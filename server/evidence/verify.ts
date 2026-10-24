/**
 * Checks generated statements against the extracted document.
 *
 * A citation is not proof on its own, so every statement is checked two
 * ways: the cited block ids must exist, and the quote the model said it
 * relied on must actually appear in one of them. What survives is `direct`;
 * what cites real blocks without a locatable quote is `inferred`; what cites
 * nothing real is `unverified` and is shown to the reader as such.
 */
import type { DocumentBlock, Evidence, Grounded, SupportLevel } from '../../shared/types.js'

/** Folds away the differences PDF extraction introduces. */
export function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[­‐‑]/g, '-')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(text: string): string[] {
  return normalise(text)
    .replace(/[^a-z0-9%.\- ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)
}

/**
 * How much of the quote is present in the block. Exact substring matching is
 * too brittle: hyphenation repair and ligatures routinely shift a character
 * or two, which should not demote a real citation.
 */
function overlapRatio(quote: string, blockText: string): number {
  const quoteTokens = tokens(quote)
  if (quoteTokens.length === 0) return 0
  const blockTokens = new Set(tokens(blockText))
  const hits = quoteTokens.filter((t) => blockTokens.has(t)).length
  return hits / quoteTokens.length
}

export interface VerifyTally {
  direct: number
  inferred: number
  unverified: number
  danglingCitations: number
}

export function emptyTally(): VerifyTally {
  return { direct: 0, inferred: 0, unverified: 0, danglingCitations: 0 }
}

/**
 * Verifies one statement's evidence, recording the outcome in `tally`.
 * Returns the evidence with unresolvable citations stripped out.
 */
export function verifyEvidence(
  evidence: Evidence,
  byId: Map<string, DocumentBlock>,
  tally: VerifyTally,
): Grounded {
  const requested = evidence.blockIds ?? []
  const real = requested.filter((id) => byId.has(id))
  tally.danglingCitations += requested.length - real.length

  const finish = (support: SupportLevel, note?: string): Grounded => {
    tally[support]++
    return {
      evidence: { ...evidence, blockIds: real },
      support,
      ...(note ? { verificationNote: note } : {}),
    }
  }

  if (real.length === 0) {
    return finish(
      'unverified',
      requested.length > 0
        ? 'The cited passages could not be found in this document.'
        : 'No source was given for this statement.',
    )
  }

  const quote = evidence.quote?.trim()
  if (!quote) {
    return finish('inferred', 'Cited passages exist, but no quote was given to check.')
  }

  const needle = normalise(quote)
  const best = real.reduce((max, id) => {
    const text = byId.get(id)!.text
    if (normalise(text).includes(needle)) return 1
    return Math.max(max, overlapRatio(quote, text))
  }, 0)

  if (best >= 0.85) return finish('direct')
  if (best >= 0.5) return finish('inferred', 'The quote only partly matches the cited passage.')
  return finish('inferred', 'The quote was not found in the cited passage.')
}

/** Convenience for items whose only citation is the block they anchor to. */
export function verifyAnchored(
  blockId: string,
  quote: string | undefined,
  byId: Map<string, DocumentBlock>,
  tally: VerifyTally,
): Grounded {
  return verifyEvidence({ blockIds: [blockId], quote }, byId, tally)
}
