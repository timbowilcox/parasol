import { extractClausesPrompt } from '../prompts/extract-clauses.js'
import type { Stage } from '../types.js'
import { executeStage, DEFAULT_RETRY } from './runner.js'
import {
  extractClausesInputSchema,
  extractClausesOutputSchema,
  type ExtractClausesInput,
  type ExtractClausesOutput,
} from './types.js'

export const extractClausesStage: Stage<ExtractClausesInput, ExtractClausesOutput> = {
  name: 'extract-clauses',
  version: '0.1.0',
  modelRole: 'haiku',
  prompt: extractClausesPrompt,
  inputSchema: extractClausesInputSchema,
  outputSchema: extractClausesOutputSchema,
  cacheable: false,
  retry: DEFAULT_RETRY,
  evalCases: [],
  run(input, ctx) {
    return executeStage({ stage: extractClausesStage, input, ctx })
  },
}
