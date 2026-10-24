import { useLayoutEffect, useRef, useState } from 'react'
import { ZOOM_LEVELS, type ZoomLevel } from '@shared/types'

const LABELS: Record<ZoomLevel, string> = {
  gist: 'Gist',
  outline: 'Outline',
  skim: 'Skim',
  full: 'Full',
}

const HINTS: Record<ZoomLevel, string> = {
  gist: 'the whole paper in a breath',
  outline: 'one paragraph per section',
  skim: 'every point, no filler',
  full: 'the paper, annotated',
}

interface Props {
  value: ZoomLevel
  onChange: (level: ZoomLevel) => void
}

/**
 * The control the whole product turns on.
 *
 * It is one axis, not four buttons, because the levels are a continuum: you
 * move along it rather than picking a mode. The sliding thumb is measured
 * from the live DOM so the label widths can change without hard-coded stops.
 */
export function ZoomControl({ value, onChange }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState({ left: 0, width: 0 })

  useLayoutEffect(() => {
    const track = trackRef.current
    if (!track) return
    const active = track.querySelector<HTMLElement>(`[data-level="${value}"]`)
    if (!active) return
    setThumb({ left: active.offsetLeft, width: active.offsetWidth })
  }, [value])

  return (
    <>
      <div className="zoom" role="radiogroup" aria-label="Reading depth" ref={trackRef}>
        <span className="zoom__thumb" style={{ left: thumb.left, width: thumb.width }} />
        {ZOOM_LEVELS.map((level) => (
          <button
            key={level}
            className="zoom__stop"
            data-level={level}
            role="radio"
            aria-checked={value === level}
            onClick={() => onChange(level)}
          >
            {LABELS[level]}
          </button>
        ))}
      </div>
      <span className="zoom-hint">{HINTS[value]}</span>
    </>
  )
}
