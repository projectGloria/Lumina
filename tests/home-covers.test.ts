import { describe, expect, it } from 'vitest'
import { HOME_COVER_DIR, sweepableCovers, type CoverFile } from '@shared/homeCovers'

const NOW = 1_000_000
const GRACE = 60_000

const file = (name: string, age = GRACE * 2): CoverFile => ({
  name,
  isFile: true,
  mtimeMs: NOW - age
})

const sweep = (files: CoverFile[], coverPath?: string): string[] =>
  sweepableCovers(files, { coverPath, now: NOW, graceMs: GRACE })

describe('sweepableCovers', () => {
  it('keeps the picture the board is using', () => {
    const files = [file('keep.jpg'), file('old.jpg')]
    expect(sweep(files, `${HOME_COVER_DIR}/keep.jpg`)).toEqual(['old.jpg'])
  })

  it('sweeps everything once the cover is removed', () => {
    expect(sweep([file('a.jpg'), file('b.png')])).toEqual(['a.jpg', 'b.png'])
  })

  // Replacing a cover repeatedly is how the folder filled up: `saveAttachment`
  // uniquifies names, so every swap left the previous file behind.
  it('sweeps the ones a series of replacements left behind', () => {
    const files = [file('photo.jpg'), file('photo 1.jpg'), file('photo 2.jpg')]
    expect(sweep(files, `${HOME_COVER_DIR}/photo 2.jpg`)).toEqual(['photo.jpg', 'photo 1.jpg'])
  })

  it('spares a picture chosen seconds ago, whatever the layout says', () => {
    // The pick copies the file first and names it second, and the save in
    // between knows only the old cover.
    const files = [file('just-picked.jpg', 1_000), file('long-gone.jpg')]
    expect(sweep(files, `${HOME_COVER_DIR}/previous.jpg`)).toEqual(['long-gone.jpg'])
  })

  it('sweeps a file exactly at the edge of the window', () => {
    expect(sweep([file('edge.jpg', GRACE)])).toEqual(['edge.jpg'])
    expect(sweep([file('inside.jpg', GRACE - 1)])).toEqual([])
  })

  it('never touches a directory or a symlink', () => {
    const files: CoverFile[] = [
      { name: 'nested', isFile: false, mtimeMs: 0 },
      { name: 'link.jpg', isFile: false, mtimeMs: 0 },
      file('real.jpg')
    ]
    expect(sweep(files)).toEqual(['real.jpg'])
  })

  it('treats a cover stored elsewhere in the vault as naming none of these', () => {
    const files = [file('a.jpg')]
    expect(sweep(files, 'attachments/a.jpg')).toEqual(['a.jpg'])
  })

  it('is not fooled by a path that only starts like the cover folder', () => {
    const files = [file('a.jpg')]
    expect(sweep(files, `${HOME_COVER_DIR}/nested/a.jpg`)).toEqual(['a.jpg'])
    expect(sweep(files, `${HOME_COVER_DIR}-backup/a.jpg`)).toEqual(['a.jpg'])
  })

  it('has nothing to say about an empty folder', () => {
    expect(sweep([])).toEqual([])
  })
})
