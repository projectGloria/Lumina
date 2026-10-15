// Loads the built Quick Note UI with a mocked bridge. Never reads or saves user notes.
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const assert = require('node:assert/strict')
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'lumina-audit-ui-'))
app.setPath('userData', data)
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: {
    preload: path.join(__dirname, 'quicknote-preload.cjs'), sandbox: true, contextIsolation: true
  } })
  try {
    await win.loadFile(path.resolve('out/renderer/quicknote/index.html'))
    const result = await win.webContents.executeJavaScript(`(async () => {
      while (document.querySelector('#editor').disabled) await new Promise(r => setTimeout(r, 20));
      const editor = document.querySelector('#editor');
      const before = editor.value;
      document.querySelectorAll('.tab')[0].click();
      const afterSwitch = editor.value;
      document.querySelector('#undo').click();
      return { before, afterSwitch, afterUndo: editor.value, title: document.querySelector('#title').textContent };
    })()`)
    assert.equal(result.before, 'BRAVO document')
    assert.equal(result.afterSwitch, 'ALPHA document')
    assert.equal(result.afterUndo, 'BRAVO document')
    console.log('CONFIRMED cross-document undo:', JSON.stringify(result))
    const findResult = await win.webContents.executeJavaScript(`(() => {
      const editor = document.querySelector('#editor');
      editor.value = 'cat dog';
      editor.dispatchEvent(new Event('input'));
      document.querySelector('#find-btn').click();
      const query = document.querySelector('#find-query');
      query.value = 'dog'; query.dispatchEvent(new Event('input'));
      document.querySelector('#find-next').click();
      editor.focus(); editor.setSelectionRange(0, 0);
      document.execCommand('insertText', false, 'XX');
      const beforeReplace = editor.value;
      document.querySelector('#replace-text').value = 'fox';
      document.querySelector('#replace-one-btn').click();
      return { beforeReplace, afterReplace: editor.value };
    })()`)
    assert.equal(findResult.beforeReplace, 'XXcat dog')
    assert.equal(findResult.afterReplace, 'XXcafoxog')
    console.log('CONFIRMED replacement at stale offsets:', JSON.stringify(findResult))
  } catch (error) { console.error(error); process.exitCode = 1 }
  finally { win.destroy(); app.exit(process.exitCode || 0) }
})
