import { generateRedlinePrompt } from '../prompts/generate-redline.js'
import type { Stage } from '../types.js'
import { executeStage, DEFAULT_RETRY } from './runner.js'
import {
  generateRedlineInputSchema,
  generateRedlineOutputSchema,
  type GenerateRedlineInput,
  type GenerateRedlineOutput,
} from './types.js'

export const generateRedlineStage: Stage<GenerateRedlineInput, GenerateRedlineOutput> = {
  name: 'generate-redline',
  version: '0.1.0',
  modelRole: 'sonnet',
  prompt: generateRedlinePrompt,
  inputSchema: generateRedlineInputSchema,
  outputSchema: generateRedlineOutputSchema,
  // Both playbook context and per-deviation authority chunks are cacheable;
  // the runner attaches them at call time via includePlaybookContext +
  // includeAuthorityChunks.
  cacheable: true,
  retry: DEFAULT_RETRY,
  evalCases: [],
  run(input, ctx) {
    return executeStage({
      stage: generateRedlineStage,
      input,
      ctx,
      includePlaybookContext: true,
      includeAuthorityChunks: true,
    })
  },
}
