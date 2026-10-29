'use strict';

// Shared boundary for the serverless JSON APIs. Never echo parsing errors or
// credentials back to callers. Vercel may supply either text or a parsed body.
function readJsonBody(req, maxBytes = 1024 * 1024) {
  let body = req.body === undefined ? {} : req.body;
  if (typeof body === 'string' || Buffer.isBuffer(body)) {
    if (Buffer.byteLength(body) > maxBytes) {
      throw Object.assign(new Error('Requête trop volumineuse.'), { status: 413 });
    }
    try { body = JSON.parse(String(body)); }
    catch { throw Object.assign(new Error('Corps JSON invalide.'), { status: 400 }); }
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw Object.assign(new Error('Un objet JSON est requis.'), { status: 400 });
  }
  // Enforce the same bound when the platform already parsed the body.
  if (Buffer.byteLength(JSON.stringify(body)) > maxBytes) {
    throw Object.assign(new Error('Requête trop volumineuse.'), { status: 413 });
  }
  return body;
}

function privateResponse(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

module.exports = { readJsonBody, privateResponse };
