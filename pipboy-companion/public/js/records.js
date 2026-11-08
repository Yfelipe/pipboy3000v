// Client-side cache of server records with change notifications.
import { api } from './api.js';

const state = { records: [], ready: false, error: null };
const listeners = new Set();

function emit() {
  for (const fn of listeners) fn(state);
}

export function onRecords(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const records = {
  get ready() {
    return state.ready;
  },
  get error() {
    return state.error;
  },
  all: () => state.records,
  byKind: (kind) => state.records.filter((r) => r.kind === kind),
  settings: () => state.records.find((r) => r.kind === 'settings') ?? null,

  async load() {
    try {
      state.records = await api.listRecords();
      state.ready = true;
      state.error = null;
    } catch (e) {
      state.ready = false;
      state.error = e;
    }
    emit();
    return state.ready;
  },

  async create(record) {
    const saved = await api.createRecord(record);
    state.records = [...state.records, saved];
    emit();
    return saved;
  },

  async remove(id) {
    await api.deleteRecord(id);
    state.records = state.records.filter((r) => r.id !== id);
    emit();
  },

  async saveSettings(payload) {
    const saved = await api.saveSettings(payload);
    state.records = [...state.records.filter((r) => r.kind !== 'settings'), saved];
    emit();
    return saved;
  },

  /** After a bulk import the simplest correct thing is to reload. */
  reload() {
    return this.load();
  },
};
