// Mojave UI's companion extras: INV > REMOTE, DATA > NOTES and INBOX, and the FM radio for
// RADIO (../shared/companion.js). Built into sd/USER/MOJAVE.EXT, which the app reads from the
// SD card when it starts: it runs from RAM, so it costs no Storage (the app shares Storage
// with Pip-OS and the extensions, and there's little to spare). Without the file the app
// works as before, minus these screens.
//
// mojave.js calls global.companionExtras(kit) with its own drawing helpers:
//   kit = { bC, list, notice, corners, sound, sel(), setSel(n), frame() }
// and gets back { pages, fm, presets }.

import { fm, presets, notes, readNote, messages, saveMessages, when, remote, REMOTE_LABEL, REMOTE_KEYS } from "../shared/companion.js";

global.companionExtras = (k) => {
  const READ_ROWS = 7;

  /** A text reader filling the content area: a title line, then `lines` from `top`. */
  function reader(b, title, lines, top) {
    b.setFontMonofonto16().setFontAlign(-1, -1).setColor(2).drawString(title, 10, 4);
    b.setColor(1).drawLine(0, 24, 399, 24).setFontMonofonto18().setColor(3);
    lines.slice(top, top + READ_ROWS).forEach((l, i) => b.drawString(l, 10, 30 + i * 22));
    b.setFontMonofonto16().setFontAlign(0, -1).setColor(1)
      .drawString(lines.length > READ_ROWS ? "WHEEL: SCROLL   PRESS: BACK" : "PRESS THE WHEEL TO GO BACK", 200, 190);
  }

  /** NOTES and INBOX: a list (wheel picks, press opens) and a reader (wheel scrolls, press goes back). */
  function textPage(o) {
    return {
      build: () => ({ items: o.load(), open: -1, lines: [], top: 0 }),
      draw(b, d) {
        if (d.open >= 0) return reader(b, o.title(d.items[d.open]), d.lines, d.top);
        if (!d.items.length) return k.notice(b, o.none, o.hint);
        k.list(b, d.items.map(o.row), 4, 14, 392, 6, 30);
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
      row: (n) => ({ t: n.title }),
      title: (n) => n.title,
      text: (items, i) => readNote(items[i].file),
      none: "NO NOTES ON SD CARD",
      hint: ["WRITE THEM ON THE PIP-BOY COMPANION", "(ID, LISTS & NOTES)"],
    }),

    // DATA > INBOX: messages sent from the companion's Home page, newest first
    INBOX: textPage({
      load: messages,
      row: (m) => ({ t: when(m.at) + "  " + String(m.text).split("\n")[0], mark: !m.read }),
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
        b.setFontMonofonto23().setFontAlign(0, -1).setColor(3).drawString("MEDIA REMOTE", 200, 4);
        b.setFontMonofonto16().setColor(d.ok ? 3 : 2).drawString(d.ok ? "CONNECTED TO YOUR COMPUTER" : d.hid ? "UNPLUG AND REPLUG THE USB CABLE" : "THIS FIRMWARE HAS NO USB HID", 200, 34);
        b.setColor(1).drawLine(20, 58, 380, 58).setFontAlign(-1, -1);
        REMOTE_KEYS.forEach((r, i) => b.setColor(2).drawString(r[0], 50, 68 + i * 22).setColor(3).drawString(r[1], 210, 68 + i * 22));
        b.setFontMonofonto18().setFontAlign(0, -1).setColor(3).drawString(d.last, 200, 162);
        b.setFontMonofonto16().setColor(1).drawString("TURN THE MODE DIAL TO LEAVE", 200, 190);
        k.corners(b, 4, 2, 396, 206, 12);
      },
    },
  };
  return { pages, fm, presets };
};
