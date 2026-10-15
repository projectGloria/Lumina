import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { documentArgsFrom, liveRouteEnv, routeForFiles } from './fileRoute'

// Synchronous dispatch preserves Vault's pre-ready protocol registration.
//
// Read before anything can move it: the Quick Note branch below repoints
// `userData`, and the vault list the router needs lives in the *Vault* app's
// copy of `lumina.json`.
const vaultUserData = app.getPath('userData')

let quick = process.argv.includes('--quicknote')
if (!quick) {
  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'))
    quick = metadata.launchMode === 'quicknote'
  } catch {
    quick = false
  }
}

// No explicit request for one or the other, so let the file decide. A markdown
// note inside a vault is Vault's; every other document the OS hands us — and
// anything at all outside a vault — belongs to Quick Note, which needs no vault
// and no index to show it. See `fileRoute.ts` for why this is the rule.
if (!quick) {
  const files = documentArgsFrom(process.argv, app.isPackaged)
  if (files.length) quick = routeForFiles(files, liveRouteEnv(vaultUserData)) === 'quicknote'
}

if (quick) {
  app.commandLine.appendSwitch('disable-background-timer-throttling')
  const data = path.join(app.getPath('appData'), 'lumina-quicknote')
  fs.mkdirSync(data, { recursive: true })
  app.setPath('userData', data)
  app.setPath('sessionData', data)
  app.setName('Lumina Quick Note')
  if (process.platform === 'win32') app.setAppUserModelId('com.nihil.lumina.quicknote')
  require('./quicknote.js').startQuickNote()
} else {
  if (process.platform === 'win32') app.setAppUserModelId('com.nihil.lumina')
  require('./vaultApp.js')
}
