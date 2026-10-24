/**
 * PDF -> DocumentBlocks.
 *
 * Uses pdfjs purely as a positioned-text source; all layout reasoning lives
 * in ./layout.ts and ./blocks.ts so it can be tested without a PDF.
 */
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import type { DocumentBlock, PaperMeta } from '../../shared/types.js'
import { EXTRACTION_VERSION } from '../../shared/types.js'
import { assembleBlocks, type PageLines } from './blocks.js'
import { layoutPage, type TextRun } from './layout.js'

const require = createRequire(import.meta.url)

/** pdfjs ships an ESM build that needs a DOM; the legacy build runs in Node. */
async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  return pdfjs
}

export interface ExtractionResult {
  meta: Omit<PaperMeta, 'id'>
  blocks: Omit<DocumentBlock, 'paperId'>[]
  warnings: string[]
}

export function hashFile(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex')
}

export async function extractPdf(
  data: Buffer,
  fileName: string,
): Promise<ExtractionResult> {
  const pdfjs = await loadPdfjs()
  const warnings: string[] = []

  const doc = await pdfjs.getDocument({
    data: new Uint8Array(data),
    // Imported documents are untrusted: no script evaluation, no network fetches.
    isEvalSupported: false,
    useSystemFonts: false,
    standardFontDataUrl: standardFontsDir(),
    verbosity: 0,
  }).promise

  const pages: PageLines[] = []

  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo)
    const viewport = page.getViewport({ scale: 1 })
    const content = await page.getTextContent()

    const runs: TextRun[] = []
    for (const item of content.items as any[]) {
      if (typeof item.str !== 'string' || item.str === '') continue
      const [a, b, , d, e, f] = item.transform as number[]
      const fontSize = Math.hypot(b, d) || Math.abs(d) || Math.abs(a) || 1
      const height = item.height || fontSize
      runs.push({
        text: item.str,
        x: e,
        // pdfjs y grows upward from the page bottom; blocks work top-down.
        y: viewport.height - f - height,
        width: item.width ?? 0,
        height,
        fontSize,
        fontName: (content.styles as any)?.[item.fontName]?.fontFamily ?? item.fontName ?? '',
      })
    }

    if (runs.length === 0) {
      warnings.push(`Page ${pageNo} contains no extractable text (likely a scan or image).`)
    }

    const lines = layoutPage(runs, viewport.width)
    pages.push({ page: pageNo, lines, width: viewport.width, height: viewport.height })
    page.cleanup()
  }

  const raw = assembleBlocks(pages)
  const blocks = raw.map((block, index) => ({
    id: `b${block.page}-${index}`,
    page: block.page,
    order: index,
    kind: block.kind,
    text: block.text,
    sectionPath: block.sectionPath,
    bbox: block.bbox,
    confidence: block.confidence,
  }))

  const pdfMeta = await doc.getMetadata().catch(() => null)
  const info = (pdfMeta?.info ?? {}) as Record<string, unknown>
  await doc.destroy()

  const derived = deriveMeta(blocks, info, fileName)
  if (!derived.abstract) warnings.push('No abstract was found in the extracted text.')
  if (blocks.length < 10) {
    warnings.push('Very few text blocks were extracted; the PDF may be image-only.')
  }

  return {
    meta: {
      ...derived,
      pageCount: doc.numPages,
      fileHash: hashFile(data),
      fileName,
      importedAt: new Date().toISOString(),
      extractionVersion: EXTRACTION_VERSION,
    },
    blocks,
    warnings,
  }
}

function standardFontsDir(): string {
  const entry = require.resolve('pdfjs-dist/package.json')
  return entry.replace(/package\.json$/, 'standard_fonts/')
}

type BlockLike = Omit<DocumentBlock, 'paperId'>

/**
 * Best-effort bibliographic metadata. The title is the first substantial
 * block on page one; the abstract is whatever follows the Abstract heading.
 * Both fall back cleanly rather than guessing.
 */
function deriveMeta(
  blocks: BlockLike[],
  info: Record<string, unknown>,
  fileName: string,
): Pick<PaperMeta, 'title' | 'authors' | 'year' | 'abstract'> {
  const firstPage = blocks.filter((b) => b.page === 1)

  const infoTitle = typeof info.Title === 'string' ? info.Title.trim() : ''
  const candidate = firstPage.find(
    (b) =>
      (b.kind === 'heading' || b.kind === 'paragraph') &&
      b.text.length > 12 &&
      b.text.length < 220 &&
      !/^abstract/i.test(b.text),
  )
  const title =
    (infoTitle.length > 8 ? infoTitle : '') ||
    candidate?.text ||
    fileName.replace(/\.pdf$/i, '')

  const abstractIndex = firstPage.findIndex((b) => /^abstract\b/i.test(b.text.trim()))
  let abstract = ''
  if (abstractIndex >= 0) {
    const head = firstPage[abstractIndex]
    const inline = head.text.replace(/^abstract\b[:.\s—-]*/i, '').trim()
    if (inline.length > 80) {
      abstract = inline
    } else {
      for (const block of firstPage.slice(abstractIndex + 1)) {
        if (block.kind === 'heading') break
        if (block.kind !== 'paragraph') continue
        abstract += (abstract ? ' ' : '') + block.text
        if (abstract.length > 1800) break
      }
    }
  }

  // Many papers print the abstract with no heading at all. Fall back to the
  // longest paragraph on page one that reads like an abstract.
  if (abstract.length < 120) {
    const preamble = firstPage.filter(
      (b) => b.kind === 'paragraph' && b.text.length > 200 && !/^\s*(https?:|doi)/i.test(b.text),
    )
    const best = preamble.sort((a, b) => b.text.length - a.text.length)[0]
    if (best) abstract = best.text
  }

  // Authors sit between the title and the abstract on page one.
  const titleIndex = candidate ? firstPage.indexOf(candidate) : -1
  let authors: string[] = []
  if (titleIndex >= 0) {
    const end = abstractIndex > titleIndex ? abstractIndex : titleIndex + 3
    const bylineText = firstPage
      .slice(titleIndex + 1, end)
      .filter((b) => b.text.length < 220 && !/^abstract/i.test(b.text))
      .map((b) => b.text)
      .join(', ')
    authors = bylineText
      .split(/,|\band\b|∗|\*|\d/)
      .map((s) => s.replace(/[^\p{L}.\-' ]/gu, '').trim())
      .filter((s) => /^\p{Lu}/u.test(s) && s.split(/\s+/).length >= 2 && s.length < 60)
      .slice(0, 12)
  }

  const yearMatch =
    /\b(19|20)\d{2}\b/.exec(typeof info.CreationDate === 'string' ? info.CreationDate : '') ??
    /\b(19|20)\d{2}\b/.exec(firstPage.map((b) => b.text).join(' '))
  const year = yearMatch ? Number(yearMatch[0]) : null

  return { title: title.slice(0, 300), authors, year, abstract: abstract.slice(0, 4000) }
}
