import type { BeatKind, NoteKind } from '@shared/types'

/**
 * Colour for a beat's marker. Hue groups the kinds a reader cares about
 * separating: what the paper claims, how it was tested, what came out, and
 * what it admits it cannot do.
 */
export const BEAT_COLOUR: Record<BeatKind, string> = {
  problem: 'var(--note-caution)',
  background: 'var(--ink-3)',
  idea: 'var(--accent)',
  method: 'var(--note-context)',
  setup: 'var(--note-why)',
  result: 'var(--note-result)',
  limitation: 'var(--note-caution)',
  aside: 'var(--ink-3)',
}

export const NOTE_COLOUR: Record<NoteKind, string> = {
  why: 'var(--note-why)',
  watch: 'var(--note-watch)',
  result: 'var(--note-result)',
  caution: 'var(--note-caution)',
  context: 'var(--note-context)',
}

export const NOTE_LABEL: Record<NoteKind, string> = {
  why: 'why',
  watch: 'watch out',
  result: 'what it means',
  caution: 'caution',
  context: 'background',
}
