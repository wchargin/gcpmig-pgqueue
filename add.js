const db = require("./db");

async function main() {
  require("dotenv").config();
  const args = process.argv.slice(2);
  if (args.length !== 1 && args.length !== 2) {
    throw new Error("usage: add <difficulty> [<n>]");
  }

  const [difficultyRaw, nRaw = "1"] = args;
  const difficulty = parseIntArg("difficulty", difficultyRaw);
  const n = parseIntArg("n", nRaw);

  await db.withClient(async (client) => {
    for (let i = 0; i < n; i++) {
      const res = await client.query(
        `
        WITH
        i_req AS (
          INSERT INTO requests (difficulty)
          VALUES ($1::int)
          RETURNING req_id
        ),
        i_queue AS (
          INSERT INTO work_queue (req_id, create_time)
          SELECT req_id, now() FROM i_req
        )
        SELECT
          req_id AS "reqId",
          pg_notify('wake', '')
        FROM i_req
        `,
        [difficulty]
      );
      if (res.rows.length !== 1) throw new Error("failed to add request");
      const [{ reqId }] = res.rows;
      console.log(`added request ${reqId} at difficulty ${difficulty}`);
    }
  });
}

function parseIntArg(name, s) {
  const n = Number(s);
  if (!Number.isInteger(n) || String(n) !== s) {
    throw new Error("%s: bad value: %s", name, s);
  }
  return n;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
