import { extractTextDegradedPrompt } from '../prompts/extract-text-degraded'
import type { Stage } from '../types'
import { executeStage, DEFAULT_RETRY } from './runner'
import {
  extractTextDegradedInputSchema,
  extractTextDegradedOutputSchema,
  type ExtractTextDegradedInput,
  type ExtractTextDegradedOutput,
} from './types'

export const extractTextDegradedStage: Stage<ExtractTextDegradedInput, ExtractTextDegradedOutput> = {
  name: 'extract-text-degraded',
  version: '0.1.0',
  modelRole: 'sonnet',  // vision-capable
  prompt: extractTextDegradedPrompt,
  inputSchema: extractTextDegradedInputSchema,
  outputSchema: extractTextDegradedOutputSchema,
  cacheable: false,
  retry: DEFAULT_RETRY,
  evalCases: [],
  run(input, ctx) {
    return executeStage({ stage: extractTextDegradedStage, input, ctx })
  },
}
