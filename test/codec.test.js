"use strict";

const { test } = require("brittle");
const OpusCodec = require("../lib/codec.js");

test("OpusCodec encodes and decodes 48kHz audio frames", (t) => {
  const codec = new OpusCodec({ sampleRate: 48000, channels: 1 });
  const decoder = OpusCodec.createDecoder({ sampleRate: 48000, channels: 1 });

  t.is(codec.frameSize, 960, "Frame size is 960 samples (20ms @ 48kHz)");
  t.is(codec.frameBytes, 1920, "Frame bytes is 1920 bytes");

  // Generate synthetic sine wave PCM frame (960 samples of 16-bit audio)
  const pcmIn = Buffer.alloc(1920);
  for (let i = 0; i < 960; i++) {
    const val = Math.round(Math.sin((i / 960) * Math.PI * 2 * 440) * 10000);
    pcmIn.writeInt16LE(val, i * 2);
  }

  const frames = codec.encodeChunks(pcmIn, 0);
  t.is(frames.length, 1, "Extracted exactly 1 Opus frame from 1920 bytes");
  t.ok(frames[0].buffer && frames[0].buffer.length > 0, "Opus frame generated");
  t.ok(
    frames[0].buffer.length < pcmIn.length,
    "Compressed significantly (Opus < PCM)",
  );

  const decoded = decoder.decode(frames[0].buffer);
  t.ok(decoded, "Decoded frame exists");
  t.is(decoded.length, 1920, "Decoded frame is exactly 1920 bytes");

  codec.destroy();
  decoder.destroy();
});

test("OpusCodec calculateRMS returns correct energy level", (t) => {
  const silence = Buffer.alloc(1920);
  t.is(OpusCodec.calculateRMS(silence), 0, "Silence has 0 RMS");

  const loud = Buffer.alloc(1920);
  for (let i = 0; i < loud.length; i += 2) {
    loud.writeInt16LE(1000, i);
  }
  const rms = OpusCodec.calculateRMS(loud);
  t.is(Math.round(rms), 1000, "Constant 1000 amplitude has ~1000 RMS");
});
