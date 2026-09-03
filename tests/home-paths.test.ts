import { describe, expect, it } from 'vitest'
import { rebaseConfigPath, vaultFolders } from '@shared/homePaths'
import type { TreeNode } from '@shared/types'

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

describe('vaultFolders', () => {
  const folder = (path: string, children: TreeNode[] = []): TreeNode => ({
    kind: 'folder',
    path,
    name: path.split('/').pop() ?? path,
    children
  })
  const file = (path: string): TreeNode => ({
    kind: 'file',
    path,
    name: path.split('/').pop() ?? path,
    title: 'x',
    mtime: 0,
    createdAt: 0,
    size: 0
  })

  it('collects folders at every depth', () => {
    const tree = [
      folder('Projects', [folder('Projects/Live', [file('Projects/Live/a.md')])]),
      folder('Notes'),
      file('Top.md')
    ]
    expect([...vaultFolders(tree)].sort()).toEqual(['Notes', 'Projects', 'Projects/Live'])
  })

  // A folder is a folder whether or not it holds a note, which is why this
  // reads the tree and not the index.
  it('counts a folder with nothing in it', () => {
    expect(vaultFolders([folder('Empty')]).has('Empty')).toBe(true)
  })

  it('holds no files, and nothing at all for an empty vault', () => {
    expect(vaultFolders([file('a.md')]).size).toBe(0)
    expect(vaultFolders([]).size).toBe(0)
  })

  it('is what tells a live folder filter from one that has gone', () => {
    const folders = vaultFolders([folder('Projects')])
    expect(folders.has('Projects')).toBe(true)
    expect(folders.has('Projects archive')).toBe(false)
    // A typo and a deleted folder are the same question, and get the same
    // answer: this filter can never match anything.
    expect(folders.has('projects')).toBe(false)
    expect(folders.has('Projects/')).toBe(false)
  })
})
