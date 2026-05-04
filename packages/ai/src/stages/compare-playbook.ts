import { comparePlaybookPrompt } from '../prompts/compare-playbook.js'
import type { Stage } from '../types.js'
import { executeStage, DEFAULT_RETRY } from './runner.js'
import {
  comparePlaybookInputSchema,
  comparePlaybookOutputSchema,
  type ComparePlaybookInput,
  type ComparePlaybookOutput,
} from './types.js'

export const comparePlaybookStage: Stage<ComparePlaybookInput, ComparePlaybookOutput> = {
  name: 'compare-playbook',
  version: '0.1.0',
  modelRole: 'sonnet',
  prompt: comparePlaybookPrompt,
  inputSchema: comparePlaybookInputSchema,
  outputSchema: comparePlaybookOutputSchema,
  // The playbook context is cacheable across all calls within a review;
  // the per-call user content is not. Cache flag here is informational only —
  // the actual cache_control hints are placed by the runner via
  // includePlaybookContext.
  cacheable: true,
  retry: DEFAULT_RETRY,
  evalCases: [],
  run(input, ctx) {
    return executeStage({
      stage: comparePlaybookStage,
      input,
      ctx,
      includePlaybookContext: true,
    })
  },
}
