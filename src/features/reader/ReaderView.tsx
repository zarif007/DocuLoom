import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { DocumentBlock, PaperMeta, Term, ZoomLevel } from '@shared/types'
import { api, type LensRun } from '@/lib/api'
import { FullText } from './FullText'
import { GistView, OutlineView, SkimView } from './Levels'
import { Rail } from './Rail'
import { TermPopover, type TermAnchor } from './TermPopover'
import { ZoomControl } from './ZoomControl'
import type { PdfTarget } from '@/features/paper-viewer/PdfViewer'

// pdfjs is most of the bundle and is not needed until a source is opened.
const PdfViewer = lazy(() =>
  import('@/features/paper-viewer/PdfViewer').then((m) => ({ default: m.PdfViewer })),
)

interface Props {
  paper: PaperMeta
  providerReady: boolean
  onOpenSettings: () => void
}

export function ReaderView({ paper, providerReady, onOpenSettings }: Props) {
  const [blocks, setBlocks] = useState<DocumentBlock[]>([])
  const [run, setRun] = useState<LensRun | null>(null)
  const [zoom, setZoom] = useState<ZoomLevel>('gist')
  const [preparing, setPreparing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<PdfTarget | null>(null)
  const [termAnchor, setTermAnchor] = useState<TermAnchor | null>(null)

  const scrollRef = useRef<HTMLDivElement>(null)
  /** The block the reader is looking at, carried across zoom changes. */
  const anchorRef = useRef<string | null>(null)
  const [activeBlockId, setActiveBlockId] = useState<string | null>(null)
  const pendingScroll = useRef<string | null>(null)

  const blocksById = useMemo(
    () => new Map(blocks.map((block) => [block.id, block])),
    [blocks],
  )

  useEffect(() => {
    setRun(null)
    setZoom('gist')
    setError(null)
    setTarget(null)
    anchorRef.current = null
    void api.getBlocks(paper.id).then(setBlocks)
    api
      .getLens(paper.id)
      .then(setRun)
      .catch(() => setRun(null))
  }, [paper.id])

  const prepare = useCallback(async () => {
    setPreparing(true)
    setError(null)
    try {
      const result = await api.prepare(paper.id)
      setRun(result)
      setZoom('gist')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPreparing(false)
    }
  }, [paper.id])

  const openSource = useCallback(
    (blockIds: string[]) => {
      const found = blockIds
        .map((id) => blocksById.get(id))
        .filter((block): block is DocumentBlock => Boolean(block))
      if (found.length === 0) return
      setTarget({ page: found[0].page, blocks: found, nonce: Date.now() })
    },
    [blocksById],
  )

  /** Scrolls to a block, or to the nearest one that exists at this level. */
  const scrollToBlock = useCallback(
    (blockId: string, behavior: ScrollBehavior = 'smooth') => {
      const root = scrollRef.current
      if (!root) return false
      const exact = root.querySelector<HTMLElement>(`[data-block="${CSS.escape(blockId)}"]`)
      if (exact) {
        exact.scrollIntoView({ block: 'start', behavior })
        return true
      }

      // The level we moved to may not render this block at all; land on the
      // closest one that is rendered so the reader keeps their place.
      const wanted = blocksById.get(blockId)?.order
      if (wanted === undefined) return false
      const candidates = [...root.querySelectorAll<HTMLElement>('[data-block]')]
        .map((el) => ({ el, order: blocksById.get(el.dataset.block ?? '')?.order }))
        .filter((entry): entry is { el: HTMLElement; order: number } => entry.order !== undefined)
      if (candidates.length === 0) return false

      const nearest = candidates.reduce((closest, entry) =>
        Math.abs(entry.order - wanted) < Math.abs(closest.order - wanted) ? entry : closest,
      )
      nearest.el.scrollIntoView({ block: 'start', behavior })
      return true
    },
    [blocksById],
  )

  // Track the topmost visible block so a zoom change can return to it.
  useEffect(() => {
    const root = scrollRef.current
    if (!root || !run) return
    let frame = 0
    const onScroll = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => {
        frame = 0
        const top = root.getBoundingClientRect().top + 90
        let current: string | null = null
        for (const el of root.querySelectorAll<HTMLElement>('[data-block]')) {
          if (el.getBoundingClientRect().top <= top) current = el.dataset.block ?? null
          else break
        }
        if (current) {
          anchorRef.current = current
          setActiveBlockId(current)
        }
      })
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => {
      root.removeEventListener('scroll', onScroll)
      if (frame) window.cancelAnimationFrame(frame)
    }
  }, [run, zoom])

  // After a zoom change, restore the reader's position in the new level.
  useLayoutEffect(() => {
    const blockId = pendingScroll.current
    if (!blockId) return
    pendingScroll.current = null
    scrollToBlock(blockId, 'auto')
  }, [zoom, scrollToBlock])

  const changeZoom = useCallback((level: ZoomLevel) => {
    // Gist is a single statement with nowhere to land, so it always starts
    // at the top; every other level keeps the reader where they were.
    pendingScroll.current = level === 'gist' ? null : anchorRef.current
    setZoom(level)
    if (level === 'gist') scrollRef.current?.scrollTo({ top: 0 })
  }, [])

  /** Zooming in from a summary lands on the thing that was summarised. */
  const diveTo = useCallback(
    (blockId: string, level: ZoomLevel) => {
      anchorRef.current = blockId
      pendingScroll.current = blockId
      setZoom(level)
    },
    [],
  )

  const jumpToBlock = useCallback(
    (blockId: string) => {
      if (zoom === 'gist' || zoom === 'outline') diveTo(blockId, 'skim')
      else scrollToBlock(blockId)
    },
    [zoom, diveTo, scrollToBlock],
  )

  if (target) {
    return (
      <Suspense
        fallback={
          <div className="empty">
            <span className="spinner" /> Opening the document…
          </div>
        }
      >
        <PdfViewer
          url={api.pdfUrl(paper.id)}
          target={target}
          onClose={() => setTarget(null)}
        />
      </Suspense>
    )
  }

  if (!run) {
    return (
      <div className="empty">
        <div className="empty__title">Not prepared yet</div>
        <p className="empty__body">
          DocuLoom will read this paper and build its four levels: the gist, a
          summary of each section, one line for every point it makes, and the
          full text with notes in the margin.
        </p>
        {error ? <div className="banner banner--error">{error}</div> : null}
        {providerReady ? (
          <button className="btn btn--primary" onClick={prepare} disabled={preparing}>
            {preparing ? (
              <>
                <span className="spinner" /> Reading the paper…
              </>
            ) : (
              'Prepare this paper'
            )}
          </button>
        ) : (
          <button className="btn" onClick={onOpenSettings}>
            Choose a model provider first
          </button>
        )}
      </div>
    )
  }

  const { lens, report } = run

  return (
    <>
      <div className="topbar" style={{ borderTop: '1px solid var(--rule)' }}>
        <ZoomControl value={zoom} onChange={changeZoom} />
        <span className="spacer" />
        <span
          className="chip"
          title={`${report.direct} statements quote a passage that was found; ${report.inferred} cite real passages without a confirmed quote.`}
        >
          <span className="support-dot" />
          {report.direct} verified
          {report.inferred > 0 ? ` · ${report.inferred} inferred` : ''}
          {report.unverified > 0 ? ` · ${report.unverified} unchecked` : ''}
        </span>
        <button className="btn btn--quiet" onClick={() => openSource([blocks[0]?.id])}>
          Original
        </button>
        <button className="btn btn--quiet" onClick={prepare} disabled={preparing}>
          {preparing ? 'Re-reading…' : 'Re-read'}
        </button>
      </div>

      <div className="reader-scroll" ref={scrollRef}>
        <div className={`reader${lens.notes.length === 0 ? ' reader--bare' : ''}`}>
          {zoom === 'gist' ? (
            <GistView
              lens={lens}
              paper={paper}
              blocksById={blocksById}
              onOpenSource={openSource}
            />
          ) : null}
          {zoom === 'outline' ? (
            <OutlineView
              lens={lens}
              blocksById={blocksById}
              onOpenSource={openSource}
              onDive={(blockId) => diveTo(blockId, 'skim')}
            />
          ) : null}
          {zoom === 'skim' ? (
            <SkimView
              lens={lens}
              blocksById={blocksById}
              onOpenSource={openSource}
              onDive={(blockId) => diveTo(blockId, 'full')}
            />
          ) : null}
          {zoom === 'full' ? (
            <FullText
              paper={paper}
              lens={lens}
              blocks={blocks}
              blocksById={blocksById}
              onOpenSource={openSource}
              onOpenTerm={(term: Term, rect: DOMRect) => setTermAnchor({ term, rect })}
            />
          ) : null}
        </div>
      </div>

      <Rail
        lens={lens}
        blocksById={blocksById}
        activeBlockId={activeBlockId}
        onJump={jumpToBlock}
      />
      <TermPopover
        anchor={termAnchor}
        onClose={() => setTermAnchor(null)}
        onJump={(blockId) => {
          anchorRef.current = blockId
          scrollToBlock(blockId)
        }}
      />
    </>
  )
}
