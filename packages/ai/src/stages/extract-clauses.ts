import { extractClausesPrompt } from '../prompts/extract-clauses'
import type { Stage } from '../types'
import { executeStage, DEFAULT_RETRY } from './runner'
import {
  extractClausesInputSchema,
  extractClausesOutputSchema,
  type ExtractClausesInput,
  type ExtractClausesOutput,
} from './types'

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
