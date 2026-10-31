// Microphone recorder: sample-accurate timestamps so a take lands exactly where it was spoken.
import { engine } from './engine.js';
import { LS } from './util.js';

export const micPrefs = () => ({
  deviceId: LS.get('mic.device', ''),
  echoCancellation: LS.get('mic.echo', true),
  noiseSuppression: LS.get('mic.noise', true),
  autoGainControl: LS.get('mic.agc', false),
  latencyMs: LS.get('mic.latency', 0),
});

class Recorder {
  constructor() {
    this.ready = false;
    this.level = 0;
    this.levelListeners = new Set();
    this.recording = false;
  }
  onLevel(fn) {
    this.levelListeners.add(fn);
    return () => this.levelListeners.delete(fn);
  }
  async open(force = false) {
    if (this.ready && !force) return;
    this.close();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error('Bu tarayıcı mikrofon kaydını desteklemiyor (güvenli bağlantı gerekli).');
    }
    const ctx = engine.ensure();
    if (!this.moduleLoaded) {
      await ctx.audioWorklet.addModule('/web/js/worklet.js?v=1');
      this.moduleLoaded = true;
    }
    const pr = micPrefs();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: pr.deviceId ? { exact: pr.deviceId } : undefined,
          echoCancellation: pr.echoCancellation,
          noiseSuppression: pr.noiseSuppression,
          autoGainControl: pr.autoGainControl,
          channelCount: 1,
        },
      });
    } catch (e) {
      if (e.name === 'NotAllowedError') throw new Error('Mikrofon izni verilmedi. Adres çubuğundaki kilit simgesinden izin ver.');
      if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') throw new Error('Mikrofon bulunamadı.');
      throw e;
    }
    this.source = ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(ctx, 'dk-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.source.connect(this.node);
    this.node.connect(this.sink);
    this.sink.connect(ctx.destination);
    this.node.port.onmessage = (e) => this.onMessage(e.data);
    const settings = this.stream.getAudioTracks()[0].getSettings();
    this.inputLatency = typeof settings.latency === 'number' ? settings.latency : 0.01;
    this.label = this.stream.getAudioTracks()[0].label;
    this.ready = true;
  }
  onMessage(m) {
    if (m.type === 'level') {
      this.level = m.peak;
      for (const f of this.levelListeners) f(m.peak);
    } else if (m.type === 'data' && this.recording) {
      if (this.firstTime == null) this.firstTime = m.t;
      this.chunks.push(m.samples);
    } else if (m.type === 'stopped' && this.stopResolve) {
      this.stopResolve();
      this.stopResolve = null;
    }
  }
  start() {
    if (!this.ready) throw new Error('Mikrofon hazır değil');
    this.chunks = [];
    this.firstTime = null;
    this.recording = true;
    this.node.port.postMessage('start');
  }
  async stop() {
    if (!this.recording) return null;
    const done = new Promise((r) => (this.stopResolve = r));
    this.node.port.postMessage('stop');
    await Promise.race([done, new Promise((r) => setTimeout(r, 500))]);
    this.recording = false;
    const n = this.chunks.reduce((a, c) => a + c.length, 0);
    const samples = new Float32Array(n);
    let o = 0;
    for (const c of this.chunks) {
      samples.set(c, o);
      o += c.length;
    }
    this.chunks = [];
    return { samples, sampleRate: engine.ctx.sampleRate, firstTime: this.firstTime };
  }
  /** Seconds between "heard at" and "captured at" that must be removed from a take's position. */
  roundTrip() {
    return engine.outLatency + (this.inputLatency || 0) + micPrefs().latencyMs / 1000;
  }
  close() {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    for (const n of [this.source, this.node, this.sink]) {
      try {
        n && n.disconnect();
      } catch {}
    }
    this.stream = this.source = this.node = this.sink = null;
    this.ready = false;
    this.recording = false;
  }
}

export const recorder = new Recorder();

export async function listMics() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs.filter((d) => d.kind === 'audioinput').map((d, i) => ({ id: d.deviceId, label: d.label || `Mikrofon ${i + 1}` }));
  } catch {
    return [];
  }
}
