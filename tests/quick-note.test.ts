import { describe, expect, it } from 'vitest'
import { DEFAULT_QUICK_NOTE_FOLDER, isGeneratedNoteName, quickNoteName } from '@shared/quickNote'
import { isMarkdownPath, joinPath } from '@shared/markdown-parse'

describe('quickNoteName', () => {
  it('sorts chronologically and reads as a time', () => {
    expect(quickNoteName(new Date(2026, 8, 1, 14, 5, 9))).toBe('Note 2026-09-01 14-05-09')
  })

  it('carries no character Windows refuses in a filename', () => {
    const name = quickNoteName(new Date(2026, 0, 2, 3, 4, 5))
    expect(name).not.toMatch(/[<>:"/\|?*]/)
  })

  it('is unique per second, so two presses cannot collide', () => {
    const first = quickNoteName(new Date(2026, 8, 1, 14, 5, 9))
    const second = quickNoteName(new Date(2026, 8, 1, 14, 5, 10))
    expect(first).not.toBe(second)
  })

  it('makes a markdown path under the quick-note folder', () => {
    const path = joinPath(DEFAULT_QUICK_NOTE_FOLDER, `${quickNoteName(new Date(2026, 8, 1))}.md`)
    expect(path.startsWith('Temporary/')).toBe(true)
    expect(isMarkdownPath(path)).toBe(true)
  })

  it('recognises generated names without claiming ordinary empty notes', () => {
    expect(isGeneratedNoteName('Note 2026-09-01 14-05-09')).toBe(true)
    expect(isGeneratedNoteName('Project Notes')).toBe(false)
    expect(isGeneratedNoteName('Note 2026-09-01')).toBe(false)
  })
})
