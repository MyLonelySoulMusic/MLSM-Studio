declare const sampleRate: number;
declare class AudioWorkletProcessor { readonly port: MessagePort; }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;
class StereoTap extends AudioWorkletProcessor {
  private block = new Float32Array(4096); private offset = 0; private enabled = true; private mono = false;
  constructor() { super(); this.port.onmessage = (event: MessageEvent<{ enabled: boolean; mono?: boolean }>) => { this.enabled = event.data.enabled; this.mono = event.data.mono === true; this.offset = 0; }; }
  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const leftInput = inputs[0], rightInput = inputs[1], output = outputs[0];
    if (!leftInput?.length) return true;
    // L and R enter through different AudioWorklet inputs after an explicit
    // ChannelSplitterNode. This avoids the WebView's multichannel speaker
    // interpretation from folding a stereo file before analysis.
    const l = leftInput[0]!, r = this.mono ? l : rightInput?.[0] ?? leftInput[1] ?? l;
    if (output?.[0]) output[0].set(l); if (output?.[1]) output[1].set(r);
    if (!this.enabled) return true;
    for (let i = 0; i < l.length; i++) { this.block[this.offset++] = l[i]!; this.block[this.offset++] = r[i]!; if (this.offset === this.block.length) { this.port.postMessage({ pcm: this.block, sampleRate }, [this.block.buffer]); this.block = new Float32Array(4096); this.offset = 0; } }
    return true;
  }
}
registerProcessor("mlsm-stereo-tap", StereoTap);
export {};
