import { Fragment, type ReactNode } from 'react'
import type { Term } from '@shared/types'

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export interface TermIndex {
  pattern: RegExp | null
  byKey: Map<string, Term>
}

/**
 * Builds one matcher for the whole glossary.
 *
 * Terms are already sorted longest first, so alternation prefers the longer
 * match and "safety classifier" is not swallowed by "classifier".
 */
export function buildTermIndex(terms: Term[]): TermIndex {
  const byKey = new Map<string, Term>()
  const spellings: string[] = []

  for (const term of terms) {
    for (const spelling of [term.term, ...term.aliases]) {
      const trimmed = spelling.trim()
      // Very short spellings match noise; acronyms are the exception.
      if (trimmed.length < 3) continue
      const key = trimmed.toLowerCase()
      if (byKey.has(key)) continue
      byKey.set(key, term)
      spellings.push(escape(trimmed))
    }
  }

  if (spellings.length === 0) return { pattern: null, byKey }
  spellings.sort((a, b) => b.length - a.length)
  return { pattern: new RegExp(`\\b(${spellings.join('|')})\\b`, 'gi'), byKey }
}

/**
 * Marks glossary terms inside a passage.
 *
 * Only the first occurrence of each term in a passage is marked. Underlining
 * every repeat turns the page into a minefield and teaches the reader to
 * ignore the marks entirely.
 */
export function renderWithTerms(
  text: string,
  index: TermIndex,
  onOpen: (term: Term, anchor: DOMRect) => void,
): ReactNode {
  if (!index.pattern) return text
  index.pattern.lastIndex = 0

  const parts: ReactNode[] = []
  const seen = new Set<string>()
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = index.pattern.exec(text)) !== null) {
    const term = index.byKey.get(match[0].toLowerCase())
    if (!term || seen.has(term.term)) continue
    seen.add(term.term)

    if (match.index > cursor) parts.push(text.slice(cursor, match.index))
    const offset = match.index
    parts.push(
      <span
        key={`${term.term}-${offset}`}
        className="term"
        tabIndex={0}
        role="button"
        onMouseEnter={(event) => onOpen(term, event.currentTarget.getBoundingClientRect())}
        onFocus={(event) => onOpen(term, event.currentTarget.getBoundingClientRect())}
        onClick={(event) => onOpen(term, event.currentTarget.getBoundingClientRect())}
      >
        {match[0]}
      </span>,
    )
    cursor = offset + match[0].length
  }

  if (parts.length === 0) return text
  if (cursor < text.length) parts.push(text.slice(cursor))
  return parts.map((part, i) => <Fragment key={i}>{part}</Fragment>)
}
