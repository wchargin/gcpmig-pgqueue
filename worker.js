const child_process = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const util = require("util");

const db = require("./db");
const signal = require("./signal");

async function main() {
  require("dotenv").config();
  await db.withPool(async (pool) => {
    await db.acqrel(pool, async (listenClient) => {
      const wake = signal();
      listenClient.on("notification", (n) => {
        if (n.channel !== "wake") return;
        wake.set();
      });
      await listenClient.query("LISTEN wake");

      console.log("listening at %s", new Date().toISOString());
      wake.set();
      while (true) {
        await wake.waitAndReset();
        async function worker(i) {
          console.log(`core ${i}: spinning up worker`);
          await db.acqrel(pool, (client) => consumeAll(client, i));
          console.log(`core ${i}: done`);
        }
        await Promise.all(os.cpus().map((_, i) => worker(i)));
      }
    });
  });
}

async function consumeAll(client, i) {
  while (true) {
    await client.query("BEGIN");
    const claimRes = await client.query(
      `
      WITH
      claimed AS (
        SELECT req_id FROM work_queue
        ORDER BY create_time
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      ),
      deleted AS (
        DELETE FROM work_queue
        WHERE req_id = (SELECT req_id FROM claimed)
      )
      SELECT req_id AS "reqId", difficulty FROM requests
      WHERE req_id = (SELECT req_id FROM claimed)
      `
    );
    if (claimRes.rows.length === 0) {
      await client.query("ROLLBACK");
      return;
    }
    const [{ reqId, difficulty }] = claimRes.rows;
    console.log(`core ${i}: got request ${reqId} at difficulty ${difficulty}`);

    const jobScript = path.join(__dirname, "job.js");
    const tmpdir = await util.promisify(fs.mkdtemp)(
      path.join(os.tmpdir(), "job-")
    );

    let result = null;
    try {
      const outfile = path.join(tmpdir, "out-" + reqId);
      try {
        try {
          await util.promisify(child_process.execFile)("node", [
            jobScript,
            String(difficulty),
            outfile,
          ]);
          const buf = await util.promisify(fs.readFile)(outfile);
          result = buf.toString("utf-8");
        } catch (e) {
          console.error(e);
          await client.query("ROLLBACK");
          return;
        }
      } finally {
        await util
          .promisify(fs.unlink)(outfile)
          .catch((e) => {});
      }
    } finally {
      await util.promisify(fs.rmdir)(tmpdir);
    }
    if (result == null) {
      throw new Error("failed to set result");
    }
    await client.query(
      `
      INSERT INTO responses (req_id, create_time, result)
      VALUES ($1::bigint, now(), $2::text)
      `,
      [reqId, result]
    );
    console.log(`core ${i}: finished request ${reqId}`);

    const contents = await client.query("COMMIT");
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
