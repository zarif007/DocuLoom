/**
 * Geometry helpers for turning positioned glyph runs into lines, columns
 * and blocks. Kept free of pdfjs types so it can be unit tested directly.
 */

export interface TextRun {
  text: string
  /** Left edge, page coordinates with origin top-left. */
  x: number
  /** Top edge. */
  y: number
  width: number
  height: number
  fontSize: number
  fontName: string
}

export interface Line {
  runs: TextRun[]
  text: string
  x: number
  y: number
  right: number
  bottom: number
  fontSize: number
  /** Dominant font of the line, used for heading detection. */
  fontName: string
}

/** Groups runs sharing a baseline into lines, left to right. */
export function groupIntoLines(runs: TextRun[]): Line[] {
  const sorted = [...runs].sort((a, b) => a.y - b.y || a.x - b.x)
  const lines: Line[] = []

  for (const run of sorted) {
    if (!run.text.trim()) continue
    const tolerance = Math.max(run.height * 0.5, 2)
    const open = lines[lines.length - 1]
    // Runs belong to the open line when their vertical centres nearly match.
    if (open && Math.abs(centre(open) - (run.y + run.height / 2)) <= tolerance) {
      open.runs.push(run)
    } else {
      lines.push({
        runs: [run],
        text: '',
        x: run.x,
        y: run.y,
        right: run.x + run.width,
        bottom: run.y + run.height,
        fontSize: run.fontSize,
        fontName: run.fontName,
      })
    }
  }

  for (const line of lines) {
    line.runs.sort((a, b) => a.x - b.x)
    line.x = Math.min(...line.runs.map((r) => r.x))
    line.y = Math.min(...line.runs.map((r) => r.y))
    line.right = Math.max(...line.runs.map((r) => r.x + r.width))
    line.bottom = Math.max(...line.runs.map((r) => r.y + r.height))
    line.fontSize = median(line.runs.map((r) => r.fontSize))
    line.fontName = dominantFont(line.runs)
    line.text = joinRuns(line.runs)
  }

  return lines.filter((l) => l.text.trim().length > 0)
}

function centre(line: Line) {
  return line.y + (line.bottom - line.y) / 2
}

function dominantFont(runs: TextRun[]): string {
  const widthByFont = new Map<string, number>()
  for (const r of runs) {
    widthByFont.set(r.fontName, (widthByFont.get(r.fontName) ?? 0) + r.width)
  }
  return [...widthByFont.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
}

/**
 * Joins runs into a line, inserting a space only where the horizontal gap
 * suggests one. PDF text is emitted in arbitrary chunks, so naive joining
 * either glues words together or splits them.
 */
function joinRuns(runs: TextRun[]): string {
  let out = ''
  let prevRight: number | null = null
  for (const run of runs) {
    if (prevRight !== null) {
      const gap = run.x - prevRight
      const spaceWidth = run.fontSize * 0.2
      if (gap > spaceWidth && !out.endsWith(' ') && !run.text.startsWith(' ')) {
        out += ' '
      }
    }
    out += run.text
    prevRight = run.x + run.width
  }
  return out.replace(/\s+/g, ' ').trim()
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Finds the x coordinate of the vertical gutter between two text columns,
 * or null for a single-column page.
 *
 * Coverage is measured over runs rather than lines: on a two-column page the
 * two columns share baselines, so lines are unreliable until we know where
 * the gutter is. A sweep line gives exact coverage depth at every x, which
 * matters because real gutters are only a few points wide.
 *
 * The threshold is adaptive rather than absolute. Page one of a two-column
 * paper carries a full-width title, byline and affiliation, all of which
 * cross the gutter and lift coverage everywhere, so an absolute cutoff finds
 * nothing. What identifies a gutter in every case is that coverage *dips*
 * sharply there relative to the rest of the page.
 */
export function detectColumnSplit(runs: TextRun[], pageWidth: number): number | null {
  const real = runs.filter((r) => r.text.trim() && r.width > 0)
  if (real.length < 40) return null

  const bandLo = pageWidth * 0.33
  const bandHi = pageWidth * 0.67

  const segments = coverageSegments(real, bandLo, bandHi)
  if (segments.length === 0) return null

  const minDepth = Math.min(...segments.map((s) => s.depth))
  const typicalDepth = weightedMedianDepth(segments)

  // A gutter is a pronounced dip. Uniform coverage means a single column.
  if (minDepth > typicalDepth * 0.4) return null
  // Guard against a page so sparse that everything looks like a dip.
  if (minDepth > real.length * 0.15) return null

  const gutter = widestRunAtOrBelow(segments, minDepth)
  if (!gutter) return null
  // Gutters are a few points wide; anything narrower is a word gap.
  if (gutter.to - gutter.from < Math.max(5, pageWidth * 0.008)) return null

  const splitX = (gutter.from + gutter.to) / 2

  // Both sides must carry text, otherwise this is a wide margin.
  const left = real.filter((r) => r.x + r.width <= splitX).length
  const right = real.filter((r) => r.x >= splitX).length
  if (left < real.length * 0.2 || right < real.length * 0.2) return null

  return Math.round(splitX * 1000) / 1000
}

interface Segment {
  from: number
  to: number
  depth: number
}

/** Coverage depth across [lo, hi], as contiguous constant-depth segments. */
function coverageSegments(runs: TextRun[], lo: number, hi: number): Segment[] {
  const events: { x: number; delta: number }[] = []
  for (const run of runs) {
    events.push({ x: run.x, delta: 1 })
    events.push({ x: run.x + run.width, delta: -1 })
  }
  events.sort((a, b) => a.x - b.x || a.delta - b.delta)

  const segments: Segment[] = []
  let depth = 0
  let cursor = lo

  for (let i = 0; i < events.length; ) {
    const x = events[i].x
    if (x > cursor && cursor < hi) {
      segments.push({ from: cursor, to: Math.min(x, hi), depth })
      cursor = Math.min(x, hi)
    }
    while (i < events.length && events[i].x === x) {
      depth += events[i].delta
      i++
    }
    if (cursor >= hi) break
    cursor = Math.max(cursor, Math.min(x, hi))
  }
  if (cursor < hi) segments.push({ from: cursor, to: hi, depth })

  return segments.filter((s) => s.to > s.from)
}

/** Median depth weighted by how much of the band sits at that depth. */
function weightedMedianDepth(segments: Segment[]): number {
  const total = segments.reduce((sum, s) => sum + (s.to - s.from), 0)
  const sorted = [...segments].sort((a, b) => a.depth - b.depth)
  let seen = 0
  for (const segment of sorted) {
    seen += segment.to - segment.from
    if (seen >= total / 2) return segment.depth
  }
  return sorted[sorted.length - 1]?.depth ?? 0
}

/** Widest contiguous stretch whose depth never exceeds `threshold`. */
function widestRunAtOrBelow(
  segments: Segment[],
  threshold: number,
): { from: number; to: number } | null {
  let best: { from: number; to: number } | null = null
  let from: number | null = null
  let to = 0

  for (const segment of segments) {
    if (segment.depth <= threshold) {
      if (from === null) from = segment.from
      to = segment.to
    } else if (from !== null) {
      if (!best || to - from > best.to - best.from) best = { from, to }
      from = null
    }
  }
  if (from !== null && (!best || to - from > best.to - best.from)) best = { from, to }

  return best
}

/**
 * Splits lines that merged across the gutter back into their columns.
 *
 * A line built from both columns has a wide internal gap exactly at the
 * gutter; a genuine full-width line (a title, a spanning caption) does not.
 * That gap is the signal used here.
 */
export function splitLinesAtGutter(lines: Line[], splitX: number): Line[] {
  const out: Line[] = []

  for (const line of lines) {
    if (line.x >= splitX || line.right <= splitX) {
      out.push(line)
      continue
    }

    let cut = -1
    for (let i = 1; i < line.runs.length; i++) {
      const prev = line.runs[i - 1]
      const next = line.runs[i]
      const prevRight = prev.x + prev.width
      const gap = next.x - prevRight
      const crossesGutter = prevRight <= splitX && next.x >= splitX
      if (crossesGutter && gap > next.fontSize * 1.2) {
        cut = i
        break
      }
    }

    if (cut === -1) {
      out.push(line)
      continue
    }

    out.push(...rebuild(line.runs.slice(0, cut)), ...rebuild(line.runs.slice(cut)))
  }

  return out
}

/** Rebuilds line metadata after a split. */
function rebuild(runs: TextRun[]): Line[] {
  if (runs.length === 0) return []
  return groupIntoLines(runs)
}

/**
 * Orders a page's lines the way a human reads them: anything above the
 * columns first, then the left column, then the right column, then
 * full-width material that sits below the columns.
 */
export function orderLines(lines: Line[], splitX: number | null): Line[] {
  const byY = (a: Line, b: Line) => a.y - b.y || a.x - b.x
  if (splitX === null) return [...lines].sort(byY)

  const full: Line[] = []
  const left: Line[] = []
  const right: Line[] = []
  for (const line of lines) {
    if (line.x < splitX && line.right > splitX) full.push(line)
    else if (line.right <= splitX) left.push(line)
    else right.push(line)
  }

  const columnTop = [...left, ...right].reduce(
    (min, l) => Math.min(min, l.y),
    Number.POSITIVE_INFINITY,
  )
  const header = full.filter((l) => l.y < columnTop).sort(byY)
  const spanning = full.filter((l) => l.y >= columnTop).sort(byY)

  return [...header, ...left.sort(byY), ...right.sort(byY), ...spanning]
}

/** Full page pipeline: runs in, ordered lines out. */
export function layoutPage(runs: TextRun[], pageWidth: number): Line[] {
  const splitX = detectColumnSplit(runs, pageWidth)
  let lines = groupIntoLines(runs)
  if (splitX !== null) lines = splitLinesAtGutter(lines, splitX)
  return orderLines(lines, splitX)
}
