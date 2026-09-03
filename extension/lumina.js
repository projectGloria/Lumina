/**
 * Settings shared by the popup and the options page, and the one call to Lumina.
 *
 * `storage.local`, deliberately not `storage.sync`: the token is a secret that
 * grants write access to a vault, and syncing it would copy it to every browser
 * signed into the same account.
 */

const DEFAULTS = {
  port: 41999,
  token: '',
  mode: 'article',
  tags: ''
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS)
  return { ...DEFAULTS, ...stored }
}

async function saveSettings(patch) {
  await chrome.storage.local.set(patch)
}

/**
 * Send one request to Lumina.
 *
 * Always 127.0.0.1 rather than `localhost`: on a machine where `localhost`
 * resolves to ::1 first the connection would go to an address Lumina is not
 * listening on, and the failure would look like the app being closed.
 */
async function callLumina(path, { port, token }, body) {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      'content-type': 'application/json',
      'x-lumina-token': token
    },
    body: body ? JSON.stringify(body) : undefined
  })

  let payload = {}
  try {
    payload = await response.json()
  } catch {
    // A non-JSON body means something other than Lumina answered on this port.
  }

  if (response.status === 401) throw new Error('Lumina rejected the token — check Options')
  if (response.status === 403) throw new Error('Lumina refused the request')
  if (!response.ok) throw new Error(payload.error || `Lumina returned ${response.status}`)
  return payload
}

/** Turn a fetch failure into something that names the actual likely cause. */
function explain(error) {
  if (error instanceof TypeError) {
    return 'Could not reach Lumina — is it running, with the clipper switched on?'
  }
  return error.message || String(error)
}
