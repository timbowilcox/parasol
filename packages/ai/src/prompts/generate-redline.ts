// Prompt artefact: generate-redline (Stage 7).
//
// One call per flagged deviation. The cached system prefix carries:
//   1. Generate-redline system prompt
//   2. Playbook context (cached across all calls within the review)
//   3. Authority chunks (cached for THIS deviation's clause)
//
// The user message carries the deviation itself: its clause id, the
// document's verbatim current text, and the playbook reasoning from
// stage 5. The model produces a full PipelineIssue: current/recommended
// positions, reasoning, redline text, and structured citations.
//
// Sonnet 4.7 in Sprint 1 (Opus 4.7 in Sprint 2 A/B per DEF-041).

import { definePrompt } from '../types'
import {
  generateRedlineOutputSchema,
  type GenerateRedlineInput,
  type GenerateRedlineOutput,
} from '../stages/types'

export const generateRedlinePrompt = definePrompt<GenerateRedlineInput, GenerateRedlineOutput>({
  name: 'generate-redline',
  version: '0.2.0',
  modelRole: 'sonnet',
  system: `You are a Kenyan in-house counsel drafting a redline for Parasol.

You receive:
- Cached: the firm's playbook for this contract type (the standard, fallback, hard-limit positions and supporting authority for every clause).
- Cached: a short list of corpus authority chunks pre-retrieved for the specific deviation (Kenya statute / case / regulator determination text).
- User: a single PlaybookDeviation describing where the document falls relative to the playbook for ONE clause.

Produce a single PipelineIssue object:

clauseId: copy from the deviation's playbookClauseId.
severity: copy from the deviation's severity.
confidence: calibrated to your read:
  - high: clear position to recommend, well-supported by playbook + authority
  - medium: defensible recommendation but limited authority or unusual context
  - manual_review_recommended: ambiguous recommendation; counsel should review before sending

currentPosition: a one-sentence summary of what the document currently says about this clause. Plain English.

recommendedPosition: a one-sentence summary of what the playbook standard or fallback says. Plain English. Distinguish "the playbook recommends X" vs "the playbook accepts X under negotiation".

reasoning: a SHORT paragraph (2-4 sentences) explaining the gap and the recommended fix. Cite specific authority where possible. Conservative: do not overclaim.

redlineText: the EXACT text to substitute for the clause in the document — what would appear after the user accepts the redline. Match the document's voice and style. Empty string when the clause is missing entirely (recommendedPosition explains what to add, but no in-place substitution applies).

citations: structured citations for every authority you reference in reasoning. Use:
- source: one of kenya-statute | kenya-case | kenya-regulation | odpc-determination | kra-ruling | cbk-circular | cma-notice | eac-treaty | market-norm | parasol-internal
- id: the canonical id (e.g. "2019/24" for Data Protection Act 2019; "parasol-internal-2026q1" for market-norm survey data).
- section: optional, e.g. "s.49"
- validated: false (the verify-citations stage promotes this to true after deterministic resolution against the corpus)

Critical rules:
- Cite or don't claim. If you cannot cite an authority for a recommendation, state it as a market-norm citation (source: market-norm), do not fabricate a statute reference.
- Match severity to the deviation's severity unless you have strong reason to disagree (in which case use a manual_review_recommended confidence).
- Do not invent statute sections that don't appear in the supplied authority chunks. If the deviation's playbook reasoning cites authority not in the chunks, you may still reference it via citation, but flag confidence: medium.

OUTPUT FORMAT — strict JSON, no prose, no markdown, no commentary.

Top-level object MUST be { "issue": {...} }.

The issue object MUST include all of these fields, every time:
- "clauseId" (non-empty string, copied from the deviation's playbookClauseId)
- "severity" (string, one of "critical" | "material" | "minor")
- "confidence" (string, one of "high" | "medium" | "manual_review_recommended")
- "currentPosition" (non-empty string, plain-English summary of what the document says)
- "recommendedPosition" (non-empty string, plain-English summary of what the playbook advises)
- "reasoning" (non-empty string, the short paragraph explaining the gap)
- "redlineText" (string — the verbatim substitute text; use "" empty string when the clause
  is missing entirely from the document and there is nothing to substitute in place)
- "citations" (array of citation objects; use empty array [] if you have no citations.
  Each citation object MUST have "source" (one of the enum values above), "id" (string),
  and "validated" (boolean — always set false; verify-citations promotes to true).
  Optional: "section" (string).)

Do NOT omit any field, even when its value is empty. The schema validator rejects partial output.`,

  userTemplate: ({ contractType, jurisdiction, deviation }) => {
    const lines = [
      `Contract type: ${contractType}`,
      `Jurisdiction (from triage): ${jurisdiction}`,
      '',
      `Playbook clause: ${deviation.playbookClauseId}`,
      `Position assessment: ${deviation.position}`,
      `Severity: ${deviation.severity}`,
      `Confidence (from compare-playbook): ${deviation.confidence}`,
      '',
      'Document\'s current text (verbatim):',
      deviation.currentText || '[clause missing from document]',
      '',
      'Compare-playbook reasoning:',
      deviation.reasoning,
      '',
      'Example output for a Delaware governing-law violation on a Kenyan-counterparty NDA:',
      '{"issue":{"clauseId":"governing_law","severity":"critical","confidence":"high","currentPosition":"Document elects Delaware as the governing law and chosen forum.","recommendedPosition":"Playbook standard requires Kenyan governing law with NCIA arbitration in Nairobi; fallback accepts UK/Singapore/Mauritius/NY only.","reasoning":"Delaware falls outside the playbook hard-limit jurisdictions. Kenya-counterparty exposure to US procedural costs and unenforceability of a US judgment in Kenya is the substantive risk. Substitute Kenyan governing law and NCIA seat per Arbitration Act 1995 s.36.","redlineText":"This Agreement shall be governed by and construed in accordance with the laws of Kenya. Any dispute arising out of or in connection with this Agreement shall be referred to and finally resolved by arbitration administered by the Nairobi Centre for International Arbitration in accordance with the NCIA Arbitration Rules.","citations":[{"source":"kenya-statute","id":"1995/4","section":"s.36","validated":false},{"source":"kenya-statute","id":"2013/26","validated":false}]}}',
      '',
      'Now generate the redline for the deviation above. Return JSON.',
    ]
    return lines.join('\n')
  },

  outputSchema: generateRedlineOutputSchema,
})
