import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  detectColumnSplit,
  groupIntoLines,
  layoutPage,
  splitLinesAtGutter,
  type TextRun,
} from '../server/extraction/layout.js'

const PAGE = 600

function run(text: string, x: number, y: number, width: number): TextRun {
  return { text, x, y, width, height: 10, fontSize: 10, fontName: 'Serif' }
}

/** Two columns of body text with a 40pt gutter at x=280..320. */
function twoColumnRuns(rows = 30): TextRun[] {
  const runs: TextRun[] = []
  for (let i = 0; i < rows; i++) {
    const y = 60 + i * 14
    runs.push(run(`left line ${i}`, 60, y, 220))
    runs.push(run(`right line ${i}`, 320, y, 220))
  }
  return runs
}

test('groups runs sharing a baseline into one line', () => {
  const lines = groupIntoLines([run('Hello', 10, 20, 40), run('world', 55, 21, 40)])
  assert.equal(lines.length, 1)
  assert.equal(lines[0].text, 'Hello world')
})

test('keeps separate baselines as separate lines', () => {
  const lines = groupIntoLines([run('first', 10, 20, 40), run('second', 10, 60, 40)])
  assert.equal(lines.length, 2)
})

test('detects the gutter on a two-column page', () => {
  const split = detectColumnSplit(twoColumnRuns(), PAGE)
  assert.ok(split !== null, 'expected a column split')
  assert.ok(split! > 270 && split! < 330, `split ${split} should sit in the gutter`)
})

test('reports no gutter on a single-column page', () => {
  const runs: TextRun[] = []
  for (let i = 0; i < 40; i++) runs.push(run(`full width line ${i}`, 60, 60 + i * 14, 480))
  assert.equal(detectColumnSplit(runs, PAGE), null)
})

test('finds the gutter even when a full-width title crosses it', () => {
  const runs = twoColumnRuns()
  // A title and byline spanning both columns, as on page one of a paper.
  runs.push(run('A Full Width Paper Title Spanning Both Columns', 60, 20, 480))
  runs.push(run('Author One, Author Two, Author Three', 60, 36, 480))
  const split = detectColumnSplit(runs, PAGE)
  assert.ok(split !== null, 'a crossing title must not hide the gutter')
  assert.ok(split! > 270 && split! < 330)
})

test('splits a line that merged across the gutter', () => {
  // One baseline carrying text from both columns.
  const merged = groupIntoLines([
    run('left column text', 60, 100, 200),
    run('right column text', 320, 100, 200),
  ])
  assert.equal(merged.length, 1, 'precondition: the two columns merged')
  const split = splitLinesAtGutter(merged, 300)
  assert.equal(split.length, 2)
  assert.equal(split[0].text, 'left column text')
  assert.equal(split[1].text, 'right column text')
})

test('leaves a genuine full-width line intact', () => {
  const line = groupIntoLines([run('A Title Spanning The Whole Page Width', 60, 20, 480)])
  assert.equal(splitLinesAtGutter(line, 300).length, 1)
})

test('orders a two-column page left column before right', () => {
  const ordered = layoutPage(twoColumnRuns(), PAGE)
  const texts = ordered.map((l) => l.text)
  const lastLeft = texts.lastIndexOf('left line 29')
  const firstRight = texts.indexOf('right line 0')
  assert.ok(lastLeft >= 0 && firstRight >= 0)
  assert.ok(lastLeft < firstRight, 'the whole left column must come first')
})
