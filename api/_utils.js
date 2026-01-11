function sendJson(res, statusCode, value) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(value));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isMonth(value) {
  return typeof value === "string" && /^\d{4}-\d{2}$/.test(value);
}

function clampText(value, maxLen) {
  const text = String(value ?? "").trim();
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen);
}

function normalizeUrl(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  try {
    return new URL(trimmed).toString();
  } catch {
    try {
      return new URL(`https://${trimmed}`).toString();
    } catch {
      return "";
    }
  }
}

function isCalendarId(value) {
  // Be permissive but bounded: avoid someone passing megabytes.
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= 10 && trimmed.length <= 80;
}

module.exports = {
  clampText,
  isCalendarId,
  isIsoDate,
  isMonth,
  normalizeUrl,
  readJson,
  sendJson,
};

