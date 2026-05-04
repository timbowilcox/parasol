// Prompt artefact: triage (Stage 3).
//
// Classifies the document by contract type, jurisdiction, and identifies
// the parties. Output drives the orchestrator's routing decision: only NDAs
// proceed through the Sprint 1 pipeline; other types get a friendly
// "we don't handle this yet" reply.
//
// Haiku 4.5 — pattern-matches contract structure cheaply and quickly.

import { definePrompt } from '../types.js'
import {
  triageOutputSchema,
  type TriageInput,
  type TriageOutput,
} from '../stages/types.js'

export const triagePrompt = definePrompt<TriageInput, TriageOutput>({
  name: 'triage',
  version: '0.1.0',
  modelRole: 'haiku',
  system: `You are a contract classifier for Parasol, an AI legal copilot for in-house counsel in Kenya, Uganda, Tanzania, and Rwanda.

Given the full text of a single contract, identify:

1. CONTRACT TYPE — exactly one of:
   - nda: confidentiality / non-disclosure agreement (mutual or one-way)
   - dpa: data processing addendum / data protection addendum
   - msa: master services agreement
   - saas: software-as-a-service / subscription agreement
   - employment: employment contract or offer letter
   - lease: real-estate or asset lease
   - distribution: distribution / reseller / agency agreement
   - unknown: cannot confidently classify

2. JURISDICTION — best read of the governing-law / chosen-law clause:
   - kenya | uganda | tanzania | rwanda | unknown
   - "unknown" includes documents governed by a non-EAC jurisdiction (US, UK, Singapore, etc).
     Parasol's playbooks are EAC-only in v1; non-EAC inputs are still useful for the redline pass
     against the Kenya playbook, but jurisdiction is reported as "unknown" so downstream stages
     can flag the mismatch.

3. PARTIES — identifying entities by their role label as written ("Disclosing Party",
   "Recipient", "Buyer", "Counterparty A") and best-guess legal name. Use empty string for
   names left as placeholders ([•], [INSERT NAME], etc.).

4. CONFIDENCE — your calibrated certainty:
   - high: clear contract type + jurisdiction, parties identified
   - medium: contract type clear but jurisdiction ambiguous, or vice versa
   - manual_review_recommended: ambiguous or non-standard structure

5. REASONING — one plain-English sentence explaining the call. Surfaces in the audit log.

Output strict JSON matching the supplied schema. No prose, no markdown.`,

  userTemplate: ({ fullText }) => {
    return `Classify this contract:\n\n---\n${fullText}\n---\n\nReturn JSON.`
  },

  outputSchema: triageOutputSchema,
})
