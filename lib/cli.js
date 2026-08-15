"use strict";

const readline = require("readline");
const os = require("os");
const ParonRoom = require("./room.js");
const ParonAudio = require("./audio.js");

class ParonCLI {
  constructor(options = {}) {
    this.name = options.name || os.userInfo().username || "User";
    this.create = options.create;
    this.join = options.join;
    this.bootstrap = options.bootstrap;
    this.audioEnabled = options.audio !== false;
    this.vad = options.vad !== undefined ? options.vad : 150;

    this.room = null;
    this.audio = null;
    this.rl = null;
    this._origStderr = null;
  }

  async start() {
    // Suppress low-level PortAudio C-runtime stderr messages from polluting the chat console
    this._origStderr = process.stderr.write;
    process.stderr.write = (chunk, encoding, callback) => {
      const str = String(chunk || "");
      if (
        str.includes("portAudio status") ||
        str.includes("AudioIO:") ||
        str.includes("Finishing input") ||
        str.includes("Finishing output") ||
        str.includes("PortAudio V19")
      ) {
        if (typeof callback === "function") callback();
        return true;
      }
      return this._origStderr.apply(process.stderr, [
        chunk,
        encoding,
        callback,
      ]);
    };

    if (!this.create && !this.join) {
      await this._promptInteractive();
    } else {
      const roomTarget = this.create || this.join;
      await this._enterRoom(roomTarget);
    }
  }

  _question(query) {
    return new Promise((resolve) => this.rl.question(query, resolve));
  }

  async _promptInteractive() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    console.log("\n=============================================");
    console.log("           PARON - P2P VOIP & CHAT           ");
    console.log("=============================================\n");

    const defaultUser = this.name;
    const nameInput = await this._question(
      `Display name [default: ${defaultUser}]: `,
    );
    if (nameInput.trim()) this.name = nameInput.trim();

    console.log("\nChoose an action:");
    console.log("  [1] Create a new room (enter a name -> get an invite code)");
    console.log("  [2] Join a room (by code or room name)");

    let choice = "";
    while (choice !== "1" && choice !== "2") {
      choice = (await this._question("\nChoice (1/2): ")).trim();
    }

    let target = "";
    if (choice === "1") {
      while (!target) {
        target = (
          await this._question('Enter a room name (e.g. "standup"): ')
        ).trim();
      }
    } else {
      while (!target) {
        target = (await this._question("Enter a room code or name: ")).trim();
      }
    }

    this.rl.close();
    this.rl = null;

    await this._enterRoom(target);
  }

  async _enterRoom(roomInput) {
    console.log("\nConnecting to the Hyperswarm P2P network...");

    this.room = new ParonRoom({
      name: this.name,
      bootstrap: this.bootstrap,
    });

    // Setup Audio Engine (48kHz Opus HD)
    if (this.audioEnabled) {
      this.audio = new ParonAudio({
        sampleRate: 48000,
        channels: 1,
        isMuted: false,
        vadThreshold: this.vad,
      });

      this.audio.on("opus", (opusPacket) => {
        if (this.room && this.room.opened) {
          this.room.broadcastAudio(opusPacket);
        }
      });

      this.audio.on("error", (err) => {
        this._printLine(`\n[Audio Warning] ${err.message}`);
        if (this.rl) this.rl.prompt(true);
      });

      const audioStarted = this.audio.start();
      if (audioStarted) {
        console.log(
          "[Audio] Microphone and speakers connected (48kHz Opus HD).",
        );
      } else {
        console.log(
          "[Audio] Could not start audio devices, continuing in text-chat mode.",
        );
      }
    }

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: `${this.name}> `,
    });

    this._bindRoomEvents();

    try {
      await this.room.join(roomInput);
    } catch (err) {
      console.error("\n[Error] Failed to join room:", err.message);
      if (this.audio) this.audio.stop();
      this.rl.close();
      process.exit(1);
    }

    console.log("\n" + "-".repeat(60));
    console.log(` Room:        ${this.room.roomName}`);
    console.log(` Invite code: ${this.room.roomCode}`);
    console.log("-".repeat(60));
    console.log(" Share the code or room name above so others can join!");
    console.log("-".repeat(60));
    console.log(" Commands:");
    console.log("   /m, /mute       - Mute / unmute microphone");
    console.log(
      "   /vad <0-500>    - Set microphone VAD sensitivity (default 150)",
    );
    console.log("   /users          - List room participants");
    console.log("   /code           - Show the room invite code again");
    console.log("   /devices        - List available audio devices");
    console.log("   /q, /quit       - Leave the room");
    console.log("   (Type a message and press Enter to send)");
    console.log("-".repeat(60));
    console.log(
      `\nYou are in the room as "${this.name}". Microphone: ${this.room.isMuted ? "MUTED" : "ON (48kHz Opus HD)"}.\n`,
    );

    this._startCommandLoop();
  }

  _bindRoomEvents() {
    this.room.on("peer-join", (peer) => {
      if (this.audio) {
        this.audio.addPeer(peer.peerId);
      }
      this._printLine(
        `\n[+] ${peer.name} joined the room! (Peer: ${peer.peerId.slice(0, 6)})`,
      );
      this.rl.prompt(true);
    });

    this.room.on("peer-leave", (peer) => {
      if (this.audio) {
        this.audio.removePeer(peer.peerId);
      }
      this._printLine(`\n[-] ${peer.name} left the room.`);
      this.rl.prompt(true);
    });

    this.room.on("peer-state", (peer) => {
      const state = peer.isMuted
        ? "muted their microphone"
        : "unmuted their microphone";
      this._printLine(`\n[*] ${peer.name} ${state}.`);
      this.rl.prompt(true);
    });

    this.room.on("audio", ({ peerId, data }) => {
      if (this.audio) {
        this.audio.receiveOpus(peerId, data);
      }
    });

    this.room.on("chat", (msg) => {
      const timeStr = new Date(msg.time).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      this._printLine(`[${timeStr}] <${msg.name}>: ${msg.text}`);
      this.rl.prompt(true);
    });

    this.room.on("self-state", (state) => {
      const status = state.isMuted ? "MUTED" : "ON";
      this._printLine(`[*] Your microphone: ${status}`);
      this.rl.prompt(true);
    });
  }

  _printLine(msg) {
    if (this.rl) {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
    }
    console.log(msg);
  }

  _startCommandLoop() {
    this.rl.setPrompt(`${this.name}${this.room.isMuted ? " [MUTED]" : ""}> `);
    this.rl.prompt();

    this.rl.on("line", (line) => {
      const input = line.trim();
      if (!input) {
        this.rl.prompt();
        return;
      }

      if (input === "/m" || input === "/mute") {
        const isMuted = this.room.toggleMute();
        if (this.audio) this.audio.setMute(isMuted);
        this.rl.setPrompt(`${this.name}${isMuted ? " [MUTED]" : ""}> `);
        this.rl.prompt();
        return;
      }

      if (input === "/users" || input === "/list") {
        const members = this.room.getMembers();
        console.log(`\nRoom members (${members.length}):`);
        for (const m of members) {
          const selfLabel = m.isSelf ? " (You)" : "";
          const muteLabel = m.isMuted ? " [Muted]" : " [Active]";
          console.log(`  - ${m.name}${selfLabel}${muteLabel}`);
        }
        console.log("");
        this.rl.prompt();
        return;
      }

      if (input === "/code") {
        console.log(`\nRoom code: ${this.room.roomCode}\n`);
        this.rl.prompt();
        return;
      }

      if (input === "/devices") {
        const devices = ParonAudio.getDevices();
        console.log(`\nAudio devices (${devices.length}):`);
        for (const d of devices) {
          const type =
            d.maxInputChannels > 0
              ? d.maxOutputChannels > 0
                ? "In/Out"
                : "Input"
              : "Output";
          console.log(`  [${d.id}] ${d.name} (${type})`);
        }
        console.log("");
        this.rl.prompt();
        return;
      }

      if (input.startsWith("/vad")) {
        if (!this.audio) {
          console.log("\nAudio is not enabled in this session.\n");
          this.rl.prompt();
          return;
        }

        const parts = input.split(/\s+/);
        if (parts.length > 1 && !isNaN(parts[1])) {
          const newThreshold = this.audio.setVAD(Number(parts[1]));
          console.log(
            `\nMicrophone VAD sensitivity set to: ${newThreshold} (0 = always on, 150 = default)\n`,
          );
        } else {
          console.log(
            `\nCurrent VAD threshold: ${this.audio.getVAD()} (Set a new one: /vad <0-500>)\n`,
          );
        }
        this.rl.prompt();
        return;
      }

      if (input === "/q" || input === "/quit" || input === "/exit") {
        this.exit();
        return;
      }

      if (input.startsWith("/")) {
        console.log(
          `Unknown command: "${input}". Commands: /mute, /vad, /users, /code, /devices, /quit`,
        );
        this.rl.prompt();
        return;
      }

      // Plain text chat
      this.room.broadcastChat(input);
      const timeStr = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      this._printLine(`[${timeStr}] <${this.name}>: ${input}`);
      this.rl.prompt();
    });

    this.rl.on("close", () => {
      this.exit();
    });
  }

  async exit() {
    if (this._origStderr) {
      process.stderr.write = this._origStderr;
    }
    console.log("\nLeaving the room and closing connections...");
    if (this.audio) {
      this.audio.stop();
    }
    if (this.room) {
      await this.room.leave();
    }
    process.exit(0);
  }
}

module.exports = ParonCLI;
