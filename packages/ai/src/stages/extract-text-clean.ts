import { extractTextCleanPrompt } from '../prompts/extract-text-clean'
import type { Stage } from '../types'
import { executeStage, DEFAULT_RETRY } from './runner'
import {
  extractTextCleanInputSchema,
  extractTextCleanOutputSchema,
  type ExtractTextCleanInput,
  type ExtractTextCleanOutput,
} from './types'

export const extractTextCleanStage: Stage<ExtractTextCleanInput, ExtractTextCleanOutput> = {
  name: 'extract-text-clean',
  version: '0.1.0',
  modelRole: 'haiku',
  prompt: extractTextCleanPrompt,
  inputSchema: extractTextCleanInputSchema,
  outputSchema: extractTextCleanOutputSchema,
  cacheable: false,
  retry: DEFAULT_RETRY,
  evalCases: [],
  run(input, ctx) {
    return executeStage({ stage: extractTextCleanStage, input, ctx })
  },
}
