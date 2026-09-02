import { describe, expect, it } from 'vitest'
import { applyTemplate, expandSnippet, formatDate, slashCommandName } from '@shared/template'

// Fixed so the assertions do not drift with the wall clock: a Tuesday.
const when = new Date(2026, 8, 1, 14, 5, 9)

describe('formatDate', () => {
  it('fills the tokens the settings field advertises', () => {
    expect(formatDate('YYYY-MM-DD HH:mm:ss', when)).toBe('2026-09-01 14:05:09')
    expect(formatDate('DDDD, DD MMMM YY', when)).toBe('Tuesday, 01 September 26')
    expect(formatDate('MMM DDD', when)).toBe('Sep Tue')
  })

  it('leaves anything else alone', () => {
    expect(formatDate('week of YYYY', when)).toBe('week of 2026')
  })
})

describe('applyTemplate', () => {
  it('fills title, date and time', () => {
    expect(applyTemplate('# {{title}} — {{date}} {{time}}', 'Notes', when)).toBe(
      '# Notes — 2026-09-01 14:05'
    )
  })

  it('honours a per-placeholder format', () => {
    expect(applyTemplate('{{date:DD/MM/YYYY}}', '', when)).toBe('01/09/2026')
  })
})

describe('expandSnippet', () => {
  it('puts the caret where {{cursor}} was', () => {
    const { text, cursor } = expandSnippet('**{{cursor}}**', '', when)
    expect(text).toBe('****')
    expect(cursor).toBe(2)
  })

  it('drops later cursor markers but keeps the first as the caret', () => {
    const { text, cursor } = expandSnippet('a{{cursor}}b{{cursor}}c', '', when)
    expect(text).toBe('abc')
    expect(cursor).toBe(1)
  })

  it('lands at the end when there is no marker', () => {
    const { text, cursor } = expandSnippet('- [ ] ', '', when)
    expect(cursor).toBe(text.length)
  })

  it('expands the other placeholders on the way', () => {
    expect(expandSnippet('{{date}} {{cursor}}', '', when).text).toBe('2026-09-01 ')
  })
})

describe('slashCommandName', () => {
  it('keeps what the trigger can actually type', () => {
    expect(slashCommandName('todo2')).toBe('todo2')
    expect(slashCommandName('meeting-notes')).toBe('meeting-notes')
  })

  it('drops characters that would make the command unreachable', () => {
    expect(slashCommandName('  daily log! ')).toBe('dailylog')
    expect(slashCommandName('/stamp')).toBe('stamp')
  })
})
