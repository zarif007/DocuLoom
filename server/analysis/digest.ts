/**
 * Builds the view of the paper the model is asked to analyse.
 *
 * Every line is prefixed with its block id, because those ids are the only
 * citations the model is allowed to produce. Anything it cannot see, it
 * cannot cite, so the digest keeps the sections that carry the argument and
 * drops the bibliography.
 */
import type { DocumentBlock } from '../../shared/types.js'

/** Roughly 4 characters per token; keeps a long paper inside a sane budget. */
const DEFAULT_CHAR_BUDGET = 160_000
const MAX_BLOCK_CHARS = 1200

const LOW_VALUE_SECTION = /references|bibliography|acknowledg/i

export interface Digest {
  text: string
  /** Ids the model is allowed to cite. */
  citableIds: Set<string>
  includedBlocks: number
  omittedBlocks: number
  truncated: boolean
}

/**
 * Scores a block's importance so that, when a paper does not fit the budget,
 * what gets dropped is background rather than the method or the results.
 */
function priority(block: DocumentBlock): number {
  const section = block.sectionPath.join(' ').toLowerCase()
  if (block.kind === 'heading') return 100
  if (LOW_VALUE_SECTION.test(section) || block.kind === 'reference') return 0
  if (block.kind === 'footnote') return 10

  let score = 50
  if (/abstract/.test(section)) score += 45
  if (/introduction/.test(section)) score += 20
  if (/method|approach|model|architecture|design/.test(section)) score += 40
  if (/experiment|evaluation|setup|result/.test(section)) score += 35
  if (/limitation|discussion|conclusion/.test(section)) score += 30
  if (/related work/.test(section)) score -= 15
  if (/appendix/.test(section)) score -= 20

  if (block.kind === 'equation') score += 10
  if (block.kind === 'caption') score += 15
  if (block.kind === 'table') score += 10

  // Very short fragments rarely carry a claim worth citing.
  if (block.text.length < 60) score -= 20
  return score
}

export function buildDigest(
  blocks: DocumentBlock[],
  charBudget = DEFAULT_CHAR_BUDGET,
): Digest {
  const ranked = [...blocks]
    .map((block) => ({ block, score: priority(block) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.block.order - b.block.order)

  const kept = new Set<string>()
  let used = 0
  let truncated = false

  for (const { block } of ranked) {
    const text = block.text.slice(0, MAX_BLOCK_CHARS)
    const cost = text.length + block.id.length + 12
    if (used + cost > charBudget) {
      truncated = true
      continue
    }
    kept.add(block.id)
    used += cost
  }

  // Emit in reading order so the model sees the paper's actual structure.
  const lines: string[] = []
  let lastSection = ''
  for (const block of blocks) {
    if (!kept.has(block.id)) continue
    const section = block.sectionPath.join(' > ')
    if (section && section !== lastSection && block.kind !== 'heading') {
      lines.push(`\n## section: ${section}`)
      lastSection = section
    }
    if (block.kind === 'heading') {
      lines.push(`\n[${block.id}] (heading, p${block.page}) ${block.text}`)
      lastSection = section
      continue
    }
    const label = block.kind === 'paragraph' ? '' : `${block.kind}, `
    lines.push(
      `[${block.id}] (${label}p${block.page}) ${block.text.slice(0, MAX_BLOCK_CHARS)}`,
    )
  }

  return {
    text: lines.join('\n'),
    citableIds: kept,
    includedBlocks: kept.size,
    omittedBlocks: blocks.length - kept.size,
    truncated,
  }
}
