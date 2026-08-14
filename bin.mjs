import { command, flag, summary } from 'paparam'
import { isWindows } from 'which-runtime'
import pkg from './package.json' with { type: 'json' }
import ParonCLI from './lib/cli.js'

const appName = pkg.productName || pkg.name

const cmd = command(
  appName,
  summary(pkg.description || 'P2P VOIP & Chat'),
  flag('--create|-c [name]', 'Luo uusi huone annetulla nimellä'),
  flag('--join|-j [code]', 'Liity huoneeseen koodilla tai nimellä'),
  flag('--name|-n [nick]', 'Aseta oma nimimerkki'),
  flag('--no-audio', 'Käynnistä ilman ääntä (vain teksti-chat)'),
  flag('--version|-v', 'Näytä versio')
)

const argv = typeof Bare !== 'undefined'
  ? Bare.argv.slice(path.basename(Bare.argv[0]) === (isWindows ? 'bare.exe' : 'bare') ? 2 : 1)
  : process.argv.slice(2)

cmd.parse(argv)

if (cmd.flags.help) {
  if (typeof Bare !== 'undefined') Bare.exit(0)
  else process.exit(0)
}

if (cmd.flags.version) {
  console.log(`${appName} v${pkg.version}`)
  if (typeof Bare !== 'undefined') Bare.exit(0)
  else process.exit(0)
}

const cli = new ParonCLI({
  create: cmd.flags.create,
  join: cmd.flags.join,
  name: cmd.flags.name,
  audio: cmd.flags.audio !== false
})

await cli.start()
