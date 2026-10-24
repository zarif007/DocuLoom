/** Typed access to the local store. All SQL lives here. */
import type {
  DocumentBlock,
  PaperLens,
  PaperMeta,
  VerificationReport,
} from '../../shared/types.js'
import { getDb } from './index.js'

interface PaperRow {
  id: string
  title: string
  authors: string
  year: number | null
  abstract: string
  page_count: number
  file_hash: string
  file_name: string
  imported_at: string
  extraction_version: number
}

interface BlockRow {
  id: string
  paper_id: string
  page: number
  ord: number
  kind: string
  text: string
  section_path: string
  bbox: string
  confidence: number
}

function toPaper(row: PaperRow): PaperMeta {
  return {
    id: row.id,
    title: row.title,
    authors: JSON.parse(row.authors),
    year: row.year,
    abstract: row.abstract,
    pageCount: row.page_count,
    fileHash: row.file_hash,
    fileName: row.file_name,
    importedAt: row.imported_at,
    extractionVersion: row.extraction_version,
  }
}

function toBlock(row: BlockRow): DocumentBlock {
  return {
    id: row.id,
    paperId: row.paper_id,
    page: row.page,
    order: row.ord,
    kind: row.kind as DocumentBlock['kind'],
    text: row.text,
    sectionPath: JSON.parse(row.section_path),
    bbox: JSON.parse(row.bbox),
    confidence: row.confidence,
  }
}

export function listPapers(): PaperMeta[] {
  return (
    getDb()
      .prepare('SELECT * FROM papers ORDER BY imported_at DESC')
      .all() as PaperRow[]
  ).map(toPaper)
}

export function getPaper(id: string): PaperMeta | null {
  const row = getDb()
    .prepare('SELECT * FROM papers WHERE id = ?')
    .get(id) as PaperRow | undefined
  return row ? toPaper(row) : null
}

export function findPaperByHash(hash: string): PaperMeta | null {
  const row = getDb()
    .prepare('SELECT * FROM papers WHERE file_hash = ?')
    .get(hash) as PaperRow | undefined
  return row ? toPaper(row) : null
}

/** Writes a paper and its blocks in one transaction. */
export function insertPaperWithBlocks(paper: PaperMeta, blocks: DocumentBlock[]) {
  const db = getDb()
  const insertPaper = db.prepare(`
    INSERT INTO papers (id, title, authors, year, abstract, page_count,
                        file_hash, file_name, imported_at, extraction_version)
    VALUES (@id, @title, @authors, @year, @abstract, @page_count,
            @file_hash, @file_name, @imported_at, @extraction_version)
  `)
  const insertBlock = db.prepare(`
    INSERT INTO blocks (id, paper_id, page, ord, kind, text, section_path, bbox, confidence)
    VALUES (@id, @paper_id, @page, @ord, @kind, @text, @section_path, @bbox, @confidence)
  `)
  const insertFts = db.prepare(
    'INSERT INTO blocks_fts (text, block_id, paper_id) VALUES (?, ?, ?)',
  )

  db.transaction(() => {
    insertPaper.run({
      id: paper.id,
      title: paper.title,
      authors: JSON.stringify(paper.authors),
      year: paper.year,
      abstract: paper.abstract,
      page_count: paper.pageCount,
      file_hash: paper.fileHash,
      file_name: paper.fileName,
      imported_at: paper.importedAt,
      extraction_version: paper.extractionVersion,
    })
    for (const b of blocks) {
      insertBlock.run({
        id: b.id,
        paper_id: paper.id,
        page: b.page,
        ord: b.order,
        kind: b.kind,
        text: b.text,
        section_path: JSON.stringify(b.sectionPath),
        bbox: JSON.stringify(b.bbox),
        confidence: b.confidence,
      })
      insertFts.run(b.text, b.id, paper.id)
    }
  })()
}

export function getBlocks(paperId: string): DocumentBlock[] {
  return (
    getDb()
      .prepare('SELECT * FROM blocks WHERE paper_id = ? ORDER BY ord')
      .all(paperId) as BlockRow[]
  ).map(toBlock)
}

export function getBlocksByIds(paperId: string, ids: string[]): DocumentBlock[] {
  if (ids.length === 0) return []
  const holes = ids.map(() => '?').join(',')
  return (
    getDb()
      .prepare(`SELECT * FROM blocks WHERE paper_id = ? AND id IN (${holes}) ORDER BY ord`)
      .all(paperId, ...ids) as BlockRow[]
  ).map(toBlock)
}

/** Keyword search over one paper's blocks, best matches first. */
export function searchBlocks(paperId: string, query: string, limit = 20): DocumentBlock[] {
  const sanitised = query
    .replace(/["*]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => `"${t}"`)
    .join(' OR ')
  if (!sanitised) return []
  const rows = getDb()
    .prepare(
      `SELECT b.* FROM blocks_fts f
       JOIN blocks b ON b.id = f.block_id AND b.paper_id = f.paper_id
       WHERE f.paper_id = ? AND blocks_fts MATCH ?
       ORDER BY rank LIMIT ?`,
    )
    .all(paperId, sanitised, limit) as BlockRow[]
  return rows.map(toBlock)
}

export function saveLens(lens: PaperLens, report: VerificationReport) {
  getDb()
    .prepare(
      `INSERT INTO lenses (paper_id, schema_version, payload, report, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(paper_id) DO UPDATE SET
         schema_version = excluded.schema_version,
         payload = excluded.payload,
         report = excluded.report,
         created_at = excluded.created_at`,
    )
    .run(
      lens.paperId,
      lens.schemaVersion,
      JSON.stringify(lens),
      JSON.stringify(report),
      new Date().toISOString(),
    )
}

export function getLens(
  paperId: string,
): { lens: PaperLens; report: VerificationReport } | null {
  const row = getDb()
    .prepare('SELECT payload, report FROM lenses WHERE paper_id = ?')
    .get(paperId) as { payload: string; report: string } | undefined
  if (!row) return null
  return { lens: JSON.parse(row.payload), report: JSON.parse(row.report) }
}

/** Removes the paper, its blocks and its generated lens. */
export function deletePaper(paperId: string) {
  const db = getDb()
  db.transaction(() => {
    db.prepare('DELETE FROM blocks_fts WHERE paper_id = ?').run(paperId)
    db.prepare('DELETE FROM papers WHERE id = ?').run(paperId)
  })()
}

export function getSetting(key: string): string | null {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string) {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value)
}
