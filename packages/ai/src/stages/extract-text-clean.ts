import { extractTextCleanPrompt } from '../prompts/extract-text-clean.js'
import type { Stage } from '../types.js'
import { executeStage, DEFAULT_RETRY } from './runner.js'
import {
  extractTextCleanInputSchema,
  extractTextCleanOutputSchema,
  type ExtractTextCleanInput,
  type ExtractTextCleanOutput,
} from './types.js'

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
