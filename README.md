<div align="center">

<img src="resources/icon.png" alt="Lumina Logo" width="128" height="128" />

# Lumina

**A local-first, Claude-styled personal knowledge workspace crafted for Windows**

*Thoughtful writing, connected thinking, and instant capture — powered by Electron, TypeScript, React, and CodeMirror.*

<p>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-00B074.svg?style=flat-square" alt="License: MIT" /></a>
  <img src="https://img.shields.io/badge/Platform-Windows%20x64-0078D4.svg?style=flat-square&logo=windows" alt="Platform: Windows x64" />
  <img src="https://img.shields.io/badge/Electron-43-47848F.svg?style=flat-square&logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/React-19-61DAFB.svg?style=flat-square&logo=react" alt="React" />
  <img src="https://img.shields.io/badge/CodeMirror-6-black.svg?style=flat-square&logo=codemirror" alt="CodeMirror 6" />
  <img src="https://img.shields.io/badge/Telemetry-None%20%7C%20Local--First-success.svg?style=flat-square" alt="Telemetry Disabled" />
</p>

---

<p>
  <a href="#-about-lumina">About</a> •
  <a href="#-key-features">Key Features</a> •
  <a href="#️-application-suite">Application Suite</a> •
  <a href="#️-modular-home-dashboard">Home Dashboard</a> •
  <a href="#-web-clipper">Web Clipper</a> •
  <a href="#-installation--usage">Installation</a> •
  <a href="#️-building-from-source">Building</a> •
  <a href="#-icon--design-philosophy">Design</a> •
  <a href="#-license--credits">License</a>
</p>

<table>
  <tr>
    <td align="center" width="50%">
      <img src="resources/icon.png" alt="Lumina Vault" width="64" height="64" /><br />
      <b>Lumina Vault</b><br />
      <sub>The interconnected thinking sanctum &amp; home dashboard</sub>
    </td>
    <td align="center" width="50%">
      <img src="resources/quicknote-icon.png" alt="Lumina Quick Note" width="64" height="64" /><br />
      <b>Lumina Quick Note</b><br />
      <sub>Instant scratchpad &amp; tabbed editor for standalone files</sub>
    </td>
  </tr>
</table>

</div>

---

## 🌿 About Lumina

**Lumina** is a private, local-first knowledge base and dual-application workspace tailored for thinkers, writers, and developers who value calm aesthetics and complete digital sovereignty. Inspired by the warm typography and gentle, distraction-free environment of Claude, Lumina treats your thoughts as enduring artifacts on your filesystem — stored in plain Markdown with zero cloud lock-in.

Lumina brings together a deep personal vault with a blazing-fast companion text editor under a single intelligent runtime:

- 🏛️ **Independent Windows Desktop Application**: Seamless Windows integration with custom taskbar identity, system tray support, dedicated user data partitions, and "Open with" file associations for markdown, text, config, and source-code formats.
- 🔒 **Zero Telemetry, No Cloud**: Your notes live only on your disk. No telemetry, no accounts, no cloud sync. The only outbound requests are link previews for URLs in your notes (on by default; turn off under **Settings → Editor**) and the pages and images you choose to clip.
- ⚡ **Intelligent Dual-Engine Dispatch**: Double-clicking a markdown note inside an indexed vault opens **Lumina Vault**; opening any standalone text document, script, or external file launches **Quick Note** instantly without waiting for vault indexing.
- 📖 **Human-Centric Markdown Architecture**: Every document is pure plain text formatted with Markdown and YAML frontmatter. Open and edit your files anytime in any text editor.

---

## ✨ Key Features

<table>
  <tr>
    <td width="50%">
      <h3>📝 Live-Preview Markdown</h3>
      <p>Powered by <b>CodeMirror 6</b> with smooth in-place formatting, syntax highlighting, callouts, task checkboxes, tables, and distraction-free typography.</p>
    </td>
    <td width="50%">
      <h3>🕸️ Connected Thought &amp; Graph</h3>
      <p>Link ideas seamlessly with <code>[[wikilinks]]</code>, backlinks exploration, and an interactive <b>D3 force-directed knowledge graph</b> visualizing connections.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>🎛️ Modular Home Dashboard</h3>
      <p>Start your day with a customizable widget board featuring GitHub-style contribution heatmaps, daily journals, tasks, calendars, and scratchpads.</p>
    </td>
    <td width="50%">
      <h3>⚡ Instant Quick Note Companion</h3>
      <p>Sub-second cold startup, multi-tab editing, a line-number gutter, and non-destructive session restoration for transient thoughts.</p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <h3>🎵 Ambient Audio &amp; Offline Voice</h3>
      <p>Integrated background music player with byte-range streaming &amp; ID3 artwork parsing, plus offline voice recording and local speech-to-text dictation.</p>
    </td>
    <td width="50%">
      <h3>🛡️ Security, Passlock &amp; Privacy</h3>
      <p>Optional per-profile passlock, a loopback-only clipper listener, sandboxed Electron renderers, and traversal-guarded filesystem access. The passlock locks the app's UI only; it does <b>not</b> encrypt your notes, which stay plain files on disk.</p>
    </td>
  </tr>
</table>

---

## 🗂️ Application Suite

Lumina ships as an integrated ecosystem containing two specialized desktop modes and a companion web extension:

### 1. Lumina Vault (Core Knowledge Hub)

<p align="center">
  <img src="resources/icon.png" alt="Lumina Vault Icon" width="96" height="96" />
</p>

Designed for sustained contemplation, deep research, and long-form writing:
- **Bi-Directional Wikilinks**: Autocomplete notes with `[[` and discover inbound backlinks across your entire vault.
- **Interactive Knowledge Graph**: Explore clusters of ideas in a force-directed map of every note and the links between them.
- **Full-Text Instant Search**: Lightning-fast keyword and fuzzy search powered by MiniSearch, indexing note content, headings, and tags.
- **Profiles & Multiple Vaults**: Switch seamlessly between distinct vaults (e.g. *Personal*, *Work*, *Research*) with isolated configuration and custom theme overrides.

---

### 2. Lumina Quick Note (Frictionless Editor)

<p align="center">
  <img src="resources/quicknote-icon.png" alt="Lumina Quick Note Icon" width="96" height="96" />
</p>

A lightweight, dedicated desktop scratchpad and general text editor:
- **Sub-Second Launch**: Bypasses the main vault indexer to open individual text files (`.txt`, `.md`, `.json`, `.yml`, `.py`, `.js`, etc.) instantly.
- **Multi-Tab Buffer System**: Work across multiple open buffers simultaneously with dirty-buffer indicators and non-destructive atomic saving.
- **Automatic Session Restoration**: Any unsaved scratch notes or drafts are preserved across reboots via debounced background session caching.
- **Zero Overhead**: Minimal memory footprint, separate `%APPDATA%\lumina-quicknote` runtime, and independent single-instance lock.

---

## 🎛️ Modular Home Dashboard

Lumina's Vault view opens into a welcoming, customizable dashboard designed to orient your day:

| Widget | Description |
| --- | --- |
| 🟩 **Activity Heatmap** | Visualizes daily editing frequency across the vault in a GitHub-inspired grid. |
| 📅 **Daily Note &amp; Calendar** | Single-click jumping to today's daily log with calendar date navigation and previous entry lookup. |
| ⏳ **On This Day** | Surfaces journal entries and notes created on this exact calendar date in previous years. |
| ✅ **Aggregated Tasks** | Automatically aggregates uncompleted Markdown task items (`- [ ]`) across all vault documents into a centralized checklist. |
| 🎶 **Ambient Music Player** | Plays local audio files directly inside Lumina with ID3 album art extraction and volume controls. |
| 📌 **Recent &amp; Starred** | Instant access to your frequently touched files, pinned notes, and categorized tag clouds. |

---

## 🌐 Web Clipper

Clip anything you read on the web directly into your local Lumina vault as clean Markdown.

<p align="center">
  <b>Chrome</b> • <b>Edge</b> • <b>Brave</b> • <b>Firefox</b>
</p>

- **Local-Only Communication**: The extension communicates exclusively with Lumina's local HTTP listener on `127.0.0.1:41999`. Nothing ever leaves your machine.
- **Authenticated Bridge**: Protected by a unique local authorization token minted inside Lumina's **Settings → Web Clipper** panel.
- **Queueing When Locked**: Clips sent while Lumina is on the profile picker or passlocked wait, and land in your vault the moment you unlock. Lumina has to be running (closing it to the tray is fine); a clip sent while it is fully closed fails with "Could not reach Lumina".

### Clipping Modes

| Mode | Output |
| --- | --- |
| **Article** | Cleansed article body with ads, navigation, and clutter stripped away via Readability. |
| **Selection** | Captures the highlighted text snippet formatted as a Markdown blockquote. |
| **Full Page** | Preserves the entire page structure and content converted to GitHub Flavored Markdown. |
| **Bookmark** | Saves the title, URL, author, and site as frontmatter, plus the page's own summary as a quote, with no page body. |

*To install the clipper, see instructions in the [extension/ directory](extension/README.md).*

---

## 🚀 Installation & Usage

### Windows Installer

Run the generated 64-bit Windows setup executable:

```powershell
release/Lumina-0.1.0-x64.exe
```

Upon installation, Lumina configures:
- Start Menu and Desktop shortcuts for **Lumina** and **Lumina Quick Note**, with high-resolution app icons.
- Isolated user data directories:
  - `%APPDATA%\Lumina` (Vault workspace & preferences)
  - `%APPDATA%\lumina-quicknote` (Quick Note cache & session buffers)
- Two apps Windows can offer under "Open with" and in Settings > Default apps: **Lumina** for markdown, and **Lumina Quick Note** (`Lumina Quick Note.exe`, a small launcher next to `Lumina.exe`) for every supported text, config, data and source-code type, markdown included. Neither takes over an existing default; pick one with Open with → Always.
- An "Open with Lumina Quick Note" right-click entry on those types (under "Show more options" on Windows 11).

### Command-Line Usage

The installer doesn't add Lumina to `PATH`, so call the executable by its full path. A per-user install goes to `%LOCALAPPDATA%\Programs\Lumina` unless you picked another folder. Pass files, not folders: a folder argument is ignored and Lumina opens your last vault.

```powershell
# Open Lumina Vault (your last-opened vault)
& "$env:LOCALAPPDATA\Programs\Lumina\Lumina.exe"

# A markdown note inside a vault opens in Vault; any other text file opens in Lumina Quick Note
& "$env:LOCALAPPDATA\Programs\Lumina\Lumina.exe" C:\Notes\PersonalVault\Ideas.md
& "$env:LOCALAPPDATA\Programs\Lumina\Lumina.exe" C:\Projects\script.py

# Open Lumina Quick Note directly (either form; the launcher just adds --quicknote)
& "$env:LOCALAPPDATA\Programs\Lumina\Lumina Quick Note.exe" C:\Projects\notes.txt
& "$env:LOCALAPPDATA\Programs\Lumina\Lumina.exe" --quicknote
```

---

## 🛠️ Building from Source

### Prerequisites

Ensure you have the following installed on your machine:
- **Node.js** (v22 or later)
- **npm** (v10 or later)
- **Windows PowerShell 5.1** (built into Windows; `npm run release` runs `scripts/verify-release.ps1` with it)
- **PowerShell 7+** (`pwsh`), only if you want to run `scripts/fetch-speech-packs.ps1` to bundle offline speech packs

No native modules are compiled, so you don't need the Visual Studio C++ Build Tools.

### Development & Build Steps

1. **Clone the repository:**
   ```powershell
   git clone https://github.com/projectGloria/Lumina.git
   cd Lumina
   ```

2. **Install dependencies:**
   ```powershell
   npm install
   ```

3. **Start in development mode:**
   ```powershell
   # Launch Lumina Vault
   npm run dev

   # Launch Lumina Quick Note
   npm run dev:quicknote
   ```

4. **Run the automated test suite:**
   ```powershell
   npm test
   ```

5. **Package production binaries for Windows:**
   ```powershell
   npm run release
   ```
   This compiles the Electron application, builds the NSIS installer and the portable executable into `release/`, and runs `scripts/verify-release.ps1`. That script requires a valid Authenticode signature, checks each artifact's version metadata, prints its SHA-256 hash, and confirms `app.asar` contains the built entry points.

   A local build is unsigned, so the signature check fails. To verify an unsigned build, allow it explicitly:
   ```powershell
   $env:LUMINA_ALLOW_UNSIGNED = '1'; npm run release
   ```
   To build the installer without verifying, run `npm run build:win`.

---

## 🎨 Icon & Design Philosophy

<p align="center">
  <img src="resources/icon.png" alt="Lumina Vault Icon" width="100" height="100" />
  &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
  <img src="resources/quicknote-icon.png" alt="Lumina Quick Note Icon" width="100" height="100" />
</p>

> *"Warm terracotta tones, refined humanist serif headings, and serene, distraction-free spatial composition."*

Lumina was designed around the idea that digital writing tools should feel as calm, warm, and inviting as a quiet study:
- **Warm Terracotta & Sandstone**: Inspired by the warm Claude color palette, eliminating harsh bright whites and high-contrast blacks in favor of restful tones.
- **Typographic Precision**: Thoughtful font pairing and generous line height for effortless long-form reading and editing.
- **Spatial Focus**: Focus mode hides the sidebars so only your writing is left (press `Esc` to leave it).
- **Distinct Dual Identity**:
  - **Lumina Vault Icon**: An engraved silver serif "L" entwined with a quill and fountain-pen nib on deep royal blue, for considered, long-form writing.
  - **Quick Note Icon**: The same engraved quill-and-nib treatment curled into a "Q" on vivid orange, a bright companion built for fast capture.

---

## 📜 License & Credits

Lumina is open-source software licensed under the **[MIT License](LICENSE)**. Third-party code keeps its own license: `extension/vendor/Readability.js` is Mozilla's Readability under the Apache License 2.0 (see its header).

### Open-Source Acknowledgments

Lumina is built upon incredible open-source foundations:
- [CodeMirror 6](https://codemirror.net/) — Next-generation modular text editor engine.
- [Electron](https://www.electronjs.org/) & [electron-vite](https://electron-vite.org/) — Desktop runtime and rapid build tooling.
- [React 19](https://react.dev/) & [Zustand](https://github.com/pmndrs/zustand) — Reactive user interface and ergonomic state management.
- [D3.js](https://d3js.org/) — Force-directed layout algorithms powering the Knowledge Graph.
- [Turndown](https://github.com/mixmark-io/turndown) & [Readability](https://github.com/mozilla/readability) — Clean HTML-to-Markdown conversion for web clipping.

---

<div align="center">
  <sub>Crafted with care by Nihil. Made for mindful thinkers.</sub>
</div>
