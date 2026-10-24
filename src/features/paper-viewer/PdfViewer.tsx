import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { DocumentBlock } from '@shared/types'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

export interface PdfTarget {
  page: number
  blocks: DocumentBlock[]
  /** Changes on every jump so repeat clicks re-trigger the highlight. */
  nonce: number
}

interface Props {
  url: string
  target: PdfTarget | null
  onClose: () => void
}

/**
 * Renders one page at a time with the cited rectangles drawn over it.
 *
 * Block boxes are stored normalised to the page, so they survive any zoom
 * level and any device pixel ratio without a second coordinate system.
 */
export function PdfViewer({ url, target, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null)
  const renderRef = useRef<pdfjsLib.RenderTask | null>(null)
  const highlightRef = useRef<HTMLDivElement>(null)

  const [page, setPage] = useState(target?.page ?? 1)
  const [pageCount, setPageCount] = useState(0)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(null)
    const task = pdfjsLib.getDocument({ url, isEvalSupported: false })
    task.promise.then(
      (doc) => {
        if (cancelled) {
          void doc.destroy()
          return
        }
        docRef.current = doc
        setPageCount(doc.numPages)
      },
      (err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      },
    )
    return () => {
      cancelled = true
      void task.destroy()
      docRef.current = null
    }
  }, [url])

  useEffect(() => {
    if (target) setPage(target.page)
  }, [target])

  useEffect(() => {
    const doc = docRef.current
    if (!doc || page < 1 || page > doc.numPages) return
    let cancelled = false

    void (async () => {
      const pdfPage = await doc.getPage(page)
      if (cancelled) return

      const canvas = canvasRef.current
      const container = containerRef.current
      if (!canvas || !container) return

      const available = Math.max(320, container.clientWidth - 28)
      const unscaled = pdfPage.getViewport({ scale: 1 })
      const scale = available / unscaled.width
      const viewport = pdfPage.getViewport({ scale })
      const ratio = window.devicePixelRatio || 1

      canvas.width = Math.floor(viewport.width * ratio)
      canvas.height = Math.floor(viewport.height * ratio)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      setSize({ width: viewport.width, height: viewport.height })

      const context = canvas.getContext('2d')
      if (!context) return
      context.setTransform(ratio, 0, 0, ratio, 0, 0)

      // Cancel any in-flight render before starting another on this canvas.
      renderRef.current?.cancel()
      const task = pdfPage.render({ canvasContext: context, viewport })
      renderRef.current = task
      await task.promise.catch(() => undefined)
      if (!cancelled) renderRef.current = null
    })()

    return () => {
      cancelled = true
    }
  }, [page, pageCount])

  const highlights = target?.page === page ? target.blocks : []

  // Landing on the right page is not enough: the cited passage is often
  // well below the fold, so bring it into view once the page has rendered.
  useEffect(() => {
    if (highlights.length === 0 || size.height === 0) return
    const frame = window.requestAnimationFrame(() => {
      highlightRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    })
    return () => window.cancelAnimationFrame(frame)
  }, [target?.nonce, page, size.height, highlights.length])

  return (
    <div className="pane" style={{ height: '100%' }}>
      <div className="pane__header">
        source document
        <span className="topbar__spacer" />
        <button
          className="btn btn--ghost"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          ‹
        </button>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>
          {page} / {pageCount || '…'}
        </span>
        <button
          className="btn btn--ghost"
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          disabled={page >= pageCount}
          aria-label="Next page"
        >
          ›
        </button>
        <button className="btn btn--ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="pdf" ref={containerRef}>
        {error ? (
          <div className="banner banner--error">Could not open the PDF: {error}</div>
        ) : null}
        <div className="pdf__page" key={target?.nonce ?? 'static'}>
          <canvas ref={canvasRef} />
          {highlights.map((block, index) => (
            <div
              className="pdf__highlight"
              key={block.id}
              ref={index === 0 ? highlightRef : undefined}
              style={{
                left: block.bbox.x * size.width - 2,
                top: block.bbox.y * size.height - 2,
                width: block.bbox.w * size.width + 4,
                height: block.bbox.h * size.height + 4,
              }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
