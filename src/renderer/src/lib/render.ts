/** Markdown to standalone HTML, used only by the export commands. */
import { marked } from 'marked'
import { parseFrontmatter, resolveLink } from '@shared/markdown-parse'
import { aliasMap, knownPaths, titleOf } from '../store/vaultStore'

/** Rewrite wikilinks and tags into plain HTML before handing over to marked. */
function preprocess(md: string, fromPath: string): string {
  const paths = knownPaths()
  const aliases = aliasMap()
  return md
    .replace(/!?\[\[([^[\]\n]+?)\]\]/g, (_m, inner: string) => {
      const [targetPart, alias] = inner.split('|')
      const target = targetPart.split(/[#^]/)[0].trim()
      const resolved = resolveLink(target, fromPath, paths, aliases)
      const label = alias?.trim() || (resolved ? titleOf(resolved) : target)
      return `<span class="wikilink${resolved ? '' : ' unresolved'}">${escapeHtml(label)}</span>`
    })
    .replace(/(^|[^\w`/])#([A-Za-z][\w/-]*)/g, (_m, lead: string, tag: string) =>
      `${lead}<span class="tag">#${escapeHtml(tag)}</span>`
    )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string
  )
}

/** Snapshot the live theme so the export looks like what is on screen. */
function currentTokens(): string {
  const style = getComputedStyle(document.documentElement)
  const names = [
    'bg', 'surface', 'surface-hover', 'border', 'text', 'text-muted', 'text-faint',
    'accent', 'accent-soft', 'link', 'link-unresolved', 'tag-bg', 'tag-text',
    'code-bg', 'code-text', 'quote-border', 'hr', 'mark-bg',
    'font-ui', 'font-serif', 'font-mono', 'font-size', 'line-height', 'radius'
  ]
  return names
    .map((n) => `--lum-${n}: ${style.getPropertyValue(`--lum-${n}`).trim()};`)
    .join('\n    ')
}

export function renderToHtml(markdownSource: string, path: string): string {
  const { data, body } = parseFrontmatter(markdownSource)
  const title = (typeof data.title === 'string' && data.title) || titleOf(path)
  const html = marked.parse(preprocess(body, path), { async: false, gfm: true, breaks: false })

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  :root {
    ${currentTokens()}
  }
  body {
    margin: 0;
    padding: 3rem 1.5rem 6rem;
    background: var(--lum-bg);
    color: var(--lum-text);
    font-family: var(--lum-font-ui);
    font-size: var(--lum-font-size);
    line-height: var(--lum-line-height);
  }
  main { max-width: 46rem; margin: 0 auto; }
  h1, h2, h3, h4, h5, h6 { font-family: var(--lum-font-serif); font-weight: 600; line-height: 1.3; margin: 1.8em 0 0.6em; }
  h1 { font-size: 1.85em; margin-top: 0; }
  h2 { font-size: 1.45em; }
  h3 { font-size: 1.22em; }
  p, ul, ol, blockquote, pre, table { margin: 0 0 1.1em; }
  a { color: var(--lum-link); }
  code { font-family: var(--lum-font-mono); font-size: 0.88em; background: var(--lum-code-bg); color: var(--lum-code-text); padding: 0.12em 0.36em; border-radius: 5px; }
  pre { background: var(--lum-code-bg); padding: 1em 1.2em; border-radius: var(--lum-radius); overflow-x: auto; }
  pre code { background: none; color: inherit; padding: 0; }
  blockquote { border-left: 3px solid var(--lum-quote-border); margin-left: 0; padding-left: 1.2em; color: var(--lum-text-muted); font-style: italic; }
  hr { border: none; border-top: 1px solid var(--lum-hr); margin: 2.4em 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid var(--lum-border); padding: 0.5em 0.75em; text-align: left; }
  th { background: var(--lum-surface-hover); }
  img { max-width: 100%; border-radius: var(--lum-radius); }
  mark { background: var(--lum-mark-bg); }
  .wikilink { color: var(--lum-link); }
  .wikilink.unresolved { color: var(--lum-link-unresolved); }
  .tag { background: var(--lum-tag-bg); color: var(--lum-tag-text); border-radius: 999px; padding: 0.08em 0.55em; font-size: 0.86em; }
  ul li::marker { color: var(--lum-accent); }
  @media print { body { padding: 0; } }
</style>
</head>
<body><main>${html}</main></body>
</html>`
}
