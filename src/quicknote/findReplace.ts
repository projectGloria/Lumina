export interface FindReplaceOptions {
  caseSensitive: boolean
  wholeWord: boolean
  useRegex: boolean
}

export interface MatchRange {
  start: number
  end: number
}

export class FindReplaceController {
  private container: HTMLElement
  private editor: HTMLTextAreaElement
  private highlightsEl: HTMLElement | null = null
  private backdropEl: HTMLElement | null = null
  private onDraftChange: () => void

  private queryInput: HTMLInputElement
  private replaceInput: HTMLInputElement
  private countLabel: HTMLElement
  private caseBtn: HTMLButtonElement
  private wordBtn: HTMLButtonElement
  private regexBtn: HTMLButtonElement

  private options: FindReplaceOptions = {
    caseSensitive: false,
    wholeWord: false,
    useRegex: false
  }

  private matches: MatchRange[] = []
  private currentIndex = -1
  private isOpen = false
  private hasSelectedMatch = false

  constructor(container: HTMLElement, editor: HTMLTextAreaElement, onDraftChange: () => void) {
    this.container = container
    this.editor = editor
    this.onDraftChange = onDraftChange

    this.container.innerHTML = `
      <div class="find-replace-inner">
        <div class="find-row">
          <div class="find-input-wrap">
            <span class="find-icon">🔍</span>
            <input type="text" id="find-query" placeholder="Find in note…" spellcheck="false" autocomplete="off">
            <span id="find-count" class="find-count"></span>
          </div>
          <button id="find-prev" class="find-btn" title="Previous match (Shift+Enter)">↑</button>
          <button id="find-next" class="find-btn" title="Next match (Enter)">↓</button>
          <div class="find-options">
            <button id="find-opt-case" class="find-toggle-btn" title="Match Case (Alt+C)">Aa</button>
            <button id="find-opt-word" class="find-toggle-btn" title="Match Whole Word (Alt+W)">\\b</button>
            <button id="find-opt-regex" class="find-toggle-btn" title="Use Regular Expression (Alt+R)">.*</button>
          </div>
          <button id="find-close" class="find-btn close-btn" title="Close (Escape)">×</button>
        </div>
        <div class="replace-row" id="replace-row">
          <div class="find-input-wrap">
            <span class="find-icon">⇄</span>
            <input type="text" id="replace-text" placeholder="Replace with…" spellcheck="false" autocomplete="off">
          </div>
          <button id="replace-one-btn" class="find-action-btn" title="Replace current match">Replace</button>
          <button id="replace-all-btn" class="find-action-btn" title="Replace all occurrences">Replace All</button>
        </div>
      </div>
    `

    this.queryInput = this.container.querySelector('#find-query')!
    this.replaceInput = this.container.querySelector('#replace-text')!
    this.countLabel = this.container.querySelector('#find-count')!
    this.caseBtn = this.container.querySelector('#find-opt-case')!
    this.wordBtn = this.container.querySelector('#find-opt-word')!
    this.regexBtn = this.container.querySelector('#find-opt-regex')!

    this.highlightsEl = document.querySelector('#highlights')
    this.backdropEl = document.querySelector('#backdrop')

    this.wireEvents()
  }

  private wireEvents(): void {
    // While typing, only calculate matches, update highlights and count. Never steal focus!
    this.queryInput.addEventListener('input', () => {
      this.hasSelectedMatch = false
      this.search(false)
    })

    this.queryInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        if (e.shiftKey) {
          this.findPrev()
        } else {
          if (!this.hasSelectedMatch) {
            this.highlightCurrent()
          } else {
            this.findNext()
          }
        }
      } else if (e.key === 'Escape') {
        this.close()
      }
    })

    this.replaceInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault()
        this.replaceCurrent()
      } else if (e.key === 'Escape') {
        this.close()
      }
    })

    this.container.querySelector('#find-prev')!.addEventListener('click', () => this.findPrev())
    this.container.querySelector('#find-next')!.addEventListener('click', () => {
      if (!this.hasSelectedMatch) {
        this.highlightCurrent()
      } else {
        this.findNext()
      }
    })
    this.container.querySelector('#replace-one-btn')!.addEventListener('click', () => this.replaceCurrent())
    this.container.querySelector('#replace-all-btn')!.addEventListener('click', () => this.replaceAll())
    this.container.querySelector('#find-close')!.addEventListener('click', () => this.close())

    this.caseBtn.addEventListener('click', () => {
      this.options.caseSensitive = !this.options.caseSensitive
      this.caseBtn.classList.toggle('active', this.options.caseSensitive)
      this.hasSelectedMatch = false
      this.search(false)
    })

    this.wordBtn.addEventListener('click', () => {
      this.options.wholeWord = !this.options.wholeWord
      this.wordBtn.classList.toggle('active', this.options.wholeWord)
      this.hasSelectedMatch = false
      this.search(false)
    })

    this.regexBtn.addEventListener('click', () => {
      this.options.useRegex = !this.options.useRegex
      this.regexBtn.classList.toggle('active', this.options.useRegex)
      this.hasSelectedMatch = false
      this.search(false)
    })
  }

  public open(focusReplace = false): void {
    this.isOpen = true
    this.hasSelectedMatch = false
    this.container.classList.add('visible')

    // If text is selected in editor, prefill query
    const selection = this.editor.value.substring(this.editor.selectionStart, this.editor.selectionEnd)
    if (selection && !selection.includes('\n')) {
      this.queryInput.value = selection
    }

    this.search(false)

    if (focusReplace) {
      this.replaceInput.focus()
      this.replaceInput.select()
    } else {
      this.queryInput.focus()
      this.queryInput.select()
    }
  }

  public close(): void {
    this.isOpen = false
    this.container.classList.remove('visible')
    this.clearHighlights()
    this.editor.focus()
  }

  public toggle(focusReplace = false): void {
    if (this.isOpen && !focusReplace) {
      this.close()
    } else {
      this.open(focusReplace)
    }
  }

  public syncScroll(): void {
    if (!this.backdropEl) {
      this.backdropEl = document.querySelector('#backdrop')
    }
    if (this.backdropEl) {
      this.backdropEl.scrollTop = this.editor.scrollTop
      this.backdropEl.scrollLeft = this.editor.scrollLeft
    }
  }

  private clearHighlights(): void {
    if (!this.highlightsEl) {
      this.highlightsEl = document.querySelector('#highlights')
    }
    if (this.highlightsEl) {
      this.highlightsEl.textContent = ''
    }
  }

  public renderHighlights(): void {
    if (!this.highlightsEl) {
      this.highlightsEl = document.querySelector('#highlights')
    }
    if (!this.highlightsEl) return

    if (!this.isOpen || this.matches.length === 0 || !this.queryInput.value) {
      this.highlightsEl.textContent = ''
      return
    }

    const text = this.editor.value
    let html = ''
    let lastIndex = 0

    const escapeHtml = (str: string): string =>
      str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

    for (let i = 0; i < this.matches.length; i++) {
      const match = this.matches[i]
      const before = text.slice(lastIndex, match.start)
      const matched = text.slice(match.start, match.end)
      const isCurrent = this.hasSelectedMatch && i === this.currentIndex

      html += escapeHtml(before)
      html += `<mark class="find-match${isCurrent ? ' current' : ''}">${escapeHtml(matched)}</mark>`
      lastIndex = match.end
    }

    html += escapeHtml(text.slice(lastIndex))
    if (text.endsWith('\n')) {
      html += ' '
    }

    this.highlightsEl.innerHTML = html
    this.syncScroll()
  }

  public search(autoSelect = false): void {
    const query = this.queryInput.value
    if (!query) {
      this.matches = []
      this.currentIndex = -1
      this.countLabel.textContent = ''
      this.clearHighlights()
      return
    }

    const text = this.editor.value
    const matches: MatchRange[] = []

    try {
      let regex: RegExp
      if (this.options.useRegex) {
        regex = new RegExp(query, this.options.caseSensitive ? 'g' : 'gi')
      } else {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const pattern = this.options.wholeWord ? `\\b${escaped}\\b` : escaped
        regex = new RegExp(pattern, this.options.caseSensitive ? 'g' : 'gi')
      }

      let m: RegExpExecArray | null
      while ((m = regex.exec(text)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length })
        if (m.index === regex.lastIndex) regex.lastIndex++
      }
    } catch {
      this.matches = []
      this.currentIndex = -1
      this.countLabel.textContent = 'Invalid regex'
      this.clearHighlights()
      return
    }

    this.matches = matches

    if (matches.length === 0) {
      this.currentIndex = -1
      this.countLabel.textContent = 'No results'
      this.clearHighlights()
      return
    }

    // Find closest match at or after cursor
    const selStart = this.editor.selectionStart
    let targetIdx = matches.findIndex((m) => m.start >= selStart)
    if (targetIdx === -1) targetIdx = 0

    this.currentIndex = targetIdx

    if (autoSelect) {
      this.highlightMatch(this.currentIndex)
    } else {
      this.countLabel.textContent = `${matches.length} found`
      this.renderHighlights()
    }
  }

  private highlightCurrent(): void {
    if (this.matches.length === 0) return
    if (this.currentIndex === -1) this.currentIndex = 0
    this.highlightMatch(this.currentIndex)
  }

  private highlightMatch(index: number): void {
    if (this.matches.length === 0 || index < 0 || index >= this.matches.length) {
      this.countLabel.textContent = 'No results'
      this.clearHighlights()
      return
    }

    this.currentIndex = index
    this.hasSelectedMatch = true
    this.countLabel.textContent = `${this.currentIndex + 1} of ${this.matches.length}`
    const match = this.matches[this.currentIndex]

    // Set selection in editor
    this.editor.setSelectionRange(match.start, match.end)

    // Scroll textarea to match
    const lineNum = this.editor.value.slice(0, match.start).split('\n').length
    const approxLineHeight = 20
    const scrollTarget = (lineNum - 3) * approxLineHeight
    this.editor.scrollTop = Math.max(0, scrollTarget)

    this.renderHighlights()
  }

  public findNext(): void {
    if (this.matches.length === 0) return
    const nextIdx = (this.currentIndex + 1) % this.matches.length
    this.highlightMatch(nextIdx)
  }

  public findPrev(): void {
    if (this.matches.length === 0) return
    const prevIdx = (this.currentIndex - 1 + this.matches.length) % this.matches.length
    this.highlightMatch(prevIdx)
  }

  public replaceCurrent(): void {
    if (this.matches.length === 0 || this.currentIndex === -1) return

    // If not selected yet, select first
    if (!this.hasSelectedMatch) {
      this.highlightCurrent()
      return
    }

    const match = this.matches[this.currentIndex]
    const replaceWith = this.replaceInput.value

    this.editor.focus()
    this.editor.setSelectionRange(match.start, match.end)

    // Using document.execCommand preserves the browser's native Undo/Redo stack!
    const ok = document.execCommand('insertText', false, replaceWith)
    if (!ok) {
      const currentText = this.editor.value
      const before = currentText.substring(0, match.start)
      const after = currentText.substring(match.end)
      this.editor.value = before + replaceWith + after
      const newCursor = before.length + replaceWith.length
      this.editor.setSelectionRange(newCursor, newCursor)
    }

    this.onDraftChange()
    this.search(true)
  }

  public replaceAll(): void {
    const query = this.queryInput.value
    if (!query) return

    let count = 0
    const replaceWith = this.replaceInput.value
    const text = this.editor.value

    try {
      let regex: RegExp
      if (this.options.useRegex) {
        regex = new RegExp(query, this.options.caseSensitive ? 'g' : 'gi')
      } else {
        const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const pattern = this.options.wholeWord ? `\\b${escaped}\\b` : escaped
        regex = new RegExp(pattern, this.options.caseSensitive ? 'g' : 'gi')
      }

      const newText = text.replace(regex, () => {
        count++
        return replaceWith
      })

      if (count > 0) {
        this.editor.focus()
        this.editor.select()
        // Replace entire text using insertText so the whole Replace All is undoable in 1 step!
        const ok = document.execCommand('insertText', false, newText)
        if (!ok) {
          this.editor.value = newText
        }
        this.onDraftChange()
        this.hasSelectedMatch = false
        this.search(false)
        this.countLabel.textContent = `Replaced ${count}`
      } else {
        this.countLabel.textContent = '0 replaced'
      }
    } catch {
      this.countLabel.textContent = 'Error replacing'
    }
  }
}
