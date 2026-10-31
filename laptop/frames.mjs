/* Her answer off the wire, read as the charm reads it: frames of a kind byte,
   three bytes of length, big-endian, then that many bytes. A voice frame is
   the vendor's raw `pcm`, 24 kHz, 16-bit little-endian, mono; a volume frame
   is one byte from 0 to 100. Pure, so laptop.test.mjs feeds it the door's own
   bytes, and agree.test.mjs holds FRAME and PCM_RATE to the door's. */
export const FRAME = { voice: 0, volume: 1 };
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
