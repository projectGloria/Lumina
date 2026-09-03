/**
 * The clip popup.
 *
 * It injects `capture.js` only when the user actually clips, which is why the
 * manifest asks for `activeTab` and `scripting` rather than a content script on
 * every page: the extension has no access to anything until the toolbar button
 * is pressed, and none afterwards.
 */

const modes = Array.from(document.querySelectorAll('.mode'))
const tagsInput = document.getElementById('tags')
const remarkInput = document.getElementById('remark')
const clipButton = document.getElementById('clip')
const statusLine = document.getElementById('status')

let settings = null
let mode = 'article'

function setStatus(text, kind = '') {
  statusLine.textContent = text
  statusLine.className = `status ${kind}`
}

function selectMode(next) {
  mode = next
  for (const button of modes) {
    const on = button.dataset.mode === next
    button.classList.toggle('on', on)
    button.setAttribute('aria-checked', String(on))
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  return tab
}

/**
 * Run the capture in the page and hand back what it found.
 *
 * Two injections rather than one: the first loads Readability and the capture
 * helper into the page, the second calls it. `executeScript` cannot both load
 * files and call a function with arguments in a single call.
 */
async function capture(tabId, which) {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['vendor/Readability.js', 'capture.js']
  })
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (m) => window.__luminaCapture(m),
    args: [which]
  })
  return result && result.result
}

async function clip() {
  clipButton.disabled = true
  setStatus('Clipping…')

  try {
    const tab = await activeTab()
    if (!tab || !tab.id) throw new Error('No page to clip')
    if (!/^https?:/.test(tab.url || '')) {
      // Browser-internal pages cannot be scripted, and saying so is friendlier
      // than the permission error Chrome would produce.
      throw new Error('This page cannot be clipped')
    }

    const payload = await capture(tab.id, mode)
    if (!payload) throw new Error('Nothing came back from the page')
    if (mode !== 'bookmark' && !payload.html) {
      throw new Error(
        mode === 'selection' ? 'Nothing is selected on the page' : 'Found no content to clip'
      )
    }

    const tags = tagsInput.value
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)

    await callLumina('/clip', settings, { ...payload, tags, remark: remarkInput.value.trim() })

    // The tags are worth keeping between clips; the remark never is.
    await saveSettings({ mode, tags: tagsInput.value })
    setStatus('Saved to Lumina', 'ok')
    setTimeout(() => window.close(), 700)
  } catch (error) {
    setStatus(explain(error), 'bad')
    clipButton.disabled = false
  }
}

async function init() {
  settings = await loadSettings()
  selectMode(settings.mode)
  tagsInput.value = settings.tags

  const tab = await activeTab()
  document.getElementById('page-title').textContent = (tab && tab.title) || ''

  if (!settings.token) {
    setStatus('No token set yet — open Options', 'bad')
  }

  for (const button of modes) {
    button.addEventListener('click', () => selectMode(button.dataset.mode))
  }
  clipButton.addEventListener('click', clip)
  document.getElementById('options').addEventListener('click', (event) => {
    event.preventDefault()
    chrome.runtime.openOptionsPage()
  })

  // Enter clips from anywhere except the remark box, where it means a newline.
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && event.target !== remarkInput) {
      event.preventDefault()
      void clip()
    }
  })
}

void init()
