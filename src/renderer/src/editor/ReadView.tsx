import { useEffect, useMemo, useRef } from 'react'
import { createFromLink, openNote } from '../lib/actions'
import { renderNoteFragment } from '../lib/render'
import { useEditor } from '../store/editorStore'
import { useSettings } from '../store/settingsStore'
import { useUi } from '../store/uiStore'

/**
 * Where each note was scrolled to in read mode, so toggling back and forth
 * does not throw you to the top. Module-level for the same reason the editor
 * parks its sessions there: the component unmounts on every mode switch.
 */
const scrollTops = new Map<string, number>()

/** A rendered, non-editable view of a note — swapped in for the CodeMirror editor in read mode. */
export default function ReadView({ path }: { path: string }): React.JSX.Element {
  const content = useEditor((s) => s.buffers[path]?.content)
  const host = useRef<HTMLDivElement>(null)

  const html = useMemo(
    () => (content === undefined ? '' : renderNoteFragment(content, path, { live: true })),
    [content, path]
  )

  /* --------------------------------------------------------- scroll memory */
  useEffect(() => {
    const el = host.current
    if (!el) return
    el.scrollTop = scrollTops.get(path) ?? 0
    const onScroll = (): void => void scrollTops.set(path, el.scrollTop)
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [path, html])

  /* ------------------------------------------------- images that guessed wrong */
  // `render.ts` can only guess which folder an image lives in, so it leaves the
  // remaining candidates behind and the first one that loads wins — the same
  // fallback the editor's image widget does.
  useEffect(() => {
    const el = host.current
    if (!el) return
    const images = Array.from(el.querySelectorAll<HTMLImageElement>('img[data-candidates]'))
    const onError = (event: Event): void => {
      const img = event.currentTarget as HTMLImageElement
      let rest: string[] = []
      try {
        rest = JSON.parse(img.dataset.candidates ?? '[]') as string[]
      } catch {
        // Malformed list: nothing left to try.
      }
      const next = rest.shift()
      if (!next) {
        img.removeAttribute('data-candidates')
        return
      }
      img.dataset.candidates = JSON.stringify(rest)
      img.src = `lumina://vault/${next.split('/').map(encodeURIComponent).join('/')}`
    }
    for (const img of images) img.addEventListener('error', onError)
    return () => {
      for (const img of images) img.removeEventListener('error', onError)
    }
  }, [html])

  /* ------------------------------------------------------- link banners */
  // Cards render from the URL alone; when link previews are on, the page's own
  // title, description and thumbnail arrive afterwards and are filled in here.
  // The main process refuses the request outright when the setting is off, so
  // this cannot leak a fetch.
  const linkPreviews = useSettings((s) => s.settings.editor.linkPreviews)
  useEffect(() => {
    const el = host.current
    if (!el || !linkPreviews) return

    let cancelled = false
    for (const card of Array.from(el.querySelectorAll<HTMLElement>('.link-banner[data-url]'))) {
      const url = card.dataset.url as string
      void window.lumina.links.preview(url).then((meta) => {
        if (cancelled || !meta) return

        const title = card.querySelector<HTMLElement>('.link-banner-title[data-from-url]')
        if (meta.title && title) title.textContent = meta.title
        if (meta.description) {
          const fallback = card.querySelector<HTMLElement>('.link-banner-desc[data-fallback]')
          if (fallback) {
            fallback.textContent = meta.description
            delete fallback.dataset.fallback
          } else if (!card.querySelector('.link-banner-desc')) {
            const description = document.createElement('span')
            description.className = 'link-banner-desc'
            description.textContent = meta.description
            card.querySelector('.link-banner-host')?.before(description)
          }
        }
        if (meta.imagePath && !card.querySelector('.link-banner-thumb')) {
          const thumb = document.createElement('img')
          thumb.className = 'link-banner-thumb'
          thumb.src = `lumina://vault/${meta.imagePath.split('/').map(encodeURIComponent).join('/')}`
          thumb.alt = ''
          thumb.addEventListener('error', () => thumb.remove())
          card.querySelector('.link-banner-mark')?.appendChild(thumb)
        }
      })
    }
    return () => {
      cancelled = true
    }
  }, [html, linkPreviews])

  /**
   * Links have to work here too, or read mode is a dead end. The markup comes
   * from `decorate()` in `lib/render.ts`, which tags wikilinks and tags with
   * the data attributes this reads.
   */
  const onClick = (event: React.MouseEvent): void => {
    const target = event.target as HTMLElement | null
    const el = target?.closest<HTMLElement>('a[href], .wikilink, .tag')
    if (!el) return

    if (el.classList.contains('tag')) {
      const tag = el.dataset.tag
      if (!tag) return
      event.preventDefault()
      useUi.getState().setTagFilter(tag)
      useUi.getState().setSearchQuery(`#${tag}`)
      return
    }

    if (el.classList.contains('wikilink')) {
      event.preventDefault()
      const resolved = el.dataset.resolved
      if (resolved) openNote(resolved, { anchor: el.dataset.anchor })
      else void createFromLink(el.dataset.target ?? '', path)
      return
    }

    const href = el.getAttribute('href') ?? ''
    if (href.startsWith('#')) return // in-page anchor; let the browser handle it
    event.preventDefault()
    if (/^(?:https?|mailto):/i.test(href)) void window.lumina.files.openExternal(href)
  }

  return (
    <div className="note-view" ref={host} onClick={onClick}>
      <div className="note-view-content" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  )
}
