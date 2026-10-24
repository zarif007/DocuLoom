import type { DocumentBlock, PaperLens } from '@shared/types'

interface Props {
  lens: PaperLens
  blocksById: Map<string, DocumentBlock>
  activeBlockId: string | null
  onJump: (blockId: string) => void
}

/**
 * Where you are in the paper, as a column of ticks.
 *
 * It replaces a sidebar of links: at a glance it shows how far through you
 * are and how much is left, and the longer ticks are the sections the
 * analysis marked as carrying the argument.
 */
export function Rail({ lens, blocksById, activeBlockId, onJump }: Props) {
  if (lens.sections.length < 2) return null

  const activeOrder = activeBlockId ? (blocksById.get(activeBlockId)?.order ?? -1) : -1

  // The section we are in is the last one that starts at or before us.
  let activeIndex = -1
  lens.sections.forEach((section, index) => {
    const anchor = section.headingBlockId ?? section.evidence.blockIds[0]
    const order = anchor ? (blocksById.get(anchor)?.order ?? Infinity) : Infinity
    if (order <= activeOrder) activeIndex = index
  })

  return (
    <nav className="rail" aria-label="Paper sections">
      {lens.sections.map((section, index) => {
        const anchor = section.headingBlockId ?? section.evidence.blockIds[0]
        const classes = [
          'rail__tick',
          section.importance === 1 ? 'rail__tick--key' : '',
          index === activeIndex ? 'rail__tick--active' : '',
        ]
          .filter(Boolean)
          .join(' ')
        return (
          <button
            key={section.id}
            className={classes}
            data-label={section.heading}
            aria-label={section.heading}
            onClick={() => anchor && onJump(anchor)}
          />
        )
      })}
    </nav>
  )
}
