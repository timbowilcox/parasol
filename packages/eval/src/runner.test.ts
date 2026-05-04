import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { run, stubPipeline, loadAnnotations } from './runner.js'

describe('runner — end-to-end with stub pipeline', () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(resolve(tmpdir(), 'parasol-eval-'))
    // Two minimal fixtures.
    await writeFile(resolve(dir, 'nda-001.txt'), 'fake pdf bytes', 'utf8')
    await writeFile(
      resolve(dir, 'nda-001.txt.annotation.yaml'),
      stringifyYaml({
        filename: 'nda-001.txt',
        annotated_at: '2026-05-04',
        annotated_by: 'parasol-internal-draft',
        expected_issues: [
          { clause_id: 'governing_law', severity: 'critical', description: 'Delaware-governed.' },
        ],
        expected_citations: [{ source: 'kenya-statute', id: '2019/24' }],
      }),
      'utf8',
    )
    await writeFile(resolve(dir, 'nda-002.txt'), 'fake pdf bytes', 'utf8')
    await writeFile(
      resolve(dir, 'nda-002.txt.annotation.yaml'),
      stringifyYaml({
        filename: 'nda-002.txt',
        annotated_at: '2026-05-04',
        annotated_by: 'parasol-internal-draft',
        expected_issues: [
          { clause_id: 'data_protection', severity: 'critical', description: 'No DPA.' },
          { clause_id: 'confidentiality_term', severity: 'minor', description: '5 years.' },
        ],
      }),
      'utf8',
    )
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('loads annotations + sourceText from disk', async () => {
    const annotations = await loadAnnotations(dir)
    expect(annotations).toHaveLength(2)
    expect(annotations[0]!.groundTruth.filename).toBe('nda-001.txt')
    expect(annotations[0]!.sourceText).toBe('fake pdf bytes')
  })

  it('stub:oracle yields F1=1.0 across all cases', async () => {
    const result = await run({
      goldenDir: dir,
      pipeline: stubPipeline('oracle'),
      pipelineLabel: 'stub',
      sprint: 'unit-test',
    })
    expect(result.per_nda).toHaveLength(2)
    expect(result.aggregate.clause_identification_f1).toBe(1)
    expect(result.aggregate.cases).toBe(2)
    expect(result.aggregate.hallucination_rate).toBe(0)
    expect(result.aggregate.citation_validity_rate).toBe(1)
  })

  it('stub:noisy yields a degraded score (penalises misses + hallucinations)', async () => {
    const result = await run({
      goldenDir: dir,
      pipeline: stubPipeline('noisy'),
      pipelineLabel: 'stub',
      sprint: 'unit-test',
    })
    expect(result.aggregate.clause_identification_f1).toBeLessThan(1)
    // Noisy stub adds a fabricated issue with text not in the source bytes
    expect(result.aggregate.hallucination_rate).toBeGreaterThan(0)
  })

  it('skips plaintext load for binary formats (.pdf / .docx) — sourceText is null', async () => {
    const binDir = await mkdtemp(resolve(tmpdir(), 'parasol-eval-bin-'))
    try {
      await writeFile(resolve(binDir, 'doc.pdf'), 'fake pdf bytes', 'utf8')
      await writeFile(
        resolve(binDir, 'doc.pdf.annotation.yaml'),
        stringifyYaml({
          filename: 'doc.pdf',
          annotated_at: '2026-05-04',
          annotated_by: 'parasol-internal-draft',
          expected_issues: [{ clause_id: 'a', severity: 'critical', description: 'x' }],
        }),
        'utf8',
      )
      const ann = await loadAnnotations(binDir)
      expect(ann).toHaveLength(1)
      expect(ann[0]!.sourceText).toBeNull()
    } finally {
      await rm(binDir, { recursive: true, force: true })
    }
  })

  it('throws on a malformed annotation file', async () => {
    const badDir = await mkdtemp(resolve(tmpdir(), 'parasol-eval-bad-'))
    try {
      await writeFile(
        resolve(badDir, 'broken.annotation.yaml'),
        stringifyYaml({ filename: 'x', annotated_at: 'not-a-date', annotated_by: '', expected_issues: [] }),
        'utf8',
      )
      await expect(loadAnnotations(badDir)).rejects.toThrow(/invalid annotation/)
    } finally {
      await rm(badDir, { recursive: true, force: true })
    }
  })

  it('progress callback fires per case', async () => {
    const events: string[] = []
    await run({
      goldenDir: dir,
      pipeline: stubPipeline('oracle'),
      pipelineLabel: 'stub',
      sprint: 'unit-test',
      onProgress: (e) => events.push(`${e.index + 1}/${e.total}:${e.filename}`),
    })
    expect(events).toEqual([
      '1/2:nda-001.txt',
      '2/2:nda-002.txt',
    ])
  })
})
