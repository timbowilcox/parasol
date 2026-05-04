import { qualityAssessPrompt } from '../prompts/quality-assess'
import type { Stage } from '../types'
import { executeStage, DEFAULT_RETRY } from './runner'
import {
  qualityAssessInputSchema,
  qualityAssessOutputSchema,
  type QualityAssessInput,
  type QualityAssessOutput,
} from './types'

export const qualityAssessStage: Stage<QualityAssessInput, QualityAssessOutput> = {
  name: 'quality-assess',
  version: '0.1.0',
  modelRole: 'haiku',
  prompt: qualityAssessPrompt,
  inputSchema: qualityAssessInputSchema,
  outputSchema: qualityAssessOutputSchema,
  cacheable: false,  // per-document state
  retry: DEFAULT_RETRY,
  evalCases: [],     // Day 13 populates with golden case ids that exercise this stage
  run(input, ctx) {
    return executeStage({ stage: qualityAssessStage, input, ctx })
  },
}
