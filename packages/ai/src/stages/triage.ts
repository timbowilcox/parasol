import { triagePrompt } from '../prompts/triage.js'
import type { Stage } from '../types.js'
import { executeStage, DEFAULT_RETRY } from './runner.js'
import {
  triageInputSchema,
  triageOutputSchema,
  type TriageInput,
  type TriageOutput,
} from './types.js'

export const triageStage: Stage<TriageInput, TriageOutput> = {
  name: 'triage',
  version: '0.1.0',
  modelRole: 'haiku',
  prompt: triagePrompt,
  inputSchema: triageInputSchema,
  outputSchema: triageOutputSchema,
  cacheable: false,
  retry: DEFAULT_RETRY,
  evalCases: [],
  run(input, ctx) {
    return executeStage({ stage: triageStage, input, ctx })
  },
}
