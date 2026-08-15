import path from "path";
import { command, flag, summary } from "paparam";
import { isWindows } from "which-runtime";
import pkg from "./package.json" with { type: "json" };
import ParonCLI from "./lib/cli.js";

const appName = pkg.name;

const cmd = command(
  appName,
  summary(pkg.description || "P2P VOIP & Chat"),
  flag("--create|-c [name]", "Create a new room with the given name"),
  flag("--join|-j [code]", "Join a room by code or name"),
  flag("--name|-n [nick]", "Set your display name"),
  flag("--no-audio", "Start without audio (text chat only)"),
  flag("--vad [threshold]", "Set microphone VAD threshold (default 150)"),
  flag("--version|-v", "Show version"),
);

const argv =
  typeof Bare !== "undefined"
    ? Bare.argv.slice(
        path.basename(Bare.argv[0]) === (isWindows ? "bare.exe" : "bare")
          ? 2
          : 1,
      )
    : process.argv.slice(2);

cmd.parse(argv);

if (cmd.flags.help) {
  if (typeof Bare !== "undefined") Bare.exit(0);
  else process.exit(0);
}

if (cmd.flags.version) {
  console.log(`${appName} v${pkg.version}`);
  if (typeof Bare !== "undefined") Bare.exit(0);
  else process.exit(0);
}

const cli = new ParonCLI({
  create: cmd.flags.create,
  join: cmd.flags.join,
  name: cmd.flags.name,
  audio: cmd.flags.audio !== false,
  vad: cmd.flags.vad !== undefined ? Number(cmd.flags.vad) : undefined,
});

await cli.start();
