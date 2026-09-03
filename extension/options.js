/** Port and token, plus a reachability check that names the actual problem. */

const portInput = document.getElementById('port')
const tokenInput = document.getElementById('token')
const statusLine = document.getElementById('status')

function setStatus(text, kind = '') {
  statusLine.textContent = text
  statusLine.className = `status ${kind}`
}

function current() {
  return {
    port: Number(portInput.value) || 41999,
    token: tokenInput.value.trim()
  }
}

async function save() {
  const settings = current()
  if (!settings.token) {
    setStatus('Paste the token from Lumina first', 'bad')
    return
  }
  await saveSettings(settings)
  setStatus('Saved', 'ok')
}

/**
 * `/ping` needs the token too, so the three failures a user actually hits —
 * Lumina closed, clipper off, wrong token — read differently instead of all
 * looking like "could not connect".
 */
async function test() {
  setStatus('Checking…')
  try {
    await callLumina('/ping', current())
    setStatus('Lumina answered — the clipper is ready', 'ok')
  } catch (error) {
    setStatus(explain(error), 'bad')
  }
}

async function init() {
  const settings = await loadSettings()
  portInput.value = settings.port
  tokenInput.value = settings.token

  document.getElementById('save').addEventListener('click', save)
  document.getElementById('test').addEventListener('click', test)
}

void init()
