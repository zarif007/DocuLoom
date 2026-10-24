import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateLens, parseJsonLoosely } from '../server/analysis/lens.js'
import type { GenerateRequest, Provider } from '../server/providers/types.js'
import type { DocumentBlock } from '../shared/types.js'

test('parses JSON wrapped in a fenced code block', () => {
  assert.deepEqual(parseJsonLoosely('```json\n{"a":1}\n```'), { a: 1 })
})

test('parses JSON surrounded by prose', () => {
  assert.deepEqual(parseJsonLoosely('Here you go:\n{"a":1}\nHope that helps.'), { a: 1 })
})

test('throws when there is no JSON at all', () => {
  assert.throws(() => parseJsonLoosely('I cannot do that.'), /did not return JSON/)
})

const BLOCKS: DocumentBlock[] = [
  {
    id: 'b1-0',
    paperId: 'p1',
    page: 1,
    order: 0,
    kind: 'paragraph',
    text: 'We propose a cheaper guardrail that keeps safety accuracy within one point.',
    sectionPath: ['1 Introduction'],
    bbox: { x: 0, y: 0, w: 1, h: 0.1 },
    confidence: 1,
  },
  {
    id: 'b2-1',
    paperId: 'p1',
    page: 2,
    order: 1,
    kind: 'paragraph',
    text: 'The quantized classifier runs four times faster than the baseline model.',
    sectionPath: ['3 Method'],
    bbox: { x: 0, y: 0.2, w: 1, h: 0.1 },
    confidence: 1,
  },
  {
    id: 'b3-2',
    paperId: 'p1',
    page: 3,
    order: 2,
    kind: 'heading',
    text: '4 Results',
    sectionPath: ['4 Results'],
    bbox: { x: 0, y: 0.4, w: 1, h: 0.05 },
    confidence: 1,
  },
]

function stubProvider(draft: unknown): Provider {
  return {
    id: 'stub',
    label: 'Stub',
    model: 'stub-1',
    local: true,
    status: async () => ({
      id: 'stub',
      label: 'Stub',
      model: 'stub-1',
      local: true,
      configured: true,
      detail: '',
    }),
    generate: async (_req: GenerateRequest) => ({
      text: JSON.stringify(draft),
      model: 'stub-1',
    }),
  }
}

const DRAFT = {
  gist: 'A cheaper guardrail that holds accuracy.',
  gistEvidence: { blockIds: ['b1-0'], quote: 'a cheaper guardrail' },
  sections: [
    {
      heading: '3 Method',
      headingBlockId: 'b3-2',
      summary: 'The classifier is quantized.',
      importance: 1,
      evidence: { blockIds: ['b2-1'], quote: 'runs four times faster' },
    },
    {
      heading: 'Ghost section',
      headingBlockId: 'b9-9',
      summary: 'Anchored to a block that does not exist.',
      importance: 2,
      evidence: { blockIds: ['b2-1'] },
    },
  ],
  beats: [
    { blockId: 'b1-0', claim: 'Guardrails cost too much.', kind: 'problem', importance: 1, quote: 'cheaper guardrail' },
    { blockId: 'b2-1', claim: 'Quantizing makes it four times faster.', kind: 'method', importance: 1, quote: 'four times faster' },
    { blockId: 'b1-0', claim: 'A duplicate beat for the same block.', kind: 'aside', importance: 3 },
    { blockId: 'b9-9', claim: 'A beat on a block that does not exist.', kind: 'aside', importance: 3 },
    { blockId: 'b3-2', claim: 'A beat on a heading.', kind: 'aside', importance: 3 },
  ],
  notes: [
    { blockId: 'b2-1', kind: 'why', text: 'Quantizing trades precision for speed.', evidence: { blockIds: ['b2-1'], quote: 'four times faster' } },
    { blockId: 'b9-9', kind: 'watch', text: 'Anchored nowhere.', evidence: { blockIds: [] } },
  ],
  terms: [
    { term: 'AUPRC', aliases: ['area under the precision-recall curve'], definition: 'A ranking metric.', firstBlockId: 'b1-0' },
    { term: 'auprc', aliases: [], definition: 'Duplicate by case.', firstBlockId: 'b1-0' },
    { term: 'Quantization', aliases: [], definition: 'Lower-precision weights.', firstBlockId: 'b9-9' },
  ],
}

test('keeps one beat per block and drops beats on unknown blocks', async () => {
  const { lens } = await generateLens('p1', BLOCKS, stubProvider(DRAFT))
  const ids = lens.beats.map((b) => b.blockId)
  assert.deepEqual(ids, ['b1-0', 'b2-1'])
  assert.equal(lens.beats[0].claim, 'Guardrails cost too much.', 'the first beat wins')
})

test('does not place a beat on a heading', async () => {
  const { lens } = await generateLens('p1', BLOCKS, stubProvider(DRAFT))
  assert.ok(!lens.beats.some((b) => b.blockId === 'b3-2'))
})

test('orders beats by their position in the document', async () => {
  const shuffled = { ...DRAFT, beats: [...DRAFT.beats].reverse() }
  const { lens } = await generateLens('p1', BLOCKS, stubProvider(shuffled))
  const orders = lens.beats.map((b) => BLOCKS.find((x) => x.id === b.blockId)!.order)
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b))
})

test('drops notes anchored to blocks that do not exist', async () => {
  const { lens } = await generateLens('p1', BLOCKS, stubProvider(DRAFT))
  assert.equal(lens.notes.length, 1)
  assert.equal(lens.notes[0].blockId, 'b2-1')
})

test('clears a section heading anchor that does not resolve', async () => {
  const { lens } = await generateLens('p1', BLOCKS, stubProvider(DRAFT))
  assert.equal(lens.sections[0].headingBlockId, 'b3-2')
  assert.equal(lens.sections[1].headingBlockId, null)
})

test('deduplicates terms case-insensitively and clears bad anchors', async () => {
  const { lens } = await generateLens('p1', BLOCKS, stubProvider(DRAFT))
  assert.equal(lens.terms.filter((t) => t.term.toLowerCase() === 'auprc').length, 1)
  assert.equal(lens.terms.find((t) => t.term === 'Quantization')?.firstBlockId, null)
})

test('sorts terms longest first so matching does not shadow', async () => {
  const { lens } = await generateLens('p1', BLOCKS, stubProvider(DRAFT))
  const lengths = lens.terms.map((t) => t.term.length)
  assert.deepEqual(lengths, [...lengths].sort((a, b) => b - a))
})

test('verifies every statement and reports coverage', async () => {
  const { lens, report } = await generateLens('p1', BLOCKS, stubProvider(DRAFT))
  assert.ok(report.totalStatements > 0)
  assert.equal(report.unverified, 0)
  assert.ok(report.beatCoverage > 0 && report.beatCoverage <= 1)
  assert.equal(lens.gistSupport, 'direct')
})

test('records how the artifact was produced', async () => {
  const { lens } = await generateLens('p1', BLOCKS, stubProvider(DRAFT))
  assert.equal(lens.generatedBy.provider, 'stub')
  assert.equal(lens.generatedBy.model, 'stub-1')
  assert.ok(lens.generatedBy.promptVersion >= 1)
})

test('rejects a draft that does not match the schema', async () => {
  await assert.rejects(generateLens('p1', BLOCKS, stubProvider({ sections: [] })), /gist/)
})
