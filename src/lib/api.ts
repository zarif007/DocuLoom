/** Typed client for the local DocuLoom server. */
import type {
  DocumentBlock,
  PaperLens,
  PaperMeta,
  VerificationReport,
} from '@shared/types'

export interface ProviderStatus {
  id: string
  label: string
  model: string
  local: boolean
  configured: boolean
  detail: string
}

export interface ImportResult {
  paper: PaperMeta
  alreadyImported: boolean
  warnings: string[]
}

export interface LensRun {
  lens: PaperLens
  report: VerificationReport
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, init)
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error ?? `Request failed (${res.status})`)
  }
  return (await res.json()) as T
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  listPapers: () => request<PaperMeta[]>('/papers'),

  importPdf: async (file: File): Promise<ImportResult> =>
    request<ImportResult>('/papers', {
      method: 'POST',
      headers: {
        'content-type': 'application/pdf',
        'x-doculoom-filename': encodeURIComponent(file.name).replace(/%20/g, ' '),
      },
      body: await file.arrayBuffer(),
    }),

  deletePaper: (id: string) => request<{ ok: true }>(`/papers/${id}`, { method: 'DELETE' }),

  getBlocks: (id: string) => request<DocumentBlock[]>(`/papers/${id}/blocks`),

  searchBlocks: (id: string, query: string) =>
    request<DocumentBlock[]>(`/papers/${id}/search?q=${encodeURIComponent(query)}`),

  getLens: (id: string) => request<LensRun>(`/papers/${id}/lens`),

  prepare: (id: string, provider?: string) =>
    request<LensRun>(`/papers/${id}/lens`, json({ provider })),

  getProviders: () =>
    request<{ active: string; providers: ProviderStatus[] }>('/providers'),

  setProvider: (id: string) => request<{ ok: true }>('/providers/active', json({ id })),

  setKey: (id: string, key: string) =>
    request<{ ok: true }>(`/providers/${id}/key`, json({ key })),

  pdfUrl: (id: string) => `/api/papers/${id}/file`,
}
