import { describe, expect, it } from 'vitest'
import { openTab } from '@shared/tabs'

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
