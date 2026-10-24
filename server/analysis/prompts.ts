/**
 * The analysis prompt and the JSON Schema that constrains it.
 *
 * PROMPT_VERSION is recorded on every generated artifact so a stored lens
 * can be traced back to the instructions that produced it.
 */
export const PROMPT_VERSION = 2

export const LENS_SYSTEM = `You prepare a research paper so it can be read at four levels of detail without losing anything.

You are given the paper's text split into blocks. Each block starts with its id in square brackets, like [b3-12].

The reader can zoom between:
- Gist: the whole paper in a few sentences.
- Outline: one paragraph per section.
- Skim: one line per paragraph that carries a point. Paragraphs you give no line to disappear at this level, which is the point.
- Full: the paper's own text, with your margin notes beside it.

Produce all four layers.

Rules you must follow:

1. Cite with block ids. Every item you return names the blocks it came from. Only use ids that appear in the text you were given. Never invent an id.
2. Quote what you relied on. For beats and anything with an evidence field, copy a short verbatim span (under 200 characters) from a cited block. Copy it exactly, character for character.
3. Report, do not embellish. Preserve numbers, units, baselines and experimental conditions exactly as written. Never add a result the paper does not state.
4. Beats are the heart of this. Write one for every paragraph that carries a point: what that paragraph actually says, in one sentence, in plain language. Not a label, not a topic, a claim. "The classifier runs on a single A100" is a beat; "Training details" is not. Skip paragraphs that are pure transition, repetition or boilerplate: leaving them out is how Skim earns its place. Aim to cover most of the body.
5. Importance: 1 for something a reader must not miss, 2 for useful detail, 3 for background they can pass over. Be sparing with 1.
6. Margin notes explain what the text assumes you already know. Use them where a reader would stop and ask a question, roughly 12 to 25 across the paper, each anchored to the block it belongs beside:
   - why: why the authors made this choice, or what it rules out.
   - watch: something easy to misread, or a subtlety that matters.
   - result: what a number or table actually means in context.
   - caution: a limit, an assumption, or a claim that is weaker than it sounds.
   - context: background the paper takes for granted.
   Do not restate the paragraph. A note earns its place by adding what the paragraph leaves out.
7. Terms: the vocabulary a newcomer would have to look up, defined the way THIS paper uses them, not in general. Include acronyms with their expansion in aliases. Point firstBlockId at where the paper introduces it.
8. Plain language everywhere. Short sentences. Keep a technical term when it carries meaning and explain it once.
9. If the paper does not contain something, omit it rather than inventing it.`

/** Mirrors `lensDraftSchema` in shared/schemas.ts. Keep both in step. */
export const LENS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['gist', 'gistEvidence', 'sections', 'beats', 'notes', 'terms'],
  properties: {
    gist: {
      type: 'string',
      description: 'The whole paper in three to five plain sentences.',
    },
    gistEvidence: {
      type: 'object',
      additionalProperties: false,
      required: ['blockIds'],
      properties: {
        blockIds: { type: 'array', items: { type: 'string' }, maxItems: 8 },
        quote: { type: 'string' },
      },
    },
    sections: {
      type: 'array',
      maxItems: 40,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['heading', 'summary', 'importance', 'evidence'],
        properties: {
          heading: { type: 'string' },
          headingBlockId: { type: 'string' },
          summary: { type: 'string' },
          importance: { type: 'integer', enum: [1, 2, 3] },
          evidence: {
            type: 'object',
            additionalProperties: false,
            required: ['blockIds'],
            properties: {
              blockIds: { type: 'array', items: { type: 'string' }, maxItems: 8 },
              quote: { type: 'string' },
            },
          },
        },
      },
    },
    beats: {
      type: 'array',
      maxItems: 160,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['blockId', 'claim', 'kind', 'importance'],
        properties: {
          blockId: { type: 'string' },
          claim: { type: 'string' },
          kind: {
            type: 'string',
            enum: [
              'problem',
              'background',
              'idea',
              'method',
              'setup',
              'result',
              'limitation',
              'aside',
            ],
          },
          importance: { type: 'integer', enum: [1, 2, 3] },
          quote: { type: 'string' },
        },
      },
    },
    notes: {
      type: 'array',
      maxItems: 60,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['blockId', 'kind', 'text', 'evidence'],
        properties: {
          blockId: { type: 'string' },
          kind: {
            type: 'string',
            enum: ['why', 'watch', 'result', 'caution', 'context'],
          },
          text: { type: 'string' },
          evidence: {
            type: 'object',
            additionalProperties: false,
            required: ['blockIds'],
            properties: {
              blockIds: { type: 'array', items: { type: 'string' }, maxItems: 8 },
              quote: { type: 'string' },
            },
          },
        },
      },
    },
    terms: {
      type: 'array',
      maxItems: 40,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['term', 'aliases', 'definition'],
        properties: {
          term: { type: 'string' },
          aliases: { type: 'array', items: { type: 'string' }, maxItems: 4 },
          definition: { type: 'string' },
          firstBlockId: { type: 'string' },
        },
      },
    },
  },
}
