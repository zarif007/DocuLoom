import type { DocumentBlock, PaperLens, PaperMeta } from '@shared/types'
import { BEAT_COLOUR } from './kinds'

interface SourceProps {
  blockIds: string[]
  blocksById: Map<string, DocumentBlock>
  onOpen: (blockIds: string[]) => void
}

/** The quiet "show me where this came from" affordance. */
export function Source({ blockIds, blocksById, onOpen }: SourceProps) {
  const pages = [...new Set(blockIds.map((id) => blocksById.get(id)?.page).filter(Boolean))]
  if (pages.length === 0) return null
  return (
    <button
      className="src"
      onClick={(event) => {
        event.stopPropagation()
        onOpen(blockIds)
      }}
      title="Open the original page"
    >
      p{pages.join(', ')}
    </button>
  )
}

/** Level 1. The paper in a breath. */
export function GistView({
  lens,
  paper,
  blocksById,
  onOpenSource,
}: {
  lens: PaperLens
  paper: PaperMeta
  blocksById: Map<string, DocumentBlock>
  onOpenSource: (blockIds: string[]) => void
}) {
  return (
    <div className="gist">
      <div className="gist__label">The short of it</div>
      <p className="gist__drop" style={{ margin: 0 }}>
        {lens.gist}
      </p>
      <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 10 }}>
        <span className={`support-dot support-dot--${lens.gistSupport}`} />
        <span style={{ fontFamily: 'var(--sans)', fontSize: 12.5, color: 'var(--ink-3)' }}>
          {paper.authors.slice(0, 3).join(', ')}
          {paper.authors.length > 3 ? ' et al.' : ''}
          {paper.year ? ` · ${paper.year}` : ''} · {paper.pageCount} pages
        </span>
        <Source
          blockIds={lens.gistEvidence.blockIds}
          blocksById={blocksById}
          onOpen={onOpenSource}
        />
      </div>
    </div>
  )
}

/** Level 2. One paragraph per section. */
export function OutlineView({
  lens,
  blocksById,
  onOpenSource,
  onDive,
}: {
  lens: PaperLens
  blocksById: Map<string, DocumentBlock>
  onOpenSource: (blockIds: string[]) => void
  onDive: (blockId: string) => void
}) {
  if (lens.sections.length === 0) {
    return <p className="empty__body">No sections were summarised for this paper.</p>
  }
  return (
    <div className="outline-list">
      {lens.sections.map((section) => {
        const anchor = section.headingBlockId ?? section.evidence.blockIds[0]
        return (
          <button
            key={section.id}
            className={`outline-card${section.importance === 1 ? ' outline-card--key' : ''}`}
            data-block={anchor ?? undefined}
            onClick={() => anchor && onDive(anchor)}
          >
            <div className="outline-card__head">{section.heading}</div>
            <div className="outline-card__body">{section.summary}</div>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className={`support-dot support-dot--${section.support}`} />
              <Source
                blockIds={section.evidence.blockIds}
                blocksById={blocksById}
                onOpen={onOpenSource}
              />
            </div>
          </button>
        )
      })}
    </div>
  )
}

/** Level 3. Every point the paper makes, and nothing else. */
export function SkimView({
  lens,
  blocksById,
  onOpenSource,
  onDive,
}: {
  lens: PaperLens
  blocksById: Map<string, DocumentBlock>
  onOpenSource: (blockIds: string[]) => void
  onDive: (blockId: string) => void
}) {
  if (lens.beats.length === 0) {
    return <p className="empty__body">No paragraph-level points were produced.</p>
  }

  let lastSection = ''
  return (
    <div className="skim-list">
      {lens.beats.map((beat) => {
        const block = blocksById.get(beat.blockId)
        const section = block?.sectionPath[block.sectionPath.length - 1] ?? ''
        const showSection = section && section !== lastSection
        if (showSection) lastSection = section
        return (
          <div key={beat.blockId}>
            {showSection ? <div className="beat__sect">{section}</div> : null}
            <button
              className={`beat beat--i${beat.importance}`}
              data-block={beat.blockId}
              style={{ ['--kind' as string]: BEAT_COLOUR[beat.kind] }}
              onClick={() => onDive(beat.blockId)}
              title="Read this paragraph in full"
            >
              <span className="beat__mark" />
              <span className="beat__text">
                {beat.claim}
                <Source
                  blockIds={beat.evidence.blockIds}
                  blocksById={blocksById}
                  onOpen={onOpenSource}
                />
              </span>
            </button>
          </div>
        )
      })}
    </div>
  )
}
