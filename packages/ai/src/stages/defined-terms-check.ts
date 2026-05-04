import { definedTermsCheckPrompt } from '../prompts/defined-terms-check.js'
import type { Stage } from '../types.js'
import { executeStage, DEFAULT_RETRY } from './runner.js'
import {
  definedTermsCheckInputSchema,
  definedTermsCheckOutputSchema,
  type DefinedTermsCheckInput,
  type DefinedTermsCheckOutput,
} from './types.js'

export const definedTermsCheckStage: Stage<DefinedTermsCheckInput, DefinedTermsCheckOutput> = {
  name: 'defined-terms-check',
  version: '0.1.0',
  modelRole: 'haiku',
  prompt: definedTermsCheckPrompt,
  inputSchema: definedTermsCheckInputSchema,
  outputSchema: definedTermsCheckOutputSchema,
  cacheable: false,  // per-document
  retry: DEFAULT_RETRY,
  evalCases: [],
  run(input, ctx) {
    return executeStage({ stage: definedTermsCheckStage, input, ctx })
  },
}
