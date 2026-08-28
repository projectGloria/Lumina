import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Notes written into a brand-new vault.
 *
 * They exist so the first launch is not an empty window: the file tree, the
 * backlinks panel and the graph all have something real to show, and the
 * shortcuts are documented inside the app itself.
 */
export const STARTER: Record<string, string> = {
  'Welcome.md': `---
title: Welcome to Lumina
aliases: [Welcome to Lumina, Start here]
tags: [lumina, start-here]
---

# Welcome to Lumina

Lumina is a local note app. Every note here is an ordinary markdown file in a
folder you chose — no account, no sync, no database. Open that folder in any
other editor and the notes are still there.

Three things worth trying right now:

- Press **Ctrl+P** and type a few letters to jump to any note.
- Type \`[[\` anywhere to link to another note. Try linking to [[Shortcuts]].
- Press **Ctrl+,** to open settings and change the accent colour.

## Where to go next

- [[Shortcuts]] — the full keyboard map
- [[Customizing Lumina]] — themes, fonts, and your own CSS
- [[How linking works]] — wikilinks, backlinks, and the graph

Everything below the surface is plain text. This paragraph has **bold**,
*italic*, ~~strikethrough~~ and \`inline code\`. Notice that the markdown
markers only appear on the line your cursor is on — that is live preview.

> [!note] Callouts
> Blocks like this one are styled callouts. Try \`[!tip]\`, \`[!warning]\`
> and \`[!quote]\` too.

- [ ] Click this checkbox to tick it off
- [x] Already done

Tag a note by writing #inbox or #project/gloria anywhere in the body.

There is a scratch note at [[Project Gloria]] so the graph has something to
draw. Delete it, and these four, whenever you like — they are only files.
`,

  'Getting Started/Shortcuts.md': `---
title: Shortcuts
tags: [lumina, reference]
---

# Shortcuts

## Navigation

| Keys | Action |
| --- | --- |
| Ctrl+P | Quick switcher — jump to a note by name |
| Ctrl+Shift+P | Command palette — every command in the app |
| Ctrl+Shift+F | Search the whole vault |
| Ctrl+G | Graph view |
| Alt+Left / Alt+Right | Back and forward through history |
| Ctrl+Tab | Next tab |

## Notes

| Keys | Action |
| --- | --- |
| Ctrl+N | New note |
| Ctrl+D | Open today's daily note |
| Ctrl+S | Save now (Lumina also autosaves) |
| Ctrl+W | Close tab |
| F2 | Rename the current note |

## Writing

| Keys | Action |
| --- | --- |
| Ctrl+B | Bold |
| Ctrl+I | Italic |
| Ctrl+K | Link |
| Ctrl+Enter | Toggle a task checkbox |
| Tab / Shift+Tab | Indent or outdent a list item |

## View

| Keys | Action |
| --- | --- |
| Ctrl+, | Settings |
| Ctrl+Shift+M | Focus mode — hide all chrome |
| Ctrl+\\\\ | Toggle the left sidebar |
| Ctrl+Shift+\\\\ | Toggle the right sidebar |

Every one of these can be rebound in Settings → Hotkeys.

Back to [[Welcome to Lumina]].
`,

  'Getting Started/Customizing Lumina.md': `---
title: Customizing Lumina
tags: [lumina, reference, theming]
---

# Customizing Lumina

Lumina ships looking like the Claude interface: warm paper background, clay
accent, serif headings, generous whitespace. None of that is hardcoded.

## The theme editor

Settings → Appearance gives you a colour picker for every design token, plus
controls for font family, size, line height, editor width and corner radius.
Changes apply live as you drag. Presets sit at the top if you would rather
start from something else.

Your edits are stored in \`.lumina/theme.json\` inside the vault, so a theme
travels with the notes it was made for.

## Your own CSS

Drop a \`.css\` file into \`.lumina/snippets/\` and Lumina loads it immediately —
no restart. Toggle individual snippets on and off in Settings → Appearance.

Every colour, font and dimension in the app is a CSS variable on \`:root\`,
named \`--lum-something\`. A snippet as small as this changes the accent
everywhere it appears:

    :root { --lum-accent: #4a7c59; }

Open the snippets folder from Settings, or find it yourself next to your notes.

See also [[Shortcuts]] and [[How linking works]].
`,

  'Getting Started/How linking works.md': `---
title: How linking works
tags: [lumina, reference]
---

# How linking works

Type \`[[\` and Lumina suggests notes as you go. Accept one and you get a link
like [[Welcome to Lumina]]. Links can carry a different display text with a
pipe: [[Shortcuts|the keyboard map]].

Link to a note that does not exist yet and the link renders faded. Click it and
Lumina creates the note for you — writing first, filing later.

## Backlinks

Open any note and the right sidebar lists every note pointing at it, with the
surrounding line for context. This note is linked from [[Welcome to Lumina]]
and [[Customizing Lumina]], so both appear there.

## The graph

Press Ctrl+G for the graph. Each note is a dot, each link a line, and dots grow
with the number of connections. It is a map of how your thinking actually
joined up, which is usually not how you planned it.

## Embeds

Prefix a link with an exclamation mark to embed the target instead of linking
to it. Images work the same way — drag one into a note and Lumina copies it
into your attachments folder.
`,

  'Ideas/Project Gloria.md': `---
title: Project Gloria
tags: [project/gloria, inbox]
---

# Project Gloria

A scratch note, here so the graph has something to draw. Delete it whenever.

Related: [[Welcome to Lumina]]

- [ ] Decide what Gloria actually is
- [ ] Write it down here
- [x] Install a note app
`
}

/** True when the folder has no markdown in it yet. */
export async function isEmptyVault(dir: string): Promise<boolean> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    return !entries.some(
      (e) => (e.isFile() && e.name.toLowerCase().endsWith('.md')) || (e.isDirectory() && !e.name.startsWith('.'))
    )
  } catch {
    return false
  }
}

/** Write the starter notes. Never overwrites a file that already exists. */
export async function seedVault(dir: string): Promise<void> {
  for (const [rel, content] of Object.entries(STARTER)) {
    const abs = path.join(dir, rel)
    try {
      await fs.mkdir(path.dirname(abs), { recursive: true })
      await fs.writeFile(abs, content, { encoding: 'utf8', flag: 'wx' })
    } catch {
      // Already there — leave the user's version alone.
    }
  }
}
