const { ensureSchema, getPool } = require("./_db");
const { isCalendarId, sendJson } = require("./_utils");

module.exports = async function handler(req, res) {
  try {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return sendJson(res, 405, { error: "Method not allowed." });
    }

    const query =
      req.query ||
      Object.fromEntries(new URL(req.url, "http://localhost").searchParams.entries());
    const calendarId = String(query.calendarId ?? "").trim();
    if (!isCalendarId(calendarId)) return sendJson(res, 400, { error: "Missing/invalid calendarId." });

    await ensureSchema();
    const pool = getPool();
    const { rows } = await pool.query(
      `
        SELECT day, title, url, updated_at
        FROM link_calendar_entries
        WHERE calendar_id = $1
        ORDER BY day ASC;
      `,
      [calendarId],
    );

    const entries = rows.map((row) => ({
      date: String(row.day),
      title: row.title ?? "",
      url: row.url ?? "",
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    }));

    return sendJson(res, 200, { exportedAt: new Date().toISOString(), calendarId, entries });
  } catch (error) {
    return sendJson(res, 500, { error: error?.message ?? "Server error." });
  }
};
