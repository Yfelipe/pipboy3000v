// PIP-OS X's companion extras: INV > REMOTE, DATA > NOTES and INBOX, and the FM radio for
// RADIO (../shared/companion.js). Built into sd/USER/PIPOSX.EXT, which the app reads from the
// SD card when it starts: it runs from RAM, so it costs no Storage (the app shares Storage
// with Pip-OS and the extensions, and there's little to spare). Without the file the app
// works as before, minus these screens.
//
// pipos-x.js calls global.companionExtras(kit) with its own drawing helpers:
//   kit = { bC, list, brackets, diamond, sound, sel(), setSel(n), frame() }
// and gets back { pages, fm, presets }.

import { fm, presets, notes, readNote, messages, saveMessages, when, remote, REMOTE_LABEL, REMOTE_KEYS } from "../shared/companion.js";

global.companionExtras = (k) => {
  const READ_ROWS = 7;

  /** A text reader filling the content area: a title line, then `lines` from `top`. */
  function reader(b, title, lines, top) {
    k.diamond(b, 12, 12, 4, true);
    b.setFontMonofonto16().setFontAlign(-1, -1).setColor(3).drawString(title, 24, 4);
    b.setColor(1).drawLine(20, 26, 380, 26).setFontMonofonto18().setColor(3);
    lines.slice(top, top + READ_ROWS).forEach((l, i) => b.drawString(l, 12, 32 + i * 22));
    if (lines.length > READ_ROWS) { // scroll bar
      const h = 150, y = 32 + (h * top) / lines.length;
      b.setColor(1).drawLine(396, 32, 396, 32 + h).setColor(3).fillRect(394, y, 398, y + (h * READ_ROWS) / lines.length);
    }
    b.setFontMonofonto16().setFontAlign(0, -1).setColor(2)
      .drawString(lines.length > READ_ROWS ? "WHEEL: SCROLL  //  PRESS: BACK" : "PRESS THE WHEEL TO GO BACK", 200, 190);
  }
  function notice(b, title, lines) {
    b.setFontMonofonto18().setFontAlign(0, 0).setColor(3).drawString(title, 200, 90);
    b.setFontMonofonto16().setColor(2);
    lines.forEach((l, i) => b.drawString(l, 200, 120 + i * 20));
  }

  /** NOTES and INBOX: a list (wheel picks, press opens) and a reader (wheel scrolls, press goes back). */
  function textPage(o) {
    return {
      build: () => ({ items: o.load(), open: -1, lines: [], top: 0 }),
      draw(b, d) {
        if (d.open >= 0) return reader(b, o.title(d.items[d.open]), d.lines, d.top);
        if (!d.items.length) return notice(b, o.none, o.hint);
        k.list(b, d.items.map(o.row), 4, 12, 392, 6, 30);
      },
      onKnob(dir, d) {
        if (d.open >= 0) { d.top = E.clip(d.top - dir, 0, Math.max(0, d.lines.length - READ_ROWS)); return; }
        const before = k.sel(), now = E.clip(before - dir, 0, Math.max(0, d.items.length - 1));
        k.setSel(now);
        if (now != before) k.sound(dir > 0 ? "ROT_V_1" : "ROT_V_2");
      },
      select(d) {
        if (d.open >= 0) { d.open = -1; k.sound("CANCEL"); return; }
        if (!d.items.length) return;
        d.open = k.sel();
        d.top = 0;
        d.lines = k.bC.setFontMonofonto18().wrapString(o.text(d.items, d.open), 380);
        k.sound("OK");
      },
    };
  }

  const pages = {
    // DATA > NOTES: NOTES/*.txt, written on the companion's ID, lists & notes page
    NOTES: textPage({
      load: notes,
      row: (n) => n.title,
      title: (n) => n.title,
      text: (items, i) => readNote(items[i].file),
      none: "NO NOTES ON SD CARD",
      hint: ["WRITE THEM ON THE PIP-BOY COMPANION", "(ID, LISTS & NOTES)"],
    }),

    // DATA > INBOX: messages sent from the companion's Home page, newest first
    INBOX: textPage({
      load: messages,
      row: (m) => (m.read ? "" : "* ") + when(m.at) + "  " + String(m.text).split("\n")[0],
      title: (m) => "RECEIVED " + when(m.at),
      text(items, i) {
        if (!items[i].read) { items[i].read = true; saveMessages(items); }
        return String(items[i].text);
      },
      none: "NO MESSAGES",
      hint: ["SEND ONE FROM THE PIP-BOY COMPANION"],
    }),

    // INV > REMOTE: media keys for the computer the Pip-Boy is plugged into (USB). The
    // thumbwheel skips tracks here, so the mode dial leaves.
    REMOTE: {
      ownsKnob2: true,
      build: () => ({ hid: remote.start(), ok: remote.ready(), last: "" }),
      act(d, name) { d.ok = remote.press(name); d.last = d.ok ? REMOTE_LABEL[name] : ""; },
      onKnob(dir, d) { this.act(d, dir > 0 ? "up" : "down"); },
      onKnob2(dir, d) { this.act(d, dir > 0 ? "next" : "prev"); },
      select(d) { this.act(d, "play"); },
      play(d) { this.act(d, "mute"); },
      draw(b, d) {
        if (!d.ok && d.hid && k.frame() % 10 == 0) d.ok = remote.ready(); // the computer just found it
        // a link ring on the left, the controls on the right
        const f = k.frame(), cx = 90, cy = 96;
        b.setColor(1).drawCircle(cx, cy, 62).drawCircle(cx, cy, 44);
        for (let i = 0; i < 3; i++) {
          const a = f / 6 + (i * Math.PI * 2) / 3;
          b.setColor(d.ok ? 3 : 2).fillCircle(cx + Math.cos(a) * 53, cy + Math.sin(a) * 53, 4);
        }
        b.setFontMonofonto23().setFontAlign(0, 0).setColor(d.ok ? 3 : 2).drawString(d.ok ? "LINK" : "----", cx, cy);
        b.setFontMonofonto18().setFontAlign(-1, -1).setColor(3).drawString("MEDIA REMOTE", 184, 4);
        b.setFontMonofonto16().setColor(d.ok ? 3 : f & 8 ? 3 : 1).drawString(d.ok ? "CONNECTED" : d.hid ? "REPLUG THE USB CABLE" : "NO USB HID IN FIRMWARE", 184, 26);
        b.setColor(1).drawLine(180, 48, 396, 48);
        REMOTE_KEYS.forEach((r, i) => {
          k.diamond(b, 188, 62 + i * 36, 3, false);
          b.setColor(2).drawString(r[0], 198, 54 + i * 36).setColor(3).drawString(r[1], 198, 71 + i * 36);
        });
        b.setFontAlign(0, -1).setColor(3).drawString(d.last ? "> " + d.last : "", cx, 170);
        b.setColor(1).drawString("MODE DIAL: LEAVE", cx, 190);
        k.brackets(b, 22, 28, 158, 164, 10);
      },
    },
  };
  return { pages, fm, presets };
};
