import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'

// Synchronous dispatch preserves Vault's pre-ready protocol registration.
let quick = process.argv.includes('--quicknote')
if (!quick) {
  try {
    const metadata = JSON.parse(fs.readFileSync(path.join(app.getAppPath(), 'package.json'), 'utf8'))
    quick = metadata.launchMode === 'quicknote'
  } catch {
    quick = false
  }
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
  require('./vaultApp.js')
}
