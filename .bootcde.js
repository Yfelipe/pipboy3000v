function log(a, b) {
    let c;
    b || (b = "exceptions.log");
    try {
        c = require("fs").statSync("LOGS")
    } catch (b) {
        a || (a = "SD CARD ERROR")
    }
    console.log(a), c && c.dir ? require("fs").appendFile("LOGS/" + b, `${new Date().toISOString()} ${a}\n`) : require("Storage").open(b, "a").write(`${new Date().toISOString()} ${a}\n`)
}

function saveSettings() {
    if (!Pip.isSDCardInserted()) throw new Error("Can't save settings - no SD card");
    require("fs").writeFile("settings.json", JSON.stringify(settings))
}

function configureAlarm() {
    if (alarmTimeout && (console.log("Cancelling existing alarm"), clearTimeout(alarmTimeout)), alarmTimeout = undefined, settings.alarm.enabled && settings.alarm.time && !Pip.demoMode) {
        let a = new Date;
        let c = new Date().getTime();
        let b = new Date(settings.alarm.time);
        b.getHours() + b.getMinutes() / 60 <= a.getHours() + a.getMinutes() / 60 ? b.setDate(a.getDate() + 1) : b.setDate(a.getDate()), settings.alarm.time = b.getTime(), alarmTimeout = setTimeout(function a() {
            if (Pip.sleeping == "BUSY") return setTimeout(a, 1e4);
            settings.alarm.repeat || (settings.alarm.enabled = !1);
            let b = Pip.sleeping;
            b ? wakeFromSleep(showAlarm) : showAlarm(), console.log("ALARM!")
        }, settings.alarm.time - a.getTime()), console.log(`Alarm set to ${b} (${((settings.alarm.time-a.getTime())/60/6e4).toFixed(3)} hours away)`)
    }
}

function wakeOnLongPress() {
    if (BTN_POWER.read()) {
        let a = setWatch(a => {
            clearTimeout(b)
        }, BTN_POWER, {
            edge: "falling"
        });
        let b = setTimeout(b => {
            clearWatch(a), settings.longPressToWake = !1, saveSettings(), wakeFromSleep(playBootAnimation)
        }, 2e3)
    }
}

function playBootAnimation(b) {
    console.log("Playing boot animation");
    let a = null;
    return b === undefined && (b = !0), Pip.remove && Pip.remove(), Pip.removeSubmenu && Pip.removeSubmenu(), Pip.videoStart("BOOT/BOOT.avi", {
        x: 40
    }), Pip.fadeOn(), new Promise((e, f) => {
        let c = () => {
            Pip.removeListener("streamStopped", c), Pip.audioStart("BOOT/BOOT_DONE.wav"), b && (a = setTimeout(a => {
                Pip.fadeOff().then(a => {
                    showMainMenu(), setTimeout(a => Pip.fadeOn([LCD_BL]), 200)
                })
            }, 2e3)), e()
        };
        let d = () => {
            Pip.removeListener("streamStopped", d), g.clear(1).drawPoly([90, 45, 90, 35, 390, 35, 390, 45]).drawPoly([90, 275, 90, 285, 390, 285, 390, 275]);
            let a = settings.userName ? `Pip-Boy assigned to ${settings.userName}` : "Success!";
            g.setFontMonofonto18().setFontAlign(0, -1).drawString(a, 240, 250), Pip.videoStart("UI/THUMBUP.avi", {
                x: 160,
                y: 55
            }), Pip.on("streamStopped", c)
        };
        Pip.on("streamStopped", d), Pip.remove = function() {
            Pip.removeAllListeners("streamStopped"), a && clearTimeout(a)
        }
    })
}

function checkBatteryAndSleep() {
    let a = Pip.measurePin(VBAT_MEAS);
    if (VUSB_PRESENT.read()) return !1;
    if (a < 3.2) return log(`Battery voltage too low (${a.toFixed(2)} V) - shutting down immediately`), clearInterval(), clearWatch(), Pip.sleeping = !0, setTimeout(Pip.off, 100), !0;
    else if (a < 3.5) {
        log(`Battery voltage too low (${a.toFixed(2)} V) - showing battery warning then shutting down`), Pip.sleeping && Pip.wake(), clearInterval(), clearWatch();
        let b = 240,
            c = 160;
        return g.clear(1).fillRect(b - 60, c - 20, b + 60, c - 18).fillRect(b - 60, c + 18, b + 60, c + 20).fillRect(b - 60, c - 18, b - 58, c + 18).fillRect(b + 58, c - 18, b + 60, c + 18).fillRect(b + 60, c - 6, b + 68, c + 6).setColor(g.blendColor(g.theme.bg, g.theme.fg, .5)).fillRect(b - 54, c - 14, b - 48, c + 14), setTimeout(() => LCD_BL.set(), 150), Pip.sleeping = !0, setTimeout(Pip.off, 2e3), !0
    } else return !1
}

function wakeFromSleep(a) {
    Pip.sleeping = "BUSY", Pip.wake(), Pip.brightness < 10 && (Pip.brightness = 20), Pip.mode == MODE.TEST && (Pip.mode = null), Pip.addWatches(), setTimeout(c => {
        let b = [LCD_BL, LED_RED, LED_GREEN];
        rd.setupI2C(), a(), Pip.fadeOn(b).then(a => {
            Pip.sleeping = !1
        })
    }, 100)
}

function submenuBlank(a) {
    return function() {
        bC.clear(1).setFontMonofonto23(), bC.setFontAlign(0, 0).drawString(a, bC.getWidth() / 2, bC.getHeight() / 2), bC.flip(), Pip.removeSubmenu = function() {}
    }
}

function showMainMenu(b) {
    Pip.remove && Pip.remove(), Pip.mode = null, d0 = null, MEAS_ENB.write(0);
    var a = setInterval(checkMode, 50);
    Pip.on("knob2", b => {
        let a = MODEINFO[Pip.mode];
        if (a && a.submenu) {
            let c = Object.keys(a.submenu);
            sm0 = (sm0 + c.length + b) % c.length, drawHeader(Pip.mode), Pip.removeSubmenu && Pip.removeSubmenu(), delete Pip.removeSubmenu, g.clearRect(BGRECT), a.submenu[c[sm0]](), Pip.knob2Click(b)
        }
    }), Pip.on("torch", torchButtonHandler), Pip.remove = () => {
        Pip.removeSubmenu && Pip.removeSubmenu(), delete Pip.removeSubmenu, Pip.removeAllListeners("knob2"), MEAS_ENB.write(1), clearInterval(a), Pip.removeAllListeners("torch")
    }, Pip.radioOn && setTimeout(a => {
        !(Pip.sleeping || rd.isOn()) && (rd.enable(!0), Pip.mode == MODE.RADIO) && (Pip.audioStart("UI/RADIO_ON.wav"), Pip.removeSubmenu && Pip.removeSubmenu(), delete Pip.removeSubmenu, submenuRadio())
    }, 2e3)
}

function enterDemoMode() {
    function step() {
        Pip.demoTimeout = undefined;
        var timeToNext = SEQ[s][0],
            cmd = SEQ[s][1];
        try {
            print("Running:", cmd), eval(cmd)
        } catch (a) {
            print(a)
        }
        s++, s >= SEQ.length && (s = 0, console.log("Loop demo, used", process.memory().usage, "vars")), Pip.demoTimeout = setTimeout(step, timeToNext)
    }
    Pip.remove && Pip.remove(), delete Pip.remove, clearWatch(), setWatch(function() {
        E.reboot()
    }, BTN_POWER, {
        debounce: 50,
        edge: "rising",
        repeat: !0
    }), settings.idleTimeout = 0, Pip.kickIdleTimer();
    var SEQ = [
            [14e3, "playBootAnimation(0);"],
            [2e3, "showMainMenu(); Pip.demoMode = MODE.STAT;"],
            [200, "Pip.emit('knob1',20)"],
            [1e3, "Pip.emit('knob1',-1)"],
            [1e3, "Pip.emit('knob1',-1)"],
            [1e3, "Pip.emit('knob1',-1)"],
            [1e3, "Pip.emit('knob1',-1)"],
            [1e3, "Pip.emit('knob1',-1)"],
            [1e3, "Pip.emit('knob1',-1)"],
            [1e3, "Pip.emit('knob1',-1)"],
            [1e3, "Pip.emit('knob1',-1)"],
            [1e3, "Pip.emit('knob1',-1)"],
            [2e3, "Pip.emit('knob1',-1)"],
            [6e3, "Pip.emit('knob2',1)"],
            [3e3, "Pip.emit('knob2',1)"],
            [3e3, "Pip.emit('knob1',-1)"],
            [3e3, "Pip.emit('knob1',-1)"],
            [2e3, "Pip.demoMode = MODE.INV;"],
            [2e3, "Pip.emit('knob1',0)"],
            [4e3, "Pip.emit('knob1',-20)"],
            [4e3, "Pip.emit('knob1',15)"],
            [2e3, "Pip.emit('knob1',0)"],
            [2e3, "Pip.emit('knob1',-1)"],
            [2e3, "Pip.emit('knob1',0)"],
            [2e3, "Pip.emit('knob1',0)"],
            [2e3, "Pip.emit('knob2',1)"],
            [6e3, "Pip.emit('knob2',1)"],
            [5e3, "Pip.demoMode = MODE.DATA;"],
            [5e3, "Pip.emit('knob2',1)"],
            [5e3, "Pip.emit('knob1',-1)"],
            [5e3, "Pip.emit('knob1',-1)"],
            [5e3, "Pip.emit('knob1',-1)"],
            [5e3, "Pip.emit('knob1',-1)"],
            [3e3, "Pip.demoMode = MODE.MAP;"],
            [3e3, "Pip.emit('knob1',-1)"],
            [3e3, "Pip.emit('knob1',-1)"],
            [3e3, "Pip.emit('knob1',-1)"],
            [3e3, "Pip.emit('knob1',-1)"],
            [3e3, "Pip.emit('knob1',-1)"],
            [1e3, "Pip.demoMode = MODE.RADIO;"],
            [1e3, "Pip.emit('knob1',-1)"]
        ],
        s = 0;
    step()
}

function leaveDemoMode() {
    Pip.demoTimeout && (clearTimeout(Pip.demoTimeout), Pip.demoTimeout = undefined), clearWatch(), Pip.demoMode = 0, Pip.addWatches()
}

function factoryTestMode() {
    function e() {
        if (b && ftm.currentTest < ftm.tests.length) {
            Pip.removeSubmenu && Pip.removeSubmenu();
            let a = ftm.tests[ftm.currentTest];
            a.testTime = Date().toLocalISOString();
            let b = getTime();
            a.fn ? a.fn(a).then(c => {
                a.testDuration = Math.round(getTime() - b), a.pass = c, ftm.currentTest++, h(), e()
            }) : (ftm.currentTest++, e())
        } else b = !1, ftm.currentTest = null, d()
    }

    function i(c) {
        console.log("Testing inputs"), Pip.remove && Pip.remove(), clearWatch(), c.inputs = [{
            pin: MODE_SELECTOR,
            name: "Mode"
        }, {
            pin: BTN_POWER,
            name: "Power"
        }, {
            pin: BTN_TORCH,
            name: "Flashlight"
        }, {
            pin: BTN_PLAY,
            name: "Play"
        }, {
            pin: BTN_TUNEUP,
            name: "Tune Up"
        }, {
            pin: BTN_TUNEDOWN,
            name: "Tune Down"
        }, {
            pin: KNOB1_A,
            name: "Knob A"
        }, {
            pin: KNOB1_B,
            name: "Knob B"
        }, {
            pin: KNOB1_BTN,
            name: "Knob Press"
        }, {
            pin: KNOB2_A,
            name: "Thumbwheel A"
        }, {
            pin: KNOB2_B,
            name: "Thumbwheel B"
        }];
        const e = [.25, .75];
        const d = [.1, .3, .5, .7, .9];
        return c.inputLevels = new Array(c.inputs.length), c.inputPassed = new Array(c.inputs.length).fill(!1), g.setFontMonofonto18().clearRect(0, 56, 479, 319).setColor("#00C000").drawString("Input test: press buttons & turn knobs", a, 56), c.inputs.forEach((f, b) => {
            g.setColor("#008000").drawString(`${f.name.padStart(12," ")}:`, a, 80 + b * 20, !0), g.setColor("#003300").fillRect(a + 126, 80 + b * 20, a + 216, 97 + b * 20), b == 0 ? (d.forEach(c => {
                g.clearRect(a + 131 + c * 80, 80 + b * 20, a + 131 + c * 80, 97 + b * 20)
            }), g.clearRect(a + 131 + d[4] * 80, 80 + b * 20, a + 216, 97 + b * 20), c.inputLevels[b] = new Array(d.length).fill(!1)) : (e.forEach(c => {
                g.clearRect(a + 131 + c * 80, 80 + b * 20, a + 131 + c * 80, 97 + b * 20)
            }), c.inputLevels[b] = new Array(2).fill(!1)), f.pin.getInfo().analog ? f.pin.mode("analog") : (f.pin.mode("input"), f.pin.mode("input_pullup"))
        }), new Promise((h, j) => {
            function i(a) {
                a || (Pip.removeListener("knob1", i), h(!0))
            }
            let f = setInterval(function() {
                c.inputs.forEach((l, k) => {
                    let j;
                    c.inputPassed[k] || (l.pin.getInfo().analog ? j = l.pin.analog() : j = l.pin.read() ? 1 : 0, k == 0 ? d.forEach((b, a) => {
                        j > (a == 0 ? 0 : d[a - 1]) && j < b && (c.inputLevels[k][a] = j)
                    }) : j < e[0] ? c.inputLevels[k][0] = j : j > e[1] && (c.inputLevels[k][1] = j), g.setColor(0, 1, 0).fillRect(a + 129 + j * 80, 80 + k * 20, a + 133 + j * 80, 97 + k * 20), c.inputLevels[k].includes(!1) || (g.drawString("OK", a + 230, 80 + k * 20), c.inputPassed[k] = !0, l.pin.mode("input"), c.inputPassed.includes(!1) || (clearInterval(f), g.setColor(0, 1, 0).drawString("Input test: PASS - press knob to continue", a, 56, !0), Pip.addWatches(), b ? h(!0) : Pip.on("knob1", i))))
                })
            }, 50);
            Pip.remove = () => {
                clearInterval(f)
            }
        })
    }

    function j(c) {
        console.log("Testing LEDs"), Pip.remove && Pip.remove(), g.setFontMonofonto18().setFontAlign(-1, -1).clearRect(0, 56, 479, 289).setColor("#00C000").drawString("LED test", a, 56);
        let e = [LED_RED, LED_GREEN, LED_BLUE, LED_TUNING];
        let d = 0;
        let f = setInterval(function() {
            e.forEach((a, b) => {
                a.write(d == b ? 1 : 0)
            }), d = (d + 1) % 4
        }, 500);
        return Pip.remove = () => {
            clearInterval(f), e.forEach(a => a.write(0))
        }, new Promise((a, d) => {
            setTimeout(() => {
                E.showPrompt("Red, green, blue & white\nLEDs all OK?").then(d => {
                    if (d) {
                        c.LEDsOK = !0, console.log("LED test passed - checking pixels"), Pip.remove(), g.setColor(.2, 1, .2).fillRect(0, 0, 479, 319);

                        function d(e) {
                            Pip.removeListener("knob1", d), E.showPrompt("All pixels look OK?").then(d => {
                                g.clearRect(0, 0, 479, 319), d ? (c.pixelsOK = !0, console.log("Pixel test passed"), a(!0)) : (c.pixelsOK = !1, console.log("Pixel test failed"), b = !1, a(!1))
                            })
                        }
                        Pip.on("knob1", d)
                    } else c.LEDsOK = !1, console.log("LED test failed"), b = !1, a(!1)
                })
            }, 2e3)
        })
    }

    function k(c) {
        console.log("Testing measurements"), Pip.remove && Pip.remove(), c.meas = [{
            pin: RADIO_AUDIO,
            name: "FM radio",
            divider: 1,
            min: .7,
            max: 1.1,
            offMax: .3
        }, {
            pin: VUSB_MEAS,
            name: "USB supply",
            divider: 2,
            min: 4,
            max: 5.6,
            offMax: .3
        }, {
            pin: VBAT_MEAS,
            name: "Battery",
            divider: 2,
            min: 3.5,
            max: 4.4
        }, {
            pin: CHARGE_STAT,
            name: "CHRG status",
            divider: 1,
            min: 2.7,
            max: 4,
            offMax: .3
        }, {
            name: "VDD",
            min: 3.2,
            max: 3.5
        }, {
            name: "Temperature",
            min: 15,
            max: 50
        }], c.measLevel = new Array(c.meas.length), c.measOff = new Array(c.meas.length), c.measPassed = new Array(c.meas.length).fill(null), lastValue = new Array(c.meas.length), g.setFontMonofonto18().setFontAlign(-1, -1).clearRect(0, 56, 479, 289).setColor("#00C000").drawString("Measurements test", a, 56);
        let d = (j, h, b, d, c) => {
            c == null && (c = 3), d == null && (d = "#00FF00");
            let e = b.offMax ? 0 : b.min - (b.max - b.min) * .1;
            let i = b.max + (b.max - b.min) * .1;
            let f = a + 131 + (j - e) / (i - e) * 80;
            g.setColor(d).fillRect(f - c / 2, h, f + c / 2, h + 17)
        };
        c.meas.forEach((b, c) => {
            g.setColor("#008000").drawString(`${b.name.padStart(12," ")}:`, a, 85 + c * 25, !0), g.setColor("#003300").fillRect(a + 126, 85 + c * 25, a + 216, 102 + c * 25), d(b.min, 85 + c * 25, b, 0, 1), d(b.max, 85 + c * 25, b, 0, 1), b.offMax && d(b.offMax, 85 + c * 25, b, 0, 1), b.pin && b.pin.mode("analog")
        });
        let e = !1;
        return new Promise((j, k) => {
            function i(a) {
                a || (clearInterval(h), Pip.removeListener("knob1", i), rd.enable(0), e || (b = !1), j(e))
            }
            Pip.on("knob1", i);
            let f = 0;
            let h = setInterval(function() {
                if (++f == 5 && rd.enable(1), (f < 5 || f > 6) && c.meas.forEach((f, b) => {
                    let e;
                    let h = "V";
                    let i = 2;
                    if (f.name == "VDD") {
                        e = 0;
                        for (let a = 0; a < 20; a++) e += E.getAnalogVRef() / 20
                    } else if (f.name == "Temperature") {
                        e = 0;
                        for (let a = 0; a < 20; a++) e += E.getTemperature() / 20;
                        h = "C", i = 1
                    } else e = Pip.measurePin(f.pin, 100, f.divider);
                    g.setColor("#00FF00").setFontMonofonto18().drawString(`${e.toFixed(i)} ${h}  `, a + 230, 85 + b * 25, !0), lastValue[b] && d(lastValue[b], 85 + b * 25, f, "#006600"), d(e, 85 + b * 25, f), lastValue[b] = e, f.offMax && e < f.offMax && (c.measOff[b] = e), e >= f.min && e <= f.max && (c.measLevel[b] = e), c.measLevel[b] && (c.measOff[b] || !f.offMax) ? (c.measPassed[b] = !0, g.drawString("OK  ", a + 310, 85 + b * 25, !0)) : f.offMax || g.setColor("#FF2200").drawString("FAIL", a + 310, 85 + b * 25, !0).setColor("#00FF00")
                }), !(c.measPassed.includes(!1) || c.measPassed.includes(null) || e)) e = !0, b ? (clearInterval(h), Pip.removeListener("knob1", i), rd.enable(0), j(!0)) : g.setColor(0, 1, 0).drawString("Measurement test: PASS - press knob", a, 56, !0);
                else {
                    let b = c.meas.findIndex(a => a.pin == VUSB_MEAS);
                    let d = "                               ";
                    c.measLevel[b] ? c.measOff[b] ? (b = c.meas.findIndex(a => a.pin == CHARGE_STAT), c.measOff[b] || (d = "Re-connect charging cable")) : d = "Disconnect charging cable" : d = "Connect charging cable", g.drawString(d, a, 260, !0)
                }
            }, 50);
            Pip.remove = () => {
                clearInterval(h)
            }
        })
    }

    function l(d) {
        if (console.log("Testing SD card"), Pip.remove && Pip.remove(), g.setFontMonofonto18().setFontAlign(-1, -1).clearRect(0, 56, 479, 289).setColor("#00C000").drawString("SD card test", a, 56), !Pip.isSDCardInserted()) return new Promise((a, c) => {
            E.showPrompt("No SD card inserted!", {
                buttons: {
                    OK: !0
                }
            }).then(c => {
                b = !1, a(!1)
            })
        });
        else {
            const e = require("fs").getFree();
            const h = (e.freeSectors * e.sectorSize / 1e6).toFixed(0);
            const i = (e.totalSectors * e.sectorSize / 1e6).toFixed(0);
            const m = `${h}/${i} MB free`;
            let f, j;
            d.sdInfo = [{
                name: "Size",
                value: i,
                units: "MB",
                min: 240,
                max: 64e3
            }, {
                name: "Used",
                value: i - h,
                units: "MB",
                min: 10,
                max: 200
            }, {
                name: "Free",
                value: h,
                units: "MB",
                min: 20,
                max: 64e3
            }, {
                name: "Files",
                value: "Counting",
                units: '',
                min: 50,
                max: 1e4
            }, {
                name: "Write speed",
                value: null,
                units: "kB/s",
                min: 50,
                max: 1e4
            }, {
                name: "Read speed",
                value: null,
                units: "kB/s",
                min: 200,
                max: 1e4
            }, {
                name: "Integrity",
                value: "Checking",
                units: ''
            }];
            let k = !0;
            let l;
            return d.sdInfo.forEach((b, d) => {
                if (g.setColor("#008000").drawString(`${b.name.padStart(12," ")}:`, a, 85 + d * 25, !0), b.value == null) {
                    if (g.setColor("#003300").fillRect(a + 126, 85 + d * 25, a + 226, 102 + d * 25).setColor("#00FF00"), j = getTime(), b.name == "Write speed") {
                        f = E.openFile("test", "w");
                        for (let e = 0; e < 50; e++) f.write(c), g.fillRect(a + 126, 85 + d * 25, a + 126 + e * 2, 102 + d * 25)
                    } else if (b.name == "Read speed") {
                        f = E.openFile("test", "r");
                        for (let e = 0; e < 50; e++) l = f.read(c.length), g.fillRect(a + 126, 85 + d * 25, a + 126 + e * 2, 102 + d * 25)
                    }
                    j = getTime() - j, f.close(), g.clearRect(a + 126, 85 + d * 25, a + 226, 102 + d * 25), b.value = (50 * c.length / 1024 / j).toFixed(0), g.drawString(b.value + " " + b.units, a + 126, 85 + d * 25, !0)
                } else g.setColor("#00FF00").drawString(b.value + " " + b.units, a + 126, 85 + d * 25, !0);
                if (b.name == "Integrity") {
                    let e = E.toUint8Array(l);
                    if (l.length == c.length) {
                        b.value = "PASS";
                        for (let a = 0; a < l.length; a++) e[a] != c[a] && (b.value = "FAIL")
                    } else b.value = "FAIL";
                    g.drawString(b.value + "      ", a + 126, 85 + d * 25, !0)
                } else if (b.name == "Files") {
                    let c = [];

                    function e(a, b) {
                        if (a[0] == "." || b[0] == ".") return;
                        let d = require("fs").statSync(a + b);
                        d.dir ? require("fs").readdir(a + b).forEach(e.bind(null, a + b + "/")) : c.push({
                            fn: a + b,
                            l: d.size
                        })
                    }
                    require("fs").readdir().forEach(e.bind(null, '')), b.value = c.length, g.drawString(b.value + "      ", a + 126, 85 + d * 25, !0)
                }
                b.value === "PASS" || b.value >= b.min && b.value <= b.max ? g.drawString("OK", a + 230, 85 + d * 25, !0) : (g.setColor("#FF2200").drawString("FAIL", a + 230, 85 + d * 25, !0), k = !1)
            }), require("fs").unlink("test"), g.setColor(0, 1, 0).drawString("SD card test completed - press knob", a, 56, !0), new Promise((a, d) => {
                function c(b) {
                    b || (Pip.removeListener("knob1", c), a(k))
                }
                b && k ? a(!0) : Pip.on("knob1", c)
            })
        }
    }

    function m(e) {
        console.log("Testing audio"), Pip.remove && Pip.remove(), g.setFontMonofonto18().setFontAlign(-1, -1).clearRect(0, 56, 479, 289).setColor("#00C000").drawString("Audio test", a, 56);
        let f;
        if (Pip.isSDCardInserted()) Pip.audioStart("UI/ALERT.wav");
        else {
            const b = ["PREV", "NEXT", "COLUMN", "OK2"];
            let a = 0;
            f = setInterval(function() {
                Pip.audioStartVar(Pip.audioBuiltin(b[a])), a = (a + 1) % b.length
            }, 500)
        }
        let d = !0;
        let c = 100;
        return e.audio = [{
            name: "Sound check",
            value: null,
            units: null
        }, {
            name: "FM frequency",
            value: c,
            units: "MHz",
            min: 76,
            max: 108
        }, {
            name: "RSSI",
            value: 0,
            units: "dBuV",
            min: 15,
            max: 100
        }], new Promise((h, i) => {
            E.showPrompt("Sound heard OK?").then(i => {
                if (f && clearInterval(f), g.clearRect(0, 76, 479, 289), i) {
                    e.audio[0].value = "PASS", rd.init(), rd.freqSet(c), rd.setVol(15);

                    function i(a) {
                        if (!a) rd.enable(0), Pip.removeListener("knob1", i), d || (b = !1), h(d);
                        else {
                            c += a * .1, c > rd.end / 100 && (c = rd.start / 100), c < rd.start / 100 && (c = rd.end / 100);
                            try {
                                rd.freqSet(c)
                            } catch (a) {
                                console.log("Error setting frequency:", a)
                            }
                        }
                    }
                    Pip.on("knob1", i), e.audio.forEach((b, c) => {
                        g.setColor("#008000").drawString(`${b.name.padStart(12," ")}:`, a, 85 + c * 25, !0)
                    });
                    let f = 0;
                    let j = setInterval(function() {
                        f++, d = !0, e.audio.forEach((b, e) => {
                            let h = 2;
                            b.name == "FM frequency" ? b.value = c : b.name == "RSSI" && (b.value = rd.getRSSI(), h = 0);
                            let i = b.value;
                            b.units && (i = `${b.value.toFixed(h)} ${b.units}  `), g.setColor("#00FF00").setFontMonofonto18().drawString(i, a + 126, 85 + e * 25, !0), f > 3 && (b.value == "PASS" || b.value >= b.min && b.value <= b.max ? g.drawString("OK  ", a + 230, 85 + e * 25, !0) : (g.setColor("#FF2200").drawString("FAIL", a + 230, 85 + e * 25, !0).setColor("#00FF00"), d = !1))
                        }), g.drawString(d ? ": PASS - press knob" : "                   ", a + 90, 56, !0)
                    }, 200);
                    Pip.remove = () => {
                        clearInterval(j)
                    }
                } else rd.enable(0), print("Audio test failed"), b = !1, h(!1)
            })
        })
    }

    function n(c) {
        console.log("Testing USB"), Pip.remove && Pip.remove(), g.setFontMonofonto18().setFontAlign(-1, -1).clearRect(0, 56, 479, 289).setColor("#00C000").drawString("USB test", a, 56), c.pass = !1, c.status = "Connect USB cable";
        let d = !1;
        return new Promise((e, h) => {
            function a(d) {
                d || (Pip.removeListener("knob1", a), c.status = "Aborted", b = !1, e(c.pass))
            }
            Pip.on("knob1", a);
            let f = setInterval(function() {
                !d && VUSB_PRESENT.read() && (d = !0, c.status = "Waiting for data"), c.pass && (Pip.removeListener("knob1", a), e(c.pass)), g.setFontAlign(0, 0).drawString("          " + c.status + "          ", 240, 160, !0)
            }, 200);
            Pip.remove = () => {
                clearInterval(f)
            }
        })
    }
    Pip.remove && Pip.remove(), delete Pip.remove, Pip.removeSubmenu && Pip.removeSubmenu(), E.showMessage("Entering Factory Test Mode"), settings.idleTimeout = 0, Pip.kickIdleTimer(), MEAS_ENB.write(0), clearInterval(), Pip.mode = MODE.TEST, Pip.addWatches(), global.ftm = {
        id: Pip.getID(),
        jsVersion: VERSION,
        fwVersion: process.env.VERSION
    };
    let a = 60;
    LCD_BL.write(1);
    let c = new Uint8Array(4096);
    c.forEach((b, a) => c[a] = a % 256);
    let b = !1;
    rd.init() && rd.enable(0), ftm.tests = [{
        name: "Inputs",
        fn: i
    }, {
        name: "LEDs & pixels",
        fn: j
    }, {
        name: "Measurements",
        fn: k
    }, {
        name: "SD card",
        fn: l
    }, {
        name: "Audio",
        fn: m
    }, {
        name: "USB",
        fn: n
    }];
    let f = {
        '': {
            x2: 200
        },
        "[ Run all tests ]": function() {
            b = !0, ftm.currentTest = 0, e()
        }
    };
    let h = () => {
        Pip.remove && Pip.remove(), delete Pip.remove, g.clear(1).setFontMonofonto23().setColor(0, 1, 0).drawString("Pip-Boy Factory Test Mode", a, 20), g.setColor(0, .6, 0).drawLine(0, 52, 479, 52).drawLine(0, 290, 479, 290), g.setFontMonofonto16().drawString(`Version ${ftm.jsVersion} ${ftm.fwVersion}     ID:${ftm.id}`, a, 295)
    };
    let d = () => {
        h(), E.showMenu(f), bC.setFontMonofonto18().setColor(3), ftm.currentTest = null, ftm.tests.forEach((a, b) => {
            a.fn && bC.drawString(a.pass === !0 ? "PASS" : a.pass === !1 ? "FAIL!" : '', 212, 43 + b * 27)
        }), ftm.tests.every(a => a.pass === !0) && bC.fillPolyAA([290, 100, 310, 120, 355, 65, 375, 85, 310, 145, 275, 120]);
        let a = setInterval(function() {
            bC.flip()
        }, 50);
        Pip.remove = () => {
            clearInterval(a)
        }
    };
    ftm.tests.forEach((a, b) => {
        f[a.name] = function() {
            Pip.removeSubmenu && Pip.removeSubmenu(), ftm.currentTest = b, a.testTime = Date().toLocalISOString();
            let c = getTime();
            a.fn(a).then(b => {
                a.testDuration = Math.round(getTime() - c), a.pass = b, d()
            })
        }
    }), d()
}
const VERSION = "1.20";
process.env.VERSION < "2v24.409" && E.enableWatchdog(15), log(`------- Booting ${process.env.VERSION} - ${VERSION} -------`), log("Reset flags: 0x" + (peek32(1073887348) >> 24).toString(16).padStart(2, "0")), poke32(1073887348, 16777216), clearTimeout(), g.theme.fg == 65535 && g.setTheme({
    fg: 2016,
    fg2: 2016
}), process.on("uncaughtException", function(a) {
    if (Pip.sleeping) console.log("Uncaught exception while sleeping: " + a);
    else try {
        clearTimeout(), clearWatch(), Pip.sleeping = !1, B15.set();
        let b = global.__FILE__ ? `(${global.__FILE__}) : ` : '';
        b += a ? `${a.type}: ${a.message} ` : "Unknown Error", Pip.isSDCardInserted() || (b += "\n(No SD card)"), g.clearRect(120, 90, 360, 180).setColor(g.theme.fg).drawRect(120, 90, 360, 180), g.setFontMonofonto16().setFontAlign(0, 0), g.drawString(g.wrapString(b, 220).join("\n"), 240, 138, 1), g.setFont("6x8").drawString(`ID:${Pip.getID()} V${VERSION} ${process.env.VERSION}`, 240, 96, !0), a && a.stack && (b += a.stack), log(b), setWatch(a => {
            LCD_BL.write(0), setTimeout(Pip.off, 1e3)
        }, BTN_POWER), E.getConsole() != "USB" && setTimeout(Pip.off, 3e4)
    } catch (b) {
        console.log("Error in uncaught exception handler: " + b.message + "\n" + b.stack), console.log("Original error: " + a + "\n" + a.stack)
    }
}), Pip.streamPlaying || (Pip._streamPlaying = !1, Pip.on("streamStarted", () => Pip._streamPlaying = !0), Pip.on("streamStopped", () => Pip._streamPlaying = !1), Pip.streamPlaying = () => Pip._streamPlaying);
const LED_RED = LED1;
const LED_GREEN = LED2;
const LED_BLUE = LED3;
const LED_TUNING = LED4;
const BTN_PLAY = BTN1;
const BTN_TUNEUP = BTN2;
const BTN_TUNEDOWN = BTN3;
const BTN_TORCH = BTN4;
const KNOB2_A = BTN5;
const KNOB2_B = BTN6;
const KNOB1_BTN = BTN7;
const KNOB1_A = BTN8;
const KNOB1_B = BTN9;
const BTN_POWER = BTN10;
const MEAS_ENB = C4;
const LCD_BL = B15;
const VUSB_PRESENT = A9;
const VUSB_MEAS = A5;
const VBAT_MEAS = A6;
const CHARGE_STAT = C5;
const RADIO_AUDIO = A4;
const MODE_SELECTOR = A7;
const SDCARD_DETECT = A15;
pinMode(MEAS_ENB, "opendrain"), Pip.isSDCardInserted = () => !SDCARD_DETECT.read();
var settings = {};
Pip.isSDCardInserted() ? require("fs").statSync("settings.json") && (settings = JSON.parse(require("fs").readFile("settings.json"))) : log("Can't load settings - no SD card"), isFinite(settings.idleTimeout) || (settings.idleTimeout = 3e5), settings.timezone && E.setTimeZone(settings.timezone), (typeof settings.alarm)[0] != "o" && (settings.alarm = {
    time: null,
    enabled: !1,
    repeat: !1,
    soundIndex: 0
}), settings.alarm.soundFiles = [];
try {
    settings.alarm.soundFiles = require("fs").readdirSync("ALARM").filter(a => a.toUpperCase().endsWith("WAV") && !a.startsWith(".")), settings.alarm.soundIndex > settings.alarm.soundFiles.length && (settings.alarm.soundIndex = 0)
} catch (a) {
    log("No alarm sounds found")
}
MEAS_ENB.write(0);
try {
    Pip.setDACMode("out")
} catch (a) {
    log("setDACMode error: " + a)
}
Date().getFullYear() == 2e3 && setTime(new Date("2077-10-23T09:47").getTime() / 1e3), Number.prototype.twoDigit = function() {
    return this.toString().padStart(2, "0")
};
let dc = require("heatshrink").decompress;
let icons = {
    cog: "F UP\2Uÿ(\x10*\xcd\x7f\xe3¥\2o\xdfþ¾ Pwÿÿÿ\xf4\n=¼\n\bD)ø\x14\x1f\xc5V¯ÿü\xdfÿùP(?Zÿÿª\5\x1c\"\x18tQH\xc3³/\xe4\xd0\xcb!\x19H\0 ",
    holotape: "F UP\2\xd5¿ø\0,\xad|\n\x1f\xd6\xde\3\7ýV\2üª\xedm÷ÿÿ\xe6«u·KÀ¡BþB\x11\4\x1d\v\xd5ª\xd7D\x17\5\x0f\xf4\x11\x1f\xf0\x1d\x10\n\t4O-WT\0\b\xec½T",
    alarm: "\xc4 P\b\x18\x1c)p\b\x18_ÿ\1\0\xdfÁ\3\2\3\6~\3\6\2\2\7ù\7\1\xf4Á\xe8_À`\xd0@@ÿ``0~\x12\xf0\x18> \x10?ÿx\f_\xf4V}\xf1¨@/\xf4\b\0",
    noAlarm: "\xc4 P\b\x18\x1c)p\b\x18_ÿ\1\0\xc2Á\0Áx'ÿ\xc88\f\x1f¤\x7f¡\x7f\0Aÿ\xf07°0\x18;\0\xe0^/ø\f\x1fx\f\x1a\b\f8¬û\xe28\6ÿ@\0",
    charging: "D Pÿþ\3ÿ\xf0ÿ`_þ\4ÿ\xe9\3ÿ@/ýZ\xdfü\0\x17?ÿ\xf4\1\xf0 _H\4ú\1\3\xe0@&\b8´\x1a\4\0"
};
let bC = Graphics.createArrayBuffer(400, 210, 2, {
    msb: !0,
    buffer: E.toArrayBuffer(E.memoryArea(268468224, 21e3))
});
bC.flip = a => Pip.blitImage(bC, 40, 65, {
    height: a
});
let bH = Graphics.createArrayBuffer(370, 51, 4, {
    msb: !0,
    buffer: E.toArrayBuffer(E.memoryArea(268489224, 9435))
});
bH.flip = () => Pip.blitImage(bH, 53, 7, {
    noScanEffect: !0
});
let bF = Graphics.createArrayBuffer(372, 25, 2, {
    msb: !0,
    buffer: E.toArrayBuffer(E.memoryArea(268498659, 2325))
});
bF.flip = () => Pip.blitImage(bF, 52, 290, {
    noScanEffect: !0
});
let BGRECT = {
    x: 36,
    y: 58,
    w: 408,
    h: 230
};
const modes = ["STAT", "INV", "DATA", "MAP", "RADIO"];
const MODE = {
    TEST: 0,
    STAT: 1,
    INV: 2,
    DATA: 3,
    MAP: 4,
    RADIO: 5
};
let MODEINFO;
let sm0, d0, tm0, ts0;
settings.fallbackMode === undefined && (settings.fallbackMode = MODE.RADIO), Pip.measurePin = (c, a, d) => {
    d === undefined && (d = 2), a === undefined && (a = 10), MEAS_ENB.write(0), pinMode(c, "analog");
    let b = 0,
        e = 0;
    for (let f = 0; f < a; f++) b += analogRead(c) / a, e += E.getAnalogVRef() / a;
    return pinMode(c, "input"), b *= d * e, b
}, Pip.getID = () => {
    let b = peek32(536836624);
    let d = peek32(536836632);
    let c = peek32(536836628);
    let a = '';
    for (let e = 0; e < 4; e++) a += String.fromCharCode(d >> 24 - e * 8 & 255);
    for (let e = 0; e < 3; e++) a += String.fromCharCode(c >> 24 - e * 8 & 255);
    return a += "-" + (c & 255).toString(16).padStart(2, "0"), a += "-" + ((b & 16711680) >> 16).toString(16).padStart(2, "0") + (b & 255).toString(16).padStart(2, "0"), a
}, Pip.knob1Click = a => {
    a > 0 ? Pip.audioStart("UI/ROT_V_1.wav") : Pip.audioStart("UI/ROT_V_2.wav")
}, Pip.knob2Click = a => {
    a > 0 ? process.env.VERSION < "2v24.206" ? Pip.audioStart("UI/PREV.wav") : Pip.audioStartVar(Pip.audioBuiltin("PREV")) : Pip.audioStartVar(Pip.audioBuiltin("NEXT"))
}, Pip.typeText = i => {
    let g = ["W\0O\0I\0\xc9ÿ\xd2þ\xc7þr\0A\1mÿ\xc2ý\x0fÿ÷\0y\0´þ&þ÷\0ü\2o\1Hÿþ\xedÿ\xdb\1\xc4\0\x19ÿWþWÿy\1¢\1y\0\xcbþ4þÿ\\\0\4\0\xd6ÿÀþÿ\1B\1\x15\0\xc4þþ\0\xe3\0Q\0\xc2ÿüþC\1\1Kÿoÿu\0«\1V\1\xc8þ\xc9ÿõ\0¤\0\0\x10þý\7ÿgÿo\1ÿ\xf0ý\xebÿ<ÿH\2-\2qþ§\0\x1eýöý\xe7\6\3\x1a\0=û/ö5\6\v/ý\xe2ûJùOÿy\fÿ¡ø$\0Dý\2ý\3\x17ü2\2ÿúf\2X\2¡ÿ\xf2\1¥þ\x17þÿi\0\xc8\3w\2Gþ:ý;ÿ)\1\xd5\0\7ÿ\1\2ÿyüü\1a\4]\2\bþ\x13õ¾ýH\vX\3þ\xc2ûýõ\v\4\vpþzÿ\xedö\xc8õý\x114\x0d²÷öù\3\xf2\f\1\x1a\x14ÿ\böþY\xed\xde\7#\x17÷ ÿ\xee\xf3·\xed»\x1b\xc4\v\xf3\xef\xf1\1\xe2\xf0\x7f\0M\x19§ö\xf4\1u\6\x19\xe8\x10\3÷\f\xf2þU\x0d\xf0ö\xe8\xefE\n>\0\0~\n÷õ½÷L\3ÿ%\v\xe5\4\xf2¢øWþ-\3Y\x0f\x1f\7õö\xf0¹ù\5\v³\x13'\2\xf02ö\2\n\x7f\b]ûA\xf38ú\2\2w\t+\n³û8\xf4ûv\2k\t\x15\6\nü5ü\x1cû[ü\"\7\xe6\7+þLùDú\5\4U\t\xe4ÿ©ú¦ý\x16þS\1 \3W\2ÿÿ\x18ù³ù \4¿\7\xdf\1\xcfü\x0eüT\0º\2i\0{ÿBþ\nþ\xde\3\xe3\4\x17\0zûú©\1\xad\69\1zûPü\"\1\xdb\4I\1\x18þGþ<ýþ°\4\xf1\5\xefÿz÷÷\xca\3õ\bR\3Oý@û\xd8ý\xf1\x017\2\2\x011ûú¼\1ý\5\xcb\4õýeù\xcaü8\2\xf3\4\xe7\2\x7fýgú\xdaýr\2\xc4\4¿\3Jÿ\xc6ûýü\xe3ÿ\f\2\xc6\2Iÿ;ü.þ\xef\1-\4\1üwý1\1¦\1|\1\x7f\0bþLþ@þ(\0U\2\"\0zþ\x1d\0¨\1\xc5\0\xc2ý%ý\x19\1C\2\x1f\0\x19\0V\1\0\xe7ý\xd1þN\2½\2\x7fÿLüÁþ©\3y\3^ÿ ýWý\0i\2\x007\0\xe2þ\xe2üÿ!\1K\x014\2ÿ£ýYþõÿI\3 \2\x13þ\xeaüGÿ\x14\2¬\1\xecý\xc5ý\0x\0 \0", "t\0E\0ÿ4\0}ÿ\xd3ÿü\0\xc8ÿ\xceÿ\xe4ÿTÿ \1F\0þy\0=\0B\0Á\0eþÿD\1\xc7ÿ¼\0\xe6ÿHþ\x1c\0¥\0[\1\xcd\0\xcfýþo\0\xf1\1\1\xd4þºþþ\xd7ÿ]\3\0þ!ÿýÁ\x012\3,ÿ©ÿÿý\x7fþb\2\x1d\0\xc6\0W\1«þþý\x10\1\x041\0Kþ.ý9þG\4`\1\xdfþy\0øû\x1d\0v\4þ\0\xd1ÿ5ü\f\3\0\1þª\3ýwý{\4\0þ\xe8þ\2\xe3ü\2z\2úW\1·\0Áý]\5\xd2ÿ\3ü\x10\1\xd4üe\1Q\6ý)þþ\x13ü\48\5¤þ\xd6ý\xc4ú¨ý>\6\x1a\5ý\0vü\xe7÷ý\xdf\6\7\x1c\19ú&ø²þ\6\xce\6\1Vú£÷þ)\7\7a\1¹ùb÷¶þ¢\6¦\7\1\2\5ú\xd1÷Pþ\5=\7©\2½ú\tø\x17þN\5õ\x061\2÷ú*ù{þ$\4\x12\6\2³û\xccùyþ½\3\x1c\5µ\1üúû\x18ÿ¿\1ÿ\2\1\xe5þ\xe4ý_þ\xf1ÿ=\2\xd8\1qÿzþ§þQ\0>\1\0&\0\xf1ÿ ÿ\5ÿ\x18\0\xc2\0\x16\1u\0Mÿ=ÿ;ÿdÿ¾\0\xec\1\x1b\1Bÿý\xd2ý \1¨\3.\1\xe0ýü\xe4þ½\2I\3r\0²ý¥ü\x13ÿ\xdd\2Q\3\0|ýµü\\ÿ½\2\2N\0`þýeÿw\1\x0e\2÷\0\xefþ±ý\xf1þ<\1\xea\1T\1\x11ÿ«ý\xf0þ\xde\0\xe8\1p\1`ÿý\xcbþ\x15\1\x15\2\xc7\0þþûÿ\x13\1\xe9\0®ÿ\3ÿÀÿ\0~\0\xe3ÿvÿ\xcbÿe\0\0\xd5ÿ/ÿ»ÿ±\0\xe9\0\xecÿ\4ÿPÿ9\0\xcb\0\0\xdbÿRÿ\xcdÿ\x17\0\x11\0;\0\x1f\0\x15\0\xf2ÿ\xc6ÿ¯ÿúÿn\0|\0\xeeÿTÿÿ=\0\xd8\0z\0uÿ\7ÿ¼ÿ\xdf\0\xed\0\xdbÿ\tÿtÿn\0ª\0\x18\0¹ÿµÿ\xdeÿ", "Á\0\xd8\0*\0[\0]\1+\1E\2\v\2\xdb\0%\1\0=\1\xf1ÿHþÿþX\0õÿ¼þ\x16þ\xc4ÿ²þ1üýüýüþ(\2Dý\xc7þ\xd5\3\08\4\xe8þ§úø\bü\7\xcaû*ÿ\bü$\5\x1b\fûõ¾÷\n\5Jÿ\xf1\1\xc3þþö\xcf\3F\4rú\2\xc6\4ù\xf0\x006ÿJû'\x0eG\2\xecZ\2\5\58\5c\x0f\xcd\xed\xd1÷\xd0\x0eA÷I\2\x15\6\xc2õ¹\b»ù\x1b\xef7\x0d\6\7ýC\0\xd8\xf4\x11\4\xe1\x13\x1e\3[÷\xdd÷{ýr\7\6\n%ù¸÷wÿ\x19û\5b\n¸ü;ü\xe5÷ûO\x0e\xde\7WüRö\3ö\xd1\5\4\x0ey\3\fû£÷«ý\x066\6\xd9ÿ\x17úúüü\xc9\2\xe7\4+\0°úµö,ý\t©\n\xe5\2xø\xc9ö\xc4\2@\fw\t\x1bý\xdf\xf3Tû\xe6\7\n+\2ö\"÷EÿD\7`\7ÿ÷qõ\xc6üz\5p\bº\0´ö\xe7ö\t\1\x18\n¯\b:ÿ\4øû\4õ\tÿ\5Lüwù\xf2ü9\1\xc7\4³\4¶þÿ÷6ù\xea\0\7Á\3½ú\x18ùMþ\6\xeb\7Dÿ¨ø\x18û\x1f\3N\7\xee\3\xeeý¡ühþt\1%\3\x10\1þ#üüuÿp\3h\1-ûeúÿX\5<\4\xcbÿý\x1cþ1\0\xc4\1\xf2\2\xea\0\xcbþ\4þhÿ>\4\5\0úû0\2¶\4ÿ\0\bý\5ýKÿ+\2+\3Á\0ý©ü8ÿ0\2\xce\x024\1\"þ$þ\xf3ÿ\xdb\0V\0\xd8ý\xe0ý\xd1þ\3ÿ]ÿ¶ÿ¡þ\xd1ý_ÿ\0\xc7\1¡\1ÿ\xd9þb\1\1\3\xe3\2>\2\xee\0ÿ\0v\2Y\2\xed\0 þþ?\0\x12\0Fÿ\x17ÿþýþyþ¿þ¿ÿ«ý\xdaýW\1\xdc\1\x1c\0»ÿ\xef\0¯\2\xd1\3\xdf\0Wÿ^\0\x19\0pÿ¦þ\4\0q\1\nÿùüÿ:\2e\0{ýdý0\0\2t\x014ÿ\3ÿ9\1·\1\7\0\x15ÿ!ÿ\x1b\1À\0\xc5ÿ \1J\0UÿXÿ\xc3ÿ\x1d\1ÿ\0=þ\0ýõþ\0\xf3ÿeÿÿ#\0&\0ÿ(\0|\0Z\0\4\1\xcd\0+ÿs\0\x1a\1\x1f\0\xdbÿ\x1d\0\"\1+\2!\2\4\0\xccÿVÿ·þ;ÿÿ\xdfÿj\0úÿ(\0\0úÿ\x14\0\xef\0", "\0«\1\xe8\1\xc2\1m\0\xf0ÿy\1\x7f\1pÿ\xecþrÿjÿ\xc6þ8ÿ_ÿ\xd3ý\xebþS\1\0¼ÿtÿ\x10\0\1p\1r\0Lÿq\0f\1PÿþÿW\1\x16\1YÿGÿL\0\x016\1öþ\x18þ\0\xf1ÿ;ÿe\0cÿ\xe8ÿS\0¾ÿ)\1\0\xe0ÿO\1]þ]þ\x1c\2\x19\0¨ý\xd5üý}\1s\1LÿKÿ\xea\0\2v\0*þD\0ª\4\3\x1dþ\xe1üI\0\v\3:\2\vþªü\xd3\0\xf2\1\\ÿUýý\xc3ÿ$\0þ±þþ\xce\0\3\xf0\0 þ\xd3ûõ\0\xdf\7\2µþ\xcdümýs\b\3Xú,ÿ\"û\xf4\1\xe4\t\xddùÁû\xdeÿ\x0dü\x1f\v\xdaü\0\xef=\2+\5¢\t¡\4º\xe9kú·\x12\x0d\v#\3#\xf0\xee\xf0£\x0e\x17\x0d\xc3ü\x15ùCöy\3J\vjÿTûþ\xf4ÿ\x0f\4\xd1\1\xe9ùTþ\7\x1a\6w\1ø¯\xf3)\3¼\vs\6)û\v\xefKø7\n\va\1\xf4¾\xf4©\x037\vC\6¢üGù\5ÿ\x1f\4ö\2\xefþ-\0u\3\x016ýBý¯\1S\5\x18\3ý\6ú¤ù@þ\3\xd2\4\2\3ü÷ú÷\1\1\tþ\5¬ü\x13ø\xe3ú\xc3\x036\v+\bnÿ÷töWÿ\n;\f\x0d\2Iõ-\xf2¡ý{\nd\f\x11\2-\xf3\xf0+ý?\n~\x0dY\2yõ\xf4\xedý \t2\f\xcd\3\x1fú@öù&\3\x0e\n\x13\bþ\x0dõ\x7föK\1B\tY\b\x10\0bø\xc4ø\x15ÿ\"\6[\t$\4:ü\bø\xf4û»\3³\6q\4Fþ\xd2ø\x11úJÿ¹\3û\4\1'û7ø3ý-\4\7L\3ü¦ùVü\x1f\3\x10\b\xd2\5*ÿ\2ú\xcaúC\1q\6µ\5\x1b\0\0ú\xea÷Vü\3þ\6\19ú&ùyþ\x13\4\xda\5\xde\2\xecü\xd4ú½þù\3\x14\6\xc3\3\xeaþ\6ü6ý$\2\x1c\4\xf4\1\x1cÿü\xcdü\5ÿ\xe6\1\xc6\2oÿ¼ûMüùþd\2<\3\x7f\0;þ\xc3þg\0v\1\xc6\1\xc7\1H\1þLþ*ÿ¬\0l\2\0UýGý\xc9ÿ\x17\2úÿþ\xd9þþ<\0\xc3\0g\0\x0e\1µ\1\0#ÿ\1ÿø\1\\\3\0\nþ\xcdþ:\0N\1\0\xcbþý\xe5üùýH\0\2°\1lþ{ý\xf3ÿ¶\2\x7f\3\1O\0\xf4ÿ\3\0k\0«ÿ\0\x18\2\"ÿ¢üiþ$\1T\1\xe6ýhû\xefý\x10\1\x0f\1EÿJþI\0¯\1J\1\xde\0\xd4\0\xda\1\f\2\x0d\0\xd2þÿ"];
    let a = 0,
        b = 0;
    Pip.typeTimer && clearTimeout(Pip.typeTimer);
    let h = 0;
    let d = 0;
    let f = i.split(/\x20|\xa0|\x09/);
    let e = f[0];
    bC.setFontMonofonto16().setFontAlign(-1, -1).setColor(3);
    const c = bC.getFontHeight();
    return b == 0 && (bC.clear(), drawVaultTecLogo(199, 15, bC), b = 125), new Promise(j => {
        function i() {
            if (d == 0 && a + bC.stringWidth(e) > 359 && (a = 0, b += c), b > bC.getHeight() - c && (bC.scroll(0, -c), b -= c), d < e.length) {
                let f = e[d++];
                bC.drawString(f, a + 20, b), bC.flip(), Pip.audioStartVar(g[Math.random() * g.length | 0]), a += bC.stringWidth(f), (f == "\n" || a > bC.getWidth() - 6) && (a = 0, b += c)
            } else {
                if (d = 0, a && (a += 8), !(++h < f.length)) {
                    Pip.typeTimer && clearTimeout(Pip.typeTimer), Pip.typeTimer = 0, j();
                    return
                }
                e = f[h]
            }
            Pip.typeTimer = setTimeout(i, Math.random() * 50 | 0)
        }
        i()
    })
};
let alarmTimeout;
configureAlarm(), Pip.offAnimation = function() {
    var a = (E.toFlatString || E.toString)("0µO\xf0ÀD*##\x11K\0\"$%\x1a\x1d\1%\x1d»%\x1d+%%À\xf3\x0f%\x1d\xc5²\x1dÁ\xf3\x0f%\x1d\xcd²\x1d\t\x1a,%O\xf4\xccp\1û\0\1%\x10FB\2\xda\x18\x012ú\xe70½\0\0\2`\xf0µO\xf0ÀF*#3;K\0$$'\x1c\x1f\1'\x1f»'\x1f+'7E\x1cÀ\xf3\x0f'À²\x1f\x18\xc5\xf3\x0f \x18\xed². \x1d0\x18\xad\xf2lm²\xadø\6\0\2¯ F\x1c'ø\x10@\x010°õ\xcc\x7fø\xd1Oö\x1f\x0e\2\xea\x0e\x0e\0&\2\xf4üb\x1c7ø\x16P¤²$\xf4ül%\xf4ü``DpD\5\xf4üe\4\xf4üd,D\xc5\3H¿@\xf4x@\x14D\6H¿@\xf0\x1f\0%\5H¿D\xf4üd\4\xf4üd \xf4ü` C'ø\x16\0\x016¶õ\xcc\x7f\xd8\xd1O\xf0À@*\"\2$$\0\"\x1a\x1c\1$\x1c»$\x1c+$\4Á\xf3\x0f$\xc9²\x1c\x19\x1c\x19,!\17ø\x12\x10\x19\x012²õ\xcc\x7fø\xd1\x0d\xf2lm\xf0½\0¿\0\0\2`øµP$\x0fF\4A&\0%¥B\x0f\xda\x0150F:F\xc5\xf1 \1ÿ÷sÿ\xc6õp:F\5\xf1\1ÿ÷lÿ\2>\xed\xe7e\0\xc4\xf1 \1\xc5\xf1 \0ÿ÷9ÿ\5\xf1 \1\4\xf1 \0½\xe8ø@ÿ÷1¿\0\0"),
        b = E.nativeCall(337, "void(int,int)", a);
    return new Promise(e => {
        var a = 0,
            c = ((g.theme.fg & 63488) > 16384 ? 2048 : 0) | ((g.theme.fg & 2016) > 512 ? 32 : 0) | ((g.theme.fg & 31) > 8 ? 1 : 0),
            d = setInterval(function() {
                if (a < 7) b(a, c);
                else {
                    analogWrite(LCD_BL, 1 - (a - 8) / 8, {
                        freq: 200
                    });
                    var f = 200 - (a - 7) * 20,
                        h = f + 25;
                    f < 0 ? (LCD_BL.write(0), clearInterval(d), e()) : g.clearRect(240 - h, 155, 240 - f, 165).clearRect(240 + f, 155, 240 + h, 165)
                }
                a++
            }, 50)
    })
}, Pip.offOrSleep = function(a) {
    a = a || {}, Pip.idleTimer = undefined, Pip.sleeping = "BUSY", Pip.remove && Pip.remove(), Pip.removeSubmenu && Pip.removeSubmenu(), delete Pip.remove, delete Pip.removeSubmenu, Pip.radioOn && rd.enable(!1, !0);
    let b = () => {
        Pip.audioStart("UI/POWER_OFF.wav");
        let b = [LED_RED, LED_GREEN];
        Pip.radioOn && b.push(LED_TUNING), Pip.fadeOff(b), Pip.offAnimation().then(b => {
            MEAS_ENB.write(1), setTimeout(b => {
                Pip.sleeping = !0;
                try {
                    clearWatch(), setWatch(Pip.powerButtonHandler, BTN_POWER, {
                        repeat: !0
                    }), a.forceOff ? (console.log("forceOff => turning off completely"), Pip.off()) : (process.env.VERSION < "2v24.409" && (Pip.watchdogKickTimer && clearInterval(Pip.watchdogKickTimer), Pip.watchdogKickTimer = setInterval(E.kickWatchdog, 12e3)), Pip.sleep())
                } catch (a) {
                    log("Error going to sleep: " + a)
                }
            }, 1e3)
        })
    };
    a.immediate ? b() : Pip.fadeOff().then(h => {
        g.setBgColor(0).clearRect(36, 40, 444, 288);
        let c = Graphics.createArrayBuffer(260, 35, 4, {
            msb: !0
        });
        let a = 15,
            d = -1;
        bC.clear().setFontMonofonto28().setFontAlign(0, -1).setColor(3).drawString("PIP-BOY 3000 Mk V", 200, 10);
        let e = settings.userName ? "Assigned to " + settings.userName : "Serial number " + Pip.getID();
        bC.setFontMonofonto18().drawString(e.toUpperCase(), 200, 60), c.setFontMonofonto36().setFontAlign(0, -1);
        let f = setInterval(b => {
            c.setColor(a).drawString("- SLEEP MODE -", 130, -3), bC.flip(100), Pip.blitImage(c, 110, 180), a += d, (a == 15 || a == 6) && (d = -d)
        }, 100);
        Pip.audioStart("UI/BURST5.wav"), Pip.fadeOn([LCD_BL]), setTimeout(a => {
            clearInterval(f), b()
        }, 3750)
    })
}, Pip.offButtonHandler = () => {
    if (BTN_POWER.read()) {
        let a = setWatch(a => {
            clearTimeout(b), settings.longPressToWake && (settings.longPressToWake = !1, saveSettings()), Pip.offOrSleep({
                immediate: !0
            })
        }, BTN_POWER, {
            edge: "falling"
        });
        let b = setTimeout(b => {
            if (clearWatch(a), BTN_TORCH.read()) return;
            settings.longPressToWake = !0, settings.alarm.enabled = !1, saveSettings(), configureAlarm(), Pip.remove && Pip.remove(), Pip.removeSubmenu && Pip.removeSubmenu(), Pip.audioStart("UI/BURST5.wav"), E.showMessage("Pip-Boy powering off"), setWatch(a => setTimeout(a => Pip.offOrSleep({
                immediate: !0
            }), 1e3), BTN_POWER, {
                edge: "falling"
            })
        }, 2500)
    } else Pip.offOrSleep({
        immediate: !0
    })
}, Pip.idleTimer = undefined, Pip.kickIdleTimer = function() {
    Pip.idleTimer && clearTimeout(Pip.idleTimer), Pip.idleTimer = settings.idleTimeout && !VUSB_PRESENT.read() ? setTimeout(Pip.offOrSleep, settings.idleTimeout) : undefined
}, Pip.kickIdleTimer(), Pip.brightness = 20, Pip.sleeping = !1, Pip.demoMode = 0, Pip.fadeOff = (b, c) => {
    Pip.fadeTimer && (clearInterval(Pip.fadeTimer), c = Pip.tempB), c == null && (c = Math.pow(2, Pip.brightness / 2) / 1024), b == null && (b = [LCD_BL]);
    let a = c;
    return new Promise(d => {
        let c = function() {
            clearInterval(Pip.fadeTimer), b.forEach(a => a.reset()), delete Pip.fadeTimer, delete Pip.tempB, d()
        };
        Pip.fadeTimer = setInterval(() => {
            if (a *= .65, a < .01) return c();
            b.forEach(b => analogWrite(b, b == LED_GREEN ? a / 2 : a, {
                soft: b == E3 || b == E4,
                freq: 200
            })), Pip.tempB = a
        }, 40)
    })
}, Pip.fadeOn = (b, c) => {
    Pip.fadeTimer && clearInterval(Pip.fadeTimer), c == null && (c = Math.pow(2, Pip.brightness / 2) / 1024), b == null && (b = [LCD_BL, LED_RED, LED_GREEN], Pip.radioOn && b.push(LED_TUNING));
    let a = Pip.tempB || .01;
    return new Promise(e => {
        let d = function() {
            clearInterval(Pip.fadeTimer), b.forEach(a => analogWrite(a, a == LED_GREEN ? c / 2 : c, {
                soft: a == E3 || a == E4,
                freq: 200
            })), delete Pip.fadeTimer, delete Pip.tempB, e()
        };
        Pip.fadeTimer = setInterval(() => {
            if (a *= 1.46, a >= c) return d();
            b.forEach(b => analogWrite(b, b == LED_GREEN ? a / 2 : a, {
                soft: b == E3 || b == E4,
                freq: 200
            })), Pip.tempB = a
        }, 40)
    })
}, Pip.updateBrightness = () => {
    let a = Math.pow(2, Pip.brightness / 2) / 1024;
    analogWrite(LCD_BL, a), analogWrite(LED_RED, a, {
        soft: !0
    }), analogWrite(LED_GREEN, a / 2), Pip.radioOn && analogWrite(LED_TUNING, a, {
        soft: !0
    })
}, Pip.powerButtonHandler = () => {
    if (Pip.sleeping == "BUSY") return;
    Pip.sleeping ? checkBatteryAndSleep() || (Pip.kickIdleTimer(), settings.longPressToWake ? wakeOnLongPress() : (wakeFromSleep(showMainMenu), Pip.audioStart("BOOT/BOOT_DONE.wav"))) : (Pip.idleTimer && clearTimeout(Pip.idleTimer), Pip.offButtonHandler())
}, Pip.usbConnectHandler = a => {
    if (console.log(`USB ${a.state?'':"dis"}connected`), Pip.sleeping == "BUSY") return;
    Pip.kickIdleTimer(), Pip.sleeping ? a.state && (console.log("USB connected - waking up"), settings.longPressToWake ? (settings.longPressToWake = !1, saveSettings(), wakeFromSleep(playBootAnimation)) : wakeFromSleep(showMainMenu)) : drawFooter()
}, Pip.addWatches = () => {
    clearWatch(), pinMode(KNOB1_B, "input"), setWatch(a => {
        let b = a.state ^ a.data ? -1 : 1;
        Pip.emit("knob1", b), Pip.kickIdleTimer()
    }, KNOB1_A, {
        data: KNOB1_B,
        edge: 1,
        repeat: !0,
        debounce: 0
    }), setWatch(a => {
        Pip.emit("knob1", 0), Pip.kickIdleTimer()
    }, KNOB1_BTN, {
        repeat: !0,
        edge: "rising",
        debounce: 20
    }), Pip.mode == MODE.TEST ? setWatch(E.reboot, BTN_POWER, {
        repeat: !0
    }) : (pinMode(KNOB2_A, "input"), setWatch(a => {
        let b = a.state ^ a.data ? 1 : -1;
        Pip.emit("knob2", b), Pip.kickIdleTimer()
    }, KNOB2_B, {
        data: KNOB2_A,
        edge: 1,
        repeat: !0,
        debounce: 0
    }), setWatch(a => {
        Pip.emit("torch")
    }, BTN_TORCH, {
        repeat: !0,
        edge: 1,
        debounce: 50
    }), setWatch(Pip.usbConnectHandler, VUSB_PRESENT, {
        repeat: !0
    }), setWatch(Pip.powerButtonHandler, BTN_POWER, {
        repeat: !0
    }))
};
let showTorch = () => {
    if (Pip.sleeping) return;
    Pip.remove && Pip.remove();

    function a() {
        Pip.removeAllListeners("torch"), Pip.audioStart("UI/L_OFF.wav"), Pip.fadeOff([LCD_BL], 1).then(a => {
            g.clear(), showMainMenu(), Pip.fadeOn([LCD_BL])
        })
    }

    function b(b) {
        b || a()
    }
    Pip.fadeOff().then(c => {
        Pip.audioStart("UI/L_ON.wav"), g.setColor(g.blendColor(g.theme.fg, "#FFF", .2)).fillRect(0, 0, 479, 319), Pip.fadeOn([LCD_BL], 1).then(c => {
            Pip.on("torch", a), Pip.on("knob1", b), Pip.remove = function() {
                Pip.removeAllListeners("torch"), Pip.removeListener("knob1", b)
            }
        })
    })
};
let torchButtonHandler = () => {
    if (BTN_TORCH.read()) {
        let a = setWatch(a => {
            clearTimeout(b), showTorch()
        }, BTN_TORCH, {
            edge: "falling"
        });
        let b = setTimeout(b => {
            if (clearWatch(a), BTN_POWER.read()) return;
            if (BTN_PLAY.read() && KNOB1_BTN.read()) console.log("Torch, play and knob1 buttons held down - entering Factory Test Mode"), Pip.remove && Pip.remove(), Pip.removeSubmenu && Pip.removeSubmenu(), Pip.videoStop(), factoryTestMode();
            else {
                let a = 1;
                let b = setInterval(d => {
                    const b = [2, 10, 20];
                    let c = b.findIndex(a => a >= Pip.brightness);
                    c >= b.length - 1 && (a = -1), c == 0 && (a = 1), Pip.brightness = b[c + a], Pip.updateBrightness()
                }, 1e3);

                function c() {
                    b && clearInterval(b), b = undefined
                }
                setWatch(c, BTN_POWER, {
                    edge: "rising"
                }), setWatch(c, BTN_TORCH, {
                    edge: "falling"
                })
            }
        }, 1e3)
    } else showTorch()
};
let drawVaultTecLogo = (b, c, a) => {
    a || (a = g);
    let d = "½L @\xf3 :ÿþZ\xcc\x1fþ\0\7ú\x1db\x16\x1d\vÿþ\x0e³\xe4.¿\x1e®Y\7\0\5\n^\x1eZ\2\x1d\x10<\x0f\xd0<®ü:$\2\x7f\xd0\x0e©/\v\2\xd5\5¨\x10b±uP\x005²-P\xe0À¿ÀÀª\xe4\3\0¼\xc5\6\f°,\0\x1d\0\f\tt\x1bø\\\x19xx\xe8\x17ÿ*Z\vÀ·\x11j\x16ø¶\x15¿\xf0°6\3ü\x1c\3ÀO\t\3ø\1\xf0\7H±\xc3\xd0#\xe1\x117\xe0pV\xe1\xef\xc7\xdfÁ\xe1Aü\x102p0o\xd1\x12  \x10\\B\x1eIõjµHw\xcb\x10¿À0|\x10\x7f\xd04\x1fù\xe4¥°\bÿ\0\x0e\x10x\x13\x183öª_H\x1f\xd0\t\xd4\x1f\xc2\x100 \0\x7f!\xd2\1\xcf\xcf\xe0 C\xf4!\xe4PS\1\x0de\3\v\f\2\bF\x0dù0 \0ky\xd40\0G J`£\2\1'\6\x1e\x12\x1bÿ^\n\x1fÀS\4¼\vü ([\xf0\xe6PA#ÿ`?°!\xe0·# !1ÿ\xf4µ\xe8\xf0~~}\3/\3\x13\x13üp\4\x005ö\3\xf4\f\7\nü\7\x18\0\x19\x14\x12pc\xc3@\xe2\4\xdf\xdfü\xc2\x0f\"\xef`C\xc2 ;þ\f8\5°²õ±?H\x10$wP? À (/2\x7f\0\xf0mZ \0¶X.\x10x\0\xe0g\xf4\2\x10?\xe0º¬\4p°K\0`\x1b\xe5HBPLB\0\x18A\7W\xf4)\3þ\xadAþ\x18\2\x1bn\4\xcc\x1e\2_ÿ«\x7fú\0\x18\x19úH0\xf1Jp\xc6 \2Á\x16\6\xe0\f\xea;\xe0#!p`\x16ö\xd8\"@·¤\xe0\xcf¤\xc3\xc9\1¦\1A\xd0\0\xe0\xe0\x12\xe1\x1e\x12\xef\4\0\f\tÀ\t\xd4\x108Qÿ\bX\x1c,¶L\x1c\t\4.\fJ\x1c-\2\x0dü$8\0hú$2`0°\xf0@0¡\xe0\xd1\t\1\6W\4·\fJ\x0e^\x16\5j\"ø\x16©Q¶8¢P\xc2À\xc3ÿ\x0e\xca\0\v\x7f\f\2%\4,\x14ýH\0¦8#\0ª\vp\xc3©ªAZ·\x10\0¤= `\x022\xf0ÀgÀRH6\xc8\xd2\xd5Z ³\0\x19ov\x1e\x005\xf4\x13±\x16ÁUZ @\xd0";
    let e = "¬\xc4\xe0[þ\4¿\xe5ÿ_ø_\xe9\x7fÿÿ\xe0@\0`õÿÿ\b\x0eÿøÿ\1 \xcbþ\x1fþ\x7f\xf3~\x0f\6\1?ÿþ¿ÿ\xc8\x17ÿ\xe7ÿÿ§ÿH_\xf2~\b\6^\x0f\6\1\x0fÿÿA\x14\5ÿ¯ÿ\xe0B\xe5@À`\xebÿü\x10 1ÿü\x1c\x0f\3\x7f\xc3ÿ\xcfþ:ÿö\2\0\3\7\x17þ\xd0\x7fþ2\0#À~\5\5\0 \1\17\4ø\t\x10p?ÿ\xf4° (\x14  0À\xcf\xc2 \xcbþa\x10\x7fø\"À`\xd0~?ÿÀD\x13¨#`F`ÿ¡\x17\1,\5\xf0\f\4\6\f-0\x10\xcc \xd8?\x7f\xe1``ø!\xd0S\2.B\xf1¥\5G\2\x1d\4°\b\xd8(\4\x1c\x12\x14ÿ\xc4X\x1bU¨,\5ú\xc7\1\x10N\vù\x7f,\n\x0d\4°\x13\xcc%\xc83ÿ\xf18\x11P+\x13~\3 4\xf0¨<?öü°\x0fõb0@!¨'\0j:\5b\x17\x14\b\x1c\x15\xe8#pQ@³B_X\f@\f|b\f?\xf0\xe5\4^\x17ö\x1e¿\x10°\x1fú\2\6\3¨d#Z\bÿ\xe2\2\6\xd5@\v\2\3\6\xd5ªA¿\0";
    a.drawImage(dc(d), b - 61, c), a.drawImage(dc(e), b - 45, c + 60)
};
let drawVaultNumLogo = (b, c, d, a) => {
    a || (a = g);
    let e = "ÿX\xe0A÷ ºÿÿû(^\xe6\xdfÿ\0\7@\x1e\xed\6\x1e\0\7\xc8>\xd6\x16>\x1bÿø\x1fi\x1b\x1f\x0fÿü³ÿÿW¯õ\x1f\x16?\xca\x0e>/ÿ\xf4\x1f_\2\x1f\x19ÿ\xf0\x0f\xef\xdf\xcd\xe0\x0f®ÿ\xd0\7\xd6\xc7\xc7\xc7\x7fG\xd6Á\xc7\xc7\x7fþ\xeb #\xe3ÿý\1ý\xf1ú\x0f\xeb\x1f\xe5\x11\0\xef\xdf\xd9@\xc6bþAa\xc2\xdf\xd4\xc6&\5\x0d\xf4¼\xe8\xf0\5E\x1fÿ \x0f¦X\x0e??\0>¶\1\3?\xcb\x1f\x12ü\f\x11\v\f\x1bþ\x1f*%d°w\xe0|£©ød\xdf\3\xf2>h§\xf4p1\x19¿@\xd3?\3\xf23_\0\1þ_\x1cü(4zõG\x19\xca# A£:\3\xe5D(\xf0\x0f\x1f½2\1?\x1fD\xe41zd\2\2\x18'üûX\0L=zI0\3\fQ8\tV\xcc\x0du\7\xf4\t\x1b\3)\6>V|$\x17À\x7f2©2t\1\xf4°±P_À_\xf4\xc6 ø\t$g\x16¤?6\xe9>~\x13\v -R\x0d¿\x17\0;\xe0$:\4#Kÿ\xe8\f\x1b\f§ÿ2\x1f\x1f\x12'þ\f/ÿ\xf04\x1f§\v\f.\x006\x1e&Sû\0\xd4?Mÿü@\xeaÁ?Iÿøo\xc2\xea\xf0\x0f\xd2ÿù\xe1e\x7f\xe9¿\xc7\xef¸o\xdf~u¼\7\xe9LÀ\xcb\xdaª¦ @/\xe1u>\7\xe9p\1G\xeaF\xd1ÀþLªI\t?\t\xd0\x17*\0>\x1e*\v\xf0\x13:\6\x13\vø>ü'\0&uü&\1hY© i#À\v\xf0$ \x0f¥tÿ\t\x1f\t\5\xf0?M?\x15\xf4)B\0^\4+\x0f\xd1\0¼<V\x17\xf4%\0\1-ù\xe00\0®£R\"\0\6\xc8\x0fW\nÿ\xe0\3FO\xc3%1W\x1f\x18«6\x16\x1a/ ¼|r\xf4°\0<\1\xf2ª\"\xd7\xc7_\xc3FP\7\xcaG\xc4f\x7fE\xc3\xc3F6M\0\x0f\3\x11ÿú\6¥^¯ÿ\xe8\6\f¾V\4$9üQd\xef\1ùHX\xd7\xf1Q\xf0\xc9¿Á\xf2\txrÁ\xdf\xf1\xf2°\vø\xdf \\x\x1b]\1\xf1ú°!\xf4\xc7\xf3ü\3\xeb \x10mP\0]yü±\xf0\xde \xd8\xdaQ\xeb\0\2]\xe3~Aa\xc2\xd9f$ªF\xd2@ ;\xf0H¿\xd1õp\vû\xc4\xe0\x004\1õp\x11\xf2\x1e\3õq\xf1\xef\xcb\x1f\xc4\7~Z\0\6~ü\xec\0\x16ü|o\0}t\4|o}t\2\6>3\xe8>¾\1\v\x1f\x17ø\x1f`?0}ü¿\xe8û!ù_öc\xf2W\2\x0f\xf2\x0fµ\0\3o\x1eþ \x0f·Au\xe3\xd0r'@";
    let f = "J [ÿø\0\x1f\xf4\0\n\x0f\xe2\1\x0f\4ÿø\3\xc2\5\2\t\x0fü\x0f\x0fÀ\x14\x13\4\x0f\0\4\x0f\xe8\x0f\x0fú\x14\x10H'\b\x1f@\x1e$,\6\x17\xf0('\xd0°\b\x10\x1a\4?\1\7\x1a\5\0P \x12\xf2 P1À'0\xc2\xdfÀa\0\1\x1b\2\x14\4j\bx\x10 0PÁ\5\4\x1f\2-\7\x14\x14f8@\x11()K \1\b\2%\4\xdc\x11(\4üJ\x12´.$\x12 ! M\v.\x16\x0fx\f\\\x10!e\xc7\xe1\x1e\1,\5\fø\x198X\b\xe0Bp^\0\x18AIÀ\4\b\6c\5X\x18P2'p\xc7Át JÁ\xca`@\vÀ\x1a\3C\6-\7\xd6\t\4²\n0/ÿl\b\x1d\1t\b\0\x1f\xea$h\" A\7\x14\x12\xcb\b()H  \xc60J@\3\5\3\xe4@µ@\0µ ";
    let h = "J _\xf0\0_\xe8x\x140\0\0I\x1fÀ \xf0 t\0 \x7f \x7f\0 @ÿ°\1q\x1c\0x\x7f\xc86«_ÿú@-Z P8\b\4\4\b\tt °?\0 3ÿÿ@\b\t\x1f\xf0\x10\x189\b\x10 @\xf0x\0@C\xc2B\xc5Á@#\xe4 AA\3\xc3\x11ü\4\x0f\4\\\x10\x12\x100\b\x18<1\x18# \x17\xf1 g \xcaA\7\xc2\2\49\b\xe6\x10\x13\xe8b@A\1\2\x15\4)\4\xe6\x13L#ÀDV\xe0\2%\7/%\x065\4¾\x18¼8\6ü\b\x1a8\x12xCPB¨\xc4\x1d\2\x14\b^\n @ §@E\7)\b <\x1f\xee@°\x1c\x15\xd8\x1f? ~\v\1¾,\5üH}\4\x1a\x10\0\x1ax\x100@\xf0!$\2»\vÿø\n\tÀ\7\6¶\f<\bP50!@\"\2A@\2\x0e5ú_\\\7_\xe8\2\2";
    a.drawImage(dc(e), b - 127, c), d == 32 ? a.drawImage(dc(f), b - 21, c + 30) : d == 33 && a.drawImage(dc(h), b - 21, c + 30)
};
let drawText = (c, d, e, a) => {
    a || (a = g);
    let b = c.split("\n");
    a.setFontMonofonto23().setFontAlign(0, -1), b.forEach((b, c) => {
        a.drawString(b, d, e + c * 30)
    })
};
let showVaultAssignment = () => {
    let a = 32 + Math.floor(Math.random() * 2);
    let c = settings.userName ? settings.userName.toUpperCase() : "CONSTITUENT";
    var b = 0;
    g.clearRect(40, 40, 440, 58);
    let d = () => {
        var d;
        bC.clear(1).setFontMonofonto23().setFontAlign(0, 0), b == 0 ? (d = a == 32 ? "WE BID YOU FAREWELL!\nYOU'RE MOVING TO" : "CONGRATULATIONS!\nYOU'RE STAYING IN", drawText(d, 200, 15, bC), drawVaultNumLogo(200, 85, a, bC)) : (a == 32 ? d = "CONGRATULATIONS,\n" + c + "!\n\nYOU'RE ONE OF THE CHOSEN\nPIONEERS WHO WILL\nREPOPULATE VAULT 32!" : d = "CONGRATULATIONS,\n" + c + "!\n\nYOU REMAIN A\nTRUE AND TRUSTED\nRESIDENT OF VAULT 33!", drawText(d, 200, 15, bC)), b = (b + 1) % 2
    };
    d();
    let e = setInterval(function() {
        bC.flip()
    }, 50);
    let f = setInterval(d, 3e3);
    Pip.removeSubmenu = function() {
        clearTimeout(f), clearInterval(e)
    }, setTimeout(a => Pip.audioStart("UI/ALERT.wav"), 100)
};
Pip.clockVertical = !1;
let submenuClock = () => {
    tm0 = null;
    let a = "¬\xeb\xe0@\xe2\xea\2E7\xf4\0ª@ªwÿø±\x18\xd6\0*\x0f\xe4*¿ý¿ÿ\xe0\7\xe1\0\3\xf0\5Lø\5Fþ\f\xdfPG\xe1\0\3\xe0\x15L\t\0\7\xf0\x15.\x16\x0f\7\xf4\2\x076\x16\b*\\\b\x1c\x0f\4¸\x11¼\xc2°>/\xcd)\7\nþ\n\x1f\nÿõoü\x070À\xc2¡\0\2§§\x0d_\xc2¢|\x7f\xd4]úp¨\x17\x15\x0fý\1´\xc2þ\xc2¿«!ü\6\xf2\xe7\xd2\xea8TP\xf0=\69R\xea°H/°\f,[|¨\x0d|P\x1f\xd0\x17H[\xd0#hT0\x18?\x0fþ\0*K\\ \0_8>F`)²¿\xed\0\xe7ÿý\x10\xd0%¿\xf4´ ¢\xe0K\5\xef\xf0_ÿ¹lL\xdfþ\x15&ÿ\xe0\xdfþU \xdf\xc2À\xda7\xeb\x12¥ÿ\x7f\xf0x\f<*\x0f\xcb?\xf0\n\x0f\6>)\t4\x17útn*\6\xed\n\x7fÿ\xe8\x1b\xd3\xdfPAm\3\xf4O\xcd¡\v\n\x1f\t\2\x15\v\xf1n(\4*\x18\0.½4T,\x1e\x0d\x1c*'ö\xe4\x15)\xe6\x0fÿÀ\xde\x17µ, \0\n\xdb\xd4\nX\4¤\bTO:À¢À?°_\xe0\x18aR\xe0_@x° aR \x1b\xd8@/\2\xc4  !R£\xd1ª\xdfÿõPPÿþ\5J\xf4ÿ\xd5Z¶¿ B?\xf3_\x1e\x7f\2\4\xf3)6\x0e\xe2\xde\7,\3\4\0\x0f@_ÿ£ª\xd2Kû\xe6\xe3 \2h\x10\x1dú\xd87m\xe0¿\xda³`\x7f\0¡p\b\x1ad\x1dxT? T\xc8\5ÿü\x18\4\0\x13\xc8°\0L \xc2¨Á\0\bA:\1\x1f\n©\1\n®0XB¸Á`\xf0¨XjX\\\xe8^\x1cX\x1f\x0fÿ üp\2\0\7¤Z\6\x15.\x1e%\6\xde\x15\7$\x15\7r\x15/d\n7þ¡\5A\xdf¢\nÿ£\x7fú\6¿\xd3\6\nZ)^\x0f^\xef\b4\x0eD*\x0f\xf4*D\b\xd2\x18¨\x1dÿøZ\v0 ¨_\xc5zAh \0\xe3Bÿ¦ <\4\x15'\x1e\3\n¾\x14\f\0\tÀ`¨}p\x18\\°¨§£üc\v\t\nø)ø\n\x14*\x1fú~\3\x14\0'@*9¨Cp\xc5[`\xedF,\b\f\xdcX°U\xe8f \xdc\"\v\b¿\x16\b\f\7üj\x15\xc2\x18\0Z\0T\x19x\x14\x11p&\xe0\xdc!\5ú\5A5\7õ\nÿ\n\x0f\2\3úný0\0\x17Á\0\2¿ÿ\xe1\x7f\xed\xe1R?\xd0\b8\x14.y¨B\xe0CP^\xc3<û\x7fülq³aQ\x7f \xca@±\xc7ÿF\xd9#\1\3\xc7\2\\\x0f\xf0]\x17\xe8\x0f\x0f\xc5ÿ\xcf\5\0\3\xe4|ýtü¿°\xc3,\6C\6\2\x16\x11\x17û\x7f\x1faX\f¤\x10XL[´>\fBÀiP`\t`úD`\xe2úù`\x7f\1,\x1fÀJ\x1fB^X#ù\0\"\xc3y,\6\x16X!\xdc\f\0\f\x10l\x10X|\"Á8\b\0( \xd8\"Àÿ\x17\xf2Á\6\xe0C\xd0\5W\xcb\4\x1bV\x041\b\n\x1f\\°AH\x11\xe0c\x10QAý5¥\xca@À\xc6\"\v\3\51\f°\x1f\xea\xc6\x0f\xe8\x15\4X\x1e+6\v\x0fUªªÀ\"\v\0\xd6Á\t\xc3\xf1\x1aC=\5\x15\xd5þ\x13AÿB¡\f\xc2ü\x1aC\0\bL\x14*\x12/\xf3\b@\0\3pi Eb\xc2¤x\x18!\xf0\5üB¤\x16\1X°\4X'\xf1`\x19`l\bÀ0\0f\x10La\6\xde\2ÁX\4\0\tf\x0e\x1c°Mÿ¿\n,\7\xc2X&~®\6 \x15\x16\1¸,\x12{\7\xc8\x14\x19\xc2 \0e('\x10@\3Á\xc2¤?\np\4°Eü*K(\"À\xf0ÿÿöZ\x16\"\xd6\x15\x1b\xd2\xd4\7ÿÀ\5\6À#AA=T\x14x\\\x7fTh\x17û!\1µ\x0f\xd2Á!\5\xe2Y\0\x18L\bD\x13¨Z°8<\"À;ú\0Tf8z\xadVý\n \f\x1e\2\x10\xf4(\x7fÿ\0ThXTÿGýª\xd0\5FIü17\4B *Q¸0\0\xc6±\xcd\xc6\x10<\0\7\xdeB<\xdc'\xdc|\4J#\x180\0?Aa!\19\xe4#\xcd\xc2}HGþ¢!\x13\7\x1d\5\x10Q¸Oý\0\xde.\0\xdcn\2>\x15\x13\xe0n7Á\2\ný7\x1a$\6~B5º'\xe2\1\v!\x1an\x10t\x11\b\xe3pi0B\7\b\x0d\4!\xd8\x13qÀB\x7f\x0d\xc6\b\xc2\x0eÿ7\x19\xf4\3²\x17 \x16\x1eþ9\x19d\"\x13qH@B\3\0\b\x0d\x11$\x19\bC¸@\1\n\2\3\3Q\xde \x18:4F\xf1\6\xe0\xcc¢, \5F\4\6\xde \xdc#@\xd8\xe6\xe1\x10M\f\fp#\xd4D\xd8\xedP\xdea\x0dFM\"\x0d\xe6\x1a8T\xd8\xe6P\xc9\xc2M\x017\x10B\x13 n=¢H\0)y¸r\x10±\xd8\xe1]n,#\xd0q\t$ \xcb\3\xc7\xcfD\x10,\x0f@\xd7´\xc8!\6\xf4\x16\x15þ Ujµ\7A\"\1m\xe3@t\x10\b\xc8TR\x10h\xf1\x1bb:H!\6+\x18\0\x0e~¦\x19x\x11@\x10H\xadV\1\5<\b\6µ\5\x0e\0*\b\2\6\xc8\x15D\x18U\x13\xe0m!@\6K\xde\nAþ\xd2\x16\4\x15H²\x13H`\1o\xd0U0\0À";
    let b = setInterval(function() {
        let d = Date();
        let e = d.getHours();
        let b, g;
        settings.clock12hr ? (b = (e + 11) % 12 + 1, g = e < 12 ? "AM" : "PM") : b = e.twoDigit();
        let c = d.getMinutes().twoDigit();
        let f = d.getSeconds();
        c != tm0 && (bC.clear(1), Pip.clockVertical ? (bC.drawImage(dc(a), 70, 20), bC.setFontMonofonto96().drawString(b, settings.clock12hr && b < 10 ? 281 : 223, 0).drawString(c, 223, 110), settings.clock12hr && bC.setFontMonofonto28().drawString(g, 350, 177)) : bC.setFontMonofonto120().drawString(b, settings.clock12hr && b < 10 ? 93 : 20, 45).drawString(":", 160, 45).drawString(c, 228, 45), tm0 = c), f != ts0 && (bC.setFontMonofonto120().setColor(f & 1 ? 3 : 1).drawString(":", 160, Pip.clockVertical ? 40 : 45), ts0 = f), bC.flip()
    }, 50);

    function c(a) {
        if (a == 0) return;
        Pip.clockVertical = !Pip.clockVertical, Pip.knob1Click(a), bC.clear(1).flip(), tm0 = null
    }
    Pip.on("knob1", c), Pip.removeSubmenu = function() {
        clearInterval(b), Pip.removeListener("knob1", c)
    }
};
let getRandomExcluding = (b, c) => {
    const a = Array(b).fill().map((b, a) => a).filter(a => a != c);
    return 0 | a[Math.floor(Math.random() * a.length * .999)]
};
var rd = new I2C;
rd.setupI2C = () => {
    if ([B6, B7].forEach(a => a.mode("input")), B7.read() == 0) {
        [B6, B7].forEach(a => a.mode("input_pullup")), log("Radio I2C SDA pin is low - trying to unstick the bus with SCL pulses");
        for (var a = 1; a <= 100; a++)
            if (B6.write(0), B6.write(1), B7.read()) break;
        log(`Radio I2C bus ${B7.read()?"unstuck":"still stuck"} after ${a} pulses`)
    }
    try {
        rd.setup({
            sda: B7,
            scl: B6
        })
    } catch (a) {
        log("Radio I2C setup failed: " + a)
    }
}, rd.setupI2C(), rd.freq = 98.8, rd.tuningInterval = null, rd.writeReg = (b, a) => {
    rd.writeTo(17, [b, a >> 8 & 255, a & 255])
}, rd.readReg = b => {
    rd.writeTo(17, b);
    let a = rd.readFrom(17, 2);
    return a[0] << 8 | a[1]
}, rd.getChannelInfo = () => {
    let a = rd.readReg(3);
    rd.band = (a & 12) >> 2;
    switch (rd.band) {
        case 0:
            rd.start = 8700;
            rd.end = 10800;
            break;
        case 1:
            rd.start = 7600;
            rd.end = 9100;
            break;
        case 2:
            rd.start = 7600;
            rd.end = 10800;
            break;
        case 3:
            rd.readReg(7) >> 9 & 1 ? (rd.start = 6500, rd.end = 7600) : (rd.start = 5e3, rd.end = 7600)
    }
    rd.space = a & 3;
    switch (rd.space) {
        case 0:
            rd.chans_per_MHz = 10;
            break;
        case 1:
            rd.chans_per_MHz = 5;
            break;
        case 2:
            rd.chans_per_MHz = 20;
            break;
        case 3:
            rd.chans_per_MHz = 40;
            break
    }
    rd.channel = (a & 65472) >> 6, rd.freq = (rd.channel * rd.chans_per_MHz + rd.start) / 100
}, rd.init = c => {
    rd._options || rd.setupI2C();
    let a = rd.readReg(0) >> 8;
    let b = !0;
    return a == 88 ? c && console.log(`RDA5807 ID: 0x${a.toString(16)} (as expected)`) : (log(`Unexpected value reading RDA5807 ID: 0x${a.toString(16)}`), b = !1), rd.writeReg(2, 3), rd.writeReg(2, 61453), rd.writeReg(3, 8), rd.writeReg(4, 12800), rd.writeReg(5, 34984), rd.writeReg(6, 32768), rd.writeReg(7, 24346), rd.getChannelInfo(), b
}, rd.init(), rd.writeReg(2, 61452);
let stationName = '';
let stationNameSegments = new Array(8).fill(" ");
let stationNameTemp = new Array(8);
readRDSData = () => {
    if (!(rd.useRDS && rd.readReg(10) & 32768)) return;
    let a = rd.readReg(13);
    let b = rd.readReg(15);
    if ((a >> 12 & 15) === 0) {
        let c = (a & 3) * 2;
        let d = b >> 8;
        let e = b & 255;
        stationNameTemp[c] == d && d >= 32 ? stationNameSegments[c] = String.fromCharCode(d) : stationNameTemp[c] = d, stationNameTemp[c + 1] == e && e >= 32 ? stationNameSegments[c + 1] = String.fromCharCode(e) : stationNameTemp[c + 1] = e, stationName = stationNameSegments.join('').trim()
    }
    let c = Graphics.createArrayBuffer(100, 25, 2, {
        msb: !0
    });
    c.setFontMonofonto18().setFontAlign(0, -1).drawString(stationName, 50, 0, 1), Pip.blitImage(c, 295, 238)
}, rd.seek = c => {
    let a = rd.readReg(2);
    a |= 256, c ? a |= 512 : a &= -513, rd.writeReg(2, a), rd.tuningInterval && clearInterval(rd.tuningInterval);
    let b = rd.readReg(4);
    return rd.writeReg(4, b | 1024), rd.writeReg(4, b & -1025), stationNameSegments.fill(" "), stationName = '', new Promise((a, b) => {
        rd.tuningInterval = setInterval(() => {
            let b = rd.readReg(10);
            let c = b & 1023;
            rd.freq = (c * rd.chans_per_MHz + rd.start) / 100, Pip.mode == MODE.RADIO && rd.drawFreq(), b & 24576 && (clearInterval(rd.tuningInterval), rd.tuningInterval = null, Pip.mode == MODE.RADIO && Pip.videoStop(), a((b & 8192) == 0))
        }, 200)
    })
}, rd.isOn = () => {
    try {
        Pip.radioOn = (rd.readReg(2) & 1) != 0
    } catch (a) {
        log(`Error reading radio enabled status: ${a}`), Pip.radioOn = null
    }
    return Pip.radioOn
}, rd.getRSSI = () => ((rd.readReg(11)) & 65024) >> 9, rd.enable = (a, b) => {
    if (a) {
        let a = rd.freq;
        rd.init(), RADIO_AUDIO.mode("analog"), a && rd.freqSet(a), Pip.fadeTimer || Pip.fadeOn([LED_TUNING], Math.pow(2, Pip.brightness / 2) / 1024)
    } else rd.tuningInterval && clearInterval(rd.tuningInterval), rd.tuningInterval = null, rd.writeReg(2, rd.readReg(2) & 65278), Pip.fadeOff([LED_TUNING], Math.pow(2, Pip.brightness / 2) / 1024);
    b || (Pip.radioOn = a)
}, rd.getVol = () => ((rd.readReg(5)) & 15), rd.setVol = a => {
    rd.writeReg(5, rd.readReg(5) & 65520 | a & 15)
}, rd.freqSet = (a, b) => {
    if (a *= 100, a < rd.start || a > rd.end) {
        b && console.log(`Invalid frequency (${a}) - must be between ${rd.start} and ${rd.end}`);
        return
    }
    let d = (a - rd.start) / rd.chans_per_MHz & 1023;
    b && console.log(`Band:${rd.band} (start:${rd.start}, end:${rd.end}), spacing:${1e3/rd.chans_per_MHz} kHz, tuning to ${a/100} MHz (channel ${d})`);
    let c = d << 6 | rd.band << 2 | rd.space;
    Pip.mode == MODE.RADIO && Pip.videoStop(), rd.writeReg(3, c), rd.writeReg(3, c | 16), stationNameSegments.fill(" "), stationName = "        ";
    var e = 0;
    return rd.tuningInterval && clearInterval(rd.tuningInterval), new Promise((d, f) => {
        rd.tuningInterval = setInterval(() => {
            let f = rd.readReg(10);
            if (f & 24576) {
                let c = (f & 8192) == 0;
                b && console.log(`- set channel=${f&1023} ${c?"OK":"(failed)"}`), rd.freq = a / 100, Pip.mode == MODE.RADIO && rd.drawFreq(), clearInterval(rd.tuningInterval), rd.tuningInterval = null, d(c)
            }
            e++ > 10 && (b && console.log(`Giving up!`), clearInterval(rd.tuningInterval), rd.tuningInterval = null, rd.writeReg(3, c), log("Timeout tuning to " + a), d(!1))
        }, 200)
    })
}, rd.drawFreq = a => {
    const b = a ? 245 : 0,
        c = a ? 150 : 0;
    a || (a = Graphics.createArrayBuffer(120, 23, 2, {
        msb: !0
    })), a.setFontMonofonto18().setFontAlign(0, -1), Pip.radioOn ? (a.drawString(`  ${rd.freq.toFixed(2)} MHz  `, b + 60, c, 1), a == bC ? bC.drawString("  " + stationName + "  ", 305, 173, 1) : (Pip.blitImage(a, 285, 215), g.clearRect(295, 238, 395, 262))) : a.clearRect(b, c, b + 119, c + 40)
};
const CLIP_TYPE = {
    ANY: null,
    VOICE: "DX",
    MUSIC: "MX",
    SFX: "SFX"
};
let radioPlayClip = (a, b) => (a == undefined && (a = CLIP_TYPE.MUSIC), new Promise((e, f) => {
    var c = null;
    let d = () => {
        Pip.removeListener("streamStopped", d), Pip.radioClipPlaying = !1, c && rd.setVol(c), e(1)
    };
    if (Pip.radioClipPlaying) Pip.removeListener("streamStopped", d), Pip.videoStop(), Pip.radioClipPlaying = !1, c && rd.setVol(c), e(0);
    else {
        c = rd.getVol(), rd.setVol(2), a == CLIP_TYPE.ANY && (a = [CLIP_TYPE.MUSIC, CLIP_TYPE.VOICE, CLIP_TYPE.SFX][Math.floor(Math.random() * 2.999)]);
        let e = require("fs").readdirSync("RADIO").sort().filter(b => b.startsWith(a) && b.toUpperCase().endsWith("WAV") && !b.startsWith("."));
        e.length || f("No radio clips found");
        let g = getRandomExcluding(e.length, Pip.lastClipIndex);
        b && console.log(`Playing radio clip type ${a}: ${e[g]}`), Pip.audioStart("RADIO/" + e[g]), Pip.on("streamStopped", d), Pip.radioClipPlaying = !0, Pip.lastClipIndex = g
    }
}));
let submenuRadio = () => {
    rd._options || rd.setupI2C(), bC.clear(1);
    let f = 0;
    let a = Graphics.createArrayBuffer(120, 120, 2, {
        msb: !0
    });
    E.getAddressOf(a, 0) == 0 && (a = undefined, E.defrag(), a = Graphics.createArrayBuffer(120, 120, 2, {
        msb: !0
    }));
    let c = new Uint16Array(60);
    for (let l = 0; l < 60; l += 2) c[l] = l * 2;

    function j() {
        for (let a = 0; a < 40; a++) {
            let c = 2,
                b = 1;
            a % 5 == 0 && (c = 3, b = 2), bC.setColor(c), bC.drawLine(245 + a * 3, 143 - b, 245 + a * 3, 143), bC.drawLine(367 - b, 22 + a * 3, 367, 22 + a * 3)
        }
        bC.setColor(3).drawLine(245, 144, 367, 144).drawLine(368, 144, 368, 22).flip()
    }

    function k() {
        if (a.clearRect(0, 0, 119, 119), Pip.radioClipPlaying) Pip.getAudioWaveform(c, 20, 100);
        else if (Pip.radioOn)
            for (let a = 1; a < 60; a += 2) c[a] = E.clip(60 + (analogRead(RADIO_AUDIO) - .263) * 600, 0, 119);
        else {
            let a = f;
            for (let b = 1; b < 60; b += 2) c[b] = 60 + Math.sin(a) * 45 * Math.sin((a += .6) * .13)
        }
        a.drawPolyAA(c), f += .3, Pip.blitImage(a, 285, 85, {
            noScanEffect: !0
        })
    }
    E.showMenu({
        '': {
            x2: 200,
            predraw: function() {
                bC.drawImage(a, 245, 20), rd.drawFreq(bC)
            }
        },
        "FM Radio": {
            value: rd.isOn(),
            format: a => a ? "On" : "Off",
            onchange: a => {
                a ? (Pip.radioKPSS = !1, rd.enable(!0), Pip.audioStart("UI/RADIO_ON.wav")) : (rd.enable(!1), rd.drawFreq(), Pip.audioStart("UI/RADIO_OFF.wav"))
            }
        },
        "FM Volume": {
            value: rd.getVol(),
            min: 0,
            max: 15,
            step: 1,
            onchange: a => {
                rd.setVol(a)
            }
        },
        "KPSS Radio": {
            value: !!Pip.radioKPSS,
            format: a => a ? "On" : "Off",
            onchange: a => {
                Pip.radioKPSS = a, a ? radioPlayClip(CLIP_TYPE.VOICE) : Pip.audioStart("UI/RADIO_OFF.wav")
            }
        }
    });
    let g = Pip.removeSubmenu;
    j();
    let h = setInterval(() => {
        Pip.radioKPSS && !Pip.streamPlaying() ? radioPlayClip(CLIP_TYPE.MUSIC) : k()
    }, 50);
    rd.rdsTimer = setInterval(() => {
        readRDSData()
    }, 100), rd.isOn() && (rd.getChannelInfo(), rd.drawFreq());
    let b = null;
    let e = 0;
    let d = null;

    function i(a) {
        if (Pip.radioKPSS) {
            Pip.videoStop();
            return
        }
        d || a == e ? (rd.freq = rd.freq + e * .1, rd.freq < rd.start / 100 && (rd.freq = rd.end / 100), rd.freq > rd.end / 100 && (rd.freq = rd.start / 100), rd.drawFreq(), b && clearTimeout(b), b = setTimeout(() => {
            try {
                rd.freqSet(rd.freq)
            } catch (a) {
                log(`Error tuning radio: ${a}`)
            }
            b = null
        }, 200), d && clearTimeout(d), d = setTimeout(() => {
            d = null
        }, 20)) : e = a
    }
    Pip.on("knob2", i), Pip.removeSubmenu = function() {
        Pip.radioKPSS = !1, clearInterval(h), rd.tuningInterval && clearInterval(rd.tuningInterval), rd.tuningInterval = null, rd.rdsTimer && clearInterval(rd.rdsTimer), rd.rdsTimer = null, Pip.removeListener("knob2", i), b && clearTimeout(b), g()
    }
};
let submenuStatus = () => {
    const c = {
        x: 137,
        y: 65,
        repeat: !0
    };
    let a = require("fs").readdirSync("STAT").sort().filter(a => a.startsWith("VB") && a.toUpperCase().endsWith("AVI") && !a.startsWith("."));
    if (!a.length) return;
    Pip.statIndex == null && (Pip.statIndex = Math.floor(a.length * Math.random() * .999));
    let b = setTimeout(function() {
        b = undefined, Pip.videoStart(`STAT/${a[Pip.statIndex]}`, c)
    }, 50);

    function d(b) {
        if (b == 0) return;
        Pip.statIndex -= b, Pip.statIndex < 0 ? Pip.statIndex = 0 : Pip.statIndex >= a.length ? Pip.statIndex = a.length - 1 : (Pip.knob1Click(b), setTimeout(b => Pip.videoStart(`STAT/${a[Pip.statIndex]}`, c), 50))
    }
    Pip.on("knob1", d), Pip.removeSubmenu = function() {
        b && clearTimeout(b), Pip.videoStop(), Pip.removeListener("knob1", d)
    }
};
let submenuConnect = () => {
    let a = setTimeout(function() {
        a = undefined, Pip.videoStart(`STAT/CONNECTING.avi`, {
            x: 50,
            y: 73,
            repeat: !1
        }), Pip.on("streamStopped", function() {
            Pip.removeAllListeners("streamStopped"), Pip.videoStart(`STAT/CONNECTED${1+Math.floor(Math.random()*1.999)}.avi`, {
                x: 50,
                y: 73,
                repeat: !0
            })
        })
    }, 100);
    Pip.removeSubmenu = function() {
        a && clearTimeout(a), Pip.removeAllListeners("streamStopped"), Pip.videoStop()
    }
};
let submenuDiagnostics = () => {
    const e = {
        x: 50,
        y: 42,
        repeat: !0
    };
    let a = require("fs").readdirSync("STAT").filter(a => a.startsWith("DIAG") && a.toUpperCase().endsWith("AVI") && !a.startsWith("."));
    if (!a.length) return;
    let b = Math.floor(a.length * Math.random() * .999);
    let c = !1;
    let d = setTimeout(function() {
        d = undefined, Pip.videoStart(`STAT/${a[b]}`, e)
    }, 200);

    function f(d) {
        if (d == 0 || c) return;
        c = !0, b = (b + a.length + d) % a.length, Pip.knob1Click(d), setTimeout(d => {
            Pip.videoStart(`STAT/${a[b]}`, e), c = !1
        }, 100)
    }
    Pip.on("knob1", f), Pip.removeSubmenu = function() {
        d && clearTimeout(d), Pip.videoStop(), Pip.removeListener("knob1", f)
    }
};
let submenuRad = () => {
    var d = Pip.audioBuiltin("CLICK"),
        k = new Uint8Array(d.length),
        a = Math.random() * .5 + .02,
        b = a,
        c = !1;
    bC.clear();
    var e = dc("\0~\0ü\1ø\3\xf0\7\xe0\x0fÀ\x1f?\0~\0ü\1ø\1\xca\xad@ø\2\b\x0fÿÀ\x1cf\x17ÿÿü\f\x1f\2\xdbÿ\0\v\7\"¶cüA\xf3\x1c^\xf3\x1f\xe0\beýÿ\1£\x0f\xe0\1g\xe6?À\x11o\xeb\xe4v\x7f\6ÿ\xc7\xccni\vÿ\2\x7fcþ\3\x1b_ÿý\0\xc3ø\0\x18\x1f\xf0\xc6\xf0u \4\xf0\x7f¤\x7f\xe0cp:\xd0\2x\x7fÁ÷\xf0\xc3ø\0\x13\b,w?\x10\xf3\x1f\xe60\xd5 ÿ\xc3\xedÁ\xcc\x7f\xe2ÿ1þcü\0$\7Á\x071þ\0\x12\x7f\xf0\x0d³\x0fúC\xcc\x7f\xe1r\3ø/þ\0\x0e_\xe01¸h\xc7ø\0X\x19\x1e\x7f\xf3\x1b\xf0\x13\x184\2ÿ\xe0\b'ÿ\x0f\xe0\x0fÀ\x1f?\0~\0ü\1ø\3\xf0\7\xe0\x0fÀ\x1f?\0~\0ü\1ø\3\xf0\7\xe0\x0fÀ\t\xc5¨\1ucAu\x19\xea°\x065´\xcced\2\xea\xca´\5À\4\xdakZ\x7f«\xe2=®c\xd3H\x17WU,þ\0&4cV\2cü\0\\+PcZYü\xc6V¤\x12<\x16ª\0\b\x18<\vTXü\0T\x18\xc65[T\0\x1a \x16\x14\xc7ø\0µ°S\b\xe0\0\x1e\0~c\x1a\4\6,b),+PXü\0T\4\xc6\x15h°\x1eT°\x13@ X@L\x7f\x0d\xd5`\nÁ\xe5\1A\xc2:\5j2\7\x1a\xd2\x15ÿ1\\\bc \0\fh \x15¨\xc7ø\0\xc5°Z\0(S\x18\xd0\b©-\1_\xf0\1P\x13\x10@±\xcccÀ ¡@Xÿ\v\xad1H1\0\x19\1\xc8\x16\x7f&\x16±$\xc6L\1ºP\3ø\t,\x1c\xd6 \xc6\\#\xd9@\x0fcZ\xad,(\xc6\vUU2\3@.þ®\x1e\6\xd4\xd5«2?c\x11AµF4\xd5j¶\xadU@¿û\x18F\x18K LiBµ&0Y\0¸Iczh\ncU\x10x&7\xea\0 \xe0\fh\xc6a\xd5uZ\x17\xeca@\0\xd3iLa\xd6D7S\x0dj4cM\x0e\xc5\xf4\x19)\x1d\1\x1bQ[S\"¹\x7f&«R³\x18\xc6«*c\x12¬\x18\0\\?þwV\5ÿÿ1F´6\x19\0¡\xc6\0\x15\x7fÿø\fjAÿÿü\0Lø\xd0øx\xd6 \xc6\4\xc6; \x11º\4 ~5\x1b\xe0ÿø\1#À¯\x18\xd1jB\1\x12\x1a \x0f\xf0\xc6¤|0\x0fÀ$t\x1bU@,\xd0\x1c\xc6kT7:\7þ\xd5ü\0 µ\x16H6c@$\tv@9\3\x19\xdf\xc8\x1f\xf4\xc6¯>c:\2;%h\t\6\xd0&2-ZC\x19\xf0#\x1a\xdd\3\x19\xeah\x062AC\xd3« Hc¼\0\6^c:T%¤\x0e\0\xc6|h\xc6MU\xe0I\x7f\xe1iù\xd2¸&2`\x064´¦2%=Cÿ\xe7\xcck\xefü\0\xe3 \xda«A¥H\xe62%F2´\xdaª\0\xe8\xcfÿÿ\xe8c[ÿÀ\7\x19*\xd2F\xda´\x063\xedF2j\xd9T\x11\0\1oÿõq \2 \x7f\xf4a£paA\2eF4r¦2+U[Vr\\\5\x0f\xe0\xc6¬\x1fþ\x0e2\x0dª@¤µ\x011ª1id©V_þ\xd5ÿ\1\xc6Fµ\b\xf0WB1\xdb\x1a\2c2«ªÀ\x0eÿ\f \xd5·\xcdµ1\2,\x0eZ\b\xe2\b\0(\xadkT\0\nªf\f\xc6\t®\4\x0d©\x1cJ´/\xc4\4\xc6´ÿ\xe0\x0d,\t$)IHH+Q0\0y@`0#\x195fU øF2~\3\x1a\xdbþ4² p\b\xd0808\x13¨ \2t¦2\xebFp\xd2A±\xe1ÿ\xf0\1¥\xca´\xf0\0\xe1\xca@\xd2\xc3\4\bt\4\xc6`P\x1c¯\xe4\f\xc6¬\vÿÿ\xf0\3\xd5\x17\x0e\b1j,\3©U\x152\51i\2\7jI\0\x1a\x17ÿ\xad\xd5=\3ÿø\x1cJ\xd5\1\x1c\x10\xc5\x0f*\x1d\"\2p\f\xc6CpJ¶¤g\xf4\xc6¡\xf0\x13\x19p\xad@\x18K@<x\xd1P\x1c ´³ F3jº§ \xca\0\xc9@ÿ\fjC\xccfJ´\5¡X\xc42\6\xc8\x1e\xad\3\tj\xc8\7\t\xdf\0\x15/1ªÀ3N\x0dZ\xd5iE\xc7\x1dB-U\xad\1\xd2\7\tÿ\xda\x18j\xe2ÁBÁ\x10\t\\\x16\xd2\xce\x1bRV\0d+P\xad\x1b@\6\x12\xd5ª\xc8\b\xd1\n\2\xc8\x14\xc65WT»\0\\¨¶(\0\x1d\"\xc8]((\x0e«T[\x13Jc\x1a\xd4H\0²4KV\0\x1a4¥b*H\xd3 J³4P\x005¤¸C\x14P\x11Hj H\xe4\0\xc2j¢\0\x11µjLa\4\3¨\th1\xc5\6\xd4\7\7\n\xd0\t^\v\x19@\x000¦@u£\x19\3@\xe0C\0\x0d\x0dÁ(\5\x1a\\\x11\2\xc85\2c,\x19\t\x15¤\xc6=Tr\"=p\1b@J!J \66h4\td\x1d)P\xd4+Q8\x12l\x10 \"\xad\3`X\xcb²\x030c&´(\4z \2\x14HP\x11AQ6©¨C!-M[*c\"\xad¨l\5 1\xc6&\7I\6\x16\2\0\"\x15ZL¶\x074b \0\x0e©@\x197ø:\xd3\xd0\x12)I-Z\x19ta\xd8&(\xc6ÁjµY\3\x19i\x1e \xcaµf%\x1b\x18Á+\x15\x1a\xd4=^\xca\xc9\xad\x0eL\x1b;ª\6~\xd5¥1V\xd5$\x1d\x1b\x17ªÀ\2\xc8&_jX\xe5¤\x1e\x1b\x15ª\xd2\2\xc8&_z1ªH>\0&4+\5¦N\xeb\6\xc4=Xn\x0e\0\xc7=¨V\v\xccu()#Z\x18\xe3r\x10j \xda\xad (h6¤[\4\vTc\x1c\xc4\x0dhn8\1ø\x0e¥z\x0e¨\x164¨i\x16«*b\x16\xadª\xd4\xd5µ\69 \xc2^ ½\6~G*\xd2\xc5\x1a\2l\5\xed\b\0XR\xec\x186©~,\t:M\xcdIW\xe0 0¨\69cK°`\"\xf0M\xc2¾\xe3\x16\2b\x12\xadªgjÀ\x18\xe5\t\xc2j\0\xd0\f#µeLa\xdaµ@`«Ca\6Q;\xc2j´¡\x12\xd2F\1\0\1}\2\4\n´\xf4\x0e¥þ&¨\xd2\x10\x14\x11mIt*¶¨\xd2\x1dY4 \2\b\x16 \n\x1c«Tõ\n\f\n\x11+\v\4;V«*c\x0d@\x1aV$PmQ|(\xd2VX\5¨¼\x13\xe0\x13\x10@`\x12B´\t±uT\1\xd8,°\x11\xca`\xd6µZS\x18¡¨ \b£EcZ 8&`\xd2Áµja\x18\xc3À%$\x12\6\xd5j Z\x14°\1@5W°&!\x19\xe0¾¤v5\6¨1\xcd\1\xd5VµL Lb\xe8\6\x11\xea\xe3F\xe4K+\7*c\x16\xad¤I\xc6¼\x1e\f7\7\0c\x1e\x0e¤\xc4)\x17\xdcp!!\tÀh\69\xe1Z\xad)j®¤]\x14\x19\xd8Dh]\x1b\xcc|©}RJ=\0\xe0´\x10R5\0@\x1dQz\xad©ù\x14k mD\xc4\xc9{Q\1\x19Pi \5`%AV\xe2J²¦1\xebCW\":\xc8H¿\x15*\vTG¥1ý|\0\x16¨\x12\1R¨\xe0°\xe0\xc62*\xdaC\x14\x10\x1dH%\x13\x1cP-IA\b\x100±\xf2 \xd5D¦1\xea¦8DB\xc5Le@5F2\x1f\xcf¯B\xd0\2Gd\5OAJb\xd4\1J²¦1õF8!F2%X\3\x1dq£\x19\x16ª\1õ\xe9\"¸ %1D\xc2\xc2´¦2\x13o¯JyÀc2\fc\"´cz<\7R*~\0S\x14\x16,\vRc# 7~\xd4\b\x1e\5¨1\xcbTI\x0ec#@7\x7fT\b\x1e\x0d¤1Á\x1518\4\xc6=X\xc7\6¤\x10<(U\4\2\nR\x0e \f\x1a\xd4c!8ü\7P\t\x1e51\xdb*\xca\xc7!\x10\0Z\4 \"U1Á\1)\7@Ic\x1eªcT¾\x1e\xd4<\x1c\xc74+Jb\x1a\xd5©\x1b=\6\xd3jjP\0\1)\69 \xc65[T9~\x15 \xadjS\"@Q¯\3ª\2\xc7\x18\xc51\3µ\x18\xdf\xc8@]bÀu\6;\xc4\xd5\x1aµ)\4\x003\x1a\xc8@ º \x18)`´8 ¥0j\x063mL\xd0\xadX\3\x1bÁ\xf0 \xda¤@Pm\1\xe8\6¨\xc4\x15h\xd0\x1dh\xc6\xf4©\xce\x1ckR\5\6\x14c\2P\4^\x18\0[P0\x1a±3\x189\3\x1cB\xe0t¦0E\x0f\0\5 @GE\x17A\xd5iLq\xda\xe2\xea´§\xc9\xe4²¶\xadI3\x18:\3\x1cp\b.«Tc\xc25ª1\vU«\x18\xde\xd4\xc6j¨\6;\xe1Z£\x10¦0t9Z\3\x1e\xd4\1dÁ´¦9`:Hú£\x1cZ¡2!\x067\4\0\x1c(\2\v&\4c\x1eªcv\4\x1e\x1c\xd8IIm!X\t0S\x18`h\x010djLr\b1\xd3\x001\xcd\6\xd0\x18ÿ\0\7ª1\xca\b \xc6\xecV¨c+Tc\x1e\xd4;r\x14Z\x1c\x10A\xca\4\4\x12@P+Ql \xf3\x1b\0H0S\x192£\x19\0\xd0À\2A@\xc6ÿ\0± \\\3\x1b0 \x100¿\xc8¬ \x18F3\xeab B\xd2ÿÿ\xcbcG\xccg\xc6d\xcbÀ@\xefÿý\1Y \1\t£\2\n11\2ÿÀ cp~\taG\xe3\xc6°\x061Á\3\xc3\1\3ÿú\n\xc81\xc764c x<¼v\f\x1cv\x13\x18S\x1bA°Qaÿ!b±\xccqVÁCÿ\xd6ÿ\xe0,Iù\tS¸q8p\x7fõ\x7fø+\v\xf0c(´-@\x10\f\x14\xd89q\xc8&3¥F5!lPE þ\5c\x18\xd9\x18\xd4\x1bc$´9\xe8\x19Q P\x13\x1bP\x1f\xf1©\xf4ü\xc6}¨F \xe8\x1a¬\3úcQ|($6\xe60´¦1\xf2\2QºF2¤\x065`\x7fø\x10\x1d\11\1\xf0CrX\xeb\x7f\xe8\x7f\xe0(&5 $°\xdcÀ\2C\x1b\bc´  ÿ,>\x11\xf1\xe8&5µ Q/ýÿÁh\1,: 8($2¦24\fy\fb\xcfÿÿ\3\x1f\xe68#ÿþx©,*\0 8\b *¡\xda±¸\x7fü.\x11U\xf0m\x12\x1a\2\x18öÿ\xd5A\x18\xce\5_\6c! !q\xe8&5µ\0Q!lt`?ÿÁz ¨X©°v=\xe61aÿþ\xf3° \xf0W\xc3\x18\xc8\4\x0d\2\xd4\xec\xc5ÿþ\x061`\xe62\2@¶\xc3-\tP\x15\5\4\x0ecTr\t\xedQ\xd9ÿ\x7f\xe8c\x13ú)\fV,ü\xc6\x0fD-Vc\x1c\x101G¸_\x19!\xd0õBQ\xccbÿù\xe5p\xe0Á\xc4\xe0A\x15¿\3\xdb\b\0\x19hs`)õUa\xe8µ\xad(\x10&\xe0f0 b\xf2\fa\xdaµ@\2b@\x7f\xf4\x7f\xe918_8B±\0À\xc7U\fd\0\vec\b\4\v\xdcc\x1a\xc5°@ \xc35W\4V9/¡Hc\x18\xec\xf1iÿ`\xdfÿ\xe1\xf1§ø\4¸N@\2¦\xc4ÿ \x013\4'\4>\b¬c\x19 \4H\5\xd5j\7Á\3)1\xf0\x1a`\0¹\t\xf0\x043\xf3\x18=\2\x1f\xe0\7\xe3\xe60p\4?À\x0fÁÿÿ\xe2\x17\xe0\bwþ\1 "),
        f = [0, 0, -5, -5, -130, -5, -152, 0, -130, 5, -5, 5],
        h = setInterval(function() {
            Math.random() < a && (b < .95 && (b += .02), Pip.audioGetFree() > 1e3 && Pip.audioStartVar(d), b > .6 ? c || (Pip.fadeOff([LED_GREEN]), c = !0) : c && (Pip.fadeOn([LED_GREEN]), c = !1))
        }, 25),
        i = setInterval(function() {
            var c = (Math.random() - .5) * (a + .1);
            b = b * .9 + (a + c * c) * .1, new Uint8Array(bC.buffer).set(e), bC.setColor(3).fillPolyAA(g.transformVertices(f, {
                x: 195,
                y: 194,
                rotate: Math.PI * b
            })), bC.flip()
        }, 100);

    function j(b) {
        b ? (a += b * .03, a < .01 && (a = .01), a > .85 && (a = .85)) : (Pip.removeSubmenu(), delete Pip.removeSubmenu, submenuInvAttach())
    }
    Pip.on("knob1", j), Pip.removeSubmenu = function() {
        clearInterval(h), clearInterval(i), Pip.removeListener("knob1", j), c && (Pip.fadeOn([LED_GREEN]), c = !1)
    }
};
let submenuMap = () => {
    if (require("fs").statSync("MAP/MAP.img") == undefined) {
        const e = {
            x: 36,
            y: 40,
            repeat: !0
        };
        let d = !1;
        let b = require("fs").readdirSync("MAP").sort().filter(a => a.toUpperCase().endsWith("AVI") && !a.startsWith("."));
        if (!b.length) return;
        let c = Math.floor(b.length * Math.random() * .999);
        let a = setTimeout(function() {
            a = undefined, Pip.videoStart(`MAP/${b[c]}`, e)
        }, 200);

        function f(f) {
            if (f == 0 || d) return;
            d = !0, c = (c + b.length + f) % b.length, Pip.knob1Click(f), a && clearTimeout(a), a = setTimeout(f => {
                a = undefined, g.clearRect(36, 286, 444, 289), Pip.videoStart(`MAP/${b[c]}`, e), d = !1
            }, 100)
        }
        Pip.on("knob1", f), Pip.removeSubmenu = function() {
            a && clearTimeout(a), Pip.videoStop(), Pip.removeListener("knob1", f), g.clearRect(36, 40, 444, 65)
        }
    } else {
        var a, e = 2048 - bC.getWidth(),
            f = 2048 - bC.getHeight(),
            b = Math.round(Math.random() * e),
            c = Math.round(Math.random() * f),
            h = {
                width: 128,
                height: 128,
                bpp: 2
            },
            d;
        bC.clear(1).setFontMonofonto23(), bC.setFontAlign(0, 0).drawString("LOADING...", 200, 75), bC.flip();
        var j = setInterval(() => bC.flip(), 50);
        E.defrag();

        function g() {
            d = undefined, a === undefined && (a = E.openFile("MAP/MAP.img", "r"));
            var l = b >> 7,
                m = c >> 7;
            for (var f = 0; f < 3; f++) {
                var i = m + f,
                    e = f * 128 - (c & 127);
                if (i >= 0 && i < 16)
                    for (var g = 0; g < 4; g++) {
                        var j = l + g,
                            k = g * 128 - (b & 127);
                        j >= 0 && j < 16 ? (a.seek(4096 * (j + i * 16)), h.buffer = undefined, h.buffer = a.read(4096), bC.drawImage(h, k, e)) : bC.fillRect(k, e, k + 127, e + 127)
                    } else bC.fillRect(0, e, BGRECT.w, e + 127)
            }
        }
        var i = setTimeout(function() {
            i = undefined, bH.drawImage({
                width: 370,
                height: 5,
                bpp: 2,
                buffer: require("heatshrink").decompress("ª?\0?j\xd5\0\7\xd2\xc8\t\x11ª\xca«\4\xc9\x13\x11Z\x1d$N n¤@A ¢F\xf2Pe\x0e\x1c}Lh\xda\f¥\xc4 \x0fÀ\vT\0")
            }, 0, 34).flip(), g()
        }, 250);

        function k(c) {
            if (!a) return;
            b += c * 20, b < 0 && (b = 0), b > e && (b = e), d || (d = setTimeout(g, 20))
        }

        function l(b) {
            if (!a) return;
            c -= b * 20, c < 0 && (c = 0), c > f && (c = f), d || (d = setTimeout(g, 20))
        }
        Pip.on("knob1", l), Pip.on("knob2", k), Pip.removeSubmenu = function() {
            a && a.close(), i && clearTimeout(i), d && clearTimeout(d), j && clearInterval(j), Pip.removeListener("knob1", l), Pip.removeListener("knob2", k)
        }
    }
};
let showAlarm = l => {
    Pip.removeSubmenu && Pip.removeSubmenu(), delete Pip.removeSubmenu, Pip.remove && Pip.remove(), delete Pip.remove;
    let e = "\xc4j @`\xe47\x18?4 ^\2\x1b\xf0\xf1±p\x1f\xe8}\b¤\2\x7fÿ\7\x15\x7fÿþ\3\xc6.\2ÿ\xe0?ÿþ\0@80\x10\"\x12\xef\x10\bXH!±R\xf0h_\5Á¥P@\1\xdf\2K\x19ÿ\xcb\b\4ÿý\x1a\xc3Ds\x1f\x14lI\xccDAb\x12?\xcfÁ¢x\4&~S`þ\xcb\4ª\3U\x18!\v\xe7\x1fX&~0\0\x184\x19ÿ\xe6PgÀ\7\xd9\x15øL\2\v¿ü\4\2þB=\f\xec\x0d\xdcd?_\bO\x1b\x10\xd94\0\x14\x7f¢4\x13G\bB´¿\x1e\x11\x13\xe7þ·»!£?¡Cÿj°N\xe1(C7þ°¿û¸Q\n\x10 \xf0S÷p¢\x14 \xe1\1\x0d!<\1\x10\xad\x0f\b\t\xd2\x10µ/ÿ\4\3ú\4\xc2\xdf\xf4\4*\xcfþ\1\0ÿ  |_\xf1\n\xdbÿ\6ü'þ>!_ÿ\xe0ÿþb_ÿ\xe8u`?ÿÿ\xcfÿü\4\xc2\xefV\3B\xe7ÿ\xd1a\x7fv\x7fü\1\xd8Q\t\xd00`?\xe9ù¤ \x007\xefù\xd8`\0\xe1\t\x7f¨>\x10]\xd1\b¡\0\2P\4#ÁÁ`\xf4@ý\xcaÁ\x7f÷Á\1!\xe2\x11\2\2Á\xc3\xef\2\2\x1c\0\vø\x10\xc7\t\v«\xdc*\nU\x14T\v\xc6\x11\x13õ\xde\xd0*\nm!+\xe2U\x17\xd4\x14B\0_\x16\xd8 )\x13\x18 \0~_ ª!ø`h_\xe0\x18_q \xd0\xadV«ýªÿ\1\xc82\xc8\xe7\xea\xc4!\x0e\3ø\4\x7f \6\"\0\1Aú\xe3\x10uZø/ Di\x7f\x12þb$B\x1f»\x7fú*\3M\x15/\xe8K\xc9\xe5\0\1ÿ\xf1\xe1\xd0°k\xc2\xe2\x10¿þ\2\x14!&\4\xc4\48\x0f\x16!*=@Y \x17ü\0\x0fÿû\5ª[û\xed\xe2¥ÿH£@\x1fÿ@Hh\x1fV¿ÿ\xefe\x0fÿ\xc7ÿm\xe0\x1bÿ\xf0t \0|\4\xc9\x1d2@\0§ÿ\xf0 \0\xed'rHA-\xc9;\4A\x14\"Uü\xc4\f\x18\x1e\x0f\x1eA\xd8\x10\0rþÿ1ÿø\x1eD\x1cB+t0@\0z~\x7fù\x10x`\0F$\6\xe7\x7fw\xe6C\xc2\xebÀ@ý\1FÁ\0\xc7\xc4!\xd0\4%ª\xc2ÿ¸\0\3\xe9 @j\xc2¿±pX_K\x17B[(\x1f\xf00\0\xdfÁ> \xc2\xd0?\xe3\xd8\1~_\xc3H_ü\x7f÷p\"2\xd0 'ÿ\xf3\x1e/\7ý/ü\"\x10\xe3ÿ\xe0@ø7\xe0`_\xe4\bQ\xf0[ÿ\x10¿ÿ/ÿü\x10(B\x0fú\2\7_x\xcb(B\b\x006\xe8}\1\tpõI@Q?0¾\x12\xe0b\x13þDp\xd5I\xf3À@ý\2uÀ¢\x13\x10ø\4\tO\2\7À\x10\xde\4\0#\x14\b@o\xe0Pþ\2\x12\xe0B\x11q\xe2\x11¼J\xe1Q\6\x0d\4\x10õ\x0d\7\x1fy\n!0\xcc(&Xl\xd5H@7\xe2\x11¼\xe0`aª\"\n\xcb\b\4\x17ÿ¶!\x1bÀ!1\x12 `\x18`\0þ\x13YÁ\xcf\5f$g\x10B\x16¼2\x15¼B30\xd0\0Q¿ÿ,*\fü2\x10\f0\0\x13\xe0\x16±\tø\1\x12\x14°\xe8\xe5 n\xe4\1Á\xc3¢\x7fw\xe2\x11\xdd\xc7\bD\x0eü\x10\x0fÿø\bPAr\6!#\xf0!H:\x18\f?xO\xe0\b\x10¨@\0¿¢\x14 %pB\xe1~@a|L\xc2P\x7fÿB\x11¿P\1P\4(ü#\x7f\xe1b\x110\2\x147ÿ1\bý!\b\1\v_ø\x14?\0\vø\xf4¼\n\x1fÀBÿ\xce!\x1fÿ\x10«\v\xedHÁ\x1a\xc4\x10¡(\xc7þDI\xf4\fB¾¾\x16\x0d\x0e ,\x11\n¡Àÿ°\xd8±8\x15?ù@HU\b\4\f\xd6 \0øøA\xd0>õ\x18P\x11\v`\0¾ÀUA\xd0\4,ü\1\xcfÀÁ`\4.%\3\xe0*U\0\7\xe0\6\3\x0f\x10Á\7\3\5\xd0\x10²\x1a\n\4(\x14\0jp1\t\x10\1\v¨\0\xddÁ\b^¿¡\xd2\x1a!(^\x17$B\xea\xdc*pø0\x004(\x7fÿý?\x10\0\6À\3\5üo\xc4\7\xcah\x10 ø\x7f¬\5¼\x1c\x1fÿÿO¿ÿ²\x10\x0dV§!\1\xd7\5D©K\xd4\5\6T©\x1a\x1c(\4B ÿA\xda(¯\x004a\1\xd0\x11\t?\5@b\x14`B\x12~`ÀÀû\xc4'@\xc4$þ\x16Áx\x17\0û,ÿ\1 \xc5\x11\0\xefõ\xc2\x13\"\0\5þ®\4¿\xdf\4'B\xc3aû\xc4\"\x7f*\xc3\xc4$±\3m\3\x7f¸\bSýIÿo\7\bEûEÀ?\2þ\xef\4'\xcb\xdc\xe2\bE\xe0\bBþ|\4*}7\xe2\x11\xe0\x7f\xccùøh?\x14Oÿ@B\x17\xd0@x^$OÿB\x11\b\5ü¼\"¼BP\"\x10!\0\x0e@GP\4*\x10ø\x0e \0\f4$\2\2\6\x13ø!cü(\x18B \xf0@\xc8K\1?¢\x16\x0f\xe1=\4%\0F\4\x19\x0f\xe8\7\6>!u\xca\x14=b(\1'0\080±\v½\08\xdfú\0~\1´oþ\0B\x1cB4\0BÁü@À{\xf1P\xe2\x15\1\1\xdf\xc4+¹D\4\7?\x10·þ\4\7\x1fj\f!SúL B¿\xf1 GBp1\b1\n\xf2\xf0¸_\t\x1f\1\vp\x11\vaqD+\xcf\xc42'\xc5¿Bú\bR\v!\x14V\x18~D\n{\xf0¸\\\0Hö¨\xe8t\"\xc3\xc4*Á`ap°\0¡!b\x15 '`\xdb\xed ,X8E8^Z\xadh\x16)41\n\x10  @\0Tÿeÿ\xadb|T \xda\xed\xd5\2\3@J\x0fªH\0bP0\7\xe0!v~\xcbLB\x7f\xf0B\xec|C\4\x1cC\4\1\x0f\4\2_ÿ\xf0\b^\x7f¨\0q\0";
    let f = "F @`\xe0_\xf0\0_©\x1b\xf0p~\0h\xf1\xf0h\x7fú\x004h\x184O\xe0p{ø8N4hx4Oøpph¿\29\xceB\x1d\tÀ\7?\x0e~\x1cl\f\x1a/\xf1\xeac\xd8yø8n\x004Hx4oø¬b¸QÀ\0\xefÁÁø\1£E2\fe\x18\xc8<\2þ\x0e\x13 \f\x17ÀW\x1a\1°9\t@/:\7\x0fø+F \3ÿYC\xc2þ¡\x1c\xe3\xc3ý\x1c\xe4\x19\xc3¿À\3\xc3\xcc\xe1Bü\1\xc27ÁÀ`\bX\5\vø\7\bÿ\x0eM+\x19\1+\6i\489\xf4\x10p_\xe4@C`H\xe1§Á¡\7\6h\x19CP4\x0fa `\xd1J\3\6ö\4\x1a,ü\x1c2\0 \0P\xf0h\xdf\xf0`p@\x10'A\x15À $P\xe1oÁÁ\xc2\xde\x11B\1\2e\x164\4\f½\xf2\tS [ü\4\x1cb\x15ü\x1c X\x18\x17õ\xd4\x17®4\3`+\6?Àg\x19\xc4\fþø\b\x0e\x16ÿ~'\xf0\x1f\xebÿ\x1f\xe0*\5\xce0\x1c\x1e\7÷}\3ú\7\7\x7f!~ÿ\5ü\xec\bph\x7fC\x7fýø\3o¡gwÁ\xc2|\x1bÿ\xf4/\xe0\x1c \x16\v\4\x11\xc9\\\x0d\xf1X¨\x0f\xf2\x1f\xe7J\x1c\x1cú\x0fö\x7f@ÿ$\n\xe1\1\2\x0e\x0dÿ@ÿ\x11þþ\x1c\x1a?)\xde\7@\xca\x1a j\x075\3\3\6ü@@\xcbü\1\xf0^\xc3@7ø\0\x100\tø8n\2|\x10ø>\bx4b\x18;\0";
    let g = "M\xe0@q'\"\x7f\xe0ª`?ú\0$\0 ±¡\xe0 ¾\2\1D\xe0\7\xc7\x10?\5\tü\5\7¿\5\tþ\x1a7\x10j(\xdc@QD\1HB\2ú\2ü\2;\nü\x15ø)5\"_ÀP \0À `¢8\x0f\1\xdeA\n\x16\5¿\5\x11ý\4\0[ü6(\xee9\xe4(8(\xe4\x13'\xe0gü\08@ ÿ\xf4/þ\0\x14*D0H\xcap!\0\5I\3\xf0\5\x0f\0\xdf\1D";
    let h = "£H @q \x7f\xf0\0\x7fÀ\xc9A\1?ÿ\02\xf0¸\0\x031F\5\x1a\x15\x0f\b3<hTü\"7\0D\xcdü\"7@ <, 7øDFü\"7\xf2x\xc2/\xc4_¿\x117\v\x111\xf0\b\x0f?\bÀ+\x1c\0\4 4\f G\xf0q\x18¡ ¢\1\xc4\b\0\3/\b\b\x10X\x18hQT\xf4a\0\xe1 >\4`\xe3@D\xcf\xf0\f\1ø\x12ö\bÿÀ\x10\xd8@p0\vøDn<\xd6$ÿ\v\b\x0dþ\53\x0f\xe9\0\xdfF\xf0@F\1\1<\"\6\x1ei\x0e\x1f\xe0z\t\b \x14\vú\"*\x0føoJ\4DJ\\\x13\xc8F\xd0DDÀ\xc4J@Á\b¡4\4m\4\xd0j-\x18Y\\\x11\x11\x100-\x10\xdb ¿´C}\4\"\"\x1ey\fr\x0f\xf0DD\f¬ \xd0\x11\x111\xf1`\0p\x10²)\x12\0À\3\x1d\xc3\x1a\x11\x1cd)` \xe5Q^Á\4\bSD4PQ\0\xd0\x108b\2 `0§\xe5\xd0¥\xe1\x11p\0\xd1\x17À\b\4\2\f°@À ø[\xf1HÁ\xd5\1\xf4!ÿH\x0f\x188x\x1f\7ÿ\2\v?À0\7\xe0Kø\x10ÿÁd\x10\x18\"\"\3Á\xf0ÿ¯\xe1\x11 Aþo\xc6 \xf0!a\1¿\xc8 ¥þÿ`\x13`!\x11¼\5PP¡\0<\"\6\x1e\x1f\5\"\f?Àõ \x12\x10\4\x1f\xf4\vú\"*\x0fø\5\xe0?\").\x0eÿük\4DT\x0f\xf0t\4D\4\x12\xf0B\"!\x7fC@oÀM\6\"\xd2Á\x11\x11\3\tÿh\xd9\4DEý¢\x0fM\xf4\x18\x7f\xe1\x10\fü\n\x0f\xf0DD\f8\x0eÿ\3\6~\"&?À,\4U\7\0¢\4<H\x11T\x18\0¨%¡\5\1\b\xca\4°\b\b\x17\x11*a\7Á\xe0\1A\0\x0e\x1c\4\x1a\bD\x1f¡\x100P\"@ ";
    tm0 = null;
    let i = 0,
        b = 0;
    let j = setInterval(function() {
        let d = Date();
        let j = d.getHours();
        let a, l;
        settings.clock12hr ? (a = (j + 11) % 12 + 1, l = j < 12 ? "AM" : "PM") : a = j.twoDigit();
        let c = d.getMinutes().twoDigit();
        let k = d.getSeconds();
        c != tm0 && (bC.clear(1), Pip.clockVertical ? (bC.drawImage(dc(e), 25, 20), bC.setFontMonofonto96().drawString(a, settings.clock12hr && a < 10 ? 281 : 223, 0).drawString(c, 223, 110), settings.clock12hr && bC.setFontMonofonto28().drawString(l, 350, 177)) : (bC.drawImage(dc(g), 175, 0), bC.setFontMonofonto120().drawString(a, settings.clock12hr && a < 10 ? 93 : 20, 45).drawString(":", 160, 45).drawString(c, 228, 45)), tm0 = c), k != ts0 && (bC.setFontMonofonto120().setColor(k & 1 ? 3 : 1).drawString(":", 160, Pip.clockVertical ? 40 : 45), ts0 = k), (++i & 7) == 0 && (Pip.clockVertical ? bC.setColor(3).drawImage(dc(f), 14, 28, {
            frame: b
        }) : bC.setColor(3).drawImage(dc(h), 162, 10, {
            frame: b
        }), b = ++b % 3), bC.flip()
    }, 50);
    let a;

    function c() {
        a && clearTimeout(a), a = undefined, Pip.videoStop(), configureAlarm(), showMainMenu()
    }

    function k(a) {
        a == 0 ? c() : (Pip.clockVertical = !Pip.clockVertical, bC.clear(1).flip(), tm0 = null)
    }
    a = setTimeout(c, 6e5), Pip.on("knob1", k), Pip.on("knob2", c), Pip.remove = function() {
        a && clearTimeout(a), a = undefined, clearInterval(j), Pip.removeListener("knob1", k), Pip.removeListener("knob2", c)
    };
    let d = settings.alarm.soundIndex;
    d >= settings.alarm.soundFiles.length ? setTimeout(a => {
        rd.enable(!0)
    }, 1e3) : (l && console.log("Playing alarm sound file: " + settings.alarm.soundFiles[d]), Pip.audioStart(`ALARM/${settings.alarm.soundFiles[d]}`, {
        repeat: !0
    })), Pip.brightness = 20, Pip.fadeOn()
};
let submenuInvAttach = () => {
    let a = 1;
    let b = ["¨Z @¡\xe0µZ y\tV«S\x15¨\4\xce²À+Z\xadU\0\"\\\6 \x14U«d\2eÁ\7\3d\f)\7J\x12\"-©µjjBa\x0f\7«j´\b\x10°\x186\0&=¤f\x10P\x1d,\x18H\f\7#U>d\1 EµY`C\xd0u!1tP qP\x18P\x1d-V´R\x17Aj\xd2\xd1@@\xd0 ¦jE `E!\b\xe9F \xd0Q\xe0\xd4 )0\xe0*Q 9,\xdc\x1dMFµ©\n\6\3\4&$\v\4.\4n\x0e¨\x0eª¨½\7@\x13\x16\x0dFÀYI\5\3ª\xeac\xd2¨( F\xe1\xe9T\xe5\2cB¡MP\xc6\xe0AÀJP`\xc5\xc6`A0@½Á\xc8Y \x16\n\bLh0L=VV \t@\4&$¦R\x13\x14\x1c\bL=HLIE¢\x14\x13\x14\x1c\x0e\1¥\xc4²Y\2ci² \xf0t\x11ºH\xd0Ll\b<\x1d,¤&&A*\tAh\3ª\xc3\xe8Bc\xea¨A0s6\x10PZ\xe0\4\xcdA¨\x010j!12X\0\xd90\x1c\xc9 \x000,6\0t6¦\x14 \x072g\b\0\f\x1aA\t§\4&E(&=2\x13\7R\x13\x12\x15\x1a\x0e\xd2\4\xc3 \xc3\xc6]\xc3jt\x12: \xd9\0\x12\xd1<m6B\xc8\x13\"\x0d©ª\xc5À\4\xc3\x16\x13\n\xc8\7\n\x13\x12 \tZ\t\6\1\5\n\2)\x0f46\t>\x0di\xe6\f\x024\xe3\4(\x1dX&\x14\4&\x10\x18\x10V\5f )\x17S\2\7\3\1\xca\xc2i 9K(¨\x18-¨(\x0d &\x18\x11`# `µj¨¤M.\f\x1b\4&\x0e&\b\xe8\x18\xd5VST\xd2B\x10\2\x13\x0fRT\6\2:\6«e¨E|\n\x13\4t\f\7,\x10\6«i\x14\x13\x10R\x0eBR\n\xd3U\xd2\xd4r¡_!\4\xc5µe\0 \xc5rµaHU] LUQ\x15²)\bx\x0d &--ª\x14Y\4R\bLX\3P\x11H !\4\xc6VAF\3j\t\6\x13\x14(\x10<\x18\5(t0Lh\bPA\xd0Á1J¡\4\xc9\n\6:\x1c&@ \x1bV¦:\x14&HP!H!3\xde¡\7G\t\0\4ÿ\tþ\x13\xde*\x13F\x0dª\xca\4\xd0´\xd0#!3\xe0\xdaH\x0dZ\x13:5A\xd5Ul3¥P\xadH¬\x1a\bL\xdbE« N\7\"\x132\3¤\xd5`h\x10\v(L\xc86KUJÀ@#!3r\xda\xd0L\x180L\xc8U+PP\n,\x1325Z(\2\x13\6R\x132U\2\xd2\xea´\x10\x0dHL\xcbL\7Cª\xd2ÀuU\0§u@ l\x012\xed\x10 :K0L\xdd@L,h&\x0d&`D\x1c\0L\x1d%«J\x132\3j²cH!4\x16À\xea²¡4\2\1\2\t\0\xc8Bk@\xe0\xc5#\4\xc3b`@*\xd0\xe2¦ VbÁ`\xcaS\xc9\6\xc2\x0f\t\x1a\x0d\x1a\x1f\2\x13\x14($¢\x0dª\4Áµ\4Á\"\6TZ«U\xadL\1\tH\x15õg\xe8:XVkS\1\xd5\x14¨6\x1f\3@eµP B@\4E \x10\x1d.ª\5l\bL\0Z\xd0¤\x1d$\x1a\x1325\x14¤\4\x1e\3U\x14¨S\0:\xd5Qª\x1e(\4h\xf47\xd0\t", "N @P¥@Á`Z\x000º pÀqaZ¬\0\x1c¹P8`8\"\xd15@aAÁj\6B\1\v\6<\fd\b8¨B0B¢\tC\x1a\x0e8\n\x11hA CP\x12&\4\x1c!¤0p¢0\xcbB\1\xc3\x13\2\x0e8F!h! \xe3\xf4\0\xe1K@\4\7\2\5\x10\x1c\x10XPp\xc6A\xc2\xea\1\xc2\3\x0eSA \x16\x19\xd5\x16E\7\f\f\7\4\x0ehr\x0e¤0\0@p/ À\4\v\1\x077\0\x1a\f\0T\v\x10\x10s'\x12\1\xc9À\1\x1d\7 )ö\x19h q\xcd²\3\3-\x12X\f´P8\xe2Àe¢\xc7\3D-\x10X\x14´@8\xe2À¥¢\1\xc7\x12R\x1eþ<\0H", "¼] Bh\xe0!\xd7 Á\xd7h\1\xdf\xc3»`\3l\xc4\3 \xe4\3¬\xc5 \x10P\xef\x11\4\4:\xd4d:\xe4h:\xe3´\x18\x0e;\xc6@;\xf3\xd0\x10\2Á°C§@C®Aj\1\xd3u\x10\v @¨\xadP:^ :dVUª\xd0\3d\2A´Àu!\xd2«YZ\xadxNB\1j\x0e+\6\3ª\xd4\xdaµC\xc2B\xe0\xda¨:\xf0\x1c\x1bT\0\v*\x1d\"R\x1d.\x0d¥\xad\7C\xd4\xadE\2\x19J¥\6\xc3\0\4\x1d\x14ü\x14j\x1a\xc8¥Á\x0eV\xd5T@\xe5\1¢VB\1d#Y\n\xcc\b:F¦\xd3e¨%\xd2D\x1c\2\x10\7I\t E@G\xd2\1Z\5©K\t\6!\2T\x10:<\x17U:\b\xf0#¤ \x10AP£\xdaF\xe0´\2ª\xd6\xc2\xdaÀC½A4UX¥µU²\0\xe1+@`m-¡¢V\xe2\x0fAZ\v\x1aN$\f\n\0\x123i\x0e¦\x1ei\x16\f\6 \x1d)*\b\0,\b\x1d\x0dP\x1c$\7Ta\n\vU,\f\x0e\b\0\x16²\x10tT°$0`\xad\xf0£;Á\0\4\xef\7SU\x0e\x1a\f\2\x0dú t-*P@\xe9\2\xd0h \xf0\xd8\"©\2\x0e\5 t}\x0e«4\x10\b:D\6\xd3\x1a\x0e*\x1dZ\xd4\1\x0e\0¬\xca¡\xe0\x14c$\x0e¥b\x11\x15\x1dÁ\x1c0\b|\x12\xc8!\xd2X¢jZ\xe0F\xc8\1\x11\4\x1d&*\x0d\7U\x0e$\x1d\48:\x1a¨\0\x1bPt°tD \xe1\xd0 \xd5µE\xc7f\x1d\xc3\x0e\4vht\xd0\0P\xea¶\xf0C\xd0¥@C¥YP \x10\x1d>;\x1a\xd2¿\6³\x1a\xd5UC¤\3\xd4´\xe6a\7Mv\x0e\4v4¨\xe8\x15Z\xd4\xe2\4:Px\x1a\xadh:3\xec!X6§p5\0\xe9U§\xf1\5@r ÀA¡\v\6<\x0d\xd5\vEn!\48X\xc4$`-!C \xe5C¡\x12\6h\x11\x0dj+tC\xd8!\xd2¡V`´\xc6n0®\t\xd8\x170F±Rh\7L\x1dB,\x16Y\f:\x0e¤:4\x14:\x1d\x14xT\4\xd6\x0dX\xd8\v\x18j\xc80\x1d-f«TZ\x17Tf´\xad@r«10\xc9`\xadYD¹Q]MX4\bX\" \0uY\28\"r'¢¥@\xf0I \3\0\5j\xd2Em!\xf0j\xcdB¡jN\xe0Eª»Aª\xda´µ¬©\xe4$°FE\4\x1a\4D\v\xccµ $°C£Á\x1f·\4\6\th\xadDvP\x11XM\xf0KD1a\x1d\x074\x1d t\x10\x10\x15©\x10``&°@A\2\xd3\x17\5-\x14;\7T8\x074\x1d8´H`\x10\b9\xe8¹`\xe8\xebPC£ÁT¡\x1bE\x0ex&\x027\v*N\x116\x1a`#À\x12\3¡\x1c\2t\x1d\b\x12 ¤'\vP\1Á\x0e¥K\x10\x1d\x1aª\x1d\4:X¶)@mHpjµ\x10\xe9rP\xd85Z¤\4:a\xe0\xf0A\xd0¨\1\xd0Z\xe1\7S\x0f\1\6\x1d\x1d\xea\x10t$±\4\1\xc3£!A\x0e :}X\6\x10u\xd0!\xd5\xce\x15A¿C\x0e¬7\6\1U\x0e£\0\x1d\0\x1e\2\x1de\f\x18:\vD\xf0\xe9Q \xebõ\0\xeb6¤\xc8!\xd7h\1\xd4\xf4À rµ\b\n\xdc \xea\x15P\xe8¥@C \xe5Z\b\x0eÁ\f4\b8\x0dA \bu)Pt#!\xe0\xc9D\x1e\x1dl¨\t\xdc\x12\b!\xd4cAÀ\xcbAT\"#\xf0ª¥\0Áh \x1d\x15*\x1d¦*\x1dXt\x15V£ª ´\x11\x0e\xd0\f:\x12M\x10\xe8aÁ\0\0U\x0e\f;U\x16\btz¬P:\x14:H\xf1¨\3X \xeaC\xd1*\0`mY@\xea\1\xadYP\xebr \xeb\xad*U3\xf1\x15\3\xe0@"];
    let c = [submenuExtTerminal, submenuRad, showTorch];

    function d() {
        bC.clear(1).setFontMonofonto23().setFontAlign(-1, 0);
        let e = 0,
            d = 220,
            c = 40;
        const f = ["EXT TERMINAL", "RAD METER", "FLASHLIGHT"];
        f.forEach((b, f) => {
            f == a ? (bC.setColor(2).fillRect(e, c - 21, d, c - 18).fillRect(d - 3, c - 17, d, c + 16).fillRect(e, c + 17, d, c + 20), bC.setBgColor(1).clearRect(e, c - 17, d - 4, c + 16), bC.setColor(3).fillRect(50, c - 5, 59, c + 4)) : (bC.setBgColor(0).clearRect(e, c - 21, d, c + 20), bC.setColor(2)), bC.drawString(b, 70, c), c += 50
        }), bC.setBgColor(0).setColor(3), b[a] && bC.drawImage(dc(b[a]), 310, 90, {
            rotate: 0
        }), bC.flip()
    }
    d();

    function e(b) {
        if (b) {
            let c = a;
            a = E.clip(a - b, 0, 2), a != c && Pip.knob1Click(b), d()
        } else c[a] && (Pip.audioStartVar(Pip.audioBuiltin("OK")), Pip.removeSubmenu(), c[a]())
    }
    let f = setInterval(function() {
        bC.flip()
    }, 50);
    Pip.on("knob1", e), Pip.removeSubmenu = function() {
        Pip.removeListener("knob1", e), clearInterval(f)
    }
};
let submenuExtTerminal = () => {
    E.setUSBHID({
        reportDescriptor: "\5\1\t\6¡\1u\1\b\5\7\x19\xe0)\xe7\x15\0%\1\2\1u\b\3\5u\1\5\b\x19\1)\5\2\1u\3\3\6u\b\x15\0%h\5\7\x19\0)h\0À"
    });
    var c = 0;

    function d() {
        c++, E.sendUSBHID([0, 0, 0, 0, 0, 0, 0, 0]) ? e() : (bC.clear().setFontAlign(0, -1).setColor(3), drawVaultTecLogo(199, 15, bC), bC.setFontMonofonto23().drawString("Connecting" + [".  ", ".. ", "..."][c % 3], 199, 115, !0), bC.setFontMonofonto16().drawString("Please reconnect USB", 199, 145, !0), bC.flip())
    }

    function e() {
        function f(b, a) {
            E.sendUSBHID([j, 0, b, 0, 0, 0, 0, 0]), setTimeout(function() {
                E.sendUSBHID([j, 0, 0, 0, 0, 0, 0, 0]), a && setTimeout(a, 5)
            }, 5), Pip.kickIdleTimer()
        }

        function n(a, d, b) {
            b = b || 20;
            var e = setInterval(function() {
                a.length ? (a[0] in c && f(c[a[0]]), a = a.substr(1)) : (clearInterval(e), d && d())
            }, b)
        }

        function o() {
            Pip.removeSubmenu(), delete Pip.removeSubmenu, bC.clear().setFontAlign(0, -1).setColor(3), drawVaultTecLogo(199, 15, bC), bC.setFontMonofonto23().drawString("Sending...", 199, 115, !0), bC.flip()
        }

        function g(a) {
            polys = [
                [200, 20, 220, 40, 210, 40, 210, 60, 190, 60, 190, 40, 180, 40],
                [200, 180, 220, 160, 210, 160, 210, 140, 190, 140, 190, 160, 180, 160],
                [100, 100, 120, 80, 120, 90, 140, 90, 140, 110, 120, 110, 120, 120],
                [300, 100, 280, 80, 280, 90, 260, 90, 260, 110, 280, 110, 280, 120]
            ], bC.setFontMonofonto23().setFontAlign(0, 0), h && clearTimeout(h), h = setTimeout(b => {
                polys.forEach((b, c) => {
                    bC.setColor(a == c ? 3 : 1).fillPoly(b)
                }), bC.setColor(0), bC.setBgColor(a == 4 ? 3 : 1).clearRect(165, 85, 235, 115).drawString("ENTER", 200, 101), bC.setBgColor(a == 5 ? 3 : 1).clearRect(275, 25, 345, 55).drawString("ESC", 310, 41), bC.setBgColor(a == 6 ? 3 : 1).clearRect(275, 145, 345, 175).drawString(d.labels[d.keyIndex], 310, 161), bC.setBgColor(0), h = null, bC.flip()
            }, a === null ? 100 : 0)
        }

        function e() {
            g(null)
        }

        function p() {
            E.showMenu({
                '': {
                    title: "Terminal Connected"
                },
                "Hello World": function() {
                    o(), n("HELLO WORLD", p)
                }
            })
        }

        function k(a) {
            a ? a < 0 ? (g(1), f(c.DOWN, e)) : (g(0), f(c.UP, e)) : (g(4), f(c.ENTER, e))
        }

        function l(a) {
            a < 0 ? (g(2), f(c.LEFT, e)) : (g(3), f(c.RIGHT, e))
        }

        function m() {
            g(5), f(c.ESC, e)
        }

        function i(a) {
            d.v = a, a ? (d.keyIndex = (d.keyIndex + a + d.keys.length) % d.keys.length, e()) : (g(6), f(d.keys[d.keyIndex], e))
        }
        Pip.HIDenabled = !0;
        var c = {
                A: 4,
                B: 5,
                C: 6,
                D: 7,
                E: 8,
                F: 9,
                G: 10,
                H: 11,
                I: 12,
                J: 13,
                K: 14,
                L: 15,
                M: 16,
                N: 17,
                O: 18,
                P: 19,
                Q: 20,
                R: 21,
                S: 22,
                T: 23,
                U: 24,
                V: 25,
                W: 26,
                X: 27,
                Y: 28,
                Z: 29,
                1: 30,
                2: 31,
                3: 32,
                4: 33,
                5: 34,
                6: 35,
                7: 36,
                8: 37,
                9: 38,
                0: 39,
                ENTER: 40,
                "\n": 40,
                ESC: 41,
                BACKSPACE: 42,
                "\t": 43,
                " ": 44,
                "-": 45,
                "=": 46,
                "[": 47,
                "]": 48,
                "\\": 49,
                NUMBER: 50,
                ";": 51,
                "'": 52,
                "~": 53,
                ",": 54,
                ".": 55,
                "/": 56,
                CAPS_LOCK: 57,
                F1: 58,
                F2: 59,
                F3: 60,
                F4: 61,
                F5: 62,
                F6: 63,
                F7: 64,
                F8: 65,
                F9: 66,
                F10: 67,
                F11: 68,
                F12: 69,
                PRINTSCREEN: 70,
                SCROLL_LOCK: 71,
                PAUSE: 72,
                INSERT: 73,
                HOME: 74,
                PAGE_UP: 75,
                DELETE: 76,
                END: 77,
                PAGE_DOWN: 78,
                RIGHT: 79,
                LEFT: 80,
                DOWN: 81,
                UP: 82,
                NUM_LOCK: 83,
                PAD_SLASH: 84,
                PAD_ASTERIX: 85,
                PAD_MINUS: 86,
                PAD_PLUS: 87,
                PAD_ENTER: 88,
                PAD_1: 89,
                PAD_2: 90,
                PAD_3: 91,
                PAD_4: 92,
                PAD_5: 93,
                PAD_6: 94,
                PAD_7: 95,
                PAD_8: 96,
                PAD_9: 97,
                PAD_0: 98,
                PAD_PERIOD: 99
            },
            j = 0;
        let h;
        let d = {
            v: null,
            keys: [c["\t"], c[" "], c.DELETE, c.BACKSPACE, c.HOME, c.END],
            labels: ["TAB", "SPACE", "DEL", "BACK", "HOME", "END"],
            keyIndex: 0
        };
        clearInterval(b), b = undefined, clearInterval(a), a = setInterval(() => {
            BTN_PLAY.read() ? d.v == null && i(0) : BTN_TUNEUP.read() ? d.v == null && i(1) : BTN_TUNEDOWN.read() ? d.v == null && i(-1) : d.v = null, bC.flip()
        }, 50), Pip["#onknob1_old"] = Pip["#onknob1"], delete Pip["#onknob1"], Pip["#onknob2_old"] = Pip["#onknob2"], delete Pip["#onknob2"], Pip["#ontorch_old"] = Pip["#ontorch"], delete Pip["#ontorch"], Pip.on("knob1", k), Pip.on("knob2", l), Pip.on("torch", m), Pip.removeSubmenu = function() {
            a && clearInterval(a), Pip.removeListener("knob1", k), Pip.removeListener("knob2", l), Pip.removeListener("torch", m), Pip["#onknob1"] = Pip["#onknob1_old"], delete Pip["#onknob1_old"], Pip["#onknob2"] = Pip["#onknob2_old"], delete Pip["#onknob2_old"], Pip["#ontorch"] = Pip["#ontorch_old"], delete Pip["#ontorch_old"], Pip.HIDenabled = !1
        }, bC.clear(), e()
    }
    var b = setInterval(d, 1e3),
        a = setInterval(() => bC.flip(), 50);
    Pip.removeSubmenu = function() {
        b && clearInterval(b), a && clearInterval(a)
    }, d()
};
let submenuApparel = () => {
    let b = "PROCEDURES!\n\nVault-Tec provides all clothing, bedding, and accommodations for residents.\n\nPersonal belongings must be reviewed and approved of by an authorized Vault-Tec hermetics technician before such belongings can be delivered to your reserved quarters within the Vault.\n\nAll Vault residents must attend an orientation seminar. If you did not attend such a seminar as part of the application process, you must make an appointment with your Vault-Tec representative.\n";
    bC.setFontMonofonto16().setFontAlign(-1, -1).setColor(3);
    let a = -223,
        c;

    function d(b) {
        a -= b * 10, a < -400 && (a = 200), a > 200 && (a = -400)
    }

    function e() {
        a !== c && (c = a, bC.clear(), a > -100 && drawVaultTecLogo(199, a + 15, bC), bC.drawString(b, 20, a + 120)), bC.flip()
    }
    Pip.typeText(b).then(() => {
        b = bC.wrapString(b, 350).join("\n"), Pip.drawInterval = setInterval(e, 50), Pip.on("knob1", d)
    }), Pip.removeSubmenu = function() {
        Pip.typeTimer && (clearInterval(Pip.typeTimer), delete Pip.typeTimer), Pip.drawInterval && (clearInterval(Pip.drawInterval), delete Pip.drawInterval, Pip.removeListener("knob1", d))
    }
};
let submenuStats = () => {
    const e = {
        x: 36,
        y: 41,
        repeat: !0
    };
    let a = require("fs").readdirSync("MISC").sort().filter(a => a.toUpperCase().endsWith("AVI") && !a.startsWith("."));
    if (!a.length) return;
    let b = Math.floor(a.length * Math.random() * .999);
    let c = !1;
    let d = setTimeout(function() {
        d = undefined, Pip.videoStart(`MISC/${a[b]}`, e)
    }, 200);

    function f(d) {
        if (d == 0 || c) return;
        c = !0, b = (b + a.length + d) % a.length, Pip.knob1Click(d), setTimeout(d => {
            g.clearRect(36, 41, 444, 288), Pip.videoStart(`MISC/${a[b]}`, e), c = !1
        }, 100)
    }
    Pip.on("knob1", f), Pip.removeSubmenu = function() {
        d && clearTimeout(d), Pip.videoStop(), Pip.removeListener("knob1", f)
    }
};
let submenuAbout = () => {
    let g = "\xcbY AD`:A\xd4r¬\0(6d\x1d $\x15ª%G\xd0\t\"\xea¨\2H`Z\xad!*)U\x1b\0$\x0d ´\x12¢µf²\2HaV\xadHy¸À\x14H\x0e\xd5 \4\t\x19\x12)\3\xf0\7\5j£\tT¶\4iuZB·\xe0\xe0\xad\xd7«¨\xc2\x10H¬\7øI\x0f5\xe8vIa\xc6\2\0\x11¥°Z¿{\xdc\0$¢\xc9`¸\4 µYX®i \x14\7¸$Y,\x0d\0\6\f\x13U¬@\xe1Y¥ZµU\xadu\x0e\fw %^\x0f\xf0\1\x19T*\x19¤ W\1\"\xe9`\xe08mV»QP\3\3\xd8\x121\0¿\xefmQÿbP$ÀIeÿ°k6ÿ\x0d¨\xdf\xe5,£\4p¾?ÿÿGU\2\3º\t\x19K\3\xdbÿù5Zª?ÿ\xc5\x125\0\xdf\xc5j\xadV¦\v¤\xd1\x1b\x7f`5¢P:\2Q± <¿ \x10\0X«'@J\xd5þ^¹\4\0\x16K\x13? \t\x19ø7\xf4a I@h\x7fBSSú\x17ö4\nQ¿\t\x1aþ!\x7fG\0:ªTn\x1f\xc8K\7\xc5I\x7f\2F \x1b\xdb\2X-&\x15/]4»\7¥K\2\7#¢ø\x12¿J¡\xe9`iRTüH\xdc\x0f\xc5¨K\3¥F²~\1+sùVÿ\xd1aµ3\xe2Sº¬\x17\xf2i¡\xd5h\xc9NO¥Z¨\xf46Qj\xd4¥\\\xd4B\xea\x0e\xdfmZ¬\v\3ª\xd5K\xe8\2F¡ümVA2£j´¿#P\x1f\xc6«S(\xcfN\0\xd3ú\2V§õ\xadU*\5úZµ\x17\xe3{~\x14 8\x0d\x17ÿ£ª\xc9\x1a\x7f\b\xe8&¿úX\x1a\x7f\xde\xd5)(\x14¢_ýj7\xcb¦@¥\1\xc5i7\xe9`Wm\xc2üU$ :¬\x12X\x1b\x12U£4\x1d\4\xd5ª¥ÿ\xf2\x17\xf1\x1b0X\x0f\xe3I\njµ\x12ÿþ?¡P\x12±©\xd6 XmV©,\x0f÷q+\x121\b´D¨\x16\x11 :¬?ÿ\xcd\x1d7\xd8Ài:\x10 :\xadIÀ\x1cT\n%_I©\xdaA±D ´ÿö.%_Q-¼À²\2@µT\x1fÿ\xefS\x1a\x12-\6M¨\x1a\x1c\x10,ÿ\xd9²h\4«G°=\tEþo\nÿÿ\xd0vU\xf4\x14¨Vý\6\x12\3/\xf3_ü\x10q\"\xf2$\xebEKÿArÿ\xc6[û$\t\x16@¢\x1e-d\x7fý@·ÿa\xd9xLBÀ%[\1ª¡`°\x12ÿþÿû\0¸\xf05T1\"\xd0l&\x15p\tAÿ@ :\n¬`%Za\2¤G \xc6ÿ 0o\x10*L$H´\v`\xdaGA\"Z p\x17@J¶z\t\x18 J¨\0\xad0*\xc5Bþ\b\f\0¢q\2`#ZX[k\0\xca^#\xec\0@\nC`=\nb\1\5µjª\x10\x18F\5ÿú%\x15 Y°\6\xe0b \x14\3¯ÿK+`B 7\b\x15\3Pp²Y\v$\x7füJV\x15\0À \x13K5¦\3\xedÀ%0\tÿÀJ¤½¤\f¢\1\6¡Ph\x10ªR5\0\xefWj\2º@4\x15d¸8h(`\b\1«\xc4\7\x0dÀB\"\x11¡#\vM\2\b\5\n¼$v\1[\xcaÁjDn\1\xea÷{ª \xf0\7\xe0\x0fÀ\x15@ÿÿ¤z\x17ÿ\xe8@ø\x1f\t\xe4\x1f\vÀm%ÿ@ 2\xea\4\v\xe9\2\xe8C\xe1\x7f\xd8\4|\x16\b \x1fz\x7fÿ\xc5\xd0|\x1b\xf0p3\xc8x\x1d\xec\3y\v¡\x7fþ\x10\b\x7fú\0\5\6_\2øoÿÀ¾\x12\xd0=\b\xf4\0\x15\0¤\x0f\3\xe8'\7¡\v\xe8m%°\xf28>\x0f¤¸2\x0f\xe2þ\x1d\n\x7f@\1¼O >\bY(\x1d¡\x19l~÷@7Á¯\5``ø>\5\xe2_\xdføm#\xf0=\xc4\v\xf1-\xf1\xf0\4¡ =\x1f\xc5\xd2;\xf0\1¦Á+\3\x10\x13÷û\xc2Àü.ü\t\x7f\v¡,\xda\x12Kø\xf4\x1e\\\3\x7fK%\3|%\2~\n\xf1-\xde\xcb _\xd9l\7¾\x1d\4,\3\xe7¬\xd8K.»\xe1(SX.<ø\x16\xc7¡-ù:A\xf0\x12ÿ¸\1\xe85\1\xf3\xe0x:\6\xd7J&@\xe0\n\x1d\x0du\xe5°\7À$ wÿ\xe8_\xf4\x0e\xde»\xf0N!t\xd2Q$\x10a\x7f\xe8\7CÁ-t\2 ¥Gü?\xd0z\x1f\3iÿ%\x13\0J\0\xc3\xe0]2\b!\x10R£\xdf\xe1ý\x0dö\xf2\x17Gú8\b%\5@~¾\x12\xd8ù(¨\x1f\xc3ù\x0fÿ\xf46\xf2P7hX2P\xd3\xf2\xd0D¢\xe7\xf0¾\7À\x10\x0d\f\f<\x0f\xe9.n\4J\b\xee\x19\x12P\xdb\xf1p0?\5\xf0^\b\xf0\x18ý\vÿ\xf0v\2³\4\n\t(K\xc4\x0f\xd0¾4¥\6\x0f\x1e\7\xf4ý\nÀ\xcb ý @\xd0\xe0\xf4\t\xe4¶\7\xd0(\2";
    let c = E.getTemperature();
    let d = () => {
        let b = process.memory();
        let d = Pip.measurePin(VUSB_MEAS);
        let e = Pip.measurePin(VBAT_MEAS);
        let f = CHARGE_STAT.read() == 0;
        c = c * .99 + E.getTemperature() * .01;
        let a = "============ Pip-Boy 3000 Mark V ===========\n\nPip-OS " + process.env.VERSION + " - " + VERSION + "\nSerial number: " + Pip.getID() + "\n\n";
        return settings.userName && (a += "Pip-Boy assigned to " + settings.userName + "\n\n"), a += `Battery: ${e.toFixed(1)}V`, d > 1 ? (a += `, USB: ${d.toFixed(1)}V`, f ? a += " (charging)\n" : e > 4 ? a += " (charged)\n" : a += " (not charging)\n") : a += " (not charging)\n", a += "Memory used: " + b.usage + "/" + b.total + " blocks\nCore temperature: " + c.toFixed(1) + " C\n\n", a += "Built for Vault-Tec by The Wand Company\n", a
    };
    bC.setFontMonofonto16().setFontAlign(-1, -1).setColor(3);
    let e = d().split("\n").length * bC.getFontHeight();
    let a = 90 - e,
        b = -200 - e;

    function f(c) {
        a -= c * 10, a < b && (a = 190), a > 190 && (a = b)
    }

    function h() {
        bC.clear(), a > -100 ? drawVaultTecLogo(199, a + 15, bC) : a < 310 + b && bC.drawImage(dc(g), 125, a - 90 - b), bC.drawString(d(), 20, a + 120), bC.flip()
    }
    Pip.typeText(d()).then(() => {
        Pip.drawInterval = setInterval(h, 50), Pip.on("knob1", f);
        let a = 0;
        scrollInterval = setInterval(function() {
            f(1), ++a > 8 && clearInterval(scrollInterval)
        }, 100)
    }), Pip.removeSubmenu = function() {
        Pip.typeTimer && (clearInterval(Pip.typeTimer), delete Pip.typeTimer), Pip.drawInterval && (clearInterval(Pip.drawInterval), delete Pip.drawInterval, Pip.removeListener("knob1", f))
    }
};
let getUserVideos = () => {
    var a = [];
    try {
        a = require("fs").readdirSync("USER").filter(a => a.toUpperCase().endsWith("AVI") && !a.startsWith("."))
    } catch (a) {}
    return a
};
let submenuVideos = () => {
    var b = getUserVideos();

    function c(b) {
        function a(a) {
            a || submenuVideos()
        }
        Pip.removeSubmenu(), Pip.videoStart("USER/" + b), Pip.on("knob1", a), Pip.removeSubmenu = function() {
            g.clear(), bH.flip(), drawFooter(), Pip.removeListener("knob1", a), Pip.videoStop()
        }
    }
    var a = {};
    b.length ? (b.forEach(b => {
        a[b.slice(0, -4)] = function() {
            c(b)
        }
    }), a["< Back"] = submenuMaintenance, E.showMenu(a)) : (Pip.removeSubmenu && Pip.removeSubmenu(), delete Pip.removeSubmenu, submenuBlank("NO VIDEOS\nADD TO 'USER' DIR")())
};
let getUserAudio = () => {
    var a = [];
    try {
        a = require("fs").readdirSync("USER").filter(a => a.toUpperCase().endsWith("WAV") && !a.startsWith("."))
    } catch (a) {}
    return a
};
let submenuAudio = () => {
    var b = getUserAudio(),
        a = {};
    b.length ? (b.forEach(b => {
        a[b.slice(0, -4)] = function() {
            Pip.audioStart("USER/" + b)
        }
    }), a["< Back"] = submenuMaintenance, E.showMenu(a)) : (Pip.removeSubmenu && Pip.removeSubmenu(), delete Pip.removeSubmenu, submenuBlank("NO AUDIO FILES\nADD TO 'USER' DIR")())
};
let getUserApps = () => {
    var a = [];
    try {
        a = require("fs").readdirSync("USER").filter(a => a.toUpperCase().endsWith("JS") && !a.startsWith("."))
    } catch (a) {}
    return a
};
let submenuApps = () => {
    var files = getUserApps();

    function startApp(app) {
        Pip.removeSubmenu && Pip.removeSubmenu(), delete Pip.removeSubmenu, Pip.remove && Pip.remove(), delete Pip.remove, g.clear(BGRECT), g.reset().setFontMonofonto28().setFontAlign(0, 0), g.drawString("Loading\n" + app, BGRECT.x + BGRECT.w / 2, BGRECT.y + BGRECT.h / 2), eval(require("fs").readFile("USER/" + app))
    }
    var menu = {};
    if (files.length) {
        var nameMap = {};
        try {
            require("fs").readdirSync("APPINFO").forEach(b => {
                var a = JSON.parse(require("fs").readFile("APPINFO/" + b));
                nameMap[a.id] = a.name
            })
        } catch (a) {}
        files.forEach(b => {
            var a = b.slice(0, -3);
            a in nameMap && (a = nameMap[a]), menu[a] = function() {
                startApp(b)
            }
        }), E.showMenu(menu)
    } else Pip.removeSubmenu && Pip.removeSubmenu(), delete Pip.removeSubmenu, submenuBlank("NO JS FILES\nADD TO 'USER' DIR")()
};
let submenuSetAlarm = () => {
    var a, b = {
        "Set alarm time": function() {
            Pip.removeSubmenu(), submenuSetAlarmTime()
        },
        "Alarm sound": {
            value: settings.alarm.soundIndex,
            min: 0,
            max: settings.alarm.soundFiles.length,
            step: 1,
            format: a => a >= settings.alarm.soundFiles.length ? "FM " + rd.freq.toFixed(1) : settings.alarm.soundFiles[a].slice(0, -4),
            onchange: b => {
                settings.alarm.soundIndex = b, b < settings.alarm.soundFiles.length ? Pip.audioStart("ALARM/" + settings.alarm.soundFiles[b]) : Pip.videoStop(), a && clearTimeout(a), a = setTimeout(function() {
                    saveSettings()
                }, 5e3)
            }
        },
        "Alarm on/off": {
            value: settings.alarm.enabled,
            format: a => a ? "On" : "Off",
            onchange: a => {
                settings.alarm.enabled = a, saveSettings(), configureAlarm(), drawFooter()
            }
        },
        "Repeat alarm each day?": {
            value: settings.alarm.repeat,
            format: a => a ? "Yes" : "No",
            onchange: a => {
                settings.alarm.repeat = a, saveSettings(), console.log("Alarm repeats:", settings.alarm.repeat ? "Yes" : "No")
            }
        },
        "< Back": submenuMaintenance
    };
    E.showMenu(b)
};
let submenuMaintenance = () => {
    var a, b = {
        "Set date & time": function() {
            Pip.removeSubmenu(), submenuSetDateTime()
        },
        "Timezone (offset from UTC)": {
            value: settings.timezone || 0,
            min: -12,
            max: 14,
            step: 1,
            format: a => (a > 0 ? "+" + a : a) + (a == 1 || a == -1 ? " hr" : " hrs"),
            onchange: (b, c) => {
                settings.timezone = b, E.setTimeZone(b), settings.alarm.time && (settings.alarm.time -= c * 36e5), drawFooter(), a && clearTimeout(a), a = setTimeout(function() {
                    saveSettings()
                }, 5e3)
            }
        },
        "12/24 hour display": {
            value: !!settings.clock12hr,
            format: a => a ? "12 hr" : "24 hr",
            onchange: a => {
                settings.clock12hr = a, drawFooter(), saveSettings(), console.log("12/24 hour display set to", settings.clock12hr ? "12 hr" : "24 hr")
            }
        },
        "Set alarm": function() {
            Pip.removeSubmenu(), submenuSetAlarm()
        },
        "Display timeout": {
            value: settings.idleTimeout ? Math.round(settings.idleTimeout / 6e4) : 31,
            min: 1,
            max: 31,
            step: 1,
            format: a => a < 31 ? a + " min" : "Never",
            onchange: b => {
                settings.idleTimeout = b < 31 ? b * 6e4 : 0, a && clearTimeout(a), a = setTimeout(function() {
                    saveSettings()
                }, 5e3)
            }
        },
        "Display brightness": {
            value: Pip.brightness,
            min: 1,
            max: 20,
            step: 1,
            onchange: a => {
                Pip.brightness = a, Pip.updateBrightness()
            }
        },
        "Demo mode": enterDemoMode,
        About: function() {
            Pip.removeSubmenu(), submenuAbout()
        },
        Reboot: function() {
            clearWatch(), clearInterval(), E.showMessage("Rebooting..."), setTimeout(E.reboot, 2e3)
        }
    };
    getUserVideos().length && (b["Play videos"] = submenuVideos), getUserAudio().length && (b["Play audio files"] = submenuAudio), E.showMenu(b)
};
let drawHeader = b => {
    let a = 50;
    bH.clear(1).setFontMonofonto18().setFontAlign(-1, -1), bH.drawImage(dc(icons.cog), 1, 1), modes.forEach((c, d) => {
        b == d + 1 && bH.drawPoly([0, 28, a - 10, 28, a - 10, 14, a - 5, 14]), bH.drawString(c, a, 7), a += c.length * 9, b == d + 1 && bH.drawPoly([a + 5, 14, a + 10, 14, a + 10, 28, 369, 28]), a += 24
    }), bH.drawImage(dc(icons.holotape), 345, 1);
    let c = MODEINFO[b];
    c.submenu && (a = 50, Object.keys(c.submenu).forEach((b, c) => {
        bH.setColor(15 / (1 + Math.abs(c - sm0))).drawString(b, a, 34), a += bH.stringWidth(b) + 10
    })), bH.flip()
};
let drawFooter = () => {
    let a = Date();
    let g = (a.getMonth() + 1).twoDigit();
    let h = a.getDate().twoDigit();
    let e = a.getHours();
    let i = settings.clock12hr ? ((e + 11) % 12 + 1).toString().padStart(2, " ") : e.twoDigit();
    let j = a.getMinutes().twoDigit();
    let k = a.getFullYear() + "-" + g + "-" + h + " " + i + ":" + j;
    bF.clear(1).setBgColor(1).setColor(3), bF.clearRect(0, 0, 148, 24).clearRect(152, 0, 238, 24).clearRect(242, 0, 371, 24), bF.setFontMonofonto16().setFontAlign(-1, -1).drawString(k, 10, 4), bF.drawRect(162, 5, 212, 19).fillRect(212, 9, 215, 15);
    let c = Pip.measurePin(VBAT_MEAS);
    let d = 3.5,
        f = 4.1;
    VUSB_PRESENT.read() ? (bF.drawImage(dc(icons.charging), 223, 4), CHARGE_STAT.read() == 0 && (d = 3.6, f = 4.2)) : c < 3.5 && (bF.drawString("!", 224, 4), c < 3.3 && Pip.sleeping === !1 && Pip.offOrSleep({
        immediate: !1,
        forceOff: !0
    }));
    let b = (c - d) / (f - d) * 48;
    if (b < 1 && (b = 1), b > 48 && (b = 48), bF.setColor(2).fillRect(163, 6, 163 + b, 18).setColor(3), Pip.demoMode) bF.drawString("DEMO MODE", 252, 4);
    else if (settings.alarm.time) {
        let a = new Date(settings.alarm.time);
        bF.setColor(settings.alarm.enabled ? 3 : 2), bF.drawString(a.getHours().twoDigit() + ":" + a.getMinutes().twoDigit(), 252, 4), bF.drawImage(dc(settings.alarm.enabled ? icons.alarm : icons.noAlarm), 300, 3)
    }
    bF.flip(), rd.isOn() && !Pip.audioIsPlaying() && Pip.audioStartVar(new Uint8Array(64).fill(0))
};
let mPrev = null;
let checkMode = () => {
    let b = MODE_SELECTOR.analog();
    let a = 1;
    if (b > .9 ? (pinMode(MEAS_ENB, "input"), pinMode(MEAS_ENB, "output"), MEAS_ENB.write(0), a = settings.fallbackMode) : b > .7 ? a = 5 : b > .5 ? a = 4 : b > .3 ? a = 3 : b > .1 && (a = 2), Pip.demoMode && (a = mPrev = Pip.demoMode), a == mPrev && a != Pip.mode) {
        Pip.kickIdleTimer(), sm0 = 0, Pip.removeSubmenu && Pip.removeSubmenu(), delete Pip.removeSubmenu, g.setBgColor(0).clearRect(BGRECT);
        let b = MODEINFO[a];
        if (b && b.submenu) {
            let a = Object.keys(b.submenu);
            b.submenu[a[sm0]]()
        } else b && b.fn && b.fn();
        Pip.mode == null ? drawFooter() : Pip.audioStart("UI/ROT_H_1.wav"), drawHeader(a), Pip.mode = a
    }
    mPrev = a;
    let c = Date();
    c.getMinutes() != d0 && (drawFooter(), d0 = c.getMinutes()), BTN_PLAY.read() && !Pip.HIDenabled ? (Pip.btnPlayPrev || (Pip.kickIdleTimer(), Pip.mode == MODE.RADIO ? radioPlayClip() : KNOB1_BTN.read() || rd.enable(!Pip.radioOn)), Pip.btnPlayPrev = !0) : Pip.btnPlayPrev = !1, BTN_TUNEUP.read() ? (!Pip.btnUpPrev && Pip.radioOn && (Pip.kickIdleTimer(), Pip.mode == MODE.RADIO && Pip.audioStart("RADIO/TUNING.wav"), rd.seek(1)), Pip.btnUpPrev = !0) : Pip.btnUpPrev = !1, BTN_TUNEDOWN.read() ? (!Pip.btnDownPrev && Pip.radioOn && (Pip.kickIdleTimer(), Pip.mode == MODE.RADIO && Pip.audioStart("RADIO/TUNING.wav"), rd.seek(0)), Pip.btnDownPrev = !0) : Pip.btnDownPrev = !1
};
let createDateTimeSubmenu = (a, d, h, i) => {
    Pip["#onknob2_old"] = Pip["#onknob2"], delete Pip["#onknob2"], a.setSeconds(0);
    let b = d ? 0 : 3;
    let f = () => {
        let b = a.getHours().twoDigit();
        let c = a.getMinutes().twoDigit();
        bC.reset().setFontMonofonto28().setFontAlign(-1, -1), d ? (bC.drawString(a.getFullYear(), 77, 83, !0), bC.drawString("-", 136, 83), bC.drawString((a.getMonth() + 1).twoDigit(), 153, 83, !0), bC.drawString("-", 184, 83), bC.drawString(a.getDate().twoDigit(), 201, 83, !0), bC.drawString(b, 249, 83, !0), bC.drawString(":", 280, 83), bC.drawString(c, 297, 83, !0)) : (bC.drawString(b, 162, 83, !0), bC.drawString(":", 193, 83), bC.drawString(c, 210, 83, !0))
    };
    let e = (f, g, h, i, a) => {
        a == null && (a = 1);
        let b = f,
            c = f + h,
            d = g,
            e = g + i;
        while (a--) bC.drawRect(b, d, c, e), b++, c--, d++, e--
    };
    let c = c => {
        c == null && (c = 3);
        let f;
        d ? f = [
            [73, 76, 64, 42, 2],
            [149, 76, 36, 42, 2],
            [197, 76, 36, 42, 2],
            [245, 76, 36, 42, 2],
            [293, 76, 36, 42, 2],
            [150, 145, 100, 33, 1]
        ] : f = [
            [],
            [],
            [],
            [158, 76, 36, 42, 2],
            [206, 76, 36, 42, 2],
            [150, 145, 100, 33, 1]
        ], bC.setColor(c);
        let a = f[b];
        b == 5 && (bC.setBgColor(1).clearRect(a[0], a[1], a[0] + a[2], a[1] + a[3]), bC.setFontMonofonto23().setFontAlign(0, -1), bC.drawString("SET", 200, 150).setBgColor(0)), e(a[0], a[1], a[2], a[3], a[4])
    };
    Pip.removeSubmenu = () => {
        clearInterval(g), Pip.removeAllListeners("knob1"), Pip.removeAllListeners("knob2"), Pip["#onknob2"] = Pip["#onknob2_old"], delete Pip["#onknob2_old"]
    }, Pip.on("knob1", d => {
        if (d) {
            switch (b) {
                case 0:
                    a.setFullYear(a.getFullYear() + d);
                    break;
                case 1:
                    a.setMonth(a.getMonth() + d);
                    break;
                case 2:
                    a.setDate(a.getDate() + d);
                    break;
                case 3:
                    a.setHours(a.getHours() + d);
                    break;
                case 4:
                    a.setMinutes(a.getMinutes() + d);
                    break
            }
            f()
        } else b >= 5 ? (Pip.audioStartVar(Pip.audioBuiltin("OK")), setTimeout(i, 700, a)) : (Pip.audioStartVar(Pip.audioBuiltin("NEXT")), c(0), b++, c());
        bC.flip()
    }), Pip.on("knob2", a => {
        Pip.audioStartVar(Pip.audioBuiltin("COLUMN")), c(b == 5 ? .3 : 0), d ? b = (b + a + 6) % 6 : b = (b + a + 3) % 3 + 3, c(), bC.flip()
    }), bC.clear().setFontMonofonto28().setColor(2).setFontAlign(0, -1), bC.drawString(h, 200, 23), bC.setFontMonofonto23().setColor(1), bC.drawString("SET", 200, 150), bC.drawRect(150, 145, 250, 178), d ? e(48, 69, 306, 56, 3) : e(124, 69, 152, 56, 3), drawHeader(3), drawFooter(), f(), c(), bC.flip();
    let g = setInterval(function() {
        bC.flip()
    }, 50)
};
let submenuSetDateTime = () => createDateTimeSubmenu(new Date, !0, "SET DATE & TIME", a => {
    console.log("Date/time set to", a), setTime(a.getTime() / 1e3), showMainMenu()
});
let submenuSetAlarmTime = () => {
    var a = new Date;
    let b = 7,
        c = 0;
    if (settings.alarm.time) {
        var d = new Date(settings.alarm.time);
        b = d.getHours(), c = d.getMinutes()
    }
    return a.setHours(b), a.setMinutes(c), a.setSeconds(0), createDateTimeSubmenu(a, !1, "SET ALARM", a => {
        settings.alarm.time = a.getTime(), settings.alarm.enabled = !0, drawFooter(), saveSettings(), configureAlarm(), submenuSetAlarm()
    })
};
E.showMenu = function(g) {
    function i(a) {
        a ? c.move(-a) : c.select()
    }
    var b = bC;
    b.clear(1);
    var a = g[''],
        d = Object.keys(g);
    a && (d.splice(d.indexOf(''), 1), a.back && (g["< Back"] = a.back, d.unshift("< Back"))), a instanceof Object || (a = {}), a.selected === undefined && (a.selected = 0), a.rowHeight = 27;
    var h = 10,
        f = a.x2 || b.getWidth() - 20,
        e = 12,
        j = b.getHeight() - 1;
    a.title && (e += a.rowHeight + 2);
    var c = {
        draw: function() {
            b.reset().setFontMonofonto18(), a.predraw && a.predraw(b), b.setFontAlign(0, -1), a.title && (b.drawString(a.title, (h + f) / 2, e - a.rowHeight), b.drawLine(h, e - 2, f, e - 2));
            var o = 0 | Math.min((j - e) / a.rowHeight, d.length),
                k = E.clip(a.selected - (o >> 1), 0, d.length - o),
                i = e,
                s = k > 0;
            b.setColor(k > 0 ? 3 : 0).fillPoly([190, 10, 210, 10, 200, 0]);
            while (o--) {
                var q = d[k],
                    l = g[q],
                    r = k == a.selected && !c.selectEdit;
                if (b.setBgColor(r ? 3 : 0).clearRect(h, i, f, i + a.rowHeight - 1), b.setColor(r ? 0 : 3).setFontAlign(-1, -1).drawString(q, h + 20, i + 4), "o" == (typeof l)[0]) {
                    var m = f,
                        n = l.value;
                    if (l.format && (n = l.format(n)), c.selectEdit && k == a.selected) {
                        var p = a.rowHeight > 10 ? 2 : 1;
                        m -= 12 * p + 1, b.setBgColor(3).clearRect(m - (b.stringWidth(n) + 4), i, f, i + a.rowHeight - 1), b.setColor(0).drawImage({
                            width: 12,
                            height: 5,
                            buffer: " \7\0ù\xf0\x0e\0@",
                            transparent: 0
                        }, m, i + (a.rowHeight - 5 * p) / 2, {
                            scale: p
                        })
                    }
                    b.setFontAlign(1, -1).drawString(n.toString(), m - 2, i + 4)
                }
                i += a.rowHeight, k++
            }
            b.setColor(k < d.length ? 3 : 0).fillPoly([191, 201, 210, 201, 200, 210]), b.setColor(3).setBgColor(0).setFontAlign(-1, -1).flip()
        },
        select: function() {
            var b = g[d[a.selected]];
            Pip.audioStartVar(Pip.audioBuiltin("OK")), "f" == (typeof b)[0] ? b(c) : "o" == (typeof b)[0] && ("n" == (typeof b.value)[0] ? c.selectEdit = c.selectEdit ? undefined : b : ("b" == (typeof b.value)[0] && (b.value = !b.value), b.onchange && b.onchange(b.value)), c.draw())
        },
        move: function(e) {
            if (c.selectEdit) {
                var b = c.selectEdit;
                let a = b.value;
                b.value -= (e || 1) * (b.step || 1), b.min !== undefined && b.value < b.min && (b.value = b.wrap ? b.max : b.min), b.max !== undefined && b.value > b.max && (b.value = b.wrap ? b.min : b.max), b.onchange && b.value != a && b.onchange(b.value, -e)
            } else {
                let b = a.selected;
                a.wrapSelection ? a.selected = (e + a.selected + d.length) % d.length : a.selected = E.clip(a.selected + e, 0, d.length - 1), b != a.selected && !Pip.radioKPSS && Pip.knob1Click(e)
            }
            c.draw()
        }
    };
    return Pip.removeSubmenu && Pip.removeSubmenu(), c.draw(), Pip.on("knob1", i), Pip.removeSubmenu = () => {
        Pip.removeListener("knob1", i)
    }, c
}, E.showPrompt = function(e, a) {
    function c() {
        g.setColor(a.color);
        var f = g.getWidth(),
            n = g.getHeight(),
            k = a.title;
        k && g.setFontMonofonto23().setFontAlign(0, -1, 0).setBgColor(a.color).drawString(k, f / 2, 42).setBgColor(0), g.setFontMonofonto18().setFontAlign(0, 0, 0);
        var i = e.split("\n"),
            l = 125 - i.length * 20 / 2;
        a.clearBg && g.clearRect((f - i[0].length * 8) / 2 - 20, l - 20, (f + i[0].length * 8) / 2 + 20, 175 + b.length * 20), i.forEach((a, b) => g.drawString(a, f / 2, l + b * 20));
        var h, c, j, m;
        h = f / 2, c = 175 - (b.length - 1) * 20, b.forEach((b, e) => {
            b = b, j = 50, m = [h - j - 4, c - 13, h + j + 4, c - 13, h + j + 4, c + 13, h - j - 4, c + 13], g.setColor(e == a.selected ? d : 0).fillPoly(m).setColor(a.color).drawPoly(m, 1).setFontMonofonto18().drawString(b, h, c + 1), c += 36
        }), g.setFontAlign(-1, -1)
    }
    var d = g.blendColor(g.theme.bg, g.theme.fg, .5);
    a || (a = {}), a.buttons || (a.buttons = {
        Yes: !0,
        No: !1
    });
    var b = Object.keys(a.buttons);
    return a.selected || (a.selected = 0), a.color === undefined && (a.color = g.theme.fg), a.clearBg || (a.clearBg = !0), c(), new Promise(f => {
        let d = !0;

        function e(g) {
            g ? d ? (a.selected -= g, a.selected < 0 && (a.selected = 0), a.selected >= b.length && (a.selected = b.length - 1), c(), d = !1) : d = !0 : (Pip.removeListener("knob1", e), f(a.buttons[b[a.selected]]))
        }
        Pip.on("knob1", e), Pip.removeSubmenu = () => {
            Pip.removeListener("knob1", e)
        }
    })
}, E.showMessage = function(a) {
    g.clear(1), bC.clear(1).setColor(3).setFontMonofonto23().setFontAlign(0, 0), drawVaultTecLogo(200, 30, bC), bC.drawString(a, 200, 150).flip()
}, MODEINFO = [0, {
    name: "STAT",
    submenu: {
        STATUS: submenuStatus,
        CONNECT: submenuConnect,
        DIAGNOSTICS: submenuDiagnostics
    }
}, {
    name: "INV",
    submenu: {
        ATTACHMENTS: submenuInvAttach,
        APPAREL: submenuApparel,
        APPS: submenuApps,
        AID: showVaultAssignment
    }
}, {
    name: "DATA",
    submenu: {
        CLOCK: submenuClock,
        STATS: submenuStats,
        MAINTENANCE: submenuMaintenance
    }
}, {
    name: "MAP",
    fn: submenuMap
}, {
    name: "RADIO",
    fn: submenuRadio
}], getUserApps().length || delete MODEINFO[2].submenu.APPS, Pip.setPalette && settings.palette && Pip.setPalette(settings.palette.split(",").map(a => new Uint16Array(E.toArrayBuffer(atob(a))))), checkBatteryAndSleep() || (KNOB1_BTN.read() && BTN_POWER.read() ? (log("Entering factory test mode"), factoryTestMode()) : Pip.isSDCardInserted() ? (Pip.addWatches(), KNOB1_BTN.read() ? (log("Booting into demo mode"), enterDemoMode()) : settings.longPressToWake ? (log("Playing boot animation"), settings.longPressToWake = !1, saveSettings(), playBootAnimation()) : (Pip.sleeping = "BUSY", Pip.fadeOn(), require("fs").statSync("BOOT") ? (log("Normal boot - showing main menu"), setTimeout(a => {
    Pip.fadeOff().then(a => {
        Pip.audioStart("BOOT/BOOT_DONE.wav"), Pip.sleeping = !1, showMainMenu(), Pip.fadeOn()
    })
}, 2e3)) : (log("*** NO BOOT DIRECTORY ***"), g.drawString("NO BOOT DIRECTORY", 240, 174, 1), Pip.sleeping = !1))) : (Pip.fadeOn(), setWatch(Pip.off, BTN_POWER, {
    edge: "falling"
})))
