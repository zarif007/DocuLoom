import assert from 'node:assert/strict'
import { test } from 'node:test'
import { emptyTally, verifyAnchored, verifyEvidence } from '../server/evidence/verify.js'
import type { DocumentBlock } from '../shared/types.js'

const block = (id: string, text: string): DocumentBlock => ({
  id,
  paperId: 'p1',
  page: 1,
  order: 0,
  kind: 'paragraph',
  text,
  sectionPath: [],
  bbox: { x: 0, y: 0, w: 1, h: 0.1 },
  confidence: 1,
})

const BY_ID = new Map(
  [
    block('b1-0', 'We introduce Llama Guard, an LLM-based input-output safeguard model.'),
    block('b1-1', 'The model reaches an AUPRC of 0.945 on the OpenAI moderation dataset.'),
  ].map((b) => [b.id, b]),
)

test('marks a statement direct when its quote is in the cited block', () => {
  const tally = emptyTally()
  const result = verifyEvidence(
    { blockIds: ['b1-0'], quote: 'an LLM-based input-output safeguard model' },
    BY_ID,
    tally,
  )
  assert.equal(result.support, 'direct')
  assert.equal(tally.direct, 1)
})

test('tolerates hyphenation and whitespace differences in a quote', () => {
  const result = verifyEvidence(
    { blockIds: ['b1-0'], quote: 'LLM‐based   input-output safeguard' },
    BY_ID,
    emptyTally(),
  )
  assert.equal(result.support, 'direct')
})

test('marks a statement inferred when the quote is not in the cited block', () => {
  const result = verifyEvidence(
    { blockIds: ['b1-0'], quote: 'trained with reinforcement learning from human feedback' },
    BY_ID,
    emptyTally(),
  )
  assert.equal(result.support, 'inferred')
  assert.match(result.verificationNote ?? '', /not found/i)
})

test('drops citations to blocks that do not exist', () => {
  const tally = emptyTally()
  const result = verifyEvidence(
    { blockIds: ['b1-0', 'b9-9'], quote: 'safeguard model' },
    BY_ID,
    tally,
  )
  assert.equal(tally.danglingCitations, 1)
  assert.deepEqual(result.evidence.blockIds, ['b1-0'])
})

test('marks a statement unverified when every citation is invented', () => {
  const tally = emptyTally()
  const result = verifyEvidence({ blockIds: ['b7-7'], quote: 'anything' }, BY_ID, tally)
  assert.equal(result.support, 'unverified')
  assert.deepEqual(result.evidence.blockIds, [])
  assert.equal(tally.unverified, 1)
})

test('marks a statement unverified when it cites nothing at all', () => {
  const result = verifyEvidence({ blockIds: [] }, BY_ID, emptyTally())
  assert.equal(result.support, 'unverified')
  assert.match(result.verificationNote ?? '', /no source/i)
})

test('verifies a statement anchored to a single block', () => {
  const result = verifyAnchored('b1-1', 'AUPRC of 0.945', BY_ID, emptyTally())
  assert.equal(result.support, 'direct')
  assert.deepEqual(result.evidence.blockIds, ['b1-1'])
})
