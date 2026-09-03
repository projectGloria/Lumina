import { describe, expect, it } from 'vitest'
import { forgetConfigPath, rebaseConfigPath } from '@shared/homePaths'

describe('rebaseConfigPath, a stored note path', () => {
  const config = { path: 'Notes/Todo.md' }

  it('follows the note when the note itself is renamed', () => {
    expect(rebaseConfigPath(config, 'path', 'Notes/Todo.md', 'Notes/Later.md')).toEqual({
      path: 'Notes/Later.md'
    })
  })

  it('follows the note when a folder above it is renamed', () => {
    expect(rebaseConfigPath(config, 'path', 'Notes', 'Archive')).toEqual({
      path: 'Archive/Todo.md'
    })
  })

  it('follows the note when it is moved into another folder', () => {
    expect(rebaseConfigPath(config, 'path', 'Notes/Todo.md', 'Archive/2025/Todo.md')).toEqual({
      path: 'Archive/2025/Todo.md'
    })
  })

  // The case that catches prefix matching done by hand, and the reason both
  // rules go through the shared predicates.
  it('leaves a sibling folder that only starts the same alone', () => {
    expect(rebaseConfigPath(config, 'path', 'Note', 'Journal')).toBeNull()
    expect(rebaseConfigPath({ path: 'Notes backup/Todo.md' }, 'path', 'Notes', 'Archive')).toBeNull()
  })

  it('leaves an unrelated rename alone', () => {
    expect(rebaseConfigPath(config, 'path', 'Projects/Plan.md', 'Projects/Roadmap.md')).toBeNull()
  })
})

describe('rebaseConfigPath, a stored folder path', () => {
  const config = { folder: 'Projects' }

  it('follows the folder when it is renamed', () => {
    expect(rebaseConfigPath(config, 'folder', 'Projects', 'Work')).toEqual({ folder: 'Work' })
  })

  it('follows a nested folder when a folder above it is renamed', () => {
    expect(rebaseConfigPath({ folder: 'Projects/Live' }, 'folder', 'Projects', 'Work')).toEqual({
      folder: 'Work/Live'
    })
  })

  it('follows the folder when it is moved', () => {
    expect(rebaseConfigPath(config, 'folder', 'Projects', 'Archive/Projects')).toEqual({
      folder: 'Archive/Projects'
    })
  })

  it('leaves a folder whose name merely starts the same alone', () => {
    expect(rebaseConfigPath({ folder: 'Projects archive' }, 'folder', 'Projects', 'Work')).toBeNull()
  })
})

describe('rebaseConfigPath, options it should not touch', () => {
  it('leaves the whole-vault empty value alone', () => {
    // Empty is not a missing path — it is how a folder option says "the whole
    // vault", and rebasing it would invent a filter the user never set.
    expect(rebaseConfigPath({ folder: '' }, 'folder', 'Projects', 'Work')).toBeNull()
  })

  it('says nothing about a key the config does not have', () => {
    expect(rebaseConfigPath({}, 'folder', 'Projects', 'Work')).toBeNull()
  })

  it('says nothing about a value of the wrong type', () => {
    expect(rebaseConfigPath({ folder: 7 }, 'folder', 'Projects', 'Work')).toBeNull()
    expect(rebaseConfigPath({ folder: null }, 'folder', 'Projects', 'Work')).toBeNull()
  })

  it('patches only the key it was asked about', () => {
    const config = { path: 'Notes/Todo.md', count: 12, showDone: false }
    expect(rebaseConfigPath(config, 'path', 'Notes', 'Archive')).toEqual({
      path: 'Archive/Todo.md'
    })
  })

  it('does not mutate the config it was given', () => {
    const config = { path: 'Notes/Todo.md' }
    rebaseConfigPath(config, 'path', 'Notes', 'Archive')
    expect(config).toEqual({ path: 'Notes/Todo.md' })
  })
})

describe('forgetConfigPath', () => {
  it('gives up a folder that was deleted', () => {
    expect(forgetConfigPath({ folder: 'Projects' }, 'folder', 'Projects', '')).toEqual({
      folder: ''
    })
  })

  it('gives up a folder inside a deleted folder', () => {
    expect(forgetConfigPath({ folder: 'Projects/Live' }, 'folder', 'Projects', '')).toEqual({
      folder: ''
    })
  })

  it('keeps a folder that only looks like it was inside the deleted one', () => {
    expect(forgetConfigPath({ folder: 'Projects archive' }, 'folder', 'Projects', '')).toBeNull()
  })

  it('keeps a folder an unrelated delete did not touch', () => {
    expect(forgetConfigPath({ folder: 'Projects' }, 'folder', 'Notes/Old.md', '')).toBeNull()
  })

  it('says nothing when the option is already the fallback', () => {
    expect(forgetConfigPath({ folder: '' }, 'folder', 'Projects', '')).toBeNull()
  })

  it('says nothing about a key it does not hold, or holds wrongly', () => {
    expect(forgetConfigPath({}, 'folder', 'Projects', '')).toBeNull()
    expect(forgetConfigPath({ folder: [] }, 'folder', 'Projects', '')).toBeNull()
  })

  it('does not mutate the config it was given', () => {
    const config = { folder: 'Projects' }
    forgetConfigPath(config, 'folder', 'Projects', '')
    expect(config).toEqual({ folder: 'Projects' })
  })
})
