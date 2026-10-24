import { useMemo } from 'react'
import type { DocumentBlock, MarginNote, PaperLens, PaperMeta, Term } from '@shared/types'
import { NOTE_COLOUR, NOTE_LABEL } from './kinds'
import { Source } from './Levels'
import { buildTermIndex, renderWithTerms } from './terms'

interface Props {
  paper: PaperMeta
  lens: PaperLens
  blocks: DocumentBlock[]
  blocksById: Map<string, DocumentBlock>
  onOpenSource: (blockIds: string[]) => void
  onOpenTerm: (term: Term, rect: DOMRect) => void
}

/** Blocks that read as prose and can carry glossary marks. */
const PROSE_KINDS = new Set(['paragraph', 'list', 'caption', 'footnote'])

/**
 * Level 4. The paper's own text, with the annotator's margin beside it.
 *
 * Nothing is rewritten here: every word is what extraction found. The only
 * additions are in the margin, which is why the margin is visually separate
 * rather than interleaved with the text.
 */
export function FullText({
  paper,
  lens,
  blocks,
  blocksById,
  onOpenSource,
  onOpenTerm,
}: Props) {
  const termIndex = useMemo(() => buildTermIndex(lens.terms), [lens.terms])

  const notesByBlock = useMemo(() => {
    const map = new Map<string, MarginNote[]>()
    for (const note of lens.notes) {
      const list = map.get(note.blockId)
      if (list) list.push(note)
      else map.set(note.blockId, [note])
    }
    return map
  }, [lens.notes])

  return (
    <>
      <header className="paper-head">
        <h1>{paper.title}</h1>
        <div className="paper-head__meta">
          {paper.authors.slice(0, 6).join(' · ')}
          {paper.authors.length > 6 ? ' et al.' : ''}
          {paper.year ? ` — ${paper.year}` : ''}
        </div>
      </header>

      {blocks.map((block) => {
        if (block.kind === 'heading') {
          const level = Math.min(block.sectionPath.length, 2)
          const Tag = (level <= 1 ? 'h2' : 'h3') as 'h2' | 'h3'
          return (
            <div className="passage" key={block.id} data-block={block.id}>
              <div className="passage__body">
                <Tag className="section-head">{block.text}</Tag>
              </div>
              <div className="passage__margin" />
            </div>
          )
        }

        const notes = notesByBlock.get(block.id) ?? []
        const body = PROSE_KINDS.has(block.kind)
          ? renderWithTerms(block.text, termIndex, onOpenTerm)
          : block.text

        return (
          <article className="passage" key={block.id} data-block={block.id}>
            <div className="passage__body">
              <p className={`prose prose--${block.kind}`}>
                {body}
                <Source
                  blockIds={[block.id]}
                  blocksById={blocksById}
                  onOpen={onOpenSource}
                />
                {block.confidence < 0.6 ? (
                  <span
                    className="src"
                    style={{ opacity: 1, color: 'var(--support-inferred)' }}
                    title="This passage was hard to extract cleanly. Check it against the PDF."
                  >
                    ?
                  </span>
                ) : null}
              </p>
            </div>

            <aside className="passage__margin">
              {notes.map((note) => (
                <button
                  key={note.id}
                  className="note"
                  style={{ ['--note' as string]: NOTE_COLOUR[note.kind] }}
                  onClick={() => onOpenSource(note.evidence.blockIds)}
                  title="Open the passage this note is about"
                >
                  <div className="note__kind">{NOTE_LABEL[note.kind]}</div>
                  {note.text}
                </button>
              ))}
            </aside>
          </article>
        )
      })}
    </>
  )
}
