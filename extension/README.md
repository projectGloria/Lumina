# Lumina Web Clipper

Clips the page you are reading into your Lumina vault, as Markdown, on your own
machine. Nothing is uploaded anywhere — the extension talks only to Lumina on
`127.0.0.1`.

## Install

The extension is not on any store yet, so it is loaded unpacked.

**Chrome / Edge / Brave**

1. Open `chrome://extensions` (`edge://extensions`).
2. Turn on **Developer mode**.
3. **Load unpacked**, and pick this `extension/` folder.

**Firefox**

1. Open `about:debugging#/runtime/this-firefox`.
2. **Load Temporary Add-on**, and pick `manifest.json` in this folder.

Firefox forgets a temporary add-on when it restarts; Chrome keeps an unpacked
one until you remove it.

## Connect it to Lumina

1. In Lumina: **Settings → Web clipper → Accept clips**. Switching it on mints a
   token and opens the listener on `127.0.0.1:41999`.
2. Copy the token (there is a **Copy** button next to it).
3. In the browser: right-click the extension icon → **Options**, paste the token,
   **Save**, then **Test connection**.

If the test fails it says which of the three things is wrong — Lumina not
running, the clipper switched off, or the token not matching.

## Clipping

Click the toolbar icon (or press `Ctrl+Shift+L`) and pick a mode:

| Mode | What you get |
| --- | --- |
| **Article** | Just the readable body — navigation, ads and comments stripped. |
| **Selection** | Whatever you highlighted, saved as a quotation. |
| **Full page** | The whole document, nothing stripped. |
| **Bookmark** | Title, link and the page's own summary. No body. |

Tags and a short note are optional; tags are remembered between clips, the note
is not. The clip lands in the folder set in Lumina's settings (`Clippings` by
default) with the source URL, author and date in its frontmatter.

Lumina does not have to be in the foreground. If it is closed to the tray a clip
still lands; if it is sitting on the profile picker or a passlock, the clip waits
until you are in, and is written the moment a vault opens.

## What it can reach

- `activeTab` and `scripting` rather than a content script on every page: the
  extension can read a page **only** in the moment you click the button, and not
  before or after.
- `http://127.0.0.1/*` — Lumina, and nothing else.
- `storage` — the port and token, in `storage.local` so the token is never
  synced to your browser account.

Browser-internal pages (`chrome://`, the Web Store, `about:`) cannot be scripted
by any extension, so those cannot be clipped.

## If something goes wrong

**"Could not reach Lumina"** — Lumina is not running, or the clipper is off.
Check **Settings → Web clipper**; the panel says whether it is actually
listening, and names the port if something else already has it.

**"Lumina rejected the token"** — the token was regenerated in Lumina. Copy the
new one into Options. Regenerating deliberately locks out any browser still
holding the old one.

**"Nothing is selected on the page"** — Selection mode with no selection.

**"Found no content to clip"** — Article mode on a page with no article. Try
Full page.
