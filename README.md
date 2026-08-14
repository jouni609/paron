# Paron

Serverless, end-to-end encrypted peer-to-peer (P2P) VoIP and text chat for the terminal.

Built on **Hyperswarm DHT**, **Protomux**, and **48 kHz Opus HD** audio.

---

## Features

- **Decentralized & Serverless**: Direct P2P audio and text over Hyperswarm DHT with Noise encryption.
- **48 kHz Opus HD Audio**: Low-latency voice with WebAssembly Opus codec and 20 ms frames.
- **Voice Activity Detection (VAD)**: Transmits only when speaking. Configurable sensitivity (`/vad`).
- **Concurrent Text Chat**: Send and receive instant messages alongside voice.
- **Multi-Device Support**: Works across separate USB microphones and speaker outputs.

---

## Requirements

- [Node.js](https://nodejs.org) v18+ (or [Bare Runtime](https://github.com/holepunchto/bare))
- Windows, macOS, or Linux

---

## Quick Start

```sh
# 1. Clone and install dependencies
git clone <repo-url>
cd paron
npm install

# 2. Start the interactive CLI
npm start
```

---

## CLI Flags

Skip the startup wizard with CLI flags:

```sh
# Create a new room
npm start -- --create meeting --name Alice

# Join an existing room by name or 64-hex code
npm start -- --join meeting --name Bob

# Join in text-only mode (disable mic/audio)
npm start -- --join meeting --no-audio

# Set microphone VAD threshold (0 = continuous, 150 = default)
npm start -- --join meeting --vad 100
```

| Flag                 | Short | Description                         |
| :------------------- | :---- | :---------------------------------- |
| `--create [name]`    | `-c`  | Create a new room with a given name |
| `--join [code/name]` | `-j`  | Join a room by name or 64-hex code  |
| `--name [nick]`      | `-n`  | Set your display nickname           |
| `--vad [0-500]`      |       | Set microphone VAD energy threshold |
| `--no-audio`         |       | Text-only mode                      |
| `--version`          | `-v`  | Show version                        |
| `--help`             | `-h`  | Show help                           |

---

## In-Room Commands

Type messages directly into the prompt to chat, or use slash commands:

| Command           | Description                               |
| :---------------- | :---------------------------------------- |
| `/m`, `/mute`     | Mute or unmute your microphone            |
| `/vad <0-500>`    | Get or adjust microphone VAD threshold    |
| `/users`, `/list` | List participants in the room             |
| `/code`           | Print the 64-hex room invite code         |
| `/devices`        | List available audio input/output devices |
| `/q`, `/quit`     | Leave the room and exit                   |

---

## Development & Tests

```sh
npm test        # Run unit & integration tests (Brittle)
npm run lint    # Check code style and linting (Prettier + Lunte)
npm run format  # Auto-format codebase
```

---

## License

Apache-2.0
