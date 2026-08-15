"use strict";

const { EventEmitter } = require("events");
const OpusCodec = require("./codec.js");

let portAudio = null;
try {
  portAudio = require("naudiodon");
} catch (err) {
  // Audio optional / fallback
}

class ParonAudio extends EventEmitter {
  constructor(options = {}) {
    super();

    this.sampleRate = options.sampleRate || 48000;
    this.channels = options.channels || 1;
    this.inputDeviceId =
      options.inputDeviceId !== undefined ? options.inputDeviceId : -1;
    this.outputDeviceId =
      options.outputDeviceId !== undefined ? options.outputDeviceId : -1;

    // Voice Activity Detection threshold (RMS energy). 0 = send all
    this.vadThreshold =
      options.vadThreshold !== undefined ? options.vadThreshold : 150;

    this.isMuted = !!options.isMuted;
    this.running = false;

    this.ai = null;
    this.ao = null;

    // Opus encoder for microphone
    this.codec = new OpusCodec({
      sampleRate: this.sampleRate,
      channels: this.channels,
    });

    // Decoders for remote peers: peerId -> { decoder }
    this.peers = new Map();
  }

  static getDevices() {
    if (!portAudio) return [];
    try {
      return portAudio.getDevices();
    } catch (err) {
      return [];
    }
  }

  /**
   * Register a remote peer with an Opus decoder.
   */
  addPeer(peerId) {
    const decoder = OpusCodec.createDecoder({
      sampleRate: this.sampleRate,
      channels: this.channels,
    });
    this.peers.set(peerId, { decoder });
  }

  /**
   * Remove a remote peer and release resources.
   */
  removePeer(peerId) {
    const peer = this.peers.get(peerId);
    if (peer && peer.decoder) {
      peer.decoder.destroy();
    }
    this.peers.delete(peerId);
  }

  /**
   * Receive Opus packet from remote peer, decode, and play to speakers.
   */
  receiveOpus(peerId, opusPacket) {
    if (!this.running || !this.ao) return;

    let peer = this.peers.get(peerId);
    if (!peer) {
      this.addPeer(peerId);
      peer = this.peers.get(peerId);
    }

    const pcm = peer.decoder.decode(opusPacket);
    if (pcm) {
      try {
        this.ao.write(pcm);
      } catch (err) {}
    }
  }

  start() {
    if (!portAudio) {
      this.emit("warn", "Native audio interface (naudiodon) is not available.");
      return false;
    }

    if (this.running) return true;

    try {
      // 1. Setup Microphone Input (48kHz 16-bit mono)
      this.ai = new portAudio.AudioIO({
        inOptions: {
          channelCount: this.channels,
          sampleFormat: portAudio.SampleFormat16Bit,
          sampleRate: this.sampleRate,
          deviceId: this.inputDeviceId,
          closeOnError: false,
        },
      });

      this.ai.on("data", (rawPcmChunk) => {
        if (this.isMuted) return;

        // Accumulate chunks into exact 20ms frames and apply VAD per frame
        const frames = this.codec.encodeChunks(rawPcmChunk, this.vadThreshold);
        for (const frame of frames) {
          this.emit("opus", frame.buffer, frame.rms);
        }
      });

      this.ai.on("error", (err) => {
        this.emit("error", new Error(`Microphone error: ${err.message}`));
      });

      // 2. Setup Speaker Output (48kHz 16-bit mono)
      this.ao = new portAudio.AudioIO({
        outOptions: {
          channelCount: this.channels,
          sampleFormat: portAudio.SampleFormat16Bit,
          sampleRate: this.sampleRate,
          deviceId: this.outputDeviceId,
          closeOnError: false,
        },
      });

      this.ao.on("error", (err) => {
        this.emit("error", new Error(`Speaker playback error: ${err.message}`));
      });

      this.ai.start();
      this.ao.start();
      this.running = true;

      this.emit("start");
      return true;
    } catch (err) {
      this.emit(
        "error",
        new Error(`Failed to initialize audio devices: ${err.message}`),
      );
      this.stop();
      return false;
    }
  }

  setVAD(threshold) {
    this.vadThreshold = Math.max(0, Number(threshold) || 0);
    return this.vadThreshold;
  }

  getVAD() {
    return this.vadThreshold;
  }

  setMute(isMuted) {
    this.isMuted = !!isMuted;
  }

  stop() {
    if (!this.running) return;
    this.running = false;

    if (this.ai) {
      try {
        this.ai.quit();
      } catch (err) {}
      this.ai = null;
    }

    if (this.ao) {
      try {
        this.ao.quit();
      } catch (err) {}
      this.ao = null;
    }

    if (this.codec) {
      this.codec.destroy();
    }

    for (const [peerId] of this.peers.entries()) {
      this.removePeer(peerId);
    }

    this.emit("stop");
  }
}

module.exports = ParonAudio;
