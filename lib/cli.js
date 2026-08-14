'use strict'

const readline = require('readline')
const os = require('os')
const ParonRoom = require('./room.js')
const ParonAudio = require('./audio.js')

class ParonCLI {
  constructor (options = {}) {
    this.name = options.name || os.userInfo().username || 'Käyttäjä'
    this.create = options.create
    this.join = options.join
    this.bootstrap = options.bootstrap
    this.audioEnabled = options.audio !== false

    this.room = null
    this.audio = null
    this.rl = null
  }

  async start () {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: '> '
    })

    console.log('\n=============================================')
    console.log('           PARON - P2P VOIP & CHAT           ')
    console.log('=============================================\n')

    if (!this.create && !this.join) {
      await this._promptInteractive()
    } else {
      const roomTarget = this.create || this.join
      await this._enterRoom(roomTarget)
    }
  }

  _question (query) {
    return new Promise((resolve) => this.rl.question(query, resolve))
  }

  async _promptInteractive () {
    const defaultUser = this.name
    const nameInput = await this._question(`Nimimerkki [oletus: ${defaultUser}]: `)
    if (nameInput.trim()) this.name = nameInput.trim()

    console.log('\nValitse toiminto:')
    console.log('  [1] Luo uusi huone (anna huoneen nimi -> saat kutsukoodin)')
    console.log('  [2] Liity huoneeseen (koodilla tai huoneen nimellä)')

    let choice = ''
    while (choice !== '1' && choice !== '2') {
      choice = (await this._question('\nValinta (1/2): ')).trim()
    }

    if (choice === '1') {
      let roomName = ''
      while (!roomName) {
        roomName = (await this._question('Anna luotavan huoneen nimi (esim. "palaveri"): ')).trim()
      }
      await this._enterRoom(roomName)
    } else {
      let codeOrName = ''
      while (!codeOrName) {
        codeOrName = (await this._question('Anna huoneen koodi tai nimi: ')).trim()
      }
      await this._enterRoom(codeOrName)
    }
  }

  async _enterRoom (roomInput) {
    console.log('\nMuodostetaan P2P-yhteyttä Hyperswarm-verkkoon...')

    this.room = new ParonRoom({
      name: this.name,
      bootstrap: this.bootstrap
    })

    // Setup Audio Engine
    if (this.audioEnabled) {
      this.audio = new ParonAudio({
        sampleRate: 16000,
        channelCount: 1,
        isMuted: false
      })

      this.audio.on('data', (chunk) => {
        if (this.room && this.room.opened) {
          this.room.broadcastAudio(chunk)
        }
      })

      this.audio.on('error', (err) => {
        this._printLine(`\n[Audio Varoitus] ${err.message}`)
        if (this.rl) this.rl.prompt(true)
      })

      const audioStarted = this.audio.start()
      if (audioStarted) {
        console.log('[Audio] Mikrofoni ja kaiuttimet kytketty (16kHz PCM).')
      } else {
        console.log('[Audio] Äänilaitetta ei voitu käynnistää, jatketaan tekstichat-tilassa.')
      }
    }

    this._bindRoomEvents()

    try {
      await this.room.join(roomInput)
    } catch (err) {
      console.error('\n[Virhe] Huoneeseen liittyminen epäonnistui:', err.message)
      if (this.audio) this.audio.stop()
      this.rl.close()
      process.exit(1)
    }

    console.log('\n' + '-'.repeat(60))
    console.log(` Huone:      ${this.room.roomName}`)
    console.log(` Kutsukoodi: ${this.room.roomCode}`)
    console.log('-'.repeat(60))
    console.log(' Jaa yllä oleva koodi tai huoneen nimi muille liittyjille!')
    console.log('-'.repeat(60))
    console.log(' Komennot:')
    console.log('   /m, /mute   - Mykistä / avaa mikrofoni')
    console.log('   /users      - Näytä huoneen osallistujat')
    console.log('   /code       - Näytä huoneen kutsukoodi uudelleen')
    console.log('   /devices    - Näytä saatavilla olevat äänilaitteet')
    console.log('   /q, /quit   - Poistu huoneesta')
    console.log('   (Kirjoita tekstiä ja paina Enter lähettääksesi viestin huoneeseen)')
    console.log('-'.repeat(60))
    console.log(`\nOlet huoneessa nimellä "${this.name}". Mikrofoni: ${this.room.isMuted ? 'MYKISTETTY' : 'PÄÄLLÄ'}.\n`)

    this._startCommandLoop()
  }

  _bindRoomEvents () {
    this.room.on('peer-join', (peer) => {
      this._printLine(`\n[+] ${peer.name} liittyi huoneeseen! (Peer: ${peer.peerId.slice(0, 6)})`)
      this.rl.prompt(true)
    })

    this.room.on('peer-leave', (peer) => {
      this._printLine(`\n[-] ${peer.name} poistui huoneesta.`)
      this.rl.prompt(true)
    })

    this.room.on('peer-state', (peer) => {
      const state = peer.isMuted ? 'MYKISTI mikrofonin' : 'AVASI mikrofonin'
      this._printLine(`\n[*] ${peer.name} ${state}.`)
      this.rl.prompt(true)
    })

    this.room.on('audio', ({ peerId, data }) => {
      if (this.audio) {
        this.audio.play(data)
      }
    })

    this.room.on('chat', (msg) => {
      const timeStr = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      this._printLine(`[${timeStr}] <${msg.name}>: ${msg.text}`)
      this.rl.prompt(true)
    })

    this.room.on('self-state', (state) => {
      const status = state.isMuted ? 'MYKISTETTY' : 'PÄÄLLÄ'
      this._printLine(`[*] Oma mikrofoni: ${status}`)
      this.rl.prompt(true)
    })
  }

  _printLine (msg) {
    readline.clearLine(process.stdout, 0)
    readline.cursorTo(process.stdout, 0)
    console.log(msg)
  }

  _startCommandLoop () {
    this.rl.setPrompt(`${this.name}${this.room.isMuted ? ' [MUTED]' : ''}> `)
    this.rl.prompt()

    this.rl.on('line', (line) => {
      const input = line.trim()
      if (!input) {
        this.rl.prompt()
        return
      }

      if (input === '/m' || input === '/mute') {
        const isMuted = this.room.toggleMute()
        if (this.audio) this.audio.setMute(isMuted)
        this.rl.setPrompt(`${this.name}${isMuted ? ' [MUTED]' : ''}> `)
        this.rl.prompt()
        return
      }

      if (input === '/users' || input === '/list') {
        const members = this.room.getMembers()
        console.log(`\nHuoneen jäsenet (${members.length}):`)
        for (const m of members) {
          const selfLabel = m.isSelf ? ' (Sinä)' : ''
          const muteLabel = m.isMuted ? ' [Mykistetty]' : ' [Aktiivinen]'
          console.log(`  - ${m.name}${selfLabel}${muteLabel}`)
        }
        console.log('')
        this.rl.prompt()
        return
      }

      if (input === '/code') {
        console.log(`\nHuonekoodi: ${this.room.roomCode}\n`)
        this.rl.prompt()
        return
      }

      if (input === '/devices') {
        const devices = ParonAudio.getDevices()
        console.log(`\nÄänilaitteet (${devices.length}):`)
        for (const d of devices) {
          const type = d.maxInputChannels > 0 ? (d.maxOutputChannels > 0 ? 'In/Out' : 'Input') : 'Output'
          console.log(`  [${d.id}] ${d.name} (${type})`)
        }
        console.log('')
        this.rl.prompt()
        return
      }

      if (input === '/q' || input === '/quit' || input === '/exit') {
        this.exit()
        return
      }

      if (input.startsWith('/')) {
        console.log(`Tuntematon komento: "${input}". Komennot: /mute, /users, /code, /devices, /quit`)
        this.rl.prompt()
        return
      }

      // Plain text chat
      this.room.broadcastChat(input)
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      this._printLine(`[${timeStr}] <${this.name}>: ${input}`)
      this.rl.prompt()
    })

    this.rl.on('close', () => {
      this.exit()
    })
  }

  async exit () {
    console.log('\nPoistutaan huoneesta ja suljetaan yhteydet...')
    if (this.audio) {
      this.audio.stop()
    }
    if (this.room) {
      await this.room.leave()
    }
    process.exit(0)
  }
}

module.exports = ParonCLI
