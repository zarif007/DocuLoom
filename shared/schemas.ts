/**
 * Validation for everything a model produces.
 *
 * Model output is untrusted input. Nothing reaches the database or the
 * renderer until it has passed through these schemas, and the pipeline
 * repairs or drops what fails rather than surfacing a malformed lens.
 */
import { z } from 'zod'

export const evidenceSchema = z.object({
  blockIds: z.array(z.string()).max(8).default([]),
  quote: z.string().max(400).optional(),
})

export const beatKindSchema = z.enum([
  'problem',
  'background',
  'idea',
  'method',
  'setup',
  'result',
  'limitation',
  'aside',
])

export const noteKindSchema = z.enum(['why', 'watch', 'result', 'caution', 'context'])

const importanceSchema = z.union([z.literal(1), z.literal(2), z.literal(3)])

export const beatDraftSchema = z.object({
  blockId: z.string().min(1),
  claim: z.string().min(1).max(320),
  kind: beatKindSchema,
  importance: importanceSchema.default(2),
  quote: z.string().max(400).optional(),
})

export const sectionDraftSchema = z.object({
  heading: z.string().min(1).max(160),
  headingBlockId: z.string().optional(),
  summary: z.string().min(1).max(900),
  importance: importanceSchema.default(2),
  evidence: evidenceSchema.default({ blockIds: [] }),
})

export const noteDraftSchema = z.object({
  blockId: z.string().min(1),
  kind: noteKindSchema,
  text: z.string().min(1).max(420),
  evidence: evidenceSchema.default({ blockIds: [] }),
})

export const termDraftSchema = z.object({
  term: z.string().min(1).max(80),
  aliases: z.array(z.string().max(80)).max(4).default([]),
  definition: z.string().min(1).max(420),
  firstBlockId: z.string().optional(),
})

/** What the analysis model is asked to return. */
export const lensDraftSchema = z.object({
  gist: z.string().min(1).max(1200),
  gistEvidence: evidenceSchema.default({ blockIds: [] }),
  sections: z.array(sectionDraftSchema).max(40).default([]),
  beats: z.array(beatDraftSchema).max(160).default([]),
  notes: z.array(noteDraftSchema).max(60).default([]),
  terms: z.array(termDraftSchema).max(40).default([]),
})

export type LensDraft = z.infer<typeof lensDraftSchema>
