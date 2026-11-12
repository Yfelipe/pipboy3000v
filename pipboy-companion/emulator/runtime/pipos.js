// Add the official Pip-OS update to an emulated Pip-Boy (the starter one in emulator/starter,
// or any other). Pip-OS isn't part of this project: it belongs to The Wand Company, and you
// download the update from them. This does what the Pip-Boy does with it: the update's files go
// onto the SD card, and FW.JS becomes the boot code (.bootcde) with its VERSION beside it.
//
//   const plan = pipOsUpdatePlan(files);   // files: Map("FW.JS" | "UI/OK.wav" ... -> Uint8Array)
//   for (const [p, bytes] of plan.sd) fs.writeFile(p, bytes);
//   (start the emulator on a blank flash), then write plan.storage, then reboot.

/**
 * Is this the FO3's firmware (board SAPLING, feed "sapling") rather than the Mk V's? Its update
 * has no VARIANT file; its screens come as JS/*.JS files and its data as DATA/F3 and DATA/NV.
 */
function isFo3(files, base) {
  const has = (p) => [...files.keys()].some((k) => k.toUpperCase() === (base + p).toUpperCase());
  const variant = [...files.entries()].find(([k]) => k.toUpperCase() === (base + 'VARIANT').toUpperCase())?.[1];
  if (variant) return /sapling/i.test(new TextDecoder().decode(variant));
  return has('JS/STATUS.JS') && [...files.keys()].some((k) => k.toUpperCase().startsWith((base + 'DATA/F3/').toUpperCase()));
}

/** A short silent WAV in the format of the Pip-Boy's sounds (16 kHz, mono, 16 bit). */
export function silentWav(ms = 100) {
  const samples = Math.round((16000 * ms) / 1000), data = samples * 2;
  const b = new Uint8Array(44 + data), v = new DataView(b.buffer);
  const tag = (o, s) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  tag(0, 'RIFF'); v.setUint32(4, 36 + data, true); tag(8, 'WAVE');
  tag(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  tag(36, 'data'); v.setUint32(40, data, true);
  return b;
}

/**
 * What to write for an update folder. `files` maps paths relative to the folder the person
 * chose to bytes; the update may be one folder down (they picked its parent).
 * Returns { version, board: 'pipboy' | 'fo3', sd: [[absolute path, bytes]], storage: [[name, bytes]] }.
 */
export function pipOsUpdatePlan(files) {
  const fw = [...files.keys()].filter((k) => /(^|\/)FW\.JS$/i.test(k)).sort((a, b) => a.length - b.length)[0];
  if (!fw) throw new Error('That folder has no FW.JS. Choose the folder with the Pip-OS update\'s files (from https://www.thewandcompany.com/pip-boy/upgrade/).');
  const base = fw.slice(0, fw.length - 'FW.JS'.length); // "" or "blueprint_x/"
  const get = (name) => [...files.entries()].find(([k]) => k.toUpperCase() === (base + name).toUpperCase())?.[1];
  const code = files.get(fw);
  if (!new TextDecoder().decode(code.subarray(0, 4000)).includes('Pip')) throw new Error(`${fw} doesn't look like Pip-OS.`);
  const versionBytes = get('VERSION');
  const sd = [];
  for (const [k, bytes] of files) {
    if (!k.startsWith(base)) continue;
    const rel = k.slice(base.length);
    if (/^(fwupdate\.js|pipboy\.(bin|crc))$/i.test(rel)) continue; // for the real flasher only
    sd.push(['/' + rel, bytes]);
  }
  // Pip-OS boots only when the card has BOOT/ and plays BOOT/BOOT_DONE.wav; that sound comes on
  // the Pip-Boy's own card, not in the update. Silence stands in when it's missing.
  // (The FO3's update brings its own card files; this is for the Mk V.)
  const fo3 = isFo3(files, base);
  if (!fo3 && !sd.some(([p]) => p.toUpperCase() === '/BOOT/BOOT_DONE.WAV')) sd.push(['/BOOT/BOOT_DONE.wav', silentWav()]);
  const storage = [['.bootcde', code]];
  if (versionBytes) storage.push(['VERSION', versionBytes]);
  return { version: versionBytes ? new TextDecoder().decode(versionBytes).trim() : null, board: fo3 ? 'fo3' : 'pipboy', sd, storage };
}

// ------------------------------------------------------------------ where to get it
// The Wand Company publishes each release as a zip, listed in a public index on their CDN
// (as their Pip-Boy Tools read it): https://cdn.thewandcompany.com/<feed>/index.json, entries
// { Version, ReleaseDate, ReleaseNotesHtml, Assets: ["<feed>/<version>/assets/<name>.zip"] },
// paths relative to the CDN. Each variant of the firmware has its own feed.
export const PIPOS_CDN = 'https://cdn.thewandcompany.com/';
export const PIPOS_UPGRADE_PAGE = 'https://www.thewandcompany.com/pip-boy/upgrade/';

/**
 * The variants their tool knows, with the feed each one reads. `marker`: a file on the SD card
 * that identifies the variant on a Pip-Boy. `board`: the emulator board it runs on (FO3 is
 * another board, SAPLING, which runs on the FO3 prototype).
 */
export const PIPOS_VARIANTS = [
  { id: 'blueprint', name: 'Pip-Boy 3000 Mk V', feed: 'blueprint', board: 'pipboy' },
  { id: 'overseer', name: 'Pip-Boy 3000 Mk V · Overseer', feed: 'blueprint-overseer', marker: 'MISC/HANK.avi', board: 'pipboy' },
  { id: 'FO3', name: 'Pip-Boy 3000 (FO3) · runs on the prototype', feed: 'sapling', board: 'fo3' },
];
export const PIPOS_FEED = 'blueprint';
export const pipOsVariant = (id) => PIPOS_VARIANTS.find((v) => v.id === id) ?? null;

/** The variant an SD card belongs to (by its marker file), else the plain Mk V. */
export function pipOsVariantFor(fs) {
  return PIPOS_VARIANTS.find((v) => v.marker && fs?.exists?.('/' + v.marker)) ?? PIPOS_VARIANTS[0];
}

/** A path from the index as a full address, only if it stays on the CDN. */
function cdnUrl(path) {
  if (typeof path !== 'string' || !path.trim()) return null;
  try {
    const url = new URL(path, PIPOS_CDN);
    return url.origin + '/' === PIPOS_CDN ? url.toString() : null;
  } catch {
    return null;
  }
}

/** The releases in an index, newest first: [{ version, date, zipUrl, zipFile, notesUrl }]. */
export function pipOsReleases(index) {
  const out = [];
  for (const e of Array.isArray(index) ? index : []) {
    const zip = (Array.isArray(e?.Assets) ? e.Assets : []).find((a) => typeof a === 'string' && a.toLowerCase().endsWith('.zip'));
    const zipUrl = cdnUrl(zip);
    if (!zipUrl) continue;
    out.push({
      version: typeof e.Version === 'string' ? e.Version.trim().replace(/^v/i, '') : '',
      date: typeof e.ReleaseDate === 'string' ? e.ReleaseDate : '',
      zipUrl,
      zipFile: zipUrl.split('/').pop(),
      notesUrl: cdnUrl(e.ReleaseNotesHtml),
    });
  }
  return out.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}

/** Every release of a feed, newest first, or null if the index can't be read. */
export async function pipOsReleaseList({ feed = PIPOS_FEED, fetch: get = globalThis.fetch } = {}) {
  if (!PIPOS_VARIANTS.some((v) => v.feed === feed)) return null;
  try {
    const res = await get(`${PIPOS_CDN}${feed}/index.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    return pipOsReleases(await res.json());
  } catch {
    return null;
  }
}

/** The newest release of a feed, or null. */
export async function latestPipOs(options) {
  return (await pipOsReleaseList(options))?.[0] ?? null;
}
