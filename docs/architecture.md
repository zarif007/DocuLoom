# Architecture

## Why this shape

Three decisions drive everything else.

**The paper is the product.** Not a summary of it, not a diagram beside it.
Every level renders the same document at a different resolution, and the
deepest level is the paper's own words, untouched. That is why there is no
chat box and no graph: both replace the text instead of serving it.

**The model returns data, never a rendering.** It emits JSON constrained by a
schema. Nothing it produces is executed, and nothing reaches the reader
without passing validation. This removes the class of problems where a
document's contents steer the application.

**Citations are checked, not trusted.** A line that cites a passage is only
useful if the passage says it. Every citation is resolved against the
extracted document and every quote is located in the block it cites. What
cannot be confirmed is labelled, not hidden.

## Pipeline

### 1. Extraction (`server/extraction/`)

pdfjs is used purely as a source of positioned glyph runs; all layout
reasoning is ours and is unit tested without a PDF.

- `layout.ts` groups runs into lines, finds the column gutter, and puts lines
  in reading order.
- `blocks.ts` assembles lines into classified, section-aware blocks.
- `pdf.ts` drives pdfjs and derives bibliographic metadata.

The hard part is two-column papers. The two columns share baselines, so runs
from both merge into one line before any column logic can run. Detection
therefore works on *runs*, using a sweep line for exact coverage depth at
every x. The threshold is adaptive: page one carries a full-width title and
byline that cross the gutter and lift coverage everywhere, so an absolute
cutoff finds nothing. What identifies a gutter in every case is a pronounced
*dip* in coverage. Lines that merged across it are then split at the wide
internal gap, which a genuine full-width line does not have.

Blocks store a normalised bbox (page fractions), so highlights survive any
zoom level and any device pixel ratio.

### 2. Digest (`server/analysis/digest.ts`)

The model sees blocks prefixed with their ids, because those ids are the only
citations it may produce. What it cannot see, it cannot cite. Blocks are
scored by section so that when a long paper exceeds the budget, what drops is
background rather than method or results. The bibliography is excluded.

### 3. The lens (`server/analysis/lens.ts`)

One provider call returns every layer at once: the gist, section summaries,
a beat per paragraph, margin notes and glossary terms. Then:

- zod validates the shape; a malformed draft is rejected.
- Beats are deduplicated per block, dropped if they target a block that does
  not exist or a heading, and sorted into document order.
- Notes are dropped unless they anchor to a real block.
- Section and term anchors that do not resolve are cleared rather than kept.
- Terms are deduplicated case-insensitively and sorted longest-first, so
  "safety classifier" is not shadowed by "classifier" when matching.

**Why a beat per paragraph.** Skim is only worth reading if the filler is
gone, which means the model must decide what carries a point and what does
not. A paragraph with no beat simply does not appear at that level. Coverage
is reported (`beatCoverage`) so a lazy pass is visible rather than silent.

### 4. Verification (`server/evidence/verify.ts`)

For each statement: cited ids must exist (dangling ones are dropped and
counted), and the quote must be locatable in a cited block. Matching tolerates
the differences extraction introduces (hyphenation, ligatures, whitespace) via
token overlap, because a one-character shift should not demote a real
citation.

Result: `direct`, `inferred` or `unverified`. The counts appear in the
toolbar.

## Storage

SQLite under `~/.doculoom`, with numbered migrations driven by `user_version`.
Blocks are indexed in FTS5. Generated artifacts record the extraction version,
schema version, prompt version and model that produced them, so a stored lens
can be traced to how it was made.

API keys are never in the database. They go to the macOS keychain via
`security`, falling back to a `0600` file, and are never read back to the
frontend.

## Providers

`Provider` is deliberately narrow: system prompt, user prompt, max tokens, an
optional JSON schema, effort. That narrowness is what makes a hosted model and
a local one interchangeable, and keeps generated content out of the execution
path.

- `anthropic.ts` streams (a beat per paragraph is a lot of output) and uses
  structured outputs.
- `ollama.ts` passes the schema to Ollama, which constrains decoding to it.
- `offline.ts` uses no model. It reconstructs blocks from the digest and
  reduces each to its opening sentence, quoting verbatim so citations verify
  exactly. It writes no margin notes, because it cannot.

## The reader (`src/features/reader/`)

**Zoom with position preservation** is the whole interaction. `ReaderView`
tracks the topmost visible `[data-block]` as you scroll. On a zoom change it
scrolls to that block at the new level, or — since a level may not render that
block at all — to the nearest block that *is* rendered, by document order.
Diving from a summary works the same way in reverse: clicking a beat sets the
anchor to its paragraph before switching level, so you land on the thing you
clicked.

**The margin** is a per-passage CSS grid (text column, margin column) rather
than absolutely positioned notes. Each passage is its own grid, so a note
aligns with its paragraph for free, at any text length, with no measurement in
JavaScript. Below 1180px the margin column is dropped entirely; with no notes
at all the column is not reserved, so the text stays centred.

**Terms** are matched with one alternation built from every spelling, longest
first. Only the first occurrence in a passage is marked: underlining every
repeat turns the page into a minefield and teaches the reader to ignore the
marks.

**Typography** carries the design. Source Serif 4 (variable, with optical
sizing) for everything the paper says, Instrument Sans for chrome, IBM Plex
Mono for ids. Importance at the Skim level is expressed as weight and colour,
not as badges, so a key line simply reads as more prominent.

## What is not built

No system diagram, no quizzes, no chat. A diagram of a paper's mechanism is a
separate artifact with its own schema and validation; it belongs after the
reading surface is solid.
