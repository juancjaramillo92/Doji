/* Her answer off the wire: frames of a kind byte, three bytes of length,
   big-endian, then that many bytes. A voice frame is the vendor's raw `pcm`,
   24 kHz, 16-bit little-endian, mono. Pure, so laptop.test.mjs feeds it the door's own
   bytes, and agree.test.mjs holds FRAME and PCM_RATE to the door's. */
export const FRAME = { voice: 0 };
export const PCM_RATE = 24000;

/* Frames out of a stream whatever its chunks: a frame split across two reads
   is held until the rest arrives, and handed on whole. */
export function framer(emit) {
  let held = new Uint8Array(0);
  return (chunk) => {
    const bytes = new Uint8Array(held.length + chunk.length);
    bytes.set(held);
    bytes.set(chunk, held.length);
    let at = 0;
    while (bytes.length - at >= 4) {
      const n = bytes[at + 1] << 16 | bytes[at + 2] << 8 | bytes[at + 3];
      if (bytes.length - at < 4 + n) break;
      emit(bytes[at], bytes.slice(at + 4, at + 4 + n));
      at += 4 + n;
    }
    held = bytes.slice(at);
  };
}

/* Her voice as samples. The vendor's chunks are what the door frames, and a
   chunk can end between the two bytes of a sample: the odd byte waits for
   the next frame rather than shifting everything after it into noise. */
export function sampler() {
  let odd = null;
  return (frame) => {
    let bytes = frame;
    if (odd !== null) {
      bytes = new Uint8Array(frame.length + 1);
      bytes[0] = odd;
      bytes.set(frame, 1);
      odd = null;
    }
    if (bytes.length % 2) {
      odd = bytes[bytes.length - 1];
      bytes = bytes.subarray(0, bytes.length - 1);
    }
    const out = new Float32Array(bytes.length / 2);
    for (let i = 0; i < out.length; i++) {
      const v = bytes[2 * i] | bytes[2 * i + 1] << 8;
      out[i] = (v >= 0x8000 ? v - 0x10000 : v) / 0x8000;
    }
    return out;
  };
}

/* Her voice played from one queue, sample by sample. Parts scheduled one
   after another at computed times click at every join, and stammer whenever
   one arrives late — as her first parts do, before the vendor's stream gets
   ahead of her speaking. The queue waits until LEAD
   of her voice is in hand before it plays, and again after running dry, so a
   late part is one pause rather than a stammer; at the end it plays what is
   left, however little. `fill` writes one block of output, silence where
   nothing plays, and says 'voice' the first time a sample above nothing goes
   out — her silence while she thinks is exact zeros — and
   'drained' once the answer has played to its end. */
export const LEAD = 0.3;

export class Queue {
  constructor(rate) {
    this.lead = Math.round(LEAD * rate);
    this.parts = [];
    this.at = 0;
    this.held = 0;
    this.playing = false;
    this.ended = false;
    this.voiced = false;
  }

  push(samples) {
    this.parts.push(samples);
    this.held += samples.length;
  }

  end() { this.ended = true; }

  fill(out) {
    out.fill(0);
    if (!this.playing && this.held > 0 && (this.held >= this.lead || this.ended)) this.playing = true;
    let said = null;
    for (let i = 0; this.playing && i < out.length && this.parts.length;) {
      const part = this.parts[0], n = Math.min(out.length - i, part.length - this.at);
      const block = part.subarray(this.at, this.at + n);
      out.set(block, i);
      if (!this.voiced && block.some(s => s !== 0)) { this.voiced = true; said = 'voice'; }
      i += n;
      this.at += n;
      this.held -= n;
      if (this.at === part.length) { this.parts.shift(); this.at = 0; }
    }
    if (!this.parts.length) {
      this.playing = false;
      if (this.ended) return 'drained';
    }
    return said;
  }
}
