// INV > REMOTE: the Pip-Boy as a media remote for the computer it's plugged into, over USB
// (a USB keyboard + media keys device next to the serial port; the dashboard keeps working).
// Wheel: volume; wheel press: play/pause; thumbwheel: previous/next track; PLAY: mute.
// The computer only sees the remote after the USB cable is plugged in with it set up, so the
// screen asks for a reconnect when needed. The stock INV > ATTACHMENTS > EXT TERMINAL keeps
// working: it shares the keyboard part.
// companion-extension remote 1
(function () {
  // Report 1: a boot keyboard; report 2: consumer (media) keys. Base64, since an array would
  // cost a RAM block per byte for as long as Pip-OS runs.
  var DESC = atob("BQEJBqEBhQEFBxngKecVACUBdQGVCIEClQF1CIEBlQV1AQUIGQEpBZEClQF1A5EBlQZ1CBUAJWgFBxkAKWiBAMAFDAkBoQGFAhUAJpwCGQAqnAJ1EJUBgQDA"), bytes = [];
  var setHID = E.setUSBHID, send = E.sendUSBHID;
  if (!setHID || !send) return;
  for (var i = 0; i < DESC.length; i++) bytes.push(DESC.charCodeAt(i));
  setHID({ reportDescriptor: bytes });
  bytes = DESC = undefined;
  // The stock terminal sets a plain keyboard and sends 8 byte reports: keep our descriptor and
  // give its reports the keyboard's report ID.
  E.setUSBHID = function () {};
  E.sendUSBHID = function (d) { return send(d.length == 8 ? [1].concat([].slice.call(d)) : d); };
  var KEY = { play: 0xCD, next: 0xB5, prev: 0xB6, up: 0xE9, down: 0xEA, mute: 0xE2 };
  var LABEL = { play: "PLAY / PAUSE", next: "NEXT TRACK", prev: "PREVIOUS TRACK", up: "VOLUME UP", down: "VOLUME DOWN", mute: "MUTE" };

  function press(name) {
    if (!send([2, KEY[name] & 255, KEY[name] >> 8])) return false;
    setTimeout(function () { send([2, 0, 0]); }, 30);
    Pip.kickIdleTimer();
    return true;
  }

  MODEINFO[2].submenu.REMOTE = function () {
    var last = "", ok = send([2, 0, 0]), playWas = BTN_PLAY.read();
    function draw() {
      bC.clear(1).setFontAlign(0, -1).setColor(3).setFontMonofonto23().drawString("MEDIA REMOTE", 200, 4);
      bC.setFontMonofonto16().setColor(ok ? 3 : 2).drawString(ok ? "CONNECTED TO YOUR COMPUTER" : "UNPLUG AND REPLUG THE USB CABLE", 200, 34);
      bC.setColor(1).drawLine(20, 58, 380, 58).setColor(3).setFontAlign(-1, -1);
      [["WHEEL", "VOLUME"], ["PRESS WHEEL", "PLAY / PAUSE"], ["THUMBWHEEL", "PREVIOUS / NEXT"], ["PLAY BUTTON", "MUTE"]].forEach(function (r, i) {
        bC.setColor(2).drawString(r[0], 40, 70 + i * 22).setColor(3).drawString(r[1], 200, 70 + i * 22);
      });
      bC.setFontAlign(0, -1).setFontMonofonto18().setColor(3).drawString(last, 200, 166);
      bC.setFontMonofonto16().setColor(1).drawString("TURN THE MODE DIAL TO LEAVE", 200, 192);
      bC.flip();
    }
    function act(name) { ok = press(name); last = ok ? LABEL[name] : ""; draw(); }
    function knob1(d) { E.stopEventPropagation(); act(d > 0 ? "up" : d < 0 ? "down" : "play"); }
    function knob2(d) { E.stopEventPropagation(); act(d > 0 ? "next" : "prev"); }
    var poll = setInterval(function () {
      var p = BTN_PLAY.read();
      if (p && !playWas) act("mute");
      playWas = p;
      if (!ok && send([2, 0, 0])) { ok = true; draw(); } // the computer just found it
    }, 100);
    Pip.HIDenabled = true; // the stock PLAY button handling stands aside
    Pip.prependListener("knob1", knob1);
    Pip.prependListener("knob2", knob2);
    Pip.removeSubmenu = function () {
      clearInterval(poll);
      Pip.removeListener("knob1", knob1);
      Pip.removeListener("knob2", knob2);
      delete Pip.HIDenabled;
    };
    draw();
  };
})();
