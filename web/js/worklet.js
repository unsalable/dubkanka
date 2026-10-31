// Captures microphone samples with their exact AudioContext timestamps.
class DkCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.rec = false;
    this.chunk = new Float32Array(4096);
    this.fill = 0;
    this.chunkTime = 0;
    this.peak = 0;
    this.levelCount = 0;
    this.port.onmessage = (e) => {
      if (e.data === 'start') {
        this.rec = true;
        this.fill = 0;
      } else if (e.data === 'stop') {
        this.flush();
        this.rec = false;
        this.port.postMessage({ type: 'stopped' });
      }
    };
  }
  flush() {
    if (this.fill > 0) {
      this.port.postMessage({ type: 'data', t: this.chunkTime, samples: this.chunk.slice(0, this.fill) });
      this.fill = 0;
    }
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        const a = ch[i] < 0 ? -ch[i] : ch[i];
        if (a > this.peak) this.peak = a;
      }
      this.levelCount += ch.length;
      if (this.levelCount >= sampleRate / 30) {
        this.port.postMessage({ type: 'level', peak: this.peak });
        this.peak = 0;
        this.levelCount = 0;
      }
      if (this.rec) {
        if (this.fill === 0) this.chunkTime = currentTime;
        if (this.fill + ch.length > this.chunk.length) {
          this.flush();
          this.chunkTime = currentTime;
        }
        this.chunk.set(ch, this.fill);
        this.fill += ch.length;
      }
    }
    return true;
  }
}
registerProcessor('dk-capture', DkCapture);
