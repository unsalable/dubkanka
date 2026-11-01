// Microphone recorder: sample-accurate timestamps so a take lands exactly where it was spoken.
// Echo cancellation and noise suppression are on by default. Noise suppression has engines to pick from, like a voice
// chat app: the browser's own, RNNoise live in an AudioWorklet (bundled, web/vendor/noise), DPDFNet on the server after
// the take (the "cleanup" feature), or none.
import { engine } from './engine.js';
import { t } from './i18n.js';
import { LS } from './util.js';

// the labels are translated where they are shown (t())
export const NOISE_ENGINES = [['standard', 'Standart'], ['rnnoise', 'RNNoise'], ['dpdfnet', 'DPDFNet'], ['off', 'Kapalı']];

export const micPrefs = () => ({
  deviceId: LS.get('mic.device', ''),
  echoCancellation: LS.get('mic.ec', true),
  noise: LS.get('mic.ns', LS.get('mic.denoise', false) ? 'dpdfnet' : 'standard'), // 1.2 had an AI cleanup switch
  autoGainControl: LS.get('mic.agc', false),
  latencyMs: LS.get('mic.latency', 0),
  hpf: LS.get('mic.hpf', true),
  monitor: LS.get('mic.monitor', false),
  monitorGain: LS.get('mic.monitorGain', 0.8),
});

// RNNoise works on 10 ms frames at 48 kHz; the worklet hands its output back 512 samples later.
const RNNOISE_DELAY = 512;
const NOISE_DIR = '/web/vendor/noise/';
const simd = () => WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
let rnnoiseWasm = null;
const rnnoiseCtx = new WeakSet();
async function rnnoiseNode(ctx) {
  if (ctx.sampleRate !== 48000) throw new Error(t('RNNoise 48 kHz ses ister'));
  if (!rnnoiseCtx.has(ctx)) {
    await ctx.audioWorklet.addModule(NOISE_DIR + 'rnnoise-worklet.js');
    rnnoiseCtx.add(ctx);
  }
  if (!rnnoiseWasm) {
    rnnoiseWasm = fetch(NOISE_DIR + (simd() ? 'rnnoise_simd.wasm' : 'rnnoise.wasm')).then((r) => {
      if (!r.ok) throw new Error(t('RNNoise yüklenemedi'));
      return r.arrayBuffer();
    });
    rnnoiseWasm.catch(() => (rnnoiseWasm = null));
  }
  return new AudioWorkletNode(ctx, '@sapphi-red/web-noise-suppressor/rnnoise', {
    numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: 'explicit',
    processorOptions: { maxChannels: 1, wasmBinary: await rnnoiseWasm },
  });
}
const prefSubs = new Set();
/** Called with (key, value) whenever a microphone preference changes, wherever it was changed from. */
export const onMicPrefs = (f) => (prefSubs.add(f), () => prefSubs.delete(f));
export const setMicPref = (k, v) => {
  LS.set('mic.' + k, v);
  for (const f of prefSubs) f(k, v);
};

// Bluetooth headsets switch to the phone-call profile when their microphone is used: 16 kHz, muffled.
const HEADSET = /hands-?free|headset|bluetooth|airpods|buds|wh-1000|\bbt\b|ag audio/i;
export const isHeadsetMic = (label) => HEADSET.test(label || '');

class Recorder {
  constructor() {
    this.ready = false;
    this.level = 0;
    this.levelListeners = new Set();
    this.stateListeners = new Set();
    this.recording = false;
    this.info = null;
    this.canClean = true; // DPDFNet is there to clean takes (the booth says when it is not)
  }
  /** The engine actually used: DPDFNet that is not installed falls back to the browser's suppression. */
  noiseEngine(pr = micPrefs()) {
    return pr.noise === 'dpdfnet' && !this.canClean ? 'standard' : pr.noise;
  }
  onLevel(fn) {
    this.levelListeners.add(fn);
    return () => this.levelListeners.delete(fn);
  }
  /** Open / close / monitor changes, for the booth panel. */
  onState(fn) {
    this.stateListeners.add(fn);
    return () => this.stateListeners.delete(fn);
  }
  emit() {
    for (const f of this.stateListeners) f(this);
  }
  async open(force = false) {
    if (this.ready && !force) return;
    if (this.opening) return this.opening;
    this.opening = this._open().finally(() => (this.opening = null));
    return this.opening;
  }
  async _open() {
    this.close(false);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      throw new Error(t('Bu tarayıcı mikrofon kaydını desteklemiyor (güvenli bağlantı gerekli).'));
    }
    const ctx = engine.ensure();
    if (!this.moduleLoaded) {
      await ctx.audioWorklet.addModule('/web/js/worklet.js?v=2');
      this.moduleLoaded = true;
    }
    const pr = micPrefs();
    let noise = this.noiseEngine(pr);
    if (noise === 'rnnoise' && ctx.sampleRate !== 48000) noise = 'standard';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: pr.deviceId ? { exact: pr.deviceId } : undefined,
          echoCancellation: pr.echoCancellation,
          noiseSuppression: noise === 'standard', // the AI engines want the untouched signal
          autoGainControl: pr.autoGainControl,
          voiceIsolation: false,
          channelCount: { ideal: 1 },
          sampleRate: { ideal: 48000 },
          sampleSize: { ideal: 24 },
          latency: { ideal: 0.01 },
        },
      });
    } catch (e) {
      if (e.name === 'NotAllowedError') throw new Error(t('Mikrofon izni verilmedi. İzin verip tekrar dene.'));
      if (e.name === 'NotFoundError' || e.name === 'OverconstrainedError') throw new Error(t('Mikrofon bulunamadı. Takılı mı, başka bir uygulama mı kullanıyor?'));
      if (e.name === 'NotReadableError') throw new Error(t('Mikrofon başka bir uygulama tarafından kullanılıyor.'));
      throw e;
    }
    const track = this.stream.getAudioTracks()[0];
    this.source = ctx.createMediaStreamSource(this.stream);
    let input = this.source;
    if (noise === 'rnnoise') {
      try {
        this.rnnoise = await rnnoiseNode(ctx);
        this.source.connect(this.rnnoise);
        input = this.rnnoise; // the take and "hear myself" both get the cleaned voice
      } catch (e) {
        console.warn('RNNoise:', e);
        this.rnnoise = null;
        noise = 'off';
      }
    }
    this.node = new AudioWorkletNode(ctx, 'dk-capture', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    input.connect(this.node);
    this.node.connect(this.sink);
    this.sink.connect(ctx.destination);
    this.monitorNode = ctx.createGain();
    this.monitorNode.gain.value = 0;
    input.connect(this.monitorNode);
    this.monitorNode.connect(ctx.destination);
    this.node.port.onmessage = (e) => this.onMessage(e.data);
    const st = track.getSettings();
    this.inputLatency = typeof st.latency === 'number' ? st.latency : 0.01;
    this.label = track.label;
    this.info = {
      label: track.label, sampleRate: st.sampleRate || ctx.sampleRate, channels: st.channelCount || 1,
      echo: !!st.echoCancellation, noise, agc: !!st.autoGainControl, ctxRate: ctx.sampleRate,
      headset: isHeadsetMic(track.label),
    };
    track.addEventListener('ended', () => {
      this.close();
    });
    this.ready = true;
    this.setMonitor(pr.monitor, pr.monitorGain);
    this.emit();
  }
  /** Hear your own voice in the headphones (never on speakers: it would feed back). */
  setMonitor(on, gain = micPrefs().monitorGain) {
    this.monitoring = !!on;
    if (this.monitorNode && engine.ctx) this.monitorNode.gain.setTargetAtTime(on ? gain : 0, engine.ctx.currentTime, 0.015);
    this.emit();
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
    if (!this.ready) throw new Error(t('Mikrofon hazır değil'));
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
    const rnn = this.rnnoise && engine.ctx ? RNNOISE_DELAY / engine.ctx.sampleRate : 0;
    return engine.outLatency + (this.inputLatency || 0) + rnn + micPrefs().latencyMs / 1000;
  }
  close(notify = true) {
    if (this.stream) this.stream.getTracks().forEach((t) => t.stop());
    for (const n of [this.source, this.rnnoise, this.node, this.sink, this.monitorNode]) {
      try {
        n && n.disconnect();
      } catch {}
    }
    if (this.rnnoise) this.rnnoise.port.postMessage('destroy');
    this.stream = this.source = this.rnnoise = this.node = this.sink = this.monitorNode = null;
    this.ready = false;
    this.recording = false;
    this.monitoring = false;
    for (const f of this.levelListeners) f(0);
    if (notify) this.emit();
  }
}

export const recorder = new Recorder();

export async function listMics() {
  try {
    const devs = await navigator.mediaDevices.enumerateDevices();
    return devs.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications')
      .map((d, i) => ({ id: d.deviceId === 'default' ? '' : d.deviceId, label: d.label || t('Mikrofon {n}', { n: i + 1 }), headset: isHeadsetMic(d.label) }));
  } catch {
    return [];
  }
}
