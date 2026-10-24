/**
 * DocuLoom shared contracts.
 *
 * The product is the paper itself, read at a chosen level of detail. A
 * `PaperLens` is everything needed to render the same document at four
 * zoom levels without ever losing the original text.
 */

/** Bumped when extraction changes in a way that invalidates stored blocks. */
export const EXTRACTION_VERSION = 1
/** Bumped when the lens shape changes. Stored on every generated artifact. */
export const LENS_SCHEMA_VERSION = 1

export type BlockKind =
  | 'heading'
  | 'paragraph'
  | 'caption'
  | 'equation'
  | 'list'
  | 'table'
  | 'reference'
  | 'footnote'

/** Normalised rectangle, origin top-left, values in 0..1 of the page box. */
export interface BBox {
  x: number
  y: number
  w: number
  h: number
}

/**
 * A contiguous piece of the source document with a location we can navigate
 * to. Block ids are stable for a given (document, extraction version) pair
 * and are the only thing the model is allowed to cite.
 */
export interface DocumentBlock {
  id: string
  paperId: string
  page: number
  order: number
  kind: BlockKind
  text: string
  /** Section headings above this block, outermost first. */
  sectionPath: string[]
  bbox: BBox
  /** 0..1. Lowered for blocks assembled across columns or with odd spacing. */
  confidence: number
}

export interface PaperMeta {
  id: string
  title: string
  authors: string[]
  year: number | null
  abstract: string
  pageCount: number
  /** sha256 of the original file. */
  fileHash: string
  fileName: string
  importedAt: string
  extractionVersion: number
}

/** Where a generated statement comes from. */
export interface Evidence {
  /** Ids of DocumentBlocks that carry this statement. */
  blockIds: string[]
  /** Verbatim span the model relied on, used to verify the citation. */
  quote?: string
}

/**
 * How well the source backs a generated statement.
 * `direct`     - the quote was found in a cited block.
 * `inferred`   - cited blocks are real, the wording is the model's.
 * `unverified` - nothing real was cited.
 */
export type SupportLevel = 'direct' | 'inferred' | 'unverified'

/** Anything generated carries its sources and how well they check out. */
export interface Grounded {
  evidence: Evidence
  support: SupportLevel
  verificationNote?: string
}

/** The four rungs of the zoom ladder, coarsest first. */
export const ZOOM_LEVELS = ['gist', 'outline', 'skim', 'full'] as const
export type ZoomLevel = (typeof ZOOM_LEVELS)[number]

/** What one paragraph of the paper is actually saying. */
export type BeatKind =
  | 'problem'
  | 'background'
  | 'idea'
  | 'method'
  | 'setup'
  | 'result'
  | 'limitation'
  | 'aside'

/**
 * One paragraph reduced to its point.
 *
 * Blocks with no beat are filler: they simply do not appear at the Skim
 * level, which is what makes skimming useful rather than merely shorter.
 */
export interface Beat extends Grounded {
  /** The paragraph this stands in for. */
  blockId: string
  /** One sentence: what this paragraph says. */
  claim: string
  kind: BeatKind
  /** 1 = worth stopping for, 2 = useful, 3 = skippable. */
  importance: 1 | 2 | 3
}

/** A section of the paper, summarised. */
export interface SectionSummary extends Grounded {
  id: string
  heading: string
  /** Id of the heading block, for navigation. */
  headingBlockId: string | null
  summary: string
  importance: 1 | 2 | 3
}

/**
 * Why a margin note exists. The kind drives its colour and icon, so the
 * reader can tell an explanation from a warning without reading it first.
 */
export type NoteKind = 'why' | 'watch' | 'result' | 'caution' | 'context'

/** A short aside anchored beside a specific paragraph. */
export interface MarginNote extends Grounded {
  id: string
  blockId: string
  kind: NoteKind
  text: string
}

/** A term defined the way this paper uses it. */
export interface Term {
  term: string
  /** Other spellings and the expanded form of an acronym. */
  aliases: string[]
  definition: string
  /** Where the paper introduces it, for the "first used" jump. */
  firstBlockId: string | null
}

export interface PaperLens {
  schemaVersion: number
  paperId: string
  /** The whole paper in a few plain sentences. */
  gist: string
  gistEvidence: Evidence
  gistSupport: SupportLevel
  sections: SectionSummary[]
  beats: Beat[]
  notes: MarginNote[]
  terms: Term[]
  generatedBy: {
    provider: string
    model: string
    promptVersion: number
    extractionVersion: number
    generatedAt: string
  }
}

/** Result of checking a lens against the extracted document. */
export interface VerificationReport {
  totalStatements: number
  direct: number
  inferred: number
  unverified: number
  /** Citations that pointed at block ids which do not exist. */
  danglingCitations: number
  /** How much of the paper's body the beats actually cover. */
  beatCoverage: number
}
