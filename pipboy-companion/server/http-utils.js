import { AppError } from './errors.js';

export async function readBody(req, limit) {
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > limit) {
    throw new AppError(413, 'too_large', `Request body exceeds the ${limit} byte limit`, { Connection: 'close' });
  }
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) {
      throw new AppError(413, 'too_large', `Request body exceeds the ${limit} byte limit`, { Connection: 'close' });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(req, limit = 1_000_000) {
  const type = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
  if (type !== 'application/json') {
    throw new AppError(415, 'unsupported_media_type', 'Content-Type must be application/json');
  }
  const body = await readBody(req, limit);
  if (!body.length) throw new AppError(400, 'empty_body', 'Request body is empty');
  try {
    return JSON.parse(body.toString('utf8'));
  } catch {
    throw new AppError(400, 'invalid_json', 'Request body is not valid JSON');
  }
}

export function sendJson(res, status, body, headers = {}) {
  const payload = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': payload.length,
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

export function sendNoContent(res) {
  res.writeHead(204, { 'Cache-Control': 'no-store' });
  res.end();
}

export function sendError(res, err) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  if (err instanceof AppError) {
    sendJson(res, err.status, { error: { code: err.code, message: err.message } }, err.headers);
    return;
  }
  console.error(err);
  sendJson(res, 500, { error: { code: 'internal', message: 'Internal server error' } });
}
