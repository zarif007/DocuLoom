/**
 * Turns ordered lines into classified, section-aware blocks.
 *
 * Blocks are the unit of evidence: a citation points at a block id, and the
 * reader is taken to that block's rectangle in the PDF. Keeping them at
 * paragraph granularity is what makes "open the evidence" land on something
 * specific rather than on a whole page.
 */
import type { BBox, BlockKind } from '../../shared/types.js'
import { median, type Line } from './layout.js'

export interface RawBlock {
  page: number
  kind: BlockKind
  text: string
  sectionPath: string[]
  bbox: BBox
  confidence: number
}

// Matches a real caption ("Figure 1 Example task...", "Table 2: Results") but
// not prose that happens to start with a reference ("Figure 1 illustrates...").
// The case of the word after the number is the distinguishing signal, so the
// keyword alternation spells out its cases instead of using the /i flag.
const CAPTION_RE =
  /^(?:[Ff]ig(?:ure)?|FIGURE|[Tt]ab(?:le)?|TABLE|[Aa]lgorithm|ALGORITHM|[Ll]isting)\.?\s*\d+\s*[:.]?\s*(?=[A-Z("'‘“]|$)/
const NUMBERED_HEADING_RE = /^(\d+(?:\.\d+)*)\.?\s+(\S.*)$/
const UNNUMBERED_HEADING_RE =
  /^(abstract|introduction|related work|background|method|methods|methodology|approach|experiments?|experimental setup|evaluation|results?|discussion|limitations?|conclusions?|acknowledg(e)?ments?|references|bibliography|appendix)\b/i
const LIST_RE = /^([•·▪◦\-–—*]|\(?\d{1,2}[.)]|\(?[a-z][.)])\s+/i
const MATH_CHARS = /[=+−\-×÷±∑∏∫√≤≥≈≠∈∀∃∇∂⊕⊗→←↔αβγδθλμσφψωΔΣΩ]/g

function unionBBox(lines: Line[], pageWidth: number, pageHeight: number): BBox {
  const x = Math.min(...lines.map((l) => l.x))
  const y = Math.min(...lines.map((l) => l.y))
  const right = Math.max(...lines.map((l) => l.right))
  const bottom = Math.max(...lines.map((l) => l.bottom))
  return {
    x: clamp01(x / pageWidth),
    y: clamp01(y / pageHeight),
    w: clamp01((right - x) / pageWidth),
    h: clamp01((bottom - y) / pageHeight),
  }
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/** Repairs words split across lines by end-of-line hyphenation. */
export function joinLines(lines: Line[]): string {
  let out = ''
  for (const line of lines) {
    const text = line.text.trim()
    if (!out) {
      out = text
      continue
    }
    if (/[-­‐]$/.test(out) && /^[a-z]/.test(text)) {
      out = out.slice(0, -1) + text
    } else {
      out += ' ' + text
    }
  }
  return out.replace(/\s+/g, ' ').trim()
}

function isHeading(line: Line, bodyFontSize: number): boolean {
  const text = line.text.trim()
  if (!text || text.length > 90) return false
  if (CAPTION_RE.test(text)) return false

  const bigger = line.fontSize > bodyFontSize * 1.08
  const bold = /bold|black|semibold|heavy/i.test(line.fontName)
  const numbered = NUMBERED_HEADING_RE.test(text)
  const named = UNNUMBERED_HEADING_RE.test(text)
  const endsLikeSentence = /[.;,:]$/.test(text) && !numbered

  // "Method AUPRC" is a table header, not a section heading. Acronyms are
  // common in table headers and rare in the named sections we match here.
  const hasAcronym = /\b[A-Z]{3,}\b/.test(text.replace(/^(\d+(?:\.\d+)*)\.?\s+/, ''))
  if (named && !hasAcronym && (bigger || bold || text.length < 40)) return true
  if (numbered && (bigger || bold)) return true
  // A short, larger-than-body line that does not read as prose.
  const clearlyBigger = line.fontSize > bodyFontSize * 1.18
  if (clearlyBigger && bold && !endsLikeSentence && text.split(/\s+/).length <= 10) {
    return true
  }
  return false
}

function headingLevel(text: string): number {
  const match = NUMBERED_HEADING_RE.exec(text.trim())
  if (!match) return 1
  return match[1].split('.').length
}

function looksLikeEquation(line: Line, pageWidth: number, bodyFontSize: number): boolean {
  const text = line.text.trim()
  if (!text || text.length > 160) return false
  const mathCount = (text.match(MATH_CHARS) ?? []).length
  const letters = (text.match(/[a-zA-Z]/g) ?? []).length
  const words = text.split(/\s+/).filter((w) => w.length > 2).length
  // Equation lines are centred, symbol-heavy and short on real words.
  const centred =
    Math.abs((line.x + line.right) / 2 - pageWidth / 2) < pageWidth * 0.12 &&
    line.right - line.x < pageWidth * 0.8
  const numbered = /\(\d+\)\s*$/.test(text)
  const symbolRatio = mathCount / Math.max(1, text.length)

  if (numbered && mathCount >= 1) return true
  if (centred && symbolRatio > 0.04 && words <= 6) return true
  if (symbolRatio > 0.12 && letters < text.length * 0.5) return true
  if (line.fontSize < bodyFontSize * 0.98 && symbolRatio > 0.08 && words <= 4) return true
  return false
}

function classify(
  lines: Line[],
  text: string,
  pageWidth: number,
  pageHeight: number,
  bodyFontSize: number,
  sectionPath: string[],
): BlockKind {
  const inReferences = sectionPath.some((s) => /references|bibliography/i.test(s))
  if (inReferences) return 'reference'
  if (CAPTION_RE.test(text)) return 'caption'
  if (LIST_RE.test(text) && text.length < 400) return 'list'
  if (lines.every((l) => looksLikeEquation(l, pageWidth, bodyFontSize))) return 'equation'

  const bottomOfPage = lines[0].y / pageHeight > 0.88
  if (bottomOfPage && lines[0].fontSize < bodyFontSize * 0.85) return 'footnote'

  return 'paragraph'
}

/**
 * Lowers confidence for blocks we are less sure we reassembled correctly.
 * The UI shows this so readers know when to check the original themselves.
 */
function scoreConfidence(lines: Line[], text: string): number {
  let score = 1
  if (lines.length === 1 && text.length < 15) score -= 0.2
  // Wildly varying line starts usually means we merged across a column or figure.
  const starts = lines.map((l) => l.x)
  if (lines.length > 2 && Math.max(...starts) - Math.min(...starts) > 40) score -= 0.25
  const weird = (text.match(/[^\x20-\x7E -ɏͰ-Ͽ -⋿]/g) ?? []).length
  if (weird / Math.max(1, text.length) > 0.08) score -= 0.3
  return Math.max(0.2, Math.round(score * 100) / 100)
}

export interface PageLines {
  page: number
  lines: Line[]
  width: number
  height: number
}

/**
 * Walks every page in reading order, tracking the current section so each
 * block knows where it sits in the paper's structure.
 */
export function assembleBlocks(pages: PageLines[]): RawBlock[] {
  const allFontSizes = pages.flatMap((p) => p.lines.map((l) => l.fontSize))
  const bodyFontSize = median(allFontSizes) || 10

  const blocks: RawBlock[] = []
  let sectionPath: string[] = []

  for (const page of pages) {
    if (page.lines.length === 0) continue
    const gaps: number[] = []
    for (let i = 1; i < page.lines.length; i++) {
      const gap = page.lines[i].y - page.lines[i - 1].bottom
      if (gap > 0) gaps.push(gap)
    }
    const typicalGap = median(gaps) || bodyFontSize * 0.3

    let current: Line[] = []

    const flush = () => {
      if (current.length === 0) return
      const text = joinLines(current)
      if (text.length < 2) {
        current = []
        return
      }
      const kind = classify(
        current,
        text,
        page.width,
        page.height,
        bodyFontSize,
        sectionPath,
      )
      blocks.push({
        page: page.page,
        kind,
        text,
        sectionPath: [...sectionPath],
        bbox: unionBBox(current, page.width, page.height),
        confidence: scoreConfidence(current, text),
      })
      current = []
    }

    for (let i = 0; i < page.lines.length; i++) {
      const line = page.lines[i]
      const prev = page.lines[i - 1]

      if (isHeading(line, bodyFontSize)) {
        flush()
        const text = line.text.trim()
        const level = headingLevel(text)
        sectionPath = [...sectionPath.slice(0, level - 1), text]
        blocks.push({
          page: page.page,
          kind: 'heading',
          text,
          sectionPath: [...sectionPath],
          bbox: unionBBox([line], page.width, page.height),
          confidence: 1,
        })
        continue
      }

      if (prev) {
        const gap = line.y - prev.bottom
        const paragraphBreak = gap > Math.max(typicalGap * 1.8, bodyFontSize * 0.6)
        const columnJump = line.y < prev.y - bodyFontSize
        const captionStart = CAPTION_RE.test(line.text.trim())
        const listStart = LIST_RE.test(line.text.trim()) && gap > typicalGap * 0.9
        if (paragraphBreak || columnJump || captionStart || listStart) flush()
      }

      current.push(line)
    }
    flush()
  }

  return blocks
}
