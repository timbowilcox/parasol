// Eval runner.
//
// Walks `packages/eval/data/golden/<contract-type>/`, loads every `.annotation.yaml`,
// pairs it with the corresponding NDA file, runs the pipeline (stub or
// production), and returns per-NDA scores plus the run-level aggregate.

import { readFile, readdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { groundTruthSchema } from './schema.js'
import type { GroundTruth, PipelineOutput, PerNdaScore, EvalRunResult } from './types.js'
import { scoreNda, buildRunResult } from './metrics.js'
import { runStubPipeline, type StubMode } from './pipeline-stub.js'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const DEFAULT_GOLDEN_DIR = resolve(PACKAGE_ROOT, 'data', 'golden', 'nda')

// ─── Annotation loader ──────────────────────────────────────────────────────

export interface LoadedAnnotation {
  groundTruth: GroundTruth
  // Path to the NDA file the annotation refers to.
  ndaPath: string
  // The NDA's plaintext content (extracted lazily; null if extraction fails
  // or if the file doesn't exist — the runner skips hallucination check then).
  sourceText: string | null
}

// Read every *.annotation.yaml file in the directory, parse + validate, and
// pair with the corresponding NDA file. The annotation's `filename` field
// must match a file in the same directory.
export async function loadAnnotations(dir = DEFAULT_GOLDEN_DIR): Promise<LoadedAnnotation[]> {
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch (cause) {
    throw new Error(`failed to list ${dir}: ${(cause as Error).message}`)
  }
  const annotationFiles = entries
    .filter((f) => f.endsWith('.annotation.yaml'))
    .sort()

  const out: LoadedAnnotation[] = []
  for (const af of annotationFiles) {
    const path = resolve(dir, af)
    const text = await readFile(path, 'utf8')
    const raw = parseYaml(text)
    const parsed = groundTruthSchema.safeParse(raw)
    if (!parsed.success) {
      throw new Error(`invalid annotation ${af}: ${parsed.error.message}`)
    }
    const gt = parsed.data
    const ndaPath = resolve(dir, gt.filename)
    // Skip plaintext load for known binary formats — reading a PDF or DOCX
    // as UTF-8 produces garbage that defeats the hallucination substring
    // check (every pipeline string would be "not in source"). Day 7 wires
    // the real extract-text stage; until then, hallucination is checked
    // only against true plaintext sources (fixtures + future .txt golden
    // entries).
    const lower = gt.filename.toLowerCase()
    const isBinary = lower.endsWith('.pdf') || lower.endsWith('.docx') || lower.endsWith('.doc')
    let sourceText: string | null = null
    if (!isBinary) {
      try {
        sourceText = await readFile(ndaPath, 'utf8')
      } catch {
        sourceText = null
      }
    }
    out.push({ groundTruth: gt as GroundTruth, ndaPath, sourceText })
  }
  return out
}

// ─── Pipeline interface ─────────────────────────────────────────────────────

// Production code (Day 9) will replace this with the real orchestrator.
export type Pipeline = (gt: GroundTruth, source: string | null) => Promise<PipelineOutput>

// Build a stub pipeline binding for a given mode.
export function stubPipeline(mode: StubMode): Pipeline {
  return async (gt) => runStubPipeline(gt, { mode })
}

// ─── Run ────────────────────────────────────────────────────────────────────

export interface RunOptions {
  goldenDir?: string
  pipeline: Pipeline
  pipelineLabel: 'stub' | 'production'
  // Sprint label (e.g. 'sprint-1') — used to name the result file.
  sprint: string
  models?: { haiku?: string; sonnet?: string; opus?: string }
  // Citation resolver — when supplied, citation validity is independently
  // verified against the corpus. CI gate always supplies one.
  resolveCitation?: (source: string, id: string) => Promise<boolean>
  // Optional progress callback (per-NDA tick).
  onProgress?: (event: { filename: string; index: number; total: number }) => void
  gitSha?: string
}

export async function run(options: RunOptions): Promise<EvalRunResult> {
  const annotations = await loadAnnotations(options.goldenDir)
  const perNda: PerNdaScore[] = []
  for (let i = 0; i < annotations.length; i++) {
    const a = annotations[i]!
    options.onProgress?.({ filename: a.groundTruth.filename, index: i, total: annotations.length })
    const out = await options.pipeline(a.groundTruth, a.sourceText)
    const score = await scoreNda({
      groundTruth: a.groundTruth,
      pipelineOutput: out,
      sourceText: a.sourceText,
      resolveCitation: options.resolveCitation ?? null,
    })
    perNda.push(score)
  }
  return buildRunResult({
    sprint: options.sprint,
    pipeline: options.pipelineLabel,
    models: options.models ?? {},
    perNda,
    gitSha: options.gitSha,
  })
}
