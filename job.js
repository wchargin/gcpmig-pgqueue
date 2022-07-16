const fs = require("fs");
const util = require("util");

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    throw new Error("usage: job <difficulty> <outfile>");
  }

  const [difficultyRaw, outfile] = args;
  const difficulty = Number(difficultyRaw);
  if (!Number.isInteger(difficulty) || String(difficulty) !== difficultyRaw) {
    throw new Error("difficulty: bad value: " + difficulty);
  }

  const result = await doWork(difficulty);
  await util.promisify(fs.writeFile)(outfile, result);
}

async function doWork(difficulty) {
  const start = Date.now();
  while (true) {
    const remaining = difficulty - (Date.now() - start);
    if (remaining <= 0) break;
    for (let i = 0; i < 1e8; i++) {
      // Spin instead of sleeping to consume CPU.
    }
  }
  const end = Date.now();
  return `spun ${end - start} ms`;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
