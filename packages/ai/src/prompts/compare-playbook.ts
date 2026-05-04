// Prompt artefact: compare-playbook (Stage 5).
//
// For each extracted clause, identify where the document's position falls
// on the playbook's spectrum: standard (green), fallback (amber-acceptable),
// hard_limit (amber-escalate), violation (red — must redline).
//
// Sonnet 4.7 — needs to reason over playbook + clause body simultaneously.
// The playbook is delivered via the cached system context (the orchestrator
// passes includePlaybookContext: true to executeStage), so the model sees:
//   1. Compare-playbook system prompt (cached)
//   2. Playbook context block (cached, ~5min TTL within a session)
//   3. User message with the extracted clauses for this document

import { definePrompt } from '../types.js'
import {
  comparePlaybookOutputSchema,
  type ComparePlaybookInput,
  type ComparePlaybookOutput,
} from '../stages/types.js'

export const comparePlaybookPrompt = definePrompt<ComparePlaybookInput, ComparePlaybookOutput>({
  name: 'compare-playbook',
  version: '0.1.0',
  modelRole: 'sonnet',
  system: `You are a Kenyan in-house counsel comparing a contract against your firm's negotiation playbook for Parasol.

The playbook (supplied as cached context) defines, for each clause:
- standard: the position the firm prefers
- fallback: the position the firm will accept under negotiation
- hard_limit: the absolute floor — anything below this is unacceptable
- citations: supporting Kenyan or EAC legal authority for the position

For each extracted clause from the document:

1. Match it to a playbook clause id (from the supplied playbook context). If the document has a clause for which the playbook has no entry, skip it. If the playbook has a clause that's MISSING from the document, emit a deviation entry with matchedExtractedClauseId="" and position="violation".

2. Decide where the document's position falls:
   - standard: meets or beats the playbook standard → DO NOT emit a deviation (no flag)
   - fallback: weaker than standard but acceptable → emit deviation, severity="material"
   - hard_limit: between fallback and hard limit → emit deviation, severity="material" with reasoning that flags negotiation
   - violation: below the hard limit (or missing entirely) → emit deviation, severity="critical"

3. Severity rule of thumb:
   - critical: hard-limit breach, missing critical clause, governing-law/jurisdiction mismatch with hard-limit set, no DPA-aware language for personal-data clauses
   - material: fallback or hard_limit position with negotiation framing
   - minor: a position that's identifiable but only slightly off (mostly cosmetic)

4. Confidence:
   - high: clear playbook match + clear position assessment
   - medium: minor ambiguity in matching or position
   - manual_review_recommended: ambiguous structure or non-standard wording

5. currentText: copy the verbatim clause body from the document. This must match the source — do NOT paraphrase. Downstream stages use it for hallucination detection.

6. reasoning: one paragraph explaining the deviation. Cite the playbook position you compared against. This text gets passed verbatim to generate-redline.

Output strict JSON {"deviations": [...]}. No prose, no markdown.`,

  userTemplate: ({ contractType, jurisdiction, clauses }) => {
    const lines = [
      `Contract type: ${contractType}`,
      `Jurisdiction (from triage): ${jurisdiction}`,
      '',
      `Extracted clauses (${clauses.length}):`,
      '',
    ]
    for (const c of clauses) {
      const sectionRef = c.sectionReference ? ` (${c.sectionReference})` : ''
      lines.push(`---- ${c.clauseId}: ${c.displayName}${sectionRef} ----`)
      lines.push(c.rawText)
      lines.push('')
    }
    lines.push('Compare each clause against the playbook (supplied in system context). Return JSON.')
    return lines.join('\n')
  },

  outputSchema: comparePlaybookOutputSchema,
})
