/* Her voice's player, in the audio thread: frames.mjs's Queue, fed her
   samples by the page and pulled a block at a time by the speaker, so
   nothing waits on the page to schedule the next part. */
import { Queue } from './frames.mjs';

class Voice extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = new Queue(sampleRate);
    this.port.onmessage = ({ data }) => (data === 'end' ? this.queue.end() : this.queue.push(data));
  }

  process(_, [[out]]) {
    const said = this.queue.fill(out);
    if (said) this.port.postMessage(said);
    return said !== 'drained';
  }
}

registerProcessor('voice', Voice);
