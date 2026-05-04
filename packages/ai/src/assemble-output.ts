// Stage 10: assemble-output (deterministic).
//
// Final stage. No LLM call — pure transformation of pipeline state into
// the three customer-facing surfaces:
//   - webView    — JSON for the /review/[id] React page
//   - email      — plain text + HTML body for the Resend reply
//   - redline    — base64-encoded .docx
//
// Sprint 1 DOCX format: clean Word document with the original document
// reproduced + an issues summary at the top. Inline annotations next to
// flagged clauses use [REDLINE: Parasol recommends ...] markers because
// native Word tracked-changes (using the docx library's InsertedTextRun
// + DeletedTextRun + Document.features.trackRevisions) is a Day 12+ polish
// item — see DEF-046 in DEFERRED.md.

import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun,
} from 'docx'
import type {
  AssembledOutput,
  DefinedTermIssue,
  EmailBody,
  ExtractedClauseDraft,
  PipelineIssue,
  TriageOutput,
  WebViewData,
  WebViewIssue,
} from './stages/types.js'

// ─── Public entry point ─────────────────────────────────────────────────────

export interface AssembleInput {
  reviewId: string
  triage: TriageOutput
  clauses: ExtractedClauseDraft[]
  issues: PipelineIssue[]
  definedTerms: DefinedTermIssue[]
  // Verbatim plaintext from extract-text. Goes into the DOCX body so the
  // recipient sees the contract content with the redline annotations
  // alongside it. Empty string is acceptable — produces a DOCX with the
  // issues summary only.
  fullText: string
}

export async function assembleOutput(input: AssembleInput): Promise<AssembledOutput> {
  const webView = buildWebView(input)
  const email = buildEmailBody(webView)
  const docxBytes = await buildRedlineDocx(input)
  const redlineDocxBase64 = Buffer.from(docxBytes).toString('base64')
  return { webView, email, redlineDocxBase64 }
}

// ─── Web view JSON ──────────────────────────────────────────────────────────

function buildWebView(input: AssembleInput): WebViewData {
  const summary = summariseIssues(input.issues)
  const issues: WebViewIssue[] = input.issues.map((i) => ({
    clauseId: i.clauseId,
    severity: i.severity,
    confidence: i.confidence,
    currentPosition: i.currentPosition,
    recommendedPosition: i.recommendedPosition,
    reasoning: i.reasoning,
    redlineText: i.redlineText,
    citations: i.citations.map((c) => ({
      source: c.source,
      id: c.id,
      section: c.section,
      validated: c.validated,
    })),
  }))
  return {
    reviewId: input.reviewId,
    contractType: input.triage.contractType,
    jurisdiction: input.triage.jurisdiction,
    parties: input.triage.parties.map((p) => ({ role: p.role, name: p.name })),
    summary,
    issues,
    definedTerms: input.definedTerms,
  }
}

function summariseIssues(issues: readonly PipelineIssue[]): WebViewData['summary'] {
  const counts = { critical: 0, material: 0, minor: 0 }
  for (const i of issues) counts[i.severity]++

  // Citation validity over the whole review: number of citations resolved /
  // total citations. Mirrors the eval harness's CI gate metric.
  let total = 0
  let resolved = 0
  for (const issue of issues) {
    for (const c of issue.citations) {
      total++
      // Trusted = market-norm/parasol-internal (we never resolve these
      // against corpus) OR a corpus-source citation that resolved.
      if (c.source === 'market-norm' || c.source === 'parasol-internal' || c.validated) {
        resolved++
      }
    }
  }
  const citationValidityRate = total > 0 ? resolved / total : 1
  return { ...counts, citationValidityRate }
}

// ─── Email body ─────────────────────────────────────────────────────────────

function buildEmailBody(webView: WebViewData): EmailBody {
  const { summary, issues } = webView
  const subjectSuffix = ` — Parasol review (${summary.critical} critical, ${summary.material} material, ${summary.minor} minor)`

  // ── Plain text version
  const plainLines: string[] = []
  plainLines.push('Hi,')
  plainLines.push('')
  plainLines.push(
    `Parasol reviewed your ${webView.contractType.toUpperCase()} (jurisdiction: ${webView.jurisdiction}). `
      + `${summary.critical + summary.material + summary.minor} issue(s) flagged: `
      + `${summary.critical} critical, ${summary.material} material, ${summary.minor} minor.`,
  )
  plainLines.push('')
  if (summary.citationValidityRate < 1) {
    plainLines.push(
      `[Note: ${(summary.citationValidityRate * 100).toFixed(0)}% of citations resolved against the corpus. `
        + 'Issues with unresolved citations have been downgraded to manual-review confidence.]',
    )
    plainLines.push('')
  }
  for (const i of issues) {
    plainLines.push(`---- ${i.severity.toUpperCase()} · ${i.clauseId} (${i.confidence}) ----`)
    plainLines.push(`Current: ${i.currentPosition}`)
    plainLines.push(`Recommended: ${i.recommendedPosition}`)
    if (i.reasoning) plainLines.push(`Why: ${i.reasoning}`)
    if (i.citations.length > 0) {
      const cites = i.citations
        .map((c) => `${c.source}/${c.id}${c.section ? ' ' + c.section : ''}${c.validated ? '' : ' [unverified]'}`)
        .join('; ')
      plainLines.push(`Citations: ${cites}`)
    }
    plainLines.push('')
  }
  plainLines.push('A redlined version is attached as a Word document.')
  plainLines.push('')
  plainLines.push('— Parasol')
  const plainText = plainLines.join('\n')

  // ── HTML version (same content, HTML-tagged for Gmail / Outlook rendering)
  const html = renderEmailHtml(webView)

  return { subjectSuffix, plainText, html }
}

function renderEmailHtml(webView: WebViewData): string {
  const { summary, issues } = webView
  const escape = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  const counts = `<p><strong>${summary.critical}</strong> critical · <strong>${summary.material}</strong> material · <strong>${summary.minor}</strong> minor</p>`
  const noteCit = summary.citationValidityRate < 1
    ? `<p><em>${(summary.citationValidityRate * 100).toFixed(0)}% of citations resolved against the corpus. Issues with unresolved citations have been downgraded to manual-review confidence.</em></p>`
    : ''
  const issueBlocks = issues.map((i) => `
    <div style="margin: 16px 0; padding: 12px; border-left: 3px solid #${severityColor(i.severity)};">
      <h3 style="margin: 0 0 8px 0;">${i.severity.toUpperCase()} · ${escape(i.clauseId)} <small style="color: #666; font-weight: normal;">(${escape(i.confidence)})</small></h3>
      <p><strong>Current:</strong> ${escape(i.currentPosition)}</p>
      <p><strong>Recommended:</strong> ${escape(i.recommendedPosition)}</p>
      ${i.reasoning ? `<p><strong>Why:</strong> ${escape(i.reasoning)}</p>` : ''}
      ${i.citations.length > 0 ? `<p><small>Citations: ${i.citations.map((c) => `${escape(c.source)}/${escape(c.id)}${c.section ? ' ' + escape(c.section) : ''}${c.validated ? '' : ' [unverified]'}`).join('; ')}</small></p>` : ''}
    </div>`).join('')

  return `<!doctype html><html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 720px;">
  <p>Hi,</p>
  <p>Parasol reviewed your ${escape(webView.contractType.toUpperCase())} (jurisdiction: ${escape(webView.jurisdiction)}).</p>
  ${counts}
  ${noteCit}
  ${issueBlocks}
  <p>A redlined version is attached as a Word document.</p>
  <p>— Parasol</p>
</body></html>`
}

// 6-character hex (no '#') so the value is usable both for HTML
// (callers prepend '#') and for the docx library (which rejects '#'
// prefixes and 3-char short forms).
function severityColor(s: 'critical' | 'material' | 'minor'): string {
  if (s === 'critical') return 'c43d3d'
  if (s === 'material') return 'c47e3d'
  return '888888'
}

// ─── DOCX redline output ────────────────────────────────────────────────────

async function buildRedlineDocx(input: AssembleInput): Promise<Uint8Array> {
  const sections: Paragraph[] = []

  // Header
  sections.push(new Paragraph({
    text: 'Parasol — Contract review',
    heading: HeadingLevel.TITLE,
    alignment: AlignmentType.LEFT,
  }))
  sections.push(new Paragraph({
    children: [
      new TextRun({ text: `Contract type: `, bold: true }),
      new TextRun({ text: input.triage.contractType }),
    ],
  }))
  sections.push(new Paragraph({
    children: [
      new TextRun({ text: `Jurisdiction: `, bold: true }),
      new TextRun({ text: input.triage.jurisdiction }),
    ],
  }))
  if (input.triage.parties.length > 0) {
    sections.push(new Paragraph({
      children: [
        new TextRun({ text: 'Parties: ', bold: true }),
        new TextRun({
          text: input.triage.parties
            .map((p) => `${p.name || '[unnamed]'} (${p.role})`)
            .join('; '),
        }),
      ],
    }))
  }
  sections.push(new Paragraph({ text: '' }))

  // Issues summary
  const counts = input.issues.reduce(
    (acc, i) => ({ ...acc, [i.severity]: acc[i.severity] + 1 }),
    { critical: 0, material: 0, minor: 0 },
  )
  sections.push(new Paragraph({
    text: 'Summary',
    heading: HeadingLevel.HEADING_1,
  }))
  sections.push(new Paragraph({
    children: [
      new TextRun({ text: `${counts.critical} critical`, bold: true, color: 'c43d3d' }),
      new TextRun({ text: ' · ' }),
      new TextRun({ text: `${counts.material} material`, bold: true, color: 'c47e3d' }),
      new TextRun({ text: ' · ' }),
      new TextRun({ text: `${counts.minor} minor`, bold: true }),
    ],
  }))
  sections.push(new Paragraph({ text: '' }))

  // Per-issue detail
  sections.push(new Paragraph({
    text: 'Issues',
    heading: HeadingLevel.HEADING_1,
  }))
  for (const issue of input.issues) {
    sections.push(new Paragraph({
      children: [
        new TextRun({
          text: `${issue.severity.toUpperCase()} — ${issue.clauseId}`,
          bold: true,
          color: severityColor(issue.severity),
        }),
        new TextRun({ text: `   (${issue.confidence})`, italics: true }),
      ],
      heading: HeadingLevel.HEADING_2,
    }))
    sections.push(paragraphLabelled('Current', issue.currentPosition))
    sections.push(paragraphLabelled('Recommended', issue.recommendedPosition))
    if (issue.reasoning) sections.push(paragraphLabelled('Why', issue.reasoning))
    if (issue.redlineText) {
      sections.push(paragraphLabelled('Proposed redline', issue.redlineText))
    }
    if (issue.citations.length > 0) {
      const cites = issue.citations
        .map((c) => `${c.source}/${c.id}${c.section ? ' ' + c.section : ''}${c.validated ? '' : ' [unverified]'}`)
        .join('; ')
      sections.push(paragraphLabelled('Citations', cites))
    }
    sections.push(new Paragraph({ text: '' }))
  }

  // Defined-term issues
  if (input.definedTerms.length > 0) {
    sections.push(new Paragraph({
      text: 'Defined-term issues',
      heading: HeadingLevel.HEADING_1,
    }))
    for (const dt of input.definedTerms) {
      sections.push(new Paragraph({
        children: [
          new TextRun({ text: dt.kind, bold: true }),
          new TextRun({ text: ' — ' }),
          new TextRun({ text: dt.term, bold: true }),
          new TextRun({ text: `: ${dt.description}` }),
        ],
      }))
    }
    sections.push(new Paragraph({ text: '' }))
  }

  // Original document body (annotated). Each paragraph from the source is
  // reproduced; if a clause matches a flagged issue, append a [REDLINE: ...]
  // marker on the next line. Sprint 1 simplification — Day 12+ replaces with
  // native Word tracked-changes (DEF-046).
  if (input.fullText) {
    sections.push(new Paragraph({
      text: 'Original document (annotated)',
      heading: HeadingLevel.HEADING_1,
    }))
    const issueByClauseId = new Map<string, PipelineIssue>()
    for (const issue of input.issues) issueByClauseId.set(issue.clauseId, issue)

    for (const para of input.fullText.split(/\n{2,}/)) {
      const trimmed = para.trim()
      if (!trimmed) continue
      sections.push(new Paragraph({ text: trimmed }))
      // Flag any issue whose redlineText would replace text inside this paragraph.
      // Cheap substring match — Sprint 1 heuristic.
      for (const [clauseId, issue] of issueByClauseId) {
        if (issue.currentPosition && trimmed.toLowerCase().includes(
          issue.currentPosition.slice(0, 32).toLowerCase(),
        )) {
          sections.push(new Paragraph({
            children: [
              new TextRun({
                text: `[REDLINE — ${clauseId}: ${issue.recommendedPosition}]`,
                italics: true,
                color: severityColor(issue.severity),
              }),
            ],
          }))
        }
      }
    }
  }

  // Footer
  sections.push(new Paragraph({ text: '' }))
  sections.push(new Paragraph({
    children: [
      new TextRun({
        text: 'Generated by Parasol — review draft, not a substitute for counsel review.',
        italics: true,
        color: '888888',
        size: 20,
      }),
    ],
  }))

  const doc = new Document({
    creator: 'Parasol',
    title: `Parasol review — ${input.reviewId}`,
    sections: [{ children: sections }],
  })

  return Packer.toBuffer(doc)
}

function paragraphLabelled(label: string, body: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true }),
      new TextRun({ text: body }),
    ],
  })
}
