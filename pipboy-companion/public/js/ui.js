// Small DOM helpers shared by every page.

export const $ = (id) => document.getElementById(id);

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Fix: lucide loads from a CDN; if it's blocked the original threw on startup and nothing worked. */
export function iconRefresh() {
  try {
    globalThis.lucide?.createIcons();
  } catch {
    // Icons are decorative.
  }
}

export function empty(title, detail) {
  return `<div class="empty"><i data-lucide="inbox"></i><strong>${escapeHtml(title)}</strong><p>${escapeHtml(detail)}</p></div>`;
}

let toastTimer;
export function notify(message, error = false) {
  const el = $('feedback');
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 5500);
}

export function download(name, content, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Run an async click handler with the button disabled for its duration. */
export async function withButton(button, fn) {
  if (button) button.disabled = true;
  try {
    return await fn();
  } finally {
    if (button) button.disabled = false;
  }
}

// ------------------------------------------------------------------ dialogs
// One accessible <dialog> (#dialog in index.html) for confirmations and short prompts,
// instead of window.confirm()/prompt() and two-click buttons.

let dialogQueue = Promise.resolve();

function openDialog({ title, body = '', details = [], input = null, confirm = 'OK', cancel = 'Cancel', danger = false }) {
  const run = () =>
    new Promise((resolve) => {
      const dlg = $('dialog');
      $('dialog-title').textContent = title;
      const bodyEl = $('dialog-body');
      bodyEl.replaceChildren();
      for (const para of [].concat(body).filter(Boolean)) bodyEl.append(Object.assign(document.createElement('p'), { textContent: para }));
      if (details.length) {
        const ul = document.createElement('ul');
        for (const d of details) ul.append(Object.assign(document.createElement('li'), { textContent: d }));
        bodyEl.append(ul);
      }
      const field = $('dialog-field');
      const inputEl = $('dialog-input');
      field.hidden = !input;
      if (input) {
        $('dialog-label').textContent = input.label;
        inputEl.value = input.value ?? '';
        inputEl.placeholder = input.placeholder ?? '';
        inputEl.maxLength = input.maxLength ?? 120;
      }
      const ok = $('dialog-ok');
      const no = $('dialog-cancel');
      ok.textContent = confirm;
      ok.className = `btn${danger ? ' danger solid' : ''}`;
      no.textContent = cancel;
      no.hidden = cancel === null;
      const finish = (value) => {
        dlg.removeEventListener('close', onClose);
        ok.onclick = no.onclick = null;
        $('dialog-form').onsubmit = null;
        if (dlg.open) dlg.close();
        resolve(value);
      };
      const onClose = () => finish(input ? null : false);
      dlg.addEventListener('close', onClose);
      no.onclick = () => finish(input ? null : false);
      $('dialog-form').onsubmit = (e) => {
        e.preventDefault();
        finish(input ? inputEl.value.trim() : true);
      };
      dlg.showModal();
      (input ? inputEl : danger ? no : ok).focus();
      if (input) inputEl.select();
    });
  const result = dialogQueue.then(run);
  dialogQueue = result.catch(() => {});
  return result;
}

/** Ask a yes/no question. Resolves true when confirmed. */
export const confirmDialog = (options) => openDialog(options);
/** Ask for one line of text. Resolves the text, or null when cancelled. */
export const promptDialog = ({ label, value, placeholder, maxLength, ...rest }) =>
  openDialog({ ...rest, input: { label, value, placeholder, maxLength } });
/** Tell the user something that needs acknowledging. */
export const infoDialog = (options) => openDialog({ confirm: 'OK', cancel: null, ...options });

/** A hidden file input the caller can open from any button. Resolves the chosen files (maybe empty). */
export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = Object.assign(document.createElement('input'), { type: 'file', accept, multiple });
    input.className = 'hidden-input';
    input.addEventListener('change', () => {
      resolve([...input.files]);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    document.body.append(input);
    input.click();
  });
}

export function stamp(date = new Date()) {
  return date.toISOString().slice(0, 19).replace(/[:T]/g, '-');
}
