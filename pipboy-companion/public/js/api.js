// Thin client for the local companion server.

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function request(method, path, { json, body, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: json !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
      body: json !== undefined ? JSON.stringify(json) : body,
    });
  } catch {
    throw new ApiError(0, 'offline', 'Companion server unreachable. Is `npm start` running?');
  }
  if (res.status === 204) return null;
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    // non-JSON response
  }
  if (!res.ok) {
    throw new ApiError(res.status, data?.error?.code ?? 'http_error', data?.error?.message ?? `Request failed (${res.status})`);
  }
  return data;
}

const enc = encodeURIComponent;

export const api = {
  health: () => request('GET', '/api/health'),

  listRecords: () => request('GET', '/api/records').then((d) => d.records),
  createRecord: (record) => request('POST', '/api/records', { json: record }).then((d) => d.record),
  updateRecord: (id, changes) => request('PATCH', `/api/records/${id}`, { json: changes }).then((d) => d.record),
  deleteRecord: (id) => request('DELETE', `/api/records/${id}`),
  saveSettings: (payload) => request('PUT', '/api/settings', { json: { payload } }).then((d) => d.record),

  exportBackup: () => request('GET', '/api/backup'),
  previewImport: (backup) => request('POST', '/api/backup/preview', { json: backup }),
  importBackup: (backup) => request('POST', '/api/backup/import', { json: backup }),

  listFiles: () => request('GET', '/api/files').then((d) => d.files),
  uploadFile: (name, blob, { overwrite = false } = {}) =>
    request('PUT', `/api/files/${enc(name)}${overwrite ? '?overwrite=1' : ''}`, {
      body: blob,
      headers: { 'Content-Type': 'application/octet-stream' },
    }).then((d) => d.file),
  fileUrl: (name) => `/api/files/${enc(name)}`,
  async fetchFile(name) {
    const res = await fetch(`/api/files/${enc(name)}`);
    if (!res.ok) throw new ApiError(res.status, 'http_error', `Could not read ${name} (${res.status})`);
    return new Uint8Array(await res.arrayBuffer());
  },
  deleteFile: (name) => request('DELETE', `/api/files/${enc(name)}`),

  listDumps: () => request('GET', '/api/dumps').then((d) => d.dumps),
  createDump: () => request('POST', '/api/dumps').then((d) => d.dump),
  deleteDump: (id) => request('DELETE', `/api/dumps/${enc(id)}`),
  dumpFileUrl: (id, rel) => `/api/dumps/${enc(id)}/files/${rel.split('/').map(enc).join('/')}`,
  saveDumpFile: (id, rel, bytes) =>
    request('PUT', `/api/dumps/${enc(id)}/files/${rel.split('/').map(enc).join('/')}`, {
      body: bytes,
      headers: { 'Content-Type': 'application/octet-stream' },
    }).then((d) => d.file),

  listLogs: (limit = 1000) => request('GET', `/api/logs?limit=${limit}`).then((d) => d.entries),
  appendLogs: (entries) => request('POST', '/api/logs', { json: { entries } }),
  clearLogs: () => request('DELETE', '/api/logs'),
};
