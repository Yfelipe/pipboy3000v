// ID, lists & feeds: the files behind Pip-OS 1.33's INV > ID, DATA > LISTS and DATA > FEEDS.
// Everything is drawn here in the browser and written to the SD card as the firmware expects
// (see pipimage.js for the formats). The ID card layout is our own design.
import { $, escapeHtml, notify, pickFiles, confirmDialog, iconRefresh } from '../ui.js';
import { log } from '../activity.js';
import { session, device, onDeviceChange } from '../device/state.js';
import { sendToSd, readFromSd, deleteFromSd } from '../device/bundles.js';
import { runJob } from '../device/jobs.js';
import * as ops from '../serial/device-ops.js';
import { pipText } from './home.js';
import { FEED, IDCARD, LISTS_PATH, pack2bpp, toGrey, quantize, dither, previewRgba, normaliseLists, listId } from '../pipimage.js';

const enc = new TextEncoder();
const dec = new TextDecoder();
const FONT = '"Rajdhani", "Arial Narrow", "Helvetica Neue", Arial, sans-serif';
const GREY = [0, 85, 170, 255];

// ------------------------------------------------------------------ images
async function loadImage(src) {
  const url = src instanceof Blob ? URL.createObjectURL(src) : src;
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    if (src instanceof Blob) URL.revokeObjectURL(url);
  }
}

/** Draw `img` cropped to fill w x h (centred), returning greyscale 0..255. */
function coverGrey(img, w, h) {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = c.getContext('2d');
  const s = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * s, dh = img.naturalHeight * s;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return { grey: toGrey(ctx.getImageData(0, 0, w, h).data), canvas: c };
}

function showLevels(canvas, levels) {
  const ctx = canvas.getContext('2d');
  ctx.putImageData(new ImageData(previewRgba(levels), canvas.width, canvas.height), 0, 0);
}

// ----------------------------------------------------------------- ID card
const PHOTO = { x: 264, y: 58, w: 122, h: 202 };
let idPhoto = null; // { levels, dataUrl }

function fields() {
  return {
    name: $('id-name').value.trim(),
    room: $('id-room').value.trim(),
    dob: $('id-dob').value.trim(),
    skill: $('id-skill').value.trim(),
    vault: $('id-vault').value.trim(),
  };
}

/** Text that fits in maxW, shrinking the font first, then truncating. */
function fitText(ctx, text, x, y, maxW, size, weight = 700) {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (ctx.measureText(text).width > maxW && s > size * 0.7) {
    s -= 1;
    ctx.font = `${weight} ${s}px ${FONT}`;
  }
  let t = text;
  while (t && ctx.measureText(t).width > maxW) t = t.slice(0, -1);
  ctx.fillText(t, x, y);
}

/** Bars of a pseudo barcode, stable for the same text. */
function barcode(ctx, text, x, y, w, h) {
  let seed = 0;
  for (const ch of text || 'PIPBOY') seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  let px = x;
  while (px < x + w) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const bw = 1 + ((seed >>> 28) % 3);
    if (seed >>> 31) ctx.fillRect(px, y, bw, h);
    px += bw + 1;
  }
}

/** The card as 0..3 levels, 400x300. */
function idCardLevels(f) {
  const { width: W, height: H } = IDCARD;
  const c = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const ctx = c.getContext('2d');
  const grey = (l) => `rgb(${GREY[l]},${GREY[l]},${GREY[l]})`;
  ctx.fillStyle = grey(0);
  ctx.fillRect(0, 0, W, H);
  // fine diagonal hatching behind everything
  ctx.strokeStyle = grey(1);
  ctx.lineWidth = 1;
  for (let i = -H; i < W; i += 12) {
    ctx.beginPath();
    ctx.moveTo(i, H);
    ctx.lineTo(i + H, 0);
    ctx.stroke();
  }
  ctx.strokeStyle = grey(2);
  ctx.lineWidth = 2;
  ctx.strokeRect(4, 4, W - 8, H - 8);
  // title
  ctx.fillStyle = grey(3);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  fitText(ctx, 'DWELLER IDENTIFICATION', W / 2, 31, W - 30, 34);
  // details panel
  const panel = (x, y, w, h) => {
    ctx.fillStyle = grey(0);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = grey(3);
    ctx.strokeRect(x, y, w, h);
  };
  panel(12, 56, 240, 158);
  ctx.textAlign = 'left';
  [['NAME', f.name], ['ROOM', f.room], ['DOB', f.dob], ['SKILL', f.skill], ['VAULT', f.vault]].forEach(([label, value], i) => {
    const y = 82 + i * 27;
    ctx.fillStyle = grey(2);
    ctx.font = `700 19px ${FONT}`;
    ctx.fillText(label, 22, y);
    ctx.fillStyle = grey(3);
    fitText(ctx, value.toUpperCase(), 92, y, 152, 21);
  });
  // number panel with barcode
  panel(12, 222, 240, 66);
  ctx.fillStyle = grey(3);
  fitText(ctx, f.vault ? `No. ${f.vault.toUpperCase()}` : 'No. ---', 22, 256, 112, 34);
  barcode(ctx, `${f.name}|${f.vault}|${f.dob}`, 146, 232, 96, 46);
  // photo frame
  panel(PHOTO.x - 2, PHOTO.y - 2, PHOTO.w + 4, PHOTO.h + 4);
  if (!idPhoto) {
    ctx.fillStyle = grey(1);
    ctx.fillRect(PHOTO.x, PHOTO.y, PHOTO.w, PHOTO.h);
    ctx.fillStyle = grey(0);
    const cx = PHOTO.x + PHOTO.w / 2;
    ctx.beginPath();
    ctx.arc(cx, PHOTO.y + 78, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx, PHOTO.y + PHOTO.h + 6, 58, 70, 0, Math.PI, 0);
    ctx.fill();
  }
  ctx.fillStyle = grey(2);
  ctx.textAlign = 'center';
  ctx.font = `700 15px ${FONT}`;
  ctx.fillText('ISSUED 2077', PHOTO.x + PHOTO.w / 2, 280);
  const levels = quantize(toGrey(ctx.getImageData(0, 0, W, H).data));
  if (idPhoto) {
    for (let y = 0; y < PHOTO.h; y++) for (let x = 0; x < PHOTO.w; x++) levels[(PHOTO.y + y) * W + PHOTO.x + x] = idPhoto.levels[y * PHOTO.w + x];
  }
  return levels;
}

function drawIdCard() {
  showLevels($('id-canvas'), idCardLevels(fields()));
  $('id-photo-clear').hidden = !idPhoto;
}

async function setPhoto(src) {
  const img = await loadImage(src);
  const { grey, canvas } = coverGrey(img, PHOTO.w, PHOTO.h);
  idPhoto = { levels: dither(grey, PHOTO.w, PHOTO.h, { contrast: 1.25 }), dataUrl: canvas.toDataURL('image/jpeg', 0.82) };
  drawIdCard();
}

async function sendId() {
  const f = fields();
  if (!f.name) return notify('Enter a name for the card.', true);
  const img = pack2bpp(idCardLevels(f), IDCARD.width, IDCARD.height);
  const json = enc.encode(JSON.stringify({ ...f, photo: idPhoto?.dataUrl ?? null }));
  const r = await sendToSd('Send the ID card', [
    { path: IDCARD.path, bytes: img, label: 'Copying the card picture' },
    { path: IDCARD.json, bytes: json, label: 'Copying the card details' },
  ], { finish: 'Your ID card is on the Pip-Boy: INV › ID.' });
  if (r?.ok) log('ID card sent to the Pip-Boy');
}

async function loadId() {
  const bytes = await readFromSd(IDCARD.json);
  if (bytes === undefined) return;
  if (bytes === null) return notify('There’s no ID card on the Pip-Boy yet.');
  try {
    const d = JSON.parse(dec.decode(bytes));
    $('id-name').value = d.name ?? '';
    $('id-room').value = d.room ?? '';
    $('id-dob').value = d.dob ?? '';
    $('id-skill').value = d.skill ?? '';
    $('id-vault').value = d.vault ?? '';
    idPhoto = null;
    if (typeof d.photo === 'string' && d.photo.startsWith('data:image/')) await setPhoto(d.photo).catch(() => {});
    drawIdCard();
    notify('Loaded the ID card from the Pip-Boy.');
  } catch (e) {
    notify(`Couldn’t read the ID card details: ${e.message}`, true);
  }
}

// ------------------------------------------------------------------- lists
let lists = { categories: [] };
let listsOnDevice = null; // the file's text when last loaded or sent

function saveDraft() {
  try {
    localStorage.setItem('pipboy-lists-draft', JSON.stringify(lists));
  } catch {}
}

function renderLists() {
  const box = $('lists-editor');
  if (!lists.categories.length) {
    box.innerHTML = '<div class="empty"><strong>No lists yet</strong><p>Load them from the Pip-Boy, or press “New list”.</p></div>';
    return;
  }
  box.innerHTML = lists.categories
    .map((c, ci) => {
      const done = c.items.filter((i) => i.done).length;
      return (
        `<section class="list-card" data-cat="${ci}"><div class="list-head">` +
        `<input class="list-name" data-cat-name="${ci}" value="${escapeHtml(c.name)}" maxlength="40" aria-label="List name">` +
        `<small>${done}/${c.items.length}</small>` +
        `<button type="button" class="mini" data-cat-move="${ci}:-1" aria-label="Move list up"${ci ? '' : ' disabled'}>↑</button>` +
        `<button type="button" class="mini" data-cat-move="${ci}:1" aria-label="Move list down"${ci < lists.categories.length - 1 ? '' : ' disabled'}>↓</button>` +
        `<button type="button" class="mini danger" data-cat-delete="${ci}">Delete list</button></div>` +
        `<ul class="list-items">` +
        c.items
          .map(
            (it, ii) =>
              `<li><input type="checkbox" data-item-done="${ci}:${ii}"${it.done ? ' checked' : ''} aria-label="Done">` +
              `<input class="item-text" data-item-text="${ci}:${ii}" value="${escapeHtml(it.text)}" maxlength="60" aria-label="Item">` +
              `<button type="button" class="mini" data-item-move="${ci}:${ii}:-1" aria-label="Move up"${ii ? '' : ' disabled'}>↑</button>` +
              `<button type="button" class="mini" data-item-move="${ci}:${ii}:1" aria-label="Move down"${ii < c.items.length - 1 ? '' : ' disabled'}>↓</button>` +
              `<button type="button" class="mini danger" data-item-delete="${ci}:${ii}" aria-label="Delete item">✕</button></li>`,
          )
          .join('') +
        `</ul><button type="button" class="mini" data-item-add="${ci}">+ Add item</button></section>`
      );
    })
    .join('');
}

function onListsInput(e) {
  const t = e.target;
  if (t.dataset.catName !== undefined) lists.categories[t.dataset.catName].name = t.value;
  else if (t.dataset.itemText !== undefined) {
    const [ci, ii] = t.dataset.itemText.split(':').map(Number);
    Object.assign(lists.categories[ci].items[ii], { text: t.value, updated: Date.now() });
  } else if (t.dataset.itemDone !== undefined) {
    const [ci, ii] = t.dataset.itemDone.split(':').map(Number);
    Object.assign(lists.categories[ci].items[ii], { done: t.checked, updated: Date.now() });
    renderLists();
  } else return;
  saveDraft();
}

function onListsClick(e) {
  const b = e.target.closest('button');
  if (!b) return;
  const d = b.dataset;
  const move = (arr, i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  };
  if (d.catDelete !== undefined) {
    const c = lists.categories[d.catDelete];
    confirmDialog({ title: `Delete “${c.name}”?`, body: `The list and its ${c.items.length} item(s) are removed here; send to the Pip-Boy to remove them there too.`, confirm: 'Delete', danger: true }).then((ok) => {
      if (!ok) return;
      lists.categories.splice(Number(d.catDelete), 1);
      saveDraft();
      renderLists();
    });
    return;
  }
  if (d.catMove) {
    const [ci, dir] = d.catMove.split(':').map(Number);
    move(lists.categories, ci, dir);
  } else if (d.itemAdd !== undefined) {
    lists.categories[d.itemAdd].items.push({ id: listId(), text: '', done: false, updated: Date.now() });
    saveDraft();
    renderLists();
    const inputs = $('lists-editor').querySelectorAll(`[data-cat="${d.itemAdd}"] .item-text`);
    inputs[inputs.length - 1]?.focus();
    return;
  } else if (d.itemMove) {
    const [ci, ii, dir] = d.itemMove.split(':').map(Number);
    move(lists.categories[ci].items, ii, dir);
  } else if (d.itemDelete) {
    const [ci, ii] = d.itemDelete.split(':').map(Number);
    lists.categories[ci].items.splice(ii, 1);
  } else return;
  saveDraft();
  renderLists();
}

async function readDeviceLists() {
  const bytes = await readFromSd(LISTS_PATH);
  if (bytes === undefined) return undefined;
  return bytes === null ? null : dec.decode(bytes);
}

async function loadLists() {
  const text = await readDeviceLists();
  if (text === undefined) return;
  if (text === null) {
    listsOnDevice = null;
    return notify('There are no lists on the Pip-Boy yet. Press “New list” to start one.');
  }
  try {
    lists = normaliseLists(JSON.parse(text));
    listsOnDevice = text;
    saveDraft();
    renderLists();
    notify(`Loaded ${lists.categories.length} list(s) from the Pip-Boy.`);
  } catch (e) {
    notify(`The lists file on the Pip-Boy couldn’t be read: ${e.message}`, true);
  }
}

async function sendLists() {
  // Drop empty items, keep empty lists (the Pip-Boy shows "No items")
  const clean = normaliseLists({
    categories: lists.categories.map((c) => ({ ...c, name: c.name.trim() || 'Untitled', items: c.items.filter((i) => i.text.trim()).map((i) => ({ ...i, text: i.text.trim() })) })),
  });
  const current = await readDeviceLists();
  if (current === undefined) return;
  if (current !== null && current !== listsOnDevice) {
    const ok = await confirmDialog({
      title: 'Replace the lists on the Pip-Boy?',
      body: listsOnDevice === null
        ? 'The Pip-Boy already has lists that you haven’t loaded here. Sending replaces them.'
        : 'The lists on the Pip-Boy changed since you loaded them (maybe items were ticked off there). Sending replaces them with the ones here.',
      confirm: 'Replace',
    });
    if (!ok) return;
  }
  const text = JSON.stringify(clean);
  const r = await sendToSd('Send lists', [{ path: LISTS_PATH, bytes: enc.encode(text), label: 'Copying the lists' }], {
    finish: `${clean.categories.length} list(s) are on the Pip-Boy: DATA › LISTS.`,
  });
  if (r?.ok) {
    lists = clean;
    listsOnDevice = text;
    saveDraft();
    renderLists();
  }
}

// -------------------------------------------------------------------- feed
let feedGrey = null;

function drawFeed() {
  if (!feedGrey) return;
  const levels = dither(feedGrey, FEED.width, FEED.height, { contrast: Number($('feed-contrast').value), brightness: Number($('feed-brightness').value) });
  showLevels($('feed-canvas'), levels);
  return levels;
}

async function pickFeed() {
  const [file] = await pickFiles({ accept: 'image/*' });
  if (!file) return;
  try {
    feedGrey = coverGrey(await loadImage(file), FEED.width, FEED.height).grey;
  } catch {
    return notify('That file couldn’t be opened as a picture.', true);
  }
  drawFeed();
  $('feed-caption').textContent = `${file.name}, cropped to fill the screen`;
  $('feed-send').disabled = false;
}

async function sendFeed() {
  const levels = drawFeed();
  if (!levels) return notify('Choose a picture first.', true);
  await sendToSd('Send the feed picture', [{ path: FEED.path, bytes: pack2bpp(levels, FEED.width, FEED.height), label: 'Copying the picture' }], {
    finish: 'Your picture is in DATA › FEEDS, after the built-in feeds.',
  });
}

async function removeFeed() {
  const ok = await confirmDialog({ title: 'Remove your feed picture?', body: `${FEED.path} is deleted from the SD card. The built-in feeds stay.`, confirm: 'Remove', danger: true });
  if (ok) await deleteFromSd('Remove the feed picture', FEED.path);
}

// ------------------------------------------------------------------- notes
// NOTES/<Title_words>.txt on the SD card, read by the Notes extension (DATA > NOTES).
let notes = []; // [{ file, title, text }] as on the Pip-Boy
let editing = null; // the note open in the editor (null = a new one)

const noteFile = (title) => `${title.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'Note'}.txt`;
const noteTitle = (file) => file.replace(/\.txt$/i, '').replace(/[_-]+/g, ' ');

function renderNotes() {
  $('notes-list').innerHTML = notes.length
    ? notes.map((n, i) => `<div class="item${n === editing ? ' current' : ''}"><button type="button" class="link" data-note="${i}"><strong>${escapeHtml(n.title)}</strong><span>${n.text.length} characters</span></button></div>`).join('')
    : '<p class="help">No notes loaded. Load them from the Pip-Boy, or start a new one.</p>';
  $('note-delete').hidden = !editing;
}

function openNote(n) {
  editing = n;
  $('notes-edit').hidden = false;
  $('note-title').value = n ? n.title : '';
  $('note-body').value = n ? n.text : '';
  renderNotes();
  $(n ? 'note-body' : 'note-title').focus();
}

async function loadNotes() {
  const r = await runJob('Load notes', async (j) => {
    j.step('Reading the NOTES folder');
    const root = await ops.sdListDir(session, '/');
    const dir = root.find((e) => e.dir && e.name.toUpperCase() === 'NOTES');
    const out = [];
    if (dir) {
      const files = (await ops.sdListDir(session, dir.path)).filter((e) => !e.dir && /\.txt$/i.test(e.name) && e.size < 20_000);
      for (const f of files) {
        j.step(`Reading ${f.name}`);
        out.push({ file: f.name, title: noteTitle(f.name), text: dec.decode(await ops.sdRead(session, f.path)) });
      }
    }
    notes = out;
    j.finish(out.length ? `Loaded ${out.length} note(s).` : 'There are no notes on the Pip-Boy yet.');
  }, { refresh: false });
  if (r.ok) {
    editing = null;
    $('notes-edit').hidden = true;
    renderNotes();
  }
}

async function saveNote(e) {
  e.preventDefault();
  const title = pipText($('note-title').value).replace(/\n/g, ' ');
  const text = pipText($('note-body').value);
  if (!title) return notify('Give the note a title.', true);
  const file = noteFile(title);
  const clash = notes.find((n) => n.file.toLowerCase() === file.toLowerCase() && n !== editing);
  if (clash && !(await confirmDialog({ title: `Replace “${clash.title}”?`, body: 'Another note already has this title.', confirm: 'Replace' }))) return;
  const old = editing && editing.file !== file ? editing.file : null;
  const r = await sendToSd('Save the note', [{ path: `NOTES/${file}`, bytes: enc.encode(text), label: `Copying ${file}` }], { finish: `“${title}” is in DATA › NOTES.` });
  if (!r?.ok) return;
  if (old) await deleteFromSd('Tidy up the old note', `NOTES/${old}`);
  notes = notes.filter((n) => n !== editing && n !== clash);
  editing = { file, title: noteTitle(file), text };
  notes.push(editing);
  notes.sort((a, b) => a.file.localeCompare(b.file));
  $('note-title').value = editing.title;
  $('note-body').value = text;
  renderNotes();
}

async function deleteNote() {
  if (!editing) return;
  const ok = await confirmDialog({ title: `Delete “${editing.title}”?`, body: 'It’s deleted from the Pip-Boy’s SD card.', confirm: 'Delete', danger: true });
  if (!ok) return;
  const r = await deleteFromSd('Delete the note', `NOTES/${editing.file}`);
  if (!r?.ok) return;
  notes = notes.filter((n) => n !== editing);
  editing = null;
  $('notes-edit').hidden = true;
  renderNotes();
}

// -------------------------------------------------------------------- init
function renderFirmware() {
  const note = $('pers-firmware');
  const fw = Number.parseFloat(device.info?.firmware ?? '');
  const old = session.connected && Number.isFinite(fw) && fw < 1.33;
  note.hidden = !old;
  if (old) note.textContent = `Your Pip-Boy has Pip-OS ${device.info.firmware}. These screens arrived in Pip-OS 1.33: update it with The Wand Company’s upgrade tool to see them. You can still prepare the files here.`;
}

export function initPersonalise() {
  for (const id of ['id-name', 'id-room', 'id-dob', 'id-skill', 'id-vault']) $(id).addEventListener('input', drawIdCard);
  $('id-photo').addEventListener('click', async () => {
    const [file] = await pickFiles({ accept: 'image/*' });
    if (file) await setPhoto(file).catch(() => notify('That file couldn’t be opened as a picture.', true));
  });
  $('id-photo-clear').addEventListener('click', () => {
    idPhoto = null;
    drawIdCard();
  });
  $('id-send').addEventListener('click', sendId);
  $('id-load').addEventListener('click', loadId);
  $('id-form').addEventListener('submit', (e) => e.preventDefault());

  try {
    const draft = JSON.parse(localStorage.getItem('pipboy-lists-draft') ?? 'null');
    if (draft) lists = normaliseLists(draft);
  } catch {}
  $('lists-editor').addEventListener('input', onListsInput);
  $('lists-editor').addEventListener('change', onListsInput);
  $('lists-editor').addEventListener('click', onListsClick);
  $('lists-add').addEventListener('click', () => {
    lists.categories.push({ id: listId(), name: 'New list', items: [] });
    saveDraft();
    renderLists();
    const names = $('lists-editor').querySelectorAll('.list-name');
    names[names.length - 1]?.select();
  });
  $('lists-load').addEventListener('click', loadLists);
  $('lists-send').addEventListener('click', sendLists);

  $('notes-load').addEventListener('click', loadNotes);
  $('notes-new').addEventListener('click', () => openNote(null));
  $('notes-list').addEventListener('click', (e) => {
    const b = e.target.closest('[data-note]');
    if (b) openNote(notes[Number(b.dataset.note)]);
  });
  $('notes-edit').addEventListener('submit', saveNote);
  $('note-delete').addEventListener('click', deleteNote);
  renderNotes();

  $('feed-pick').addEventListener('click', pickFeed);
  $('feed-contrast').addEventListener('input', drawFeed);
  $('feed-brightness').addEventListener('input', drawFeed);
  $('feed-send').addEventListener('click', sendFeed);
  $('feed-remove').addEventListener('click', removeFeed);

  onDeviceChange(renderFirmware);
  drawIdCard();
  document.fonts?.ready.then(drawIdCard); // the card uses the page's display font once it has loaded
  renderLists();
  iconRefresh();
}
