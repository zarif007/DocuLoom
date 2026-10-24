/**
 * Builds a PaperLens: the paper prepared for reading at four zoom levels.
 *
 * The model returns data, never markup or code. Everything it returns is
 * validated, repaired where that is safe, and dropped where it is not.
 */
import { lensDraftSchema } from '../../shared/schemas.js'
import {
  EXTRACTION_VERSION,
  LENS_SCHEMA_VERSION,
  type Beat,
  type DocumentBlock,
  type MarginNote,
  type PaperLens,
  type SectionSummary,
  type Term,
  type VerificationReport,
} from '../../shared/types.js'
import { emptyTally, verifyAnchored, verifyEvidence } from '../evidence/verify.js'
import type { Provider } from '../providers/index.js'
import { buildDigest } from './digest.js'
import { LENS_JSON_SCHEMA, LENS_SYSTEM, PROMPT_VERSION } from './prompts.js'

/**
 * Models occasionally wrap JSON in prose or a fenced block even when asked
 * not to. Recovering it here is cheaper than a retry.
 */
export function parseJsonLoosely(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    // fall through
  }

  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed)
  if (fenced) {
    try {
      return JSON.parse(fenced[1])
    } catch {
      // fall through
    }
  }

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start >= 0 && end > start) {
    return JSON.parse(trimmed.slice(start, end + 1))
  }
  throw new Error('The model did not return JSON.')
}

export interface LensRun {
  lens: PaperLens
  report: VerificationReport
}

/** Blocks a beat may legitimately stand in for. */
const BEAT_KINDS = new Set(['paragraph', 'list', 'caption', 'equation', 'table'])

export async function generateLens(
  paperId: string,
  blocks: DocumentBlock[],
  provider: Provider,
  signal?: AbortSignal,
): Promise<LensRun> {
  const digest = buildDigest(blocks)
  if (digest.includedBlocks === 0) {
    throw new Error('No analysable text was extracted from this document.')
  }

  const prompt = [
    'Prepare this paper for reading at all four zoom levels.',
    digest.truncated
      ? 'Note: the bibliography and some lower-value sections were omitted from this excerpt.'
      : '',
    '',
    '--- PAPER BLOCKS ---',
    digest.text,
  ]
    .filter(Boolean)
    .join('\n')

  const result = await provider.generate({
    system: LENS_SYSTEM,
    prompt,
    // A beat per paragraph across a long paper is a lot of output.
    maxTokens: 32_000,
    schema: LENS_JSON_SCHEMA,
    effort: 'high',
    signal,
  })

  const draft = lensDraftSchema.parse(parseJsonLoosely(result.text))
  const byId = new Map(blocks.map((b) => [b.id, b]))
  const tally = emptyTally()

  const gist = verifyEvidence(draft.gistEvidence, byId, tally)

  // One beat per block, keeping the first when the model repeats itself.
  const beats: Beat[] = []
  const claimedBlocks = new Set<string>()
  for (const item of draft.beats) {
    const block = byId.get(item.blockId)
    if (!block || claimedBlocks.has(item.blockId)) continue
    if (!BEAT_KINDS.has(block.kind)) continue
    claimedBlocks.add(item.blockId)
    beats.push({
      blockId: item.blockId,
      claim: item.claim,
      kind: item.kind,
      importance: item.importance,
      ...verifyAnchored(item.blockId, item.quote, byId, tally),
    })
  }
  beats.sort((a, b) => byId.get(a.blockId)!.order - byId.get(b.blockId)!.order)

  const sections: SectionSummary[] = draft.sections.map((item, index) => ({
    id: `s${index}`,
    heading: item.heading,
    headingBlockId:
      item.headingBlockId && byId.has(item.headingBlockId) ? item.headingBlockId : null,
    summary: item.summary,
    importance: item.importance,
    ...verifyEvidence(item.evidence, byId, tally),
  }))

  // Notes must anchor to a real block, or they have nowhere to sit.
  const notes: MarginNote[] = []
  draft.notes.forEach((item, index) => {
    if (!byId.has(item.blockId)) return
    const evidence = item.evidence.blockIds.length > 0
      ? item.evidence
      : { blockIds: [item.blockId], quote: item.evidence.quote }
    notes.push({
      id: `n${index}`,
      blockId: item.blockId,
      kind: item.kind,
      text: item.text,
      ...verifyEvidence(evidence, byId, tally),
    })
  })
  notes.sort((a, b) => byId.get(a.blockId)!.order - byId.get(b.blockId)!.order)

  const terms: Term[] = dedupeTerms(draft.terms, byId)

  const bodyBlocks = blocks.filter(
    (b) => BEAT_KINDS.has(b.kind) && digest.citableIds.has(b.id),
  )
  const report: VerificationReport = {
    totalStatements: tally.direct + tally.inferred + tally.unverified,
    direct: tally.direct,
    inferred: tally.inferred,
    unverified: tally.unverified,
    danglingCitations: tally.danglingCitations,
    beatCoverage:
      bodyBlocks.length === 0
        ? 0
        : Math.round((beats.length / bodyBlocks.length) * 100) / 100,
  }

  const lens: PaperLens = {
    schemaVersion: LENS_SCHEMA_VERSION,
    paperId,
    gist: draft.gist,
    gistEvidence: gist.evidence,
    gistSupport: gist.support,
    sections,
    beats,
    notes,
    terms,
    generatedBy: {
      provider: provider.id,
      model: result.model,
      promptVersion: PROMPT_VERSION,
      extractionVersion: EXTRACTION_VERSION,
      generatedAt: new Date().toISOString(),
    },
  }

  return { lens, report }
}

/**
 * Keeps one entry per term. Longer terms are matched first in the reader, so
 * near-duplicates that differ only by case would otherwise shadow each other.
 */
function dedupeTerms(
  drafts: { term: string; aliases: string[]; definition: string; firstBlockId?: string }[],
  byId: Map<string, DocumentBlock>,
): Term[] {
  const seen = new Set<string>()
  const terms: Term[] = []
  for (const draft of drafts) {
    const key = draft.term.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    terms.push({
      term: draft.term.trim(),
      aliases: [...new Set(draft.aliases.map((a) => a.trim()).filter(Boolean))],
      definition: draft.definition,
      firstBlockId:
        draft.firstBlockId && byId.has(draft.firstBlockId) ? draft.firstBlockId : null,
    })
  }
  return terms.sort((a, b) => b.term.length - a.term.length)
}
