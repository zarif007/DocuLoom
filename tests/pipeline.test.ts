import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import { generateLens } from '../server/analysis/lens.js'
import { buildDigest } from '../server/analysis/digest.js'
import { extractPdf } from '../server/extraction/pdf.js'
import { OfflineProvider } from '../server/providers/offline.js'
import type { DocumentBlock } from '../shared/types.js'

/**
 * Exercises extraction through analysis on a real paper.
 *
 * The fixture PDFs are not committed (they are third-party papers), so this
 * skips rather than fails when they are absent.
 */
const FIXTURE = 'fixtures/papers/llama-guard.pdf'
const available = existsSync(FIXTURE)

test('extracts a real paper into located, section-aware blocks', { skip: !available }, async () => {
  const result = await extractPdf(readFileSync(FIXTURE), 'llama-guard.pdf')

  assert.match(result.meta.title, /Llama Guard/i)
  assert.ok(result.meta.abstract.length > 200, 'an abstract should be found')
  assert.ok(result.meta.pageCount > 5)
  assert.ok(result.blocks.length > 50, 'a 15-page paper should yield many blocks')

  assert.ok(
    result.blocks.some((b) => b.kind === 'heading' && /Experiments/i.test(b.text)),
    'section headings should be detected',
  )
  assert.ok(result.blocks.some((b) => b.kind === 'caption'), 'captions should be detected')

  // Every block must be navigable: a real page and a sane rectangle.
  for (const block of result.blocks) {
    assert.ok(block.page >= 1 && block.page <= result.meta.pageCount)
    assert.ok(block.bbox.x >= 0 && block.bbox.x <= 1)
    assert.ok(block.bbox.y >= 0 && block.bbox.y <= 1)
    assert.ok(block.bbox.w > 0 && block.bbox.h > 0)
  }

  // Block ids must be unique, since citations resolve through them.
  const ids = new Set(result.blocks.map((b) => b.id))
  assert.equal(ids.size, result.blocks.length)
})

test('builds a digest that only offers real block ids', { skip: !available }, async () => {
  const result = await extractPdf(readFileSync(FIXTURE), 'llama-guard.pdf')
  const blocks: DocumentBlock[] = result.blocks.map((b) => ({ ...b, paperId: 'p1' }))
  const digest = buildDigest(blocks)

  assert.ok(digest.includedBlocks > 20)
  const known = new Set(blocks.map((b) => b.id))
  for (const id of digest.citableIds) assert.ok(known.has(id))

  // The bibliography carries no argument and is excluded on purpose.
  const references = blocks.filter((b) => b.kind === 'reference').map((b) => b.id)
  assert.ok(references.length > 0, 'precondition: this paper has a bibliography')
  assert.ok(references.every((id) => !digest.citableIds.has(id)))
})

test('runs extraction through to a verified lens', { skip: !available }, async () => {
  const result = await extractPdf(readFileSync(FIXTURE), 'llama-guard.pdf')
  const blocks: DocumentBlock[] = result.blocks.map((b) => ({ ...b, paperId: 'p1' }))

  const { lens, report } = await generateLens('p1', blocks, new OfflineProvider())

  assert.ok(lens.beats.length > 30, 'a 15-page paper should yield many beats')
  assert.ok(lens.sections.length > 4, 'sections should be summarised')
  assert.equal(report.danglingCitations, 0, 'nothing may cite a block that does not exist')
  assert.equal(report.unverified, 0, 'every offline statement quotes its own source')
  assert.ok(report.beatCoverage > 0.5, 'most of the body should carry a beat')

  // Every citation must resolve to a block the reader can be taken to.
  const byId = new Map(blocks.map((b) => [b.id, b]))
  for (const beat of lens.beats) {
    assert.ok(byId.has(beat.blockId), `${beat.blockId} must exist`)
    assert.ok(beat.claim.length > 0)
  }
  for (const note of lens.notes) assert.ok(byId.has(note.blockId))
  for (const term of lens.terms) {
    if (term.firstBlockId) assert.ok(byId.has(term.firstBlockId))
  }

  // Beats must be in reading order, since the reader scrolls through them.
  const orders = lens.beats.map((b) => byId.get(b.blockId)!.order)
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b))
})

test('extracts acronyms the paper expands itself', { skip: !available }, async () => {
  const result = await extractPdf(readFileSync(FIXTURE), 'llama-guard.pdf')
  const blocks: DocumentBlock[] = result.blocks.map((b) => ({ ...b, paperId: 'p1' }))
  const { lens } = await generateLens('p1', blocks, new OfflineProvider())

  assert.ok(lens.terms.length > 0, 'this paper expands several acronyms')
  for (const term of lens.terms) {
    assert.ok(term.aliases.length > 0, `${term.term} should carry its expansion`)
  }
})
