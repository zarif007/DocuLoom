/**
 * Offline analyser. Prepares the zoom levels from the paper's own structure,
 * with no model involved.
 *
 * It is deliberately shallow: it reduces each paragraph to its opening
 * sentence rather than understanding it, and it writes no margin notes at
 * all, because explaining why an author made a choice is exactly the part a
 * heuristic cannot do honestly. Terms come only from acronyms the paper
 * expands itself. Everything it emits is quoted verbatim, so citations
 * verify exactly. It exists so the app works, and can be tested, before a
 * provider is configured.
 */
import type {
  GenerateRequest,
  GenerateResult,
  Provider,
  ProviderStatus,
} from './types.js'

interface ParsedBlock {
  id: string
  page: number
  kind: string
  text: string
  section: string
}

/** Recovers the blocks from the digest the pipeline built. */
function parseDigest(prompt: string): ParsedBlock[] {
  const blocks: ParsedBlock[] = []
  let section = ''
  for (const line of prompt.split('\n')) {
    const sectionMatch = /^## section: (.*)$/.exec(line)
    if (sectionMatch) {
      section = sectionMatch[1]
      continue
    }
    const match = /^\[([^\]]+)\] \(([^)]*)\) ([\s\S]*)$/.exec(line)
    if (!match) continue
    const meta = match[2]
    const pageMatch = /p(\d+)/.exec(meta)
    const kind = meta.includes('heading')
      ? 'heading'
      : meta.split(',')[0].trim() || 'paragraph'
    if (kind === 'heading') section = match[3]
    blocks.push({
      id: match[1],
      page: pageMatch ? Number(pageMatch[1]) : 1,
      kind,
      text: match[3],
      section,
    })
  }
  return blocks
}

/** First sentence, trimmed to something that reads as a statement. */
function firstSentence(text: string, max = 240): string {
  const match = /^[\s\S]{40,}?[.!?](?=\s|$)/.exec(text)
  const sentence = (match ? match[0] : text).trim()
  return sentence.length > max ? `${sentence.slice(0, max - 1).trimEnd()}…` : sentence
}

const KIND_RULES: { re: RegExp; kind: string }[] = [
  { re: /abstract/i, kind: 'idea' },
  { re: /introduction|motivation/i, kind: 'problem' },
  { re: /related work|background/i, kind: 'background' },
  { re: /method|approach|model|architecture|design|building|training/i, kind: 'method' },
  { re: /data|dataset|setup|experiment|protocol/i, kind: 'setup' },
  { re: /result|finding|performance|evaluation|benchmark/i, kind: 'result' },
  { re: /limitation|broader impact|threat/i, kind: 'limitation' },
  { re: /discussion|conclusion/i, kind: 'idea' },
]

function beatKind(section: string): string {
  return KIND_RULES.find((rule) => rule.re.test(section))?.kind ?? 'aside'
}

/** 1 for the sections that carry the argument, 3 for background. */
function importanceFor(section: string): number {
  if (/abstract|conclusion/i.test(section)) return 1
  if (/method|result|limitation|contribution/i.test(section)) return 1
  if (/related work|appendix|acknowledg/i.test(section)) return 3
  return 2
}

/**
 * Acronyms the paper expands itself, as in "area under the curve (AUC)".
 * The definition is the paper's own words, so nothing is invented.
 */
function extractTerms(blocks: ParsedBlock[]) {
  const terms = new Map<string, { term: string; aliases: string[]; definition: string; firstBlockId: string }>()
  const pattern = /([A-Z][\w-]*(?:\s+[a-z][\w-]*){1,5})\s*\(([A-Z][A-Za-z]{1,7})\)/g

  for (const block of blocks) {
    for (const match of block.text.matchAll(pattern)) {
      const expansion = match[1].trim()
      const acronym = match[2].trim()
      const initials = expansion
        .split(/\s+/)
        .map((word) => word[0]?.toUpperCase() ?? '')
        .join('')
      // Only keep it when the letters actually line up with the phrase.
      if (!initials.includes(acronym[0]) || acronym.length > expansion.split(/\s+/).length + 2) {
        continue
      }
      if (terms.has(acronym)) continue
      terms.set(acronym, {
        term: acronym,
        aliases: [expansion],
        definition: `${expansion}. Expanded by the paper itself; DocuLoom has not added a definition.`,
        firstBlockId: block.id,
      })
    }
  }
  return [...terms.values()].slice(0, 30)
}

export class OfflineProvider implements Provider {
  readonly id = 'offline'
  readonly label = 'Offline reader (no model)'
  readonly local = true
  readonly model = 'structural-heuristics'

  async status(): Promise<ProviderStatus> {
    return {
      id: this.id,
      label: this.label,
      model: this.model,
      local: true,
      configured: true,
      detail:
        'Builds the zoom levels from the paper’s own sentences. No model, no margin notes, no network. Useful before you set up a provider.',
    }
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    const blocks = parseDigest(req.prompt)
    const body = blocks.filter((b) => b.kind !== 'heading' && b.text.length > 110)

    const abstract =
      body.find((b) => /abstract/i.test(b.section)) ??
      [...body].sort((a, b) => b.text.length - a.text.length)[0]

    // One beat per substantial paragraph, quoted so citations verify.
    const beats = body.map((block) => ({
      blockId: block.id,
      claim: firstSentence(block.text),
      kind: beatKind(block.section),
      importance: importanceFor(block.section),
      quote: block.text.slice(0, 160),
    }))

    // One summary per section, built from its longest paragraph.
    const bySection = new Map<string, ParsedBlock[]>()
    for (const block of body) {
      const key = block.section || 'Body'
      if (!bySection.has(key)) bySection.set(key, [])
      bySection.get(key)!.push(block)
    }
    const sections = [...bySection.entries()].map(([heading, members]) => {
      const longest = [...members].sort((a, b) => b.text.length - a.text.length)[0]
      return {
        heading,
        summary: firstSentence(longest.text, 420),
        importance: importanceFor(heading),
        evidence: { blockIds: [longest.id], quote: longest.text.slice(0, 160) },
      }
    })

    return {
      text: JSON.stringify({
        gist: abstract
          ? `Structural reading only, with no model involved. The paper opens: ${firstSentence(abstract.text, 420)}`
          : 'Structural reading only. No abstract was found in this document.',
        gistEvidence: abstract
          ? { blockIds: [abstract.id], quote: abstract.text.slice(0, 160) }
          : { blockIds: [] },
        sections,
        beats,
        // Explaining why an author chose something is not something a
        // heuristic can do without inventing it, so it does not try.
        notes: [],
        terms: extractTerms(blocks),
      }),
      model: this.model,
    }
  }
}
