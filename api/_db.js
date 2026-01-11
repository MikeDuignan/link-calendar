const { Pool } = require("pg");

function getConnectionString() {
  return (
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL ||
    ""
  );
}

function getPool() {
  if (global.__linkCalendarPool) return global.__linkCalendarPool;

  const connectionString = getConnectionString();
  if (!connectionString) {
    throw new Error(
      "Missing Postgres connection string. Set POSTGRES_URL (Vercel Postgres) or DATABASE_URL.",
    );
  }

  const pool = new Pool({
    connectionString,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });

  global.__linkCalendarPool = pool;
  return pool;
}

let ensured = null;
async function ensureSchema() {
  if (ensured) return ensured;
  ensured = (async () => {
    const pool = getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS link_calendar_entries (
        calendar_id text NOT NULL,
        day date NOT NULL,
        title text NOT NULL DEFAULT '',
        url text NOT NULL DEFAULT '',
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (calendar_id, day)
      );
    `);
    await pool.query(`
      CREATE INDEX IF NOT EXISTS link_calendar_entries_calendar_day_idx
      ON link_calendar_entries (calendar_id, day);
    `);
  })();
  return ensured;
}

module.exports = {
  ensureSchema,
  getPool,
};

