/**
 * Reads the page the user is looking at. Injected on demand, never persistent.
 *
 * This runs in the page's own world, so it sees the document *after* whatever
 * JavaScript built it — which is the whole reason the clipper is an extension
 * rather than something Lumina does by fetching the URL itself.
 *
 * It only ever reads. Nothing here writes to the page, stores anything, or
 * talks to the network; the popup that injected it owns the request to Lumina.
 */
;(() => {
  /** Metadata the page publishes about itself, best source first. */
  function meta(...names) {
    for (const name of names) {
      const el =
        document.querySelector(`meta[property="${name}"]`) ||
        document.querySelector(`meta[name="${name}"]`)
      const value = el && el.getAttribute('content')
      if (value && value.trim()) return value.trim()
    }
    return ''
  }

  /**
   * The selection as markup rather than text, so formatting and links survive.
   *
   * A selection can span several ranges (Ctrl-dragging in Firefox, table cells
   * in Chrome), so every range is taken rather than only the first.
   */
  function selectionHtml() {
    const selection = window.getSelection()
    if (!selection || selection.isCollapsed || !selection.rangeCount) return ''

    const holder = document.createElement('div')
    for (let i = 0; i < selection.rangeCount; i++) {
      holder.appendChild(selection.getRangeAt(i).cloneContents())
    }
    return holder.innerHTML
  }

  /**
   * Readability rewrites the document it is handed, so it gets a clone.
   *
   * Running it on the live document would visibly gut the page the user is
   * still reading.
   */
  function articleHtml() {
    if (typeof Readability !== 'function') return null
    try {
      return new Readability(document.cloneNode(true)).parse()
    } catch {
      return null
    }
  }

  /**
   * Capture the page in one of the four modes.
   *
   * Returns `html: ''` rather than throwing when a mode cannot produce
   * anything — Lumina refuses an empty body-carrying clip, so the popup can
   * report the real reason instead of writing a blank note.
   */
  window.__luminaCapture = function capture(mode) {
    const base = {
      mode,
      url: location.href,
      title: document.title || meta('og:title', 'twitter:title'),
      excerpt: meta('og:description', 'twitter:description', 'description'),
      image: meta('og:image', 'twitter:image'),
      byline: meta('article:author', 'author'),
      siteName: meta('og:site_name'),
      html: '',
      clippedAt: Date.now()
    }

    if (mode === 'bookmark') return base

    if (mode === 'selection') {
      return { ...base, html: selectionHtml() }
    }

    if (mode === 'article') {
      const article = articleHtml()
      if (article && article.content) {
        return {
          ...base,
          title: article.title || base.title,
          byline: article.byline || base.byline,
          excerpt: article.excerpt || base.excerpt,
          siteName: article.siteName || base.siteName,
          html: article.content
        }
      }
      // Readability gives up on pages that are not articles (a dashboard, a
      // search result list). Falling back to the whole body beats failing, and
      // Lumina still strips nav/header/footer for article mode.
      return { ...base, html: document.body ? document.body.innerHTML : '' }
    }

    return { ...base, html: document.body ? document.body.innerHTML : '' }
  }
})()
