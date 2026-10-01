declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort; }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;
class StereoTap extends AudioWorkletProcessor {
  private block = new Float32Array(4096); private offset = 0; private enabled = true; private channels = 0;
  constructor() { super(); this.port.onmessage = (event: MessageEvent<{ enabled: boolean }>) => { this.enabled = event.data.enabled; this.offset = 0; }; }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0], output = outputs[0];
    if (!input?.length) return true;
    if (input.length !== this.channels) { this.channels = input.length; this.offset = 0; }
    // Only an absent channel is mono. Silence in an existing R channel is
    // valid stereo (hard left), and must never be replaced with L.
    const l = input[0]!, r = input[1] ?? l;
    if (output?.[0]) output[0].set(l); if (output?.[1]) output[1].set(r);
    if (!this.enabled) return true;
    for (let i = 0; i < l.length; i++) { this.block[this.offset++] = l[i]!; this.block[this.offset++] = r[i]!; if (this.offset === this.block.length) { this.port.postMessage({ pcm: this.block, sampleRate, channels: this.channels }, [this.block.buffer]); this.block = new Float32Array(4096); this.offset = 0; } }
    return true;
  }
}
registerProcessor("mlsm-stereo-tap", StereoTap);
export {};
