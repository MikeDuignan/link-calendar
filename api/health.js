const { sendJson } = require("./_utils");

module.exports = async function handler(req, res) {
  return sendJson(res, 200, { ok: true });
};

