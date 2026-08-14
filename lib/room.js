'use strict'

const { EventEmitter } = require('events')
const crypto = require('crypto')
const Hyperswarm = require('hyperswarm')
const Protomux = require('protomux')
const c = require('compact-encoding')
const b4a = require('b4a')

class ParonRoom extends EventEmitter {
  constructor (options = {}) {
    super()

    this.name = options.name || 'Anonyymi'
    this.peerId = options.peerId || crypto.randomBytes(8).toString('hex')
    this.isMuted = !!options.isMuted

    this.roomName = null
    this.topic = null
    this.roomCode = null

    this.swarmOptions = options.swarmOptions || (options.bootstrap ? { bootstrap: options.bootstrap } : {})
    this.swarm = null
    this.discovery = null
    this.peers = new Map() // peerId -> { peerId, name, isMuted, channel, messages, conn }
    this.opened = false
    this.closing = false
  }

  /**
   * Derive a 32-byte topic from either a raw 64-char hex code or a human-friendly room name.
   */
  static deriveTopic (input) {
    const clean = (input || '').trim()
    if (!clean) throw new Error('Huoneen nimi tai koodi ei voi olla tyhjä.')

    // If already 64 hex characters (32 bytes)
    if (/^[0-9a-fA-F]{64}$/.test(clean)) {
      return {
        topic: b4a.from(clean, 'hex'),
        roomCode: clean.toLowerCase(),
        roomName: 'Koodihuone (' + clean.slice(0, 8) + '...)'
      }
    }

    // Otherwise derive SHA256 from normalized room name
    const normalized = clean.toLowerCase()
    const topic = crypto.createHash('sha256').update('paron:v1:room:' + normalized).digest()
    const roomCode = b4a.toString(topic, 'hex')

    return {
      topic,
      roomCode,
      roomName: clean
    }
  }

  /**
   * Join a room by name or code.
   */
  async join (roomInput) {
    if (this.opened) throw new Error('Huone on jo auki.')

    const { topic, roomCode, roomName } = ParonRoom.deriveTopic(roomInput)
    this.topic = topic
    this.roomCode = roomCode
    this.roomName = roomName

    this.swarm = new Hyperswarm(this.swarmOptions)

    this.swarm.on('connection', (conn, info) => {
      this._handleConnection(conn, info)
    })

    this.discovery = this.swarm.join(this.topic, { client: true, server: true })
    await this.discovery.flushed()
    this.opened = true

    this.emit('ready', {
      roomName: this.roomName,
      roomCode: this.roomCode,
      topic: this.topic
    })

    return this
  }

  _handleConnection (conn, info) {
    const mux = Protomux.from(conn)

    let remotePeerId = null
    let remoteName = 'Tuntematon'
    let remoteIsMuted = false

    const channel = mux.createChannel({
      protocol: 'paron/voip/v1',
      onopen: () => {
        // Send our handshake
        handshakeMsg.send({
          peerId: this.peerId,
          name: this.name,
          isMuted: this.isMuted
        })
      },
      onclose: () => {
        if (remotePeerId && this.peers.has(remotePeerId)) {
          const peer = this.peers.get(remotePeerId)
          this.peers.delete(remotePeerId)
          this.emit('peer-leave', peer)
        }
      }
    })

    const handshakeMsg = channel.addMessage({
      encoding: c.json,
      onmessage: (msg) => {
        if (!msg || !msg.peerId) return
        remotePeerId = msg.peerId
        remoteName = msg.name || 'Nimetön'
        remoteIsMuted = !!msg.isMuted

        const peer = {
          peerId: remotePeerId,
          name: remoteName,
          isMuted: remoteIsMuted,
          channel,
          messages: {
            handshake: handshakeMsg,
            state: stateMsg,
            audio: audioMsg,
            chat: chatMsg
          },
          conn
        }

        this.peers.set(remotePeerId, peer)
        this.emit('peer-join', peer)
      }
    })

    const stateMsg = channel.addMessage({
      encoding: c.json,
      onmessage: (msg) => {
        if (!remotePeerId || !this.peers.has(remotePeerId)) return
        const peer = this.peers.get(remotePeerId)
        if (typeof msg.isMuted === 'boolean') {
          peer.isMuted = msg.isMuted
          this.emit('peer-state', peer)
        }
      }
    })

    const audioMsg = channel.addMessage({
      encoding: c.buffer,
      onmessage: (buf) => {
        if (!remotePeerId) return
        this.emit('audio', {
          peerId: remotePeerId,
          data: buf
        })
      }
    })

    const chatMsg = channel.addMessage({
      encoding: c.json,
      onmessage: (msg) => {
        if (!remotePeerId) return
        this.emit('chat', {
          peerId: remotePeerId,
          name: remoteName,
          text: msg.text,
          time: msg.time || Date.now()
        })
      }
    })

    channel.open()
  }

  setMute (isMuted) {
    this.isMuted = !!isMuted
    this.broadcastState({ isMuted: this.isMuted })
    this.emit('self-state', { isMuted: this.isMuted })
  }

  toggleMute () {
    this.setMute(!this.isMuted)
    return this.isMuted
  }

  broadcastState (state) {
    for (const peer of this.peers.values()) {
      try {
        peer.messages.state.send(state)
      } catch (err) {
        // Ignore send errors on dying connections
      }
    }
  }

  broadcastAudio (buffer) {
    if (this.isMuted) return
    for (const peer of this.peers.values()) {
      try {
        peer.messages.audio.send(buffer)
      } catch (err) {
        // Ignore
      }
    }
  }

  broadcastChat (text) {
    const payload = {
      text,
      time: Date.now()
    }
    for (const peer of this.peers.values()) {
      try {
        peer.messages.chat.send(payload)
      } catch (err) {
        // Ignore
      }
    }
    return payload
  }

  getMembers () {
    const members = [
      {
        peerId: this.peerId,
        name: this.name,
        isMuted: this.isMuted,
        isSelf: true
      }
    ]

    for (const peer of this.peers.values()) {
      members.push({
        peerId: peer.peerId,
        name: peer.name,
        isMuted: peer.isMuted,
        isSelf: false
      })
    }

    return members
  }

  async leave () {
    if (this.closing) return
    this.closing = true

    if (this.discovery) {
      await this.discovery.destroy()
    }

    if (this.swarm) {
      await this.swarm.destroy()
    }

    this.peers.clear()
    this.opened = false
    this.emit('close')
  }
}

module.exports = ParonRoom
