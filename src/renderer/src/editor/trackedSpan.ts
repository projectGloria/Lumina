import { Facet, StateEffect, StateField } from '@codemirror/state'

export const documentPath = Facet.define<string, string>({ combine: (values) => values[0] ?? '' })
export interface TrackedSpan { from: number; to: number; text: string }
export const setTrackedSpan = StateEffect.define<TrackedSpan | null>()
export const trackedSpan = StateField.define<{ identity: symbol; span: TrackedSpan | null }>({
  create: () => ({ identity: Symbol('document'), span: null }),
  update(value, tr) {
    let span = value.span
    if (span && tr.docChanged) {
      const from = tr.changes.mapPos(span.from, 1)
      const to = tr.changes.mapPos(span.to, -1)
      span = from <= to && tr.state.sliceDoc(from, to) === span.text ? { ...span, from, to } : null
    }
    for (const effect of tr.effects) if (effect.is(setTrackedSpan)) span = effect.value
    return { identity: value.identity, span }
  }
})
