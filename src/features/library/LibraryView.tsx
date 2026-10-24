import { useCallback, useRef, useState } from 'react'
import type { PaperMeta } from '@shared/types'
import { api } from '@/lib/api'

interface Props {
  papers: PaperMeta[]
  onOpen: (paper: PaperMeta) => void
  onChanged: () => void
}

export function LibraryView({ papers, onOpen, onChanged }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])

  const importFile = useCallback(
    async (file: File) => {
      setBusy(true)
      setError(null)
      setWarnings([])
      try {
        const result = await api.importPdf(file)
        setWarnings(result.warnings)
        onChanged()
        if (result.warnings.length === 0) onOpen(result.paper)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setBusy(false)
      }
    },
    [onChanged, onOpen],
  )

  return (
    <div className="library">
      <h1 className="library__title">Your shelf</h1>
      <p className="library__lede">
        Import a paper and read it at whatever depth you need: the gist, the
        sections, every point it makes, or the full text with notes in the
        margin. Nothing is lost on the way down.
      </p>

      <div
        className={`dropzone${dragging ? ' dropzone--over' : ''}`}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          const file = event.dataTransfer.files[0]
          if (file) void importFile(file)
        }}
      >
        {busy ? (
          <span className="chip">
            <span className="spinner" /> Extracting…
          </span>
        ) : (
          <>
            <div style={{ marginBottom: 10 }}>Drop a PDF here</div>
            <button className="btn" onClick={() => inputRef.current?.click()}>
              Choose a file
            </button>
          </>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            if (file) void importFile(file)
            event.target.value = ''
          }}
        />
      </div>

      {error ? <div className="banner banner--error" style={{ marginTop: 14 }}>{error}</div> : null}
      {warnings.length > 0 ? (
        <div className="banner" style={{ marginTop: 14 }}>
          <strong>Extraction notes</strong>
          <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <ul className="shelf">
        {papers.map((paper) => (
          <li className="shelf__row" key={paper.id}>
            <button className="shelf__main" onClick={() => onOpen(paper)}>
              <div className="shelf__title">{paper.title}</div>
              <div className="shelf__meta">
                {paper.authors.slice(0, 2).join(', ')}
                {paper.authors.length > 2 ? ' et al.' : ''}
                {paper.year ? ` · ${paper.year}` : ''} · {paper.pageCount} pages
              </div>
            </button>
            <button
              className="btn btn--quiet"
              title="Delete this paper and everything generated from it"
              onClick={async () => {
                await api.deletePaper(paper.id)
                onChanged()
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {papers.length === 0 && !busy ? (
        <p style={{ color: 'var(--ink-3)', marginTop: 22 }}>Nothing on the shelf yet.</p>
      ) : null}
    </div>
  )
}
