// Espruino REPL session over a Web Serial port (or any object with the same shape).
// No DOM access: the UI subscribes through the `events` callbacks.
import {
  buildCommand,
  cleanText,
  extractFrames,
  detectDeviceError,
  describeType,
  frameMatches,
  validateValue,
  randomToken,
  previewExpression,
  escapeControl,
  expr,
  KICK_IDLE,
} from './protocol.js';

export const SERIAL_OPTIONS = Object.freeze({ baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
// The Espruino Web IDE's "slow write" (19-byte blocks, 50 ms apart) exists for Bluetooth LE.
// Over USB CDC the device NAKs when it's busy, and the Pip-Boy accepted 241-byte single
// writes in the 10:51 logs, so USB defaults write at full speed. Pass these for a slow link.
export const IDE_WRITE_CHUNK = 19;
export const IDE_WRITE_PAUSE_MS = 50;
export const USB_WRITE_CHUNK = 512;
/** Logged on connect, so the activity log shows which dashboard code ran (bump on changes). */
export const CLIENT_VERSION = '2026-11-11.7';
/** Sent after every command so the device releases the previous command's reply. */
export const RELEASE_LINE = '\x10print("")\n';
/** The Pip-Boy sends one packet of this many bytes (or fewer) per line it runs. */
export const DEVICE_PACKET_BYTES = 63;
const MAX_RELEASE_BURST = 40;
const RAW_LIMIT = 120_000;
const RX_LIMIT = 64_000;

export const OUTCOME_NEXT = Object.freeze({
  verified: 'continue',
  disconnected: 'reconnect',
  unavailable: 'check prerequisites',
  'uncertain-write': 'stop and inspect',
  timeout: 'stop and inspect',
  cancelled: 'wait or retry manually',
  'low-memory-safe-mode': 'reconnect before retry',
  failed: 'stop or ask for confirmation',
});

const pause = (ms) => new Promise((r) => setTimeout(r, ms));

export class SerialSession {
  constructor({
    events = {},
    promptDelayMs = 350,
    writeChunk = USB_WRITE_CHUNK,
    writePauseMs = 0,
    flushDelayMs = 20,
    releaseIntervalMs = 100,
    probeOnConnect = true,
    keepAwake = true,
    keepAwakeMs = 30_000,
    resetDelayMs = 1500, // reset() prints a banner and re-initialises the libraries
  } = {}) {
    this.resetDelayMs = resetDelayMs;
    this.keepAwake = keepAwake;
    this.keepAwakeMs = keepAwakeMs;
    this.lastKick = 0;
    this.keepAliveTimer = null;
    this.pipState = null;
    this.releaseIntervalMs = releaseIntervalMs;
    this.events = events;
    this.promptDelayMs = promptDelayMs;
    this.writeChunk = writeChunk;
    this.writePauseMs = writePauseMs;
    this.flushDelayMs = flushDelayMs;
    this.recentTimeouts = new Map(); // requestId -> { id, kind, started }
    this.wakeMode = 'release'; // or 'timer' once probeWake() proves device timers release output
    this.ignoredRequestIds = new Set(); // our own replies we deliberately abandoned (probe)
    this.probeOnConnect = probeOnConnect;
    this.port = null;
    this.reader = null;
    this.writer = null;
    this.portInfo = null;
    this.sessionId = 0;
    this.generation = 0;
    this.sequence = 0;
    this.operationId = 0;
    this.connected = false; // board verified
    this.board = null;
    this.sdAvailable = false;
    this.memoryLimited = false;
    this.deviceError = '';
    this.busy = false;
    this.opening = false;
    this.pending = null;
    this.cancelRequested = false;
    this.disconnectReason = 'none';
    this.raw = '';
    this.rx = '';
    this.outsideTail = '';
    this.queue = Promise.resolve();
    this.writeQueue = Promise.resolve();
    this.closing = null;
    this.stats = { bytesIn: 0, bytesOut: 0, staleFrames: 0 };
    this.lastOutcome = 'unavailable';
    this.lastError = null;
    this.lastUncertain = false;
    this.activeOperation = null;
    this.history = [];
    this.encoder = new TextEncoder();
  }

  // ------------------------------------------------------------ events
  #log(level, message) {
    this.events.log?.(level, message);
  }
  #changed() {
    this.events.state?.(this.status());
  }

  get portOpen() {
    return !!(this.reader && this.writer);
  }

  status() {
    return {
      transport: 'USB CDC / Web Serial',
      portOpen: this.portOpen,
      portInfo: this.portInfo,
      sessionId: this.port ? this.sessionId : null,
      board: this.connected ? this.board : null,
      replStatus: this.connected ? 'verified' : this.port ? 'unverified' : 'disconnected',
      sdStatus: this.sdAvailable ? 'verified' : this.memoryLimited ? 'unavailable' : 'unverified',
      queueStatus: this.pending || this.busy ? 'busy' : 'idle',
      activeOperation: this.activeOperation,
      transaction: this.pending ? { id: this.pending.id, kind: this.pending.kind, requestId: this.pending.requestId } : null,
      lowMemorySafeMode: this.memoryLimited,
      transferMode: this.wakeMode,
      pipSleeping: this.pipState?.sleeping ?? null,
      deviceError: this.deviceError || null,
      lastOutcome: this.lastOutcome,
      lastError: this.lastError,
      uncertainWrite: this.lastUncertain,
      staleFrameCount: this.stats.staleFrames,
      bytesIn: this.stats.bytesIn,
      bytesOut: this.stats.bytesOut,
      disconnectReason: this.disconnectReason,
      timestamp: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------- connection
  /** Open `port`, start the reader, and verify the board. Throws if verification fails (port stays open). */
  async open(port) {
    if (this.opening) throw new Error('Already connecting');
    if (this.port && this.port !== port) throw new Error('Disconnect the active session before switching ports');
    this.opening = true;
    this.#changed();
    try {
      if (this.port === port && this.portOpen) await this.#releasePort({ closePort: true });
      await port.open(SERIAL_OPTIONS);
      this.generation++;
      this.sessionId++;
      this.sequence = 0;
      this.queue = Promise.resolve();
      this.writeQueue = Promise.resolve();
      this.cancelRequested = false;
      this.memoryLimited = false;
      this.deviceError = '';
      this.sdAvailable = false;
      this.connected = false;
      this.board = null;
      this.rx = '';
      this.outsideTail = '';
      this.disconnectReason = 'none';
      this.stats = { bytesIn: 0, bytesOut: 0, staleFrames: 0 };
      this.lastStaleRaw = null;
      this.wakeMode = 'release';
      this.raw = '';
      this.port = port;
      try {
        this.portInfo = port.getInfo?.() ?? null;
      } catch {
        this.portInfo = null;
      }
      // Some USB CDC stacks only transmit once the host asserts DTR. Browsers usually do this
      // on open, but be explicit; failure here is not fatal.
      let signals = 'not supported';
      if (typeof port.setSignals === 'function') {
        try {
          await port.setSignals({ dataTerminalReady: true });
          signals = 'DTR asserted';
        } catch (e) {
          signals = `setSignals failed: ${e.message}`;
        }
      }
      this.reader = port.readable.getReader();
      this.writer = port.writable.getWriter();
      void this.#readLoop(this.reader, this.generation);
      this.#log('info', `Session ${this.sessionId} · dashboard ${CLIENT_VERSION} · port opened · ${this.portInfo ? JSON.stringify(this.portInfo) : 'no port info'} · ${signals}`);
      this.#changed();
      await this.send('\n'); // wake the prompt; no Ctrl-C is sent automatically
      await pause(this.promptDelayMs);
      this.#log(
        'info',
        this.stats.bytesIn
          ? `Wake: device answered with ${this.stats.bytesIn} byte(s): "${escapeControl(this.raw.slice(-120))}"`
          : `Wake: no bytes from the device ${this.promptDelayMs} ms after a newline`,
      );
      const board = await this.verifyBoard();
      await this.readPipState();
      if (this.probeOnConnect) await this.probeWake();
      this.#startKeepAlive();
      return board;
    } finally {
      this.opening = false;
      this.#changed();
    }
  }

  async #releasePort({ closePort }) {
    this.generation++;
    const { reader, writer, port } = this;
    this.reader = null;
    this.writer = null;
    try {
      await reader?.cancel();
    } catch {}
    try {
      reader?.releaseLock();
    } catch {}
    try {
      writer?.releaseLock();
    } catch {}
    if (closePort) {
      try {
        await port?.close();
      } catch {}
    }
  }

  /** While connected and idle, reset the Pip-Boy's idle timer so it doesn't fall asleep. */
  #startKeepAlive() {
    this.#stopKeepAlive();
    if (!this.keepAwake) return;
    this.keepAliveTimer = setInterval(() => {
      if (!this.connected || this.busy || this.pending || !this.writer || this.opening) return;
      if (Date.now() - this.lastKick < this.keepAwakeMs) return;
      this.lastKick = Date.now();
      this.transaction(`(${KICK_IDLE},1)`, 'value', { timeout: 4000 }).catch(() => {});
    }, Math.max(20, Math.floor(this.keepAwakeMs / 3)));
    this.keepAliveTimer.unref?.();
  }

  #stopKeepAlive() {
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    this.keepAliveTimer = null;
  }

  /** Read the firmware's sleep/power state and log it. Harmless on non-Pip-Boy boards. */
  async readPipState() {
    try {
      const s = await this.transaction(expr.pipState(), 'value', { timeout: 4000, replyBytes: 200 });
      this.pipState = s;
      this.#log(
        s?.sleeping === true ? 'error' : 'info',
        `Pip-Boy state: sleeping=${s?.sleeping} · mode=${s?.mode} · USB power=${s?.usbPower} · idleTimeout=${s?.idleTimeout} ms · idle timer armed=${s?.idleTimerArmed} · console=${s?.console}` +
          (s?.sleeping === true ? ' · asleep: transfers will be slow and it may stop answering; press Wake Pip-Boy' : ''),
      );
      this.#changed();
      return s;
    } catch (e) {
      this.#log('info', `Pip-Boy state unavailable: ${e.message.split(' · ')[0]}`);
      return null;
    }
  }

  /** Wake a sleeping Pip-Boy (same path as its power button). Does nothing if it is awake. */
  async wake() {
    const result = await this.transaction(expr.pipWake(), 'value', { timeout: 6000 });
    this.#log('info', `Wake Pip-Boy: ${result}`);
    return result;
  }

  async close(reason = 'Disconnected') {
    this.#stopKeepAlive();
    if (this.closing) return this.closing;
    this.closing = (async () => {
      this.connected = false;
      this.sdAvailable = false;
      this.cancelRequested = true;
      this.disconnectReason = reason;
      this.#settle(null, new Error('Disconnected; command outcome uncertain if sent'));
      await this.#releasePort({ closePort: true });
      this.port = null;
      this.portInfo = null;
      this.#log('info', reason);
      this.#changed();
    })();
    try {
      await this.closing;
    } finally {
      this.closing = null;
    }
  }

  /** Ctrl-C the running program, then re-verify. Only on explicit user request. */
  async recover() {
    if (!this.writer) throw new Error('No open port');
    this.#settle(null, new Error('Cancelled for recovery'));
    this.queue = Promise.resolve();
    this.connected = false;
    this.sdAvailable = false;
    this.memoryLimited = false;
    this.deviceError = '';
    this.rx = '';
    this.outsideTail = '';
    this.#log('info', 'Recovery requested: sending Ctrl-C');
    await this.send('\x03');
    await pause(this.promptDelayMs);
    await this.send('\n');
    await pause(this.promptDelayMs);
    return this.verifyBoard();
  }

  /**
   * reset(): clear the interpreter without running any boot code, so nothing executes from
   * Storage (needed before erasing it - the firmware runs straight from flash). Then re-verify.
   * The board and its native libraries keep working; E.reboot() brings the firmware back.
   */
  async softReset() {
    if (!this.writer) throw new Error('No open port');
    this.#stopKeepAlive();
    this.#log('info', 'Soft reset: reset() without boot code');
    await this.send('\x10reset();\n');
    await pause(Math.max(this.promptDelayMs, this.resetDelayMs));
    this.rx = '';
    this.outsideTail = '';
    await this.verifyBoard();
    this.#startKeepAlive();
  }

  /** One-line snapshot of what the link has seen; written to the persistent log on failures. */
  diagnostics() {
    const tail = this.raw.slice(-1000);
    return (
      `bytes in ${this.stats.bytesIn} / out ${this.stats.bytesOut} this session · stale frames ${this.stats.staleFrames}` +
      (this.lastStaleRaw ? ` · last stale frame: "${escapeControl(this.lastStaleRaw)}"` : '') +
      ` · raw tail (${tail.length} chars): "${escapeControl(tail)}"`
    );
  }

  async verifyBoard() {
    let board;
    try {
      board = await this.transaction(expr.board(), 'board', { timeout: 10_000, requireVerified: false });
    } catch (e) {
      this.connected = false;
      this.#log('error', `Board verification failed: ${e.message} · ${this.diagnostics()}`);
      if (this.stats.bytesIn === 0 && this.port && /timeout/i.test(e.message)) {
        throw new Error(
          'The Pip-Boy has not sent a single byte since the port opened, so its console is not running. ' +
            'It is probably asleep, switched off with USB still connected, or frozen. ' +
            'Check the screen and press the power button to wake it (or restart it), then reconnect.',
        );
      }
      throw e;
    }
    if (board !== null && board !== 'PIPBOY') {
      this.connected = false;
      this.#log('error', `Unexpected board: ${String(board)}`);
      throw new Error(`Unexpected board: ${String(board)}`);
    }
    this.connected = true;
    this.board = board;
    this.#log('info', `Board verified · ${board === null ? 'board information unavailable' : `board: ${board}`}`);
    this.#changed();
    return board;
  }

  // ------------------------------------------------------------- I/O
  send(text) {
    const task = this.writeQueue.then(async () => {
      if (!this.writer) throw new Error('Port disconnected');
      const bytes = this.encoder.encode(text);
      for (let i = 0; i < bytes.length; i += this.writeChunk) {
        if (i > 0 && this.writePauseMs) await pause(this.writePauseMs);
        if (!this.writer) throw new Error('Port disconnected');
        const part = bytes.slice(i, i + this.writeChunk);
        await this.writer.write(part);
        this.stats.bytesOut += part.length;
      }
    });
    this.writeQueue = task.catch(() => {});
    return task;
  }

  async #readLoop(reader, epoch) {
    const decoder = new TextDecoder();
    try {
      while (epoch === this.generation) {
        const { value, done } = await reader.read();
        if (done) break;
        this.stats.bytesIn += value?.byteLength || 0;
        this.#receive(decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      if (epoch === this.generation) this.disconnectReason = `Read error: ${e.message}`;
    } finally {
      if (epoch === this.generation) void this.close(this.disconnectReason === 'none' ? 'Device disconnected' : this.disconnectReason);
    }
  }

  /** Feed received text through the frame parser. Exposed for tests. */
  #receive(text) {
    this.raw = (this.raw + text).slice(-RAW_LIMIT);
    this.events.raw?.(this.raw);
    const job = this.pending;
    if (job) job.lastRx = Date.now();
    if (job && job.firstByte == null && job.writeDoneAt) job.firstByte = Date.now() - job.writeDoneAt;

    // Clean the joined buffer so a backspace at the start of a chunk can erase the previous chunk's tail.
    const { frames, rest, outside } = extractFrames(cleanText(this.rx + text));
    this.rx = rest.length > RX_LIMIT ? rest.slice(-RX_LIMIT) : rest;
    this.outsideTail = (this.outsideTail + outside).slice(-1024);

    for (const frame of frames) this.#handleFrame(frame);

    const problem = detectDeviceError(this.outsideTail);
    if (problem) {
      this.outsideTail = '';
      if (problem.type === 'memory') {
        this.memoryLimited = true;
        this.sdAvailable = false;
        this.deviceError = problem.message;
        this.#log('error', `Low-memory safe mode · ${problem.message}`);
        this.#settle(null, new Error(problem.message));
        this.#changed();
      } else if (this.pending) {
        this.#settle(null, new Error(`Device error: ${problem.message}`));
      }
    }
  }

  #handleFrame({ raw, json }) {
    const job = this.pending;
    if (json && this.ignoredRequestIds.delete(json.requestId)) return;
    if (!job || !frameMatches(json, job)) {
      this.stats.staleFrames++;
      this.lastStaleRaw = raw.slice(0, 300);
      if (job) job.strays++;
      const late = json && this.recentTimeouts.get(json.requestId);
      const waiting = job ? `#${job.id} ${job.kind} request ${job.requestId}` : 'nothing';
      const got = json === undefined ? 'unparseable frame' : `request ${json?.requestId ?? '?'} kind ${json?.kind ?? '?'}`;
      this.#log(
        late && late.kind !== 'probe' ? 'error' : 'info',
        late
          ? `Late reply for #${late.id} ${late.kind} (request ${json.requestId}) ${Date.now() - late.started} ms after it was sent, after its timeout · waiting for ${waiting}`
          : `Stale frame discarded · waiting for ${waiting} · got ${got}`,
      );
      return;
    }
    job.rawLength += raw.length;
    if (typeof json.error === 'string') return this.#settle(null, new Error(`Device exception: ${json.error}`));
    if (!validateValue(job.kind, json.value)) {
      return this.#settle(null, new Error(`Unexpected ${describeType(json.value)} response for ${job.kind}`));
    }
    job.responseType = describeType(json.value);
    this.#settle(json.value);
  }

  #settle(value, problem) {
    const job = this.pending;
    if (!job) return;
    this.pending = null;
    clearTimeout(job.timer);
    const elapsed = Date.now() - job.started;
    const summary = `Transaction #${job.id} · ${job.kind} · ${elapsed} ms · write ${job.writeStatus} · first byte ${job.firstByte ?? 'none'} ms · ${job.releases ?? 0} release command(s) · ${job.strays} stale frame(s)`;
    if (job.kind === 'board') this.#log('info', `${summary} · ${problem ? problem.message : 'reply received'}`);
    if (problem) {
      let message = problem.message;
      if (/timeout/i.test(message)) message += ` · outbound write ${job.writeStatus} · outcome uncertain`;
      this.#log('debug', `${summary} · ${message}`);
      job.reject(new Error(message));
    } else {
      this.#log('debug', `${summary} · verified`);
      job.resolve(value);
    }
    this.#changed();
  }

  /** Queue one marked REPL transaction. Only one runs at a time. */
  transaction(expression, kind = 'value', { timeout = 12_000, requireVerified = true, replyBytes = 0 } = {}) {
    const session = this.sessionId;
    const id = ++this.sequence;
    const run = async () => {
      if (session !== this.sessionId) throw new Error('Session reset; queued command cancelled');
      if (this.memoryLimited) throw new Error('Low-memory safe mode: reconnect before retrying');
      if (!this.writer || (requireVerified && !this.connected)) throw new Error('No verified REPL connection');
      const requestId = randomToken();
      let resolve, reject;
      const answer = new Promise((a, b) => {
        resolve = a;
        reject = b;
      });
      // The reply (or an error) can arrive while we're still writing the flush newline,
      // before `await answer` below; mark it handled so that isn't an unhandled rejection.
      answer.catch(() => {});
      const job = {
        id, kind, requestId, resolve, reject,
        strays: 0, rawLength: 0, started: Date.now(), timer: null,
        writeStatus: 'not sent', writeDoneAt: null, firstByte: null, responseType: null,
      };
      this.outsideTail = ''; // errors printed before this command belong to someone else
      this.pending = job;
      this.lastRequestId = requestId;
      this.#changed();
      // Packets the reply needs (~130 bytes of frame/JSON overhead on top of the value).
      const packets = Math.ceil((replyBytes + 130) / DEVICE_PACKET_BYTES);
      const probe = kind === 'probe';
      const timerMode = probe || this.wakeMode === 'timer';
      // Piggyback an idle-timer reset on a command at most every keepAwakeMs (cheap, no extra round trip).
      const keepAwake = this.keepAwake && this.connected && Date.now() - this.lastKick >= this.keepAwakeMs;
      if (keepAwake) this.lastKick = Date.now();
      const code = buildCommand(expression, { requestId, kind, wakeTicks: timerMode ? packets + 3 : 0, keepAwake });
      this.#log(
        kind === 'board' || probe ? 'info' : 'debug',
        `Outbound #${id} · ${kind} · request ${requestId} · ${previewExpression(expression)} · ${this.encoder.encode(code).length} bytes`,
      );
      job.timer = setTimeout(() => {
        if (this.pending !== job) return;
        this.recentTimeouts.set(requestId, { id, kind, started: job.started });
        if (this.recentTimeouts.size > 20) this.recentTimeouts.delete(this.recentTimeouts.keys().next().value);
        this.#settle(null, new Error('REPL transaction timeout'));
      }, Math.min(30_000, Math.max(probe ? 300 : 2_000, timeout)));
      try {
        // Release mode: the Pip-Boy sends one ~63-byte packet each time it runs a line (11:26
        // logs), so send that many side-effect-free lines right behind the command in the same
        // write. Timer mode (if the probe showed device timers also send packets): a short
        // device-side interval drains the reply instead. The pump tops up either way.
        const burst = probe ? 0 : timerMode ? 1 : Math.min(MAX_RELEASE_BURST, Math.max(2, packets + 1));
        job.releases = burst;
        await this.send(code + RELEASE_LINE.repeat(burst));
        job.writeStatus = 'completed';
        job.writeDoneAt = Date.now();
        if (!probe) void this.#pumpReleases(job, packets);
      } catch (e) {
        job.writeStatus = 'failed';
        if (this.pending === job) this.#settle(null, new Error(`Outbound write failed; outcome uncertain: ${e.message}`));
      }
      const value = await answer;
      this.lastResponseType = job.responseType;
      return value;
    };
    const task = this.queue.then(run);
    this.queue = task.catch(() => {});
    return task;
  }

  /**
   * Top up release commands only while `job`'s reply has STALLED.
   * Fix (found with the sleep model): topping up on a timer queued release lines faster than a
   * slow device runs them; leftovers delayed the next reply, which triggered more top-ups – a
   * runaway (37 → 473 lines per transfer) that buries the device's input queue.
   */
  async #pumpReleases(job, expectedPackets) {
    const cap = (job.releases ?? 0) + expectedPackets + 12;
    for (let n = 0; n < 400; n++) {
      // 100 ms between checks for the first second, then back off to 250 ms.
      const interval = n < 10 ? this.releaseIntervalMs : this.releaseIntervalMs * 2.5;
      await pause(interval);
      if (this.pending !== job || !this.writer) return;
      // A device that hasn't sent a single byte since the port opened isn't running its console
      // (asleep, off or frozen). More release lines won't help, and they would all run in a burst
      // once it wakes, so stop after a couple of checks.
      if (this.stats.bytesIn === 0 && n >= 2) return;
      const quietFor = Date.now() - (job.lastRx ?? job.writeDoneAt ?? job.started);
      if (quietFor < interval) continue; // reply still flowing: don't queue lines behind it
      if ((job.releases ?? 0) >= cap) continue; // never flood the device's input queue
      try {
        await this.send(RELEASE_LINE.repeat(2));
      } catch {
        return;
      }
      job.releases = (job.releases ?? 0) + 2;
    }
  }

  command(expression, timeout, { replyBytes = 0 } = {}) {
    return this.transaction(expression, 'value', { timeout, replyBytes });
  }

  /**
   * One-time check after connecting: does a device timer firing also send a USB packet?
   * Sends a ~530-byte reply with only a 2 ms device interval and no release lines. If the whole
   * reply arrives, later transfers use timer mode (far fewer lines run per reply).
   */
  async probeWake() {
    const expression = '(function(){return new Array(401).join("x")})()';
    let failure = null;
    try {
      const value = await this.transaction(expression, 'probe', { timeout: 800, replyBytes: 400 });
      if (typeof value !== 'string' || value.length !== 400) failure = 'unexpected probe reply';
    } catch (e) {
      failure = e.message.split(' · ')[0];
    }
    if (!failure) {
      this.wakeMode = 'timer';
      this.#log('info', 'Wake probe: device timers release output · using timer mode for transfers');
    } else {
      this.wakeMode = 'release';
      if (this.lastRequestId) this.ignoredRequestIds.add(this.lastRequestId);
      this.#log('info', `Wake probe: timers did not release the reply (${failure}) · using release commands`);
      // Drain the probe's withheld reply so it doesn't show up later.
      try {
        await this.send(RELEASE_LINE.repeat(14));
        await pause(Math.min(300, Math.max(50, this.releaseIntervalMs)));
      } catch {}
    }
    this.#changed();
    return this.wakeMode;
  }

  // -------------------------------------------------------- operations
  checkCancelled(message = 'Operation cancelled') {
    if (this.cancelRequested) throw new Error(message);
  }

  requestCancel() {
    this.cancelRequested = true;
    this.#log('info', 'Cancellation requested; stopping at next transaction boundary');
  }

  static classify(error, { memoryLimited, portOpen }) {
    const reason = error.message;
    const uncertain = /uncertain|timeout|timed out|write/i.test(reason);
    const status = memoryLimited
      ? 'low-memory-safe-mode'
      : !portOpen
        ? 'disconnected'
        : /timeout|timed out/i.test(reason)
          ? 'timeout'
          : /cancelled/i.test(reason)
            ? 'cancelled'
            : /not verified|not available|No verified/i.test(reason)
              ? 'unavailable'
              : uncertain
                ? 'uncertain-write'
                : 'failed';
    return { status, uncertain };
  }

  /** Run a user-level operation: one at a time, one terminal outcome recorded. */
  async run(label, work, { requireVerified = true } = {}) {
    if (requireVerified && !this.connected) throw new Error('Verify the Espruino REPL first');
    if (this.busy || this.pending) throw new Error('Wait for the current device operation');
    const id = ++this.operationId;
    const start = Date.now();
    const before = { ...this.stats };
    this.busy = true;
    this.cancelRequested = false;
    this.activeOperation = label;
    this.lastRequestId = null;
    this.lastResponseType = null;
    this.#changed();
    const record = (status, uncertain, detail) => {
      this.lastOutcome = status;
      this.lastError = detail;
      this.lastUncertain = uncertain;
      const row = {
        operationId: id, action: label, status, elapsedMs: Date.now() - start,
        requestId: this.lastRequestId ?? null, responseType: this.lastResponseType ?? null,
        bytesWritten: this.stats.bytesOut - before.bytesOut, bytesRead: this.stats.bytesIn - before.bytesIn,
        uncertainWrite: uncertain, next: OUTCOME_NEXT[status], detail,
      };
      this.history = [row, ...this.history].slice(0, 40);
      return row;
    };
    try {
      const value = await work();
      this.checkCancelled();
      const row = record('verified', false, null);
      const secs = Math.max(row.elapsedMs, 1) / 1000;
      const kb = (n) => `${(n / 1024).toFixed(1)} KB`;
      this.#log(
        'info',
        `${label} complete · ${secs.toFixed(1)} s · serial in ${kb(row.bytesRead)} (${kb(row.bytesRead / secs)}/s) · out ${kb(row.bytesWritten)}`,
      );
      return { ok: true, value, row };
    } catch (e) {
      const { status, uncertain } = SerialSession.classify(e, { memoryLimited: this.memoryLimited, portOpen: this.portOpen });
      const row = record(status, uncertain, e.message);
      const extra = status === 'timeout' || status === 'uncertain-write' ? ` · ${this.diagnostics()}` : '';
      this.#log('error', `${status} #${id} · ${label}: ${e.message} · outcome ${uncertain ? 'uncertain' : 'known'}${extra}`);
      return { ok: false, error: e, row };
    } finally {
      this.activeOperation = null;
      this.busy = false;
      this.cancelRequested = false;
      this.#changed();
    }
  }
}
