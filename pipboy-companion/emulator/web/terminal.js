// A small terminal for the Espruino console. It understands the VT100 subset Espruino's
// line editor sends (jsinteractive.c): CR, LF, backspace, cursor up/down/left/right
// (ESC[nA..D), clear to end of line (ESC[K) and of screen (ESC[J). Keys are sent as the
// Espruino Web IDE sends them.

const MAX_LINES = 2000;

const KEYS = {
  Enter: '\r',
  Backspace: '\x08',
  Delete: '\x1b[3~',
  Tab: '\t',
  Escape: '\x1b',
  ArrowUp: '\x1b[A',
  ArrowDown: '\x1b[B',
  ArrowRight: '\x1b[C',
  ArrowLeft: '\x1b[D',
  Home: '\x1b[H',
  End: '\x1b[F',
};

export class Terminal {
  /**
   * @param {HTMLElement} element  focusable element that shows the text (a <pre> works)
   * @param {(data: string) => void} send  called with what the user types
   */
  constructor(element, send) {
    this.element = element;
    this.send = send;
    this.clear();
    element.tabIndex = 0;
    element.addEventListener('keydown', (e) => this.#onKey(e));
    element.addEventListener('paste', (e) => {
      e.preventDefault();
      this.send(e.clipboardData.getData('text').replace(/\r?\n/g, '\r'));
    });
  }

  clear() {
    this.lines = [''];
    this.row = 0;
    this.col = 0;
    this.pending = ''; // an escape sequence split across writes
    this.#render();
  }

  write(text) {
    let s = this.pending + text;
    this.pending = '';
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '\x1b') {
        const m = /^\x1b\[(\??)(\d*)([A-Za-z~])/.exec(s.slice(i));
        if (!m) {
          if (s.length - i < 8) this.pending = s.slice(i); // wait for the rest
          else continue; // not a sequence we know: drop the ESC
          break;
        }
        this.#escape(m[1], m[2] === '' ? 1 : Number(m[2]), m[3]);
        i += m[0].length - 1;
      } else if (ch === '\r') this.col = 0;
      else if (ch === '\n') this.#moveTo(this.row + 1, this.col);
      else if (ch === '\x08') this.col = Math.max(0, this.col - 1);
      else if (ch >= ' ' || ch === '\t') this.#put(ch);
    }
    this.#render();
  }

  #escape(privateMode, n, cmd) {
    if (privateMode) return; // e.g. ESC[?7l (line wrap off)
    if (cmd === 'A') this.#moveTo(Math.max(0, this.row - n), this.col);
    else if (cmd === 'B') this.#moveTo(this.row + n, this.col);
    else if (cmd === 'C') this.col += n;
    else if (cmd === 'D') this.col = Math.max(0, this.col - n);
    else if (cmd === 'K') this.lines[this.row] = this.lines[this.row].slice(0, this.col);
    else if (cmd === 'J') {
      this.lines[this.row] = this.lines[this.row].slice(0, this.col);
      this.lines.length = this.row + 1;
    }
  }

  #moveTo(row, col) {
    while (this.lines.length <= row) this.lines.push('');
    this.row = row;
    this.col = col;
    if (this.lines.length > MAX_LINES) {
      const drop = this.lines.length - MAX_LINES;
      this.lines.splice(0, drop);
      this.row -= drop;
    }
  }

  #put(ch) {
    const line = this.lines[this.row].padEnd(this.col);
    this.lines[this.row] = line.slice(0, this.col) + ch + line.slice(this.col + 1);
    this.col++;
  }

  #render() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      const atBottom = this.element.scrollTop + this.element.clientHeight >= this.element.scrollHeight - 4;
      this.element.textContent = this.lines.join('\n');
      if (atBottom) this.element.scrollTop = this.element.scrollHeight;
    });
  }

  #onKey(e) {
    if (e.metaKey || (e.ctrlKey && e.key === 'v')) return; // let paste through
    if (e.ctrlKey && e.key === 'c' && getSelection().toString()) return; // copying a selection
    let data = null;
    if (e.ctrlKey && e.key.length === 1) {
      const code = e.key.toUpperCase().charCodeAt(0) - 64; // Ctrl-C -> 0x03
      if (code > 0 && code < 32) data = String.fromCharCode(code);
    } else if (KEYS[e.key]) data = KEYS[e.key];
    else if (e.key.length === 1 && !e.altKey) data = e.key;
    if (data === null) return;
    e.preventDefault();
    this.send(data);
  }
}
