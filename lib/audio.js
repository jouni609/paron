'use strict'

const { EventEmitter } = require('events')
let portAudio = null
try {
  portAudio = require('naudiodon')
} catch (err) {
  // Audio optional / fallback
}

class ParonAudio extends EventEmitter {
  constructor (options = {}) {
    super()

    this.sampleRate = options.sampleRate || 16000
    this.channelCount = options.channelCount || 1
    this.inputDeviceId = options.inputDeviceId !== undefined ? options.inputDeviceId : -1
    this.outputDeviceId = options.outputDeviceId !== undefined ? options.outputDeviceId : -1

    // Voice Activity Detection threshold (RMS energy). 0 = send always
    this.vadThreshold = options.vadThreshold !== undefined ? options.vadThreshold : 200

    this.isMuted = !!options.isMuted
    this.running = false

    this.ai = null
    this.ao = null
  }

  static isSupported () {
    return !!portAudio
  }

  static getDevices () {
    if (!portAudio) return []
    try {
      return portAudio.getDevices()
    } catch (err) {
      return []
    }
  }

  start () {
    if (!portAudio) {
      this.emit('warn', 'Natiivia äänirajapintaa (naudiodon) ei ole saatavilla.')
      return false
    }

    if (this.running) return true

    try {
      // 1. Setup Input (Microphone)
      this.ai = new portAudio.AudioIO({
        inOptions: {
          channelCount: this.channelCount,
          sampleFormat: portAudio.SampleFormat16Bit,
          sampleRate: this.sampleRate,
          deviceId: this.inputDeviceId,
          closeOnError: false
        }
      })

      this.ai.on('data', (chunk) => {
        if (this.isMuted) return

        // Calculate RMS volume level for Voice Activity Detection
        const rms = this._calculateRMS(chunk)
        if (this.vadThreshold > 0 && rms < this.vadThreshold) {
          // Below threshold, skip sending silent frames to save bandwidth
          return
        }

        this.emit('data', chunk, rms)
      })

      this.ai.on('error', (err) => {
        this.emit('error', new Error(`Äänen sisääntulovirhe: ${err.message}`))
      })

      // 2. Setup Output (Speaker / Headphones)
      this.ao = new portAudio.AudioIO({
        outOptions: {
          channelCount: this.channelCount,
          sampleFormat: portAudio.SampleFormat16Bit,
          sampleRate: this.sampleRate,
          deviceId: this.outputDeviceId,
          closeOnError: false
        }
      })

      this.ao.on('error', (err) => {
        this.emit('error', new Error(`Äänen ulostulovirhe: ${err.message}`))
      })

      // Start capture & playback
      this.ai.start()
      this.ao.start()
      this.running = true

      this.emit('start')
      return true
    } catch (err) {
      this.emit('error', new Error(`Äänilaitteen alustus epäonnistui: ${err.message}`))
      this.stop()
      return false
    }
  }

  play (chunk) {
    if (!this.running || !this.ao) return
    try {
      this.ao.write(chunk)
    } catch (err) {
      // Ignore write errors during shutdown
    }
  }

  setMute (isMuted) {
    this.isMuted = !!isMuted
  }

  toggleMute () {
    this.isMuted = !this.isMuted
    return this.isMuted
  }

  stop () {
    if (!this.running) return
    this.running = false

    if (this.ai) {
      try {
        this.ai.quit()
      } catch (err) {}
      this.ai = null
    }

    if (this.ao) {
      try {
        this.ao.quit()
      } catch (err) {}
      this.ao = null
    }

    this.emit('stop')
  }

  _calculateRMS (buffer) {
    if (!buffer || buffer.length < 2) return 0
    let sum = 0
    const samples = buffer.length / 2

    for (let i = 0; i < buffer.length; i += 2) {
      const val = buffer.readInt16LE(i)
      sum += val * val
    }

    return Math.sqrt(sum / samples)
  }
}

module.exports = ParonAudio
