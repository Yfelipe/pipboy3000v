// Pure Espruino REPL protocol helpers. No DOM and no Web Serial – runs in the browser and in Node tests.
// Relative path resolves to /shared/validate.js in the browser (URL ".." clamps at the root)
// and to <repo>/shared/validate.js in Node.
import { byteChecksum } from '../../../shared/validate.js';

export const FRAME_OPEN = '< << ';
export const FRAME_CLOSE = ' >> >';

/**
 * Apply backspaces the way a terminal would, then strip ANSI escapes and the remaining
 * control characters (keeps \n and \r).
 * Fix: Espruino erases its input line with "\b \b" when it prints. Stripping only the "\b"
 * left stray spaces in the output, which could land inside a reply marker.
 */
export function cleanText(s) {
  s = s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '');
  if (s.includes('\x08')) {
    const out = [];
    for (const ch of s) {
      if (ch === '\x08') {
        if (out.length && out[out.length - 1] !== '\n') out.pop();
      } else out.push(ch);
    }
    s = out.join('');
  }
  return s.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, '');
}

/** Make control characters visible for logs: "\r" -> "\\r", "\x1b" -> "\\x1b". */
export function escapeControl(s) {
  return s
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, '0')}`);
}

export function randomToken(bytes = 8) {
  const b = new Uint8Array(bytes);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/**
 * Build the line sent to the REPL. \x10 turns off echo for this line. The device wraps the
 * result as {requestId, kind, value|error} and escapes every ">" so a frame terminator can
 * never appear inside the payload (fix: file contents containing ">> >" broke parsing).
 */
/**
 * Resets the Pip-Boy firmware's idle timer (what a knob turn does). Serial traffic doesn't count
 * as activity, so without this the Pip-Boy sleeps after settings.idleTimeout (2 min on the real
 * device) mid-session, and then only answers slowly or not at all (13:21 / 13:42 logs).
 */
export const KICK_IDLE = '(global.Pip&&Pip.kickIdleTimer&&Pip.kickIdleTimer())';

export function buildCommand(expression, { requestId, kind, wakeTicks = 0, keepAwake = false }) {
  const id = JSON.stringify(requestId);
  const k = JSON.stringify(kind);
  const value = keepAwake ? `(${KICK_IDLE},(${expression}))` : `(${expression})`;
  const body =
    `(function(){try{return {requestId:${id},kind:${k},value:${value}}}` +
    `catch(e){return {requestId:${id},kind:${k},error:String(e)}}})()`;
  // Optional: a short-lived device timer that ticks `wakeTicks` times, 2 ms apart, after the
  // line runs. On devices that send one USB packet per wake-up this drains the reply quickly.
  const wake = wakeTicks > 0
    ? `(function(){var n=0,i=setInterval(function(){if(++n>=${Math.floor(wakeTicks)})clearInterval(i)},2)})();`
    : '';
  // Device source must read: .split(">").join("\\u003e") – a 6-character JSON escape, not ">".
  return `\x10${wake}print(${JSON.stringify(FRAME_OPEN)}+JSON.stringify(${body}).split(">").join("\\\\u003e")+${JSON.stringify(FRAME_CLOSE)})\n`;
}

/**
 * Pull complete frames out of a receive buffer.
 * Returns { frames: [{ raw, json }], rest, outside } where `outside` is the text that is not part of any frame.
 */
// Markers are matched with flexible whitespace, like the original dashboard's
// /<\s*<<\s*([\s\S]*?)\s*>>\s*>/ – the strict "< << " / " >> >" match was a regression.
// Inside a frame every ">" is escaped by the device, so the first ">>…>" closes it.
const OPEN_RE = /<\s*<</g;
const CLOSE_RE = /\s*>>\s*>/g;
const PARTIAL_OPEN_RE = /<\s*<?$/;

export function extractFrames(buffer) {
  const frames = [];
  let outside = '';
  let pos = 0;
  for (;;) {
    OPEN_RE.lastIndex = pos;
    const open = OPEN_RE.exec(buffer);
    if (!open) {
      // Keep a possible partial opener ("<", "< <", "<<") at the end of the buffer.
      const tail = buffer.slice(pos);
      const partial = PARTIAL_OPEN_RE.exec(tail);
      const keep = partial ? tail.length - partial.index : 0;
      outside += tail.slice(0, tail.length - keep);
      return { frames, rest: tail.slice(tail.length - keep), outside };
    }
    const start = open.index;
    CLOSE_RE.lastIndex = start + open[0].length;
    const close = CLOSE_RE.exec(buffer);
    if (!close) {
      outside += buffer.slice(pos, start);
      return { frames, rest: buffer.slice(start), outside };
    }
    outside += buffer.slice(pos, start);
    let raw = buffer.slice(start + open[0].length, close.index).trim();
    let json;
    try {
      json = JSON.parse(raw);
    } catch {
      json = undefined;
      // Resync: an orphaned half frame (its tail was lost, e.g. across a reconnect) followed by
      // a complete one. Parse from the last opener so the complete frame isn't thrown away.
      const reopen = [...raw.matchAll(/<\s*<</g)].pop();
      if (reopen) {
        outside += raw.slice(0, reopen.index);
        raw = raw.slice(reopen.index + reopen[0].length).trim();
        try {
          json = JSON.parse(raw);
        } catch {}
      }
    }
    frames.push({ raw, json });
    pos = close.index + close[0].length;
  }
}

/**
 * Look for Espruino errors in REPL text that is NOT inside a frame.
 * Fix: the old check matched /\bMEMORY\b/i anywhere, so a file or directory named
 * "memory" put the session into low-memory safe mode.
 */
export function detectDeviceError(outsideText) {
  const text = cleanText(outsideText);
  const memory = text.match(/^[ \t>]*(?:New interpreter error:[^\r\n]*|ERROR: Out of Memory[^\r\n]*|[^\r\n]*\bLOW_MEMORY\b[^\r\n]*|Execution Interrupted[^\r\n]*)/m);
  if (memory) return { type: 'memory', message: memory[0].replace(/^[ \t>]+/, '').trim() };
  const uncaught = text.match(/^[ \t>]*Uncaught [^\r\n]*/m);
  if (uncaught) return { type: 'uncaught', message: uncaught[0].replace(/^[ \t>]+/, '').trim() };
  return null;
}

export function describeType(value) {
  return Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;
}

/** Does a parsed frame belong to the given transaction? */
export function frameMatches(json, job) {
  return !!json && typeof json === 'object' && !Array.isArray(json) && json.requestId === job.requestId && json.kind === job.kind;
}

/** Validate a frame value against what the transaction kind expects. */
export function validateValue(kind, value) {
  const type = describeType(value);
  if (kind === 'board') return type === 'string' || type === 'null';
  if (kind === 'sd' || kind === 'list') return type === 'array';
  return true;
}

// ----------------------------------------------------------------- bytes

export function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export { byteChecksum };

// ------------------------------------------------- device-side expressions

const q = (s) => JSON.stringify(s);
const CHECKSUM_FN = 'function(s){var c=0;for(var i=0;i<s.length;i++)c=(c+s.charCodeAt(i))>>>0;return c}';

export const expr = {
  board: () => 'process.env.BOARD',
  storageList: () => 'require("Storage").list()',
  storageSize: (name) => `(function(){var s=require("Storage").read(${q(name)});return s===undefined?null:s.length})()`,
  storageReadChunk: (name, offset, length) =>
    `(function(){var s=require("Storage").read(${q(name)},${offset},${length})||"";return {data:btoa(s),size:s.length,checksum:(${CHECKSUM_FN})(s)}})()`,
  // Fix: the first write must declare the final file size, otherwise later chunks overflow the file.
  storageWriteChunk: (name, b64, offset, totalSize) =>
    offset === 0
      ? `require("Storage").write(${q(name)},atob(${q(b64)}),0,${totalSize})`
      : `require("Storage").write(${q(name)},atob(${q(b64)}),${offset})`,
  storageErase: (name) => `(require("Storage").erase(${q(name)}),true)`,
  storageEraseAll: () => '(require("Storage").eraseAll(),true)',
  storageStats: () => 'require("Storage").getStats()',
  // Whole-file check with the native E.CRC32: a JS loop over a 100 KB file takes long enough
  // on the Pip-Boy to trip its 15 s watchdog (it rebooted mid-clean-up). Small chunk reads and
  // writes keep the JS checksum. crc is null on builds without E.CRC32.
  // A slice at a time (and kicking the watchdog) so no single command runs for long.
  storageVerify: (name, offset = 0, length = 16384) =>
    `(function(){if(E.kickWatchdog)E.kickWatchdog();var S=require("Storage"),f=S.read(${q(name)});if(f===undefined)return null;` +
    `var s=S.read(${q(name)},${offset},${length})||"";return {total:f.length,size:s.length,crc:E.CRC32?E.CRC32(s):null}})()`,
  /** Firmware power/sleep state (all guarded: other Espruino boards just return nulls). */
  pipState: () =>
    '({sleeping:global.Pip?Pip.sleeping:null,mode:global.Pip?Pip.mode:null,' +
    'usbPower:typeof VUSB_PRESENT!="undefined"?VUSB_PRESENT.read():null,' +
    'idleTimeout:typeof settings!="undefined"?settings.idleTimeout:null,' +
    'idleTimerArmed:global.Pip?!!Pip.idleTimer:null,console:E.getConsole?E.getConsole():null})',
  /** Wake the Pip-Boy only if it is asleep: powerButtonHandler would switch an awake one OFF. */
  pipWake: () =>
    '(global.Pip&&Pip.sleeping&&Pip.sleeping!="BUSY"&&Pip.powerButtonHandler)?(Pip.powerButtonHandler(),"waking"):(global.Pip?"not asleep ("+Pip.sleeping+")":"no Pip object")',
  sdList: () => 'require("fs").readdirSync("/")',
  /** [[name, size, isDir], …] for one SD directory. size is -1 if stat failed. */
  sdListDir: (path) =>
    `(function(p){var fs=require("fs");return fs.readdirSync(p).filter(function(n){return n!="."&&n!=".."}).map(function(n){` +
    `var s=null;try{s=fs.statSync((p=="/"?"":p)+"/"+n)}catch(e){}return [n,s?s.size:-1,s&&s.dir?1:0]})})(${q(path)})`,
  sdMkdir: (path) => `(require("fs").mkdirSync(${q(path)}),true)`,
  sdUnlink: (path) => `(require("fs").unlinkSync(${q(path)}),true)`,
  /**
   * Everything the dashboard's status views need, in one round trip: firmware version, Storage
   * usage, every Storage file with its size, and whether an SD card answers. Each part is guarded.
   */
  deviceSummary: () =>
    '(function(){var S=require("Storage"),r={version:process.env.VERSION,firmware:null,stats:null,files:[],sd:false};' +
    'try{r.firmware=S.read("VERSION")||null}catch(e){}try{r.stats=S.getStats()}catch(e){}' +
    'r.files=S.list().map(function(n){var s=S.read(n);return [n,s===undefined?-1:s.length]});' +
    'try{r.sd=require("fs").readdirSync("/").length>0}catch(e){}r.now=Date.now();' +
    'r.pipos=typeof MODEINFO=="object"&&typeof saveSettings=="function";' +
    'try{var b=S.read(".bootPowerOn");r.powerOn=b?b.slice(0,300):null}catch(e){}return r})()',
  /**
   * The Pip-Boy's own settings: the firmware's live `settings` object while the stock
   * interface runs (live: true), otherwise SD card settings.json. Plus clock facts.
   */
  pipSettings: () =>
    '(function(){var live=typeof settings=="object"&&typeof saveSettings=="function",s=live?settings:null;' +
    'if(!s){try{s=JSON.parse(require("fs").readFile("settings.json"))}catch(e){}}' +
    'return {live:live,settings:s||null,time:Date.now(),rtc:E.getRTCCalibration?E.getRTCCalibration():null,' +
    'calibrated:E.getClock?!!(E.getClock()||{}).RTCCalibrated:null}})()',
  /** Merge `patch` into the settings: live through the firmware's saveSettings(), else into settings.json. */
  pipSettingsWrite: (patch) =>
    `(function(p){if(typeof settings=="object"&&typeof saveSettings=="function"){Object.assign(settings,p);` +
    `if("timezone" in p)E.setTimeZone(p.timezone);saveSettings();return "live"}` +
    `var fs=require("fs"),s={};try{s=JSON.parse(fs.readFile("settings.json"))}catch(e){}` +
    `Object.assign(s,p);fs.writeFile("settings.json",JSON.stringify(s));if("timezone" in p)E.setTimeZone(p.timezone);return "file"})(${q(patch)})`,
  /** Set the clock (ms since 1970, UTC) the way the firmware's own clock menu does. */
  pipSetTime: (ms) =>
    `(function(t){if(global.Pip&&Pip.setDateAndTime)Pip.setDateAndTime(new Date(t));else setTime(t/1000);return Date.now()})(${Math.round(ms)})`,
  /**
   * SD card space from fs.getFree (Espruino 2v29+; undefined elsewhere). Counting free clusters
   * can take a while on a big card, so the watchdog is kicked first.
   */
  sdFree: () =>
    '(function(){if(E.kickWatchdog)E.kickWatchdog();var fs=require("fs");if(!fs.getFree)return null;' +
    'var f=fs.getFree("");if(!f)return null;return {free:f.freeSectors*f.sectorSize,total:f.totalSectors*f.sectorSize}})()',
  /**
   * A message from the companion: kept in USER/MESSAGES.json (the Inbox extension lists it) and,
   * when the stock interface is on screen, shown straight away in a prompt over the current page.
   */
  pipMessage: (text, at) =>
    `(function(t,at){var fs=require("fs"),F="USER/MESSAGES.json",l=[];try{l=JSON.parse(fs.readFile(F))}catch(e){}if(!Array.isArray(l))l=[];` +
    `var live=typeof showMainMenu=="function"&&typeof MODEINFO=="object"&&Pip.sleeping===false&&!!Pip.mode;` +
    // Mojave UI and PIP-OS X show it themselves (and keep it in their own DATA > INBOX)
    `var app=!live&&typeof companionMessage=="function";` +
    `l.push({text:t,at:at,read:live||app});if(l.length>50)l=l.slice(-50);try{fs.mkdir("USER")}catch(e){}fs.writeFile(F,JSON.stringify(l));` +
    `if(live){if(Pip.kickIdleTimer)Pip.kickIdleTimer();if(Pip.removeSubmenu)Pip.removeSubmenu();delete Pip.removeSubmenu;g.clearRect(BGRECT).clearRect(53,34,423,58);` +
    `try{Pip.audioStart("UI/ALERT.wav")}catch(e){}g.setFontMonofonto18();` +
    `E.showPrompt(g.wrapString(t,380).slice(0,5).join("\\n"),{title:"INCOMING MESSAGE",buttons:{OK:true}}).then(function(){` +
    `if(Pip.removeSubmenu)Pip.removeSubmenu();delete Pip.removeSubmenu;g.clearRect(BGRECT);drawHeader(Pip.mode);var m=MODEINFO[Pip.mode];` +
    `if(m&&m.submenu){var k=Object.keys(m.submenu);m.submenu[k[sm0]||k[0]]()}else if(m&&m.fn)m.fn()})}` +
    `if(app)companionMessage(t);` +
    `return {live:live||app,app:app,count:l.length,inbox:!!require("Storage").read("ext.inbox.js")}})(${q(text)},${Math.round(at)})`,
  /**
   * The stock interface's display colour, computed on the device exactly as Pip-OS's
   * DATA > MAINTENANCE > Display color does (g.toColor), applied live and saved to settings.json.
   * color: { r, g, b, scanline, overscan }, each 0..255.
   */
  pipPalette: (color) =>
    `(function(a){var f=a.r/255,h=a.g/255,i=a.b/255,d=1-a.scanline/255,e=a.overscan/1275,P=[0,1,2,3].map(function(){return new Uint16Array(16)});` +
    `for(var b=0;b<16;b++){var c=Math.max(0,(b-12)/30),k=b/15;P[0][b]=g.toColor(c+f*k,c+h*k,c+i*k);P[1][b]=g.toColor(c+d*f*k,c+d*h*k,c+d*i*k);` +
    `P[2][b]=g.toColor(c+(e+f)*k,c+(e+h)*k,c+(e+i)*k);P[3][b]=g.toColor(c+(e+d*f)*k,c+(e+d*h)*k,c+(e+d*i)*k)}` +
    `var p=P.map(function(x){return btoa(x.buffer)}).join(",");` +
    `if(typeof settings=="object"&&typeof saveSettings=="function"){if(Pip.setPalette)Pip.setPalette(P);settings.color=a;settings.palette=p;saveSettings();return "live"}` +
    `var fs=require("fs"),s={};try{s=JSON.parse(fs.readFile("settings.json"))}catch(x){}s.color=a;s.palette=p;fs.writeFile("settings.json",JSON.stringify(s));return "file"})(${q(color)})`,
  /** [[name, size], …] for every Storage file, including system and StorageFile chunk names. */
  storageListDetailed: () =>
    '(function(){var S=require("Storage");return S.list().map(function(n){var s=S.read(n);return [n,s===undefined?-1:s.length]})})()',
  /** Firmware/device facts for an emulator. Each field is collected independently. */
  deviceInfo: () =>
    '(function(){var r={},S=require("Storage");function t(k,f){try{r[k]=f()}catch(e){r[k]={error:String(e)}}}' +
    't("env",function(){return process.env});t("version",function(){return process.version});' +
    't("memory",function(){return process.memory()});t("storageFree",function(){return S.getFree()});' +
    't("storageStats",function(){return S.getStats()});t("flags",function(){return E.getFlags()});' +
    't("time",function(){return Date.now()});t("timezone",function(){return E.getTimeZone?E.getTimeZone():null});' +
    't("globals",function(){return Object.getOwnPropertyNames(global)});return r})()',
  /** For each global name: its type, own property names and prototype property names (arrays summarised). */
  globalShapes: (names) =>
    `(function(ns){var o={};ns.forEach(function(n){try{var v=global[n],t=typeof v,e={type:t};` +
    `if(v&&(t=="object"||t=="function")){if(t!="function"&&typeof v.length=="number"){e.length=v.length}else{` +
    `var k=Object.getOwnPropertyNames(v);e.own=k.length>300?k.slice(0,300):k;if(k.length>300)e.truncated=k.length;` +
    `if(t=="function"&&v.prototype)e.proto=Object.getOwnPropertyNames(v.prototype)}}o[n]=e}catch(x){o[n]={error:String(x)}}});return o})(${q(names)})`,
  sdSize: (path) => `require("fs").statSync(${q(path)}).size`,
  sdStat: (path) => `require("fs").statSync(${q(path)})`,
  sdOpen: (path, mode, handle) => `(function(){global.${handle}=E.openFile(${q(path)},${q(mode)});return !!global.${handle}})()`,
  sdReadChunk: (handle, length) =>
    `(function(){var s=${handle}.read(${length})||"";return {data:btoa(s),size:s.length,checksum:(${CHECKSUM_FN})(s)}})()`,
  sdWriteChunk: (handle, b64) => `(function(){var s=atob(${q(b64)});${handle}.write(s);return {size:s.length,checksum:(${CHECKSUM_FN})(s)}})()`,
  sdClose: (handle) => `(function(){if(global.${handle}){${handle}.close();delete global.${handle}}return true})()`,
};

/** Command preview for logs – never include file contents. */
export function previewExpression(expression) {
  if (/atob\(/.test(expression)) return '[file contents redacted]';
  return expression.length > 180 ? `${expression.slice(0, 180)}…` : expression;
}
