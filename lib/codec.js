"use strict";

const OpusScript = require("opusscript");

class OpusCodec {
  constructor(options = {}) {
    this.sampleRate = options.sampleRate || 48000;
    this.channels = options.channels || 1;
    // 20ms frame at sampleRate (e.g. 48000 * 0.02 = 960 samples)
    this.frameSize = (this.sampleRate * 20) / 1000;
    this.frameBytes = this.frameSize * this.channels * 2; // 16-bit (2 bytes per sample)

    this.encoder = new OpusScript(
      this.sampleRate,
      this.channels,
      OpusScript.Application.VOIP,
    );

    // Preallocated accumulator buffer to eliminate GC allocations in hot audio loop
    this._capacity = 65536;
    this._pcmBuffer = Buffer.allocUnsafe(this._capacity);
    this._pcmLength = 0;
  }

  /**
   * Push arbitrary sized PCM chunk into encoder accumulator.
   * Extracts exact 20ms frames and checks VAD on each full frame.
   * Zero-allocation in steady state.
   */
  encodeChunks(chunk, vadThreshold = 0) {
    if (!chunk || chunk.length === 0) return [];

    // Expand buffer capacity if incoming chunk exceeds current capacity
    if (this._pcmLength + chunk.length > this._capacity) {
      this._capacity = Math.max(
        this._capacity * 2,
        this._pcmLength + chunk.length + 16384,
      );
      const nextBuffer = Buffer.allocUnsafe(this._capacity);
      this._pcmBuffer.copy(nextBuffer, 0, 0, this._pcmLength);
      this._pcmBuffer = nextBuffer;
    }

    chunk.copy(this._pcmBuffer, this._pcmLength);
    this._pcmLength += chunk.length;

    const frames = [];
    let offset = 0;

    while (offset + this.frameBytes <= this._pcmLength) {
      const pcmFrame = this._pcmBuffer.subarray(
        offset,
        offset + this.frameBytes,
      );
      offset += this.frameBytes;

      const rms = OpusCodec.calculateRMS(pcmFrame);
      if (vadThreshold > 0 && rms < vadThreshold) {
        continue;
      }

      const opusBuffer = this.encoder.encode(pcmFrame, this.frameSize);
      frames.push({ buffer: opusBuffer, rms });
    }

    // Shift remaining unprocessed bytes to the beginning of the buffer
    if (offset > 0) {
      const remaining = this._pcmLength - offset;
      if (remaining > 0) {
        this._pcmBuffer.copy(this._pcmBuffer, 0, offset, this._pcmLength);
      }
      this._pcmLength = remaining;
    }

    return frames;
  }

  encode(pcmFrame) {
    return this.encoder.encode(pcmFrame, this.frameSize);
  }

  static calculateRMS(buffer) {
    if (!buffer || buffer.length < 2) return 0;
    let sum = 0;
    const samples = buffer.length / 2;

    for (let i = 0; i < buffer.length; i += 2) {
      const val = buffer.readInt16LE(i);
      sum += val * val;
    }

    return Math.sqrt(sum / samples);
  }

  destroy() {
    if (this.encoder) {
      try {
        this.encoder.delete();
      } catch (err) {}
      this.encoder = null;
    }
  }

  /**
   * Factory for creating a decoder instance for an individual peer.
   */
  static createDecoder(options = {}) {
    const sampleRate = options.sampleRate || 48000;
    const channels = options.channels || 1;
    const frameSize = (sampleRate * 20) / 1000;

    const decoder = new OpusScript(
      sampleRate,
      channels,
      OpusScript.Application.VOIP,
    );

    return {
      frameSize,
      frameBytes: frameSize * channels * 2,
      decode(opusPacket) {
        if (!opusPacket || opusPacket.length === 0) return null;
        return decoder.decode(opusPacket, frameSize);
      },
      destroy() {
        try {
          decoder.delete();
        } catch (err) {}
      },
    };
  }
}

module.exports = OpusCodec;
