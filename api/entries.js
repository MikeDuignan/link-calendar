const { ensureSchema, getPool } = require("./_db");
const { clampText, isCalendarId, isIsoDate, isMonth, normalizeUrl, readJson, sendJson } = require("./_utils");

function monthBounds(month) {
  const [yearStr, monthStr] = month.split("-");
  const year = Number(yearStr);
  const monthIndex = Number(monthStr) - 1;
  if (!Number.isFinite(year) || !Number.isFinite(monthIndex)) return null;
  const start = new Date(Date.UTC(year, monthIndex, 1));
  const end = new Date(Date.UTC(year, monthIndex + 1, 1));
  return {
    startIso: start.toISOString().slice(0, 10),
    endIso: end.toISOString().slice(0, 10),
  };
}

async function handleGet(req, res) {
  const query =
    req.query ||
    Object.fromEntries(new URL(req.url, "http://localhost").searchParams.entries());
  const calendarId = String(query.calendarId ?? "").trim();
  const month = String(query.month ?? "").trim();

  if (!isCalendarId(calendarId)) return sendJson(res, 400, { error: "Missing/invalid calendarId." });
  if (!isMonth(month)) return sendJson(res, 400, { error: "Missing/invalid month (YYYY-MM)." });

  const bounds = monthBounds(month);
  if (!bounds) return sendJson(res, 400, { error: "Invalid month." });

  await ensureSchema();
  const pool = getPool();
  const { rows } = await pool.query(
    `
      SELECT day, title, url, updated_at
      FROM link_calendar_entries
      WHERE calendar_id = $1
        AND day >= $2::date
        AND day < $3::date
      ORDER BY day ASC;
    `,
    [calendarId, bounds.startIso, bounds.endIso],
  );

  const entries = rows.map((row) => ({
    date: String(row.day),
    title: row.title ?? "",
    url: row.url ?? "",
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  }));

  return sendJson(res, 200, { entries });
}

async function upsertOne({ pool, calendarId, date, title, url }) {
  const { rows } = await pool.query(
    `
      INSERT INTO link_calendar_entries (calendar_id, day, title, url)
      VALUES ($1, $2::date, $3, $4)
      ON CONFLICT (calendar_id, day)
      DO UPDATE SET title = EXCLUDED.title, url = EXCLUDED.url, updated_at = now()
      RETURNING day, title, url, updated_at;
    `,
    [calendarId, date, title, url],
  );
  return rows[0] || null;
}

async function deleteOne({ pool, calendarId, date }) {
  await pool.query(
    `
      DELETE FROM link_calendar_entries
      WHERE calendar_id = $1 AND day = $2::date;
    `,
    [calendarId, date],
  );
}

async function handlePost(req, res) {
  const body = await readJson(req);
  const calendarId = String(body?.calendarId ?? "").trim();
  if (!isCalendarId(calendarId)) return sendJson(res, 400, { error: "Missing/invalid calendarId." });

  await ensureSchema();
  const pool = getPool();

  const entries = Array.isArray(body?.entries) ? body.entries : null;
  if (entries) {
    if (entries.length > 500) return sendJson(res, 400, { error: "Too many entries (max 500)." });

    const client = await pool.connect();
    try {
      await client.query("BEGIN;");
      for (const e of entries) {
        const date = String(e?.date ?? "").trim();
        if (!isIsoDate(date)) continue;
        const title = clampText(e?.title, 120);
        const url = normalizeUrl(e?.url);
        if (!title && !url) {
          await deleteOne({ pool: client, calendarId, date });
        } else {
          await upsertOne({ pool: client, calendarId, date, title, url });
        }
      }
      await client.query("COMMIT;");
    } catch (error) {
      await client.query("ROLLBACK;");
      throw error;
    } finally {
      client.release();
    }

    return sendJson(res, 200, { ok: true });
  }

  const date = String(body?.date ?? "").trim();
  if (!isIsoDate(date)) return sendJson(res, 400, { error: "Missing/invalid date (YYYY-MM-DD)." });

  const title = clampText(body?.title, 120);
  const url = normalizeUrl(body?.url);
  if (!title && !url) {
    await deleteOne({ pool, calendarId, date });
    return sendJson(res, 200, { deleted: true });
  }

  const row = await upsertOne({ pool, calendarId, date, title, url });
  return sendJson(res, 200, {
    entry: row
      ? {
          date: String(row.day),
          title: row.title ?? "",
          url: row.url ?? "",
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
        }
      : null,
  });
}

module.exports = async function handler(req, res) {
  try {
    // Basic cache safety for serverless.
    res.setHeader("Cache-Control", "no-store");
    if (req.method === "GET") return await handleGet(req, res);
    if (req.method === "POST") return await handlePost(req, res);
    res.setHeader("Allow", "GET, POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    return sendJson(res, 500, { error: error?.message ?? "Server error." });
  }
};
