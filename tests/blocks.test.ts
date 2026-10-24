import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assembleBlocks, joinLines, type PageLines } from '../server/extraction/blocks.js'
import { groupIntoLines, type TextRun } from '../server/extraction/layout.js'

function line(text: string, y: number, fontSize = 10, fontName = 'Serif') {
  const runs: TextRun[] = [
    { text, x: 60, y, width: text.length * 5, height: fontSize, fontSize, fontName },
  ]
  return groupIntoLines(runs)[0]
}

function page(lines: ReturnType<typeof line>[]): PageLines[] {
  return [{ page: 1, lines, width: 600, height: 800 }]
}

test('repairs words split by end-of-line hyphenation', () => {
  const joined = joinLines([line('quan-', 10), line('tization reduces cost', 24)])
  assert.equal(joined, 'quantization reduces cost')
})

test('keeps a real hyphenated compound intact', () => {
  const joined = joinLines([line('state-of-the-art results', 10)])
  assert.equal(joined, 'state-of-the-art results')
})

test('recognises numbered headings and tracks the section path', () => {
  const blocks = assembleBlocks(
    page([
      line('3 Building The Model', 10, 13, 'Bold'),
      line('We train the model on a large corpus of documents collected from the web.', 40),
      line('3.1 Training Data', 70, 12, 'Bold'),
      line('The corpus contains one billion tokens drawn from public sources.', 100),
    ]),
  )
  const headings = blocks.filter((b) => b.kind === 'heading').map((b) => b.text)
  assert.deepEqual(headings, ['3 Building The Model', '3.1 Training Data'])

  const last = blocks[blocks.length - 1]
  assert.deepEqual(last.sectionPath, ['3 Building The Model', '3.1 Training Data'])
})

test('treats a bold table header as content, not a heading', () => {
  const blocks = assembleBlocks(
    page([
      line('Method AUPRC', 10, 10, 'Bold'),
      line('Our approach reaches the highest score across every evaluated benchmark.', 40),
    ]),
  )
  assert.equal(blocks.filter((b) => b.kind === 'heading').length, 0)
})

test('classifies a caption but not prose referring to a figure', () => {
  const caption = assembleBlocks(
    page([line('Figure 1 Example task instructions for the classifier.', 10)]),
  )
  assert.equal(caption[0].kind, 'caption')

  const prose = assembleBlocks(
    page([
      line('Figure 1 illustrates the prompt and response classification tasks we use.', 10),
    ]),
  )
  assert.equal(prose[0].kind, 'paragraph')
})

test('normalises bounding boxes into page fractions', () => {
  const blocks = assembleBlocks(
    page([line('A paragraph of ordinary body text that runs on for a while.', 80)]),
  )
  const { bbox } = blocks[0]
  for (const value of [bbox.x, bbox.y, bbox.w, bbox.h]) {
    assert.ok(value >= 0 && value <= 1, `${value} should be a page fraction`)
  }
  assert.ok(Math.abs(bbox.y - 80 / 800) < 0.01)
})
