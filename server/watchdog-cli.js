import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Watchdog } from './watchdog.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

const wd = new Watchdog({
  cmd: process.execPath,
  args: [join(root, 'server', 'appServer.js')],
  maxRestarts: 10,
  restartDelayMs: 2000,
})
wd.on('exit', (info) => {
  console.log(`[watchdog] ${info.message}${info.code != null ? ` (code ${info.code})` : ''}`)
})
wd.start()
