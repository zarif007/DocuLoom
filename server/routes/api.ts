/**
 * Local HTTP API. The frontend talks only to this; nothing here reaches the
 * network except through a provider the user has selected.
 */
import { Router, type Request, type Response } from 'express'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { nanoid } from 'nanoid'
import { generateLens } from '../analysis/lens.js'
import { PAPERS_DIR } from '../db/index.js'
import * as repo from '../db/repo.js'
import { extractPdf, hashFile } from '../extraction/pdf.js'
import {
  getProvider,
  providerStatuses,
  setActiveProvider,
  ProviderError,
} from '../providers/index.js'
import { deleteKey, writeKey } from '../providers/keystore.js'

export const api = Router()

function paperFile(paperId: string) {
  return join(PAPERS_DIR, `${paperId}.pdf`)
}

/** Wraps a handler so a thrown error becomes a clean JSON response. */
function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    fn(req, res).catch((error: unknown) => {
      const status = error instanceof ProviderError ? 502 : 500
      const message = error instanceof Error ? error.message : String(error)
      // Logged without the request body, which may contain paper text.
      console.error(`[api] ${req.method} ${req.path} failed: ${message}`)
      if (!res.headersSent) res.status(status).json({ error: message })
    })
  }
}

api.get('/papers', (_req, res) => {
  res.json(repo.listPapers())
})

api.post(
  '/papers',
  handle(async (req, res) => {
    const data = req.body as Buffer
    if (!Buffer.isBuffer(data) || data.length === 0) {
      res.status(400).json({ error: 'Expected a PDF body.' })
      return
    }
    if (data.subarray(0, 5).toString('latin1') !== '%PDF-') {
      res.status(400).json({ error: 'That file is not a PDF.' })
      return
    }

    const fileName = String(req.header('x-doculoom-filename') ?? 'paper.pdf')
    const existing = repo.findPaperByHash(hashFile(data))
    if (existing) {
      res.json({ paper: existing, alreadyImported: true, warnings: [] })
      return
    }

    const extraction = await extractPdf(data, fileName)
    const paperId = nanoid(12)
    const paper = { ...extraction.meta, id: paperId }
    const blocks = extraction.blocks.map((b) => ({ ...b, paperId }))

    writeFileSync(paperFile(paperId), data)
    try {
      repo.insertPaperWithBlocks(paper, blocks)
    } catch (error) {
      rmSync(paperFile(paperId), { force: true })
      throw error
    }

    res.json({ paper, alreadyImported: false, warnings: extraction.warnings })
  }),
)

api.get('/papers/:id', (req, res) => {
  const paper = repo.getPaper(req.params.id)
  if (!paper) {
    res.status(404).json({ error: 'No such paper.' })
    return
  }
  res.json(paper)
})

api.delete('/papers/:id', (req, res) => {
  repo.deletePaper(req.params.id)
  rmSync(paperFile(req.params.id), { force: true })
  res.json({ ok: true })
})

api.get('/papers/:id/blocks', (req, res) => {
  res.json(repo.getBlocks(req.params.id))
})

api.get('/papers/:id/file', (req, res) => {
  const path = paperFile(req.params.id)
  if (!existsSync(path)) {
    res.status(404).json({ error: 'The stored PDF is missing.' })
    return
  }
  res.type('application/pdf').send(readFileSync(path))
})

api.get('/papers/:id/search', (req, res) => {
  const query = String(req.query.q ?? '')
  res.json(repo.searchBlocks(req.params.id, query))
})

api.get('/papers/:id/lens', (req, res) => {
  const stored = repo.getLens(req.params.id)
  if (!stored) {
    res.status(404).json({ error: 'This paper has not been prepared yet.' })
    return
  }
  res.json(stored)
})

api.post(
  '/papers/:id/lens',
  handle(async (req, res) => {
    const paper = repo.getPaper(req.params.id)
    if (!paper) {
      res.status(404).json({ error: 'No such paper.' })
      return
    }
    const blocks = repo.getBlocks(paper.id)
    const provider = getProvider(req.body?.provider)
    const run = await generateLens(paper.id, blocks, provider)
    repo.saveLens(run.lens, run.report)
    res.json(run)
  }),
)

api.get(
  '/providers',
  handle(async (_req, res) => {
    res.json({
      active: repo.getSetting('provider') ?? 'anthropic',
      providers: await providerStatuses(),
    })
  }),
)

api.post('/providers/active', (req, res) => {
  const id = String(req.body?.id ?? '')
  setActiveProvider(id)
  res.json({ ok: true, active: id })
})

/** Stores a key in the OS credential store. The key is never read back out. */
api.post(
  '/providers/:id/key',
  handle(async (req, res) => {
    const key = String(req.body?.key ?? '').trim()
    if (key) await writeKey(req.params.id, key)
    else await deleteKey(req.params.id)
    res.json({ ok: true })
  }),
)
