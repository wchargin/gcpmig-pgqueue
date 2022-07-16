const pg = require("pg");

async function acqrel(pool, callback) {
  const client = await pool.connect();
  try {
    return await callback(client);
  } finally {
    await client.query("ROLLBACK").catch((e) => {
      console.error("ROLLBACK failed:", e);
    });
    try {
      await client.release();
    } catch (e) {
      console.error("Client release failed:", e);
    }
  }
}

async function withPool(callback) {
  const pool = new pg.Pool();
  try {
    return await callback(pool);
  } finally {
    await pool.end();
  }
}

async function withClient(callback) {
  return await withPool((pool) => acqrel(pool, callback));
}

module.exports = {
  acqrel,
  withPool,
  withClient,
};
