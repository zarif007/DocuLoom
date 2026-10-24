import { useEffect, useState } from 'react'
import type { Term } from '@shared/types'

export interface TermAnchor {
  term: Term
  rect: DOMRect
}

interface Props {
  anchor: TermAnchor | null
  onClose: () => void
  onJump: (blockId: string) => void
}

/** Definition card for a glossary term, placed beside the word it explains. */
export function TermPopover({ anchor, onClose, onJump }: Props) {
  const [hovered, setHovered] = useState(false)

  useEffect(() => {
    if (!anchor || hovered) return
    const timer = window.setTimeout(onClose, 2600)
    return () => window.clearTimeout(timer)
  }, [anchor, hovered, onClose])

  if (!anchor) return null

  // Prefer below the word, flip above when it would fall off screen.
  const below = anchor.rect.bottom + 230 < window.innerHeight
  const top = below ? anchor.rect.bottom + 8 : anchor.rect.top - 8
  const left = Math.min(Math.max(12, anchor.rect.left - 10), window.innerWidth - 332)

  return (
    <div
      className="popover"
      style={{ top, left, transform: below ? undefined : 'translateY(-100%)' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false)
        onClose()
      }}
    >
      <div className="popover__term">{anchor.term.term}</div>
      {anchor.term.aliases.length > 0 ? (
        <div className="popover__alias">{anchor.term.aliases.join(' · ')}</div>
      ) : null}
      <div>{anchor.term.definition}</div>
      {anchor.term.firstBlockId ? (
        <button
          className="btn btn--quiet"
          style={{ marginTop: 9, padding: '3px 0', fontSize: 12.5 }}
          onClick={() => {
            onJump(anchor.term.firstBlockId!)
            onClose()
          }}
        >
          Where the paper introduces it →
        </button>
      ) : null}
    </div>
  )
}
