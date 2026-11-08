// Activity log: bounded in memory, info/error entries persisted to the server in batches.
// Fix: the original kept every entry forever and re-rendered the whole list on each one,
// which froze the page during long serial transfers.
import { api } from './api.js';

export const MEMORY_LIMIT = 2000;

const entries = []; // newest first
const listeners = new Set();
let outbox = [];
let flushTimer = null;
let scheduled = false;

function emit() {
  if (scheduled) return;
  scheduled = true;
  const run = () => {
    scheduled = false;
    for (const fn of listeners) fn();
  };
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
  else setTimeout(run, 0);
}

export function onActivity(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function log(message, level = 'info') {
  const entry = { at: new Date().toISOString(), level, message: String(message) };
  entries.unshift(entry);
  if (entries.length > MEMORY_LIMIT) entries.length = MEMORY_LIMIT;
  if (level !== 'debug') {
    outbox.push(entry);
    flushTimer ??= setTimeout(flush, 1000);
  }
  emit();
}

export async function flush() {
  clearTimeout(flushTimer);
  flushTimer = null;
  if (!outbox.length) return;
  const batch = outbox.splice(0, 500);
  try {
    await api.appendLogs(batch);
  } catch {
    // Server unavailable: keep entries for the next attempt (bounded).
    outbox = [...batch, ...outbox].slice(-MEMORY_LIMIT);
    flushTimer = setTimeout(flush, 5000);
    return;
  }
  if (outbox.length) flushTimer = setTimeout(flush, 250);
}

/** Load persisted history (older than anything logged this session). */
export async function loadHistory() {
  const history = await api.listLogs(1000);
  const seen = new Set(entries.map((e) => e.at + e.message));
  for (const e of history) if (!seen.has(e.at + e.message)) entries.push(e);
  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
  if (entries.length > MEMORY_LIMIT) entries.length = MEMORY_LIMIT;
  emit();
}

export function getEntries({ q = '', includeDebug = false } = {}) {
  const needle = q.toLowerCase();
  return entries.filter((e) => (includeDebug || e.level !== 'debug') && (!needle || e.message.toLowerCase().includes(needle)));
}

export async function clearAll() {
  outbox = [];
  entries.length = 0;
  await api.clearLogs();
  emit();
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (!outbox.length) return;
    const body = JSON.stringify({ entries: outbox.splice(0, 500) });
    try {
      fetch('/api/logs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true });
    } catch {}
  });
}
