// Prompt artefact: extract-clauses (Stage 4).
//
// Decompose the full document into structured clauses keyed against the
// playbook's controlled clause-id vocabulary. Haiku 4.5 — pattern-matching
// over standardised legal structure.
//
// Behavioural decisions:
// - The model returns clause_id matching the playbook vocabulary when
//   confident; else 'unknown_<n>' with a sequential index. Sprint 5+
//   may add a "fuzzy mapper" stage that promotes 'unknown_*' to known ids.
// - Section reference is best-effort; absence is fine.
// - Verbatim raw_text is required (downstream redline + hallucination check).

import { definePrompt } from '../types'
import {
  extractClausesOutputSchema,
  type ExtractClausesInput,
  type ExtractClausesOutput,
} from '../stages/types'

// Curated clause-id vocabulary for Sprint 1's NDA contract type.
// Mirrors packages/playbooks/kenya/nda.yaml clause ids exactly.
// Extending to other contract types: add a contract-type → vocabulary
// mapping when DPA / MSA / SaaS playbooks land in Sprint 4+.
const NDA_CLAUSE_VOCABULARY = [
  'confidentiality_term',
  'definition_of_confidential_information',
  'exclusions_from_confidentiality',
  'data_protection',
  'return_or_destruction',
  'governing_law',
  'dispute_resolution',
  'term_and_termination',
  'remedies',
  'no_obligation_to_proceed',
  'no_waiver',
  'severability',
  'assignment',
  'notices',
  'counterparts_and_execution',
] as const

export const extractClausesPrompt = definePrompt<ExtractClausesInput, ExtractClausesOutput>({
  name: 'extract-clauses',
  version: '0.2.0',
  modelRole: 'haiku',
  system: `You are a legal-document parser for Parasol, an AI legal copilot.

Given the full text of a contract and its contract type, decompose it into a list of clauses, mapping each to a controlled clause-id vocabulary.

For NDA contracts, the vocabulary is:
${NDA_CLAUSE_VOCABULARY.join(', ')}

Behavioural rules:
- Return one entry per substantive clause; do not merge multi-topic clauses.
- Skip recitals, signature blocks, and execution dates — those are not clauses.
- A "definitions" preamble counts as one clause with id "definition_of_confidential_information" only if the definition is specifically of confidential information; generic definitions sections should use 'unknown_<n>'.
- Preserve original ordering via clauseOrder.

OUTPUT FORMAT — strict JSON, no prose, no markdown, no commentary.

Top-level object MUST be { "clauses": [...] }.

Every clause object in the array MUST include all of these fields, every time:
- "clauseId" (string, snake_case from the vocabulary above when confident; otherwise
  "unknown_<n>" with a sequential index starting at 1)
- "displayName" (non-empty string, sentence-case human label, e.g. "Term of confidentiality")
- "rawText" (non-empty string, verbatim clause body — do NOT paraphrase or summarise)
- "clauseOrder" (integer, 0-indexed order in the document)

Optional field — include it when relevant, omit (don't set null) when absent:
- "sectionReference" (string, the document's own labelling, e.g. "Section 5", "Cl 3.2")

Do NOT omit any required field. The schema validator rejects partial output.`,

  userTemplate: ({ fullText, contractType }) => {
    return `Decompose this ${contractType.toUpperCase()} into clauses:

---
${fullText}
---

Example output for a tiny NDA with two clauses:
{"clauses":[{"clauseId":"governing_law","displayName":"Governing law","rawText":"This Agreement shall be governed by the laws of Kenya.","sectionReference":"Section 12","clauseOrder":0},{"clauseId":"confidentiality_term","displayName":"Term of confidentiality","rawText":"This Agreement remains in effect for three (3) years from the Effective Date.","clauseOrder":1}]}

Now produce the JSON for the contract above.`
  },

  outputSchema: extractClausesOutputSchema,
})

// Exported for tests so the test suite can assert vocabulary stays in sync
// with the playbook's clause ids.
export const __testing = { NDA_CLAUSE_VOCABULARY }
