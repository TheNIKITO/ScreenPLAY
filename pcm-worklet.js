// Toca o som que chega do ScreenPLAYAudio.exe (PCM 48 kHz, 16 bits, estéreo) para virar
// a faixa de áudio da transmissão. Guarda ~40 ms de folga e nunca deixa o atraso passar de ~150 ms.
class PcmPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunks = [];
    this.pos = 0;        // posição (em amostras) dentro de chunks[0]
    this.frames = 0;     // quadros esperando para tocar
    this.primed = false;
    this.port.onmessage = (e) => {
      const samples = new Int16Array(e.data);
      this.chunks.push(samples);
      this.frames += samples.length / 2;
      while (this.frames > 7200 && this.chunks.length > 1) {
        const dropped = this.chunks.shift();
        this.frames -= (dropped.length - this.pos) / 2;
        this.pos = 0;
      }
    };
  }

  process(_inputs, outputs) {
    const left = outputs[0][0];
    const right = outputs[0][1] || left;
    if (!this.primed && this.frames >= 1920) this.primed = true;
    for (let i = 0; i < left.length; i++) {
      if (!this.primed || this.frames <= 0) {
        left[i] = 0;
        right[i] = 0;
        continue;
      }
      const cur = this.chunks[0];
      left[i] = cur[this.pos] / 32768;
      right[i] = cur[this.pos + 1] / 32768;
      this.pos += 2;
      this.frames--;
      if (this.pos >= cur.length) {
        this.chunks.shift();
        this.pos = 0;
      }
    }
    if (this.frames <= 0) this.primed = false;
    return true;
  }
}

registerProcessor('pcm-player', PcmPlayer);
