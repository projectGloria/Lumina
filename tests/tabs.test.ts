import { describe, expect, it } from 'vitest'
import { openHomeTab, openTab } from '@shared/tabs'

describe('openTab', () => {
  it('opens different notes in separate tabs by default', () => {
    const result = openTab([{ path: 'First.md' }], 0, 'Second.md')
    expect(result).toEqual({
      tabs: [{ path: 'First.md' }, { path: 'Second.md', mode: undefined }],
      activeTab: 1
    })
  })

  it('activates an existing note instead of duplicating it', () => {
    const tabs = [{ path: 'First.md' }, { path: 'Second.md' }]
    expect(openTab(tabs, 1, 'First.md')).toEqual({ tabs, activeTab: 0 })
  })

  it('allows an explicit duplicate tab', () => {
    const result = openTab([{ path: 'First.md' }], 0, 'First.md', { newTab: true })
    expect(result.tabs).toHaveLength(2)
    expect(result.activeTab).toBe(1)
  })

  it('replaces the active tab only when requested', () => {
    const result = openTab(
      [{ path: 'First.md', mode: 'read' }, { path: 'Keep.md' }],
      0,
      'History.md',
      { replace: true }
    )
    expect(result).toEqual({
      tabs: [{ path: 'History.md', mode: 'read' }, { path: 'Keep.md' }],
      activeTab: 0
    })
  })
})

describe('openTab, with a home tab in the strip', () => {
  it('opens Home once and activates it thereafter', () => {
    const first = openHomeTab([{ path: 'First.md' }], 0)
    expect(first).toEqual({
      tabs: [{ path: 'First.md' }, { kind: 'home', path: '' }],
      activeTab: 1
    })

    const again = openHomeTab(first.tabs, 0)
    expect(again).toEqual({ tabs: first.tabs, activeTab: 1 })
  })

  it('does not mistake a home tab for a note with an empty path', () => {
    const tabs = [{ kind: 'home' as const, path: '' }]
    const result = openTab(tabs, 0, '')
    expect(result.tabs).toHaveLength(2)
    expect(result.tabs[1]).toEqual({ path: '', mode: undefined })
  })

  it('appends rather than replacing when Home is the active tab', () => {
    const tabs = [{ kind: 'home' as const, path: '' }]
    const result = openTab(tabs, 0, 'History.md', { replace: true })
    expect(result).toEqual({
      tabs: [{ kind: 'home', path: '' }, { path: 'History.md', mode: undefined }],
      activeTab: 1
    })
  })

  it('does not inherit read mode from a home tab', () => {
    const tabs = [{ path: 'Read.md', mode: 'read' as const }, { kind: 'home' as const, path: '' }]
    const result = openTab(tabs, 1, 'Next.md')
    expect(result.tabs[2]).toEqual({ path: 'Next.md', mode: undefined })
  })
})
