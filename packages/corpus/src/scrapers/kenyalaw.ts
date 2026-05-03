// Kenya Law (kenyalaw.org) scraper.
//
// Sprint 1 scope: handle Acts of Parliament by canonical id (e.g.
// 'CAP-486-Companies-Act' or 'No-24-of-2019-Data-Protection-Act'). The
// listAvailable() method is constrained to a small fixture set in Sprint 1;
// full enumeration of all Acts and judgments lands in Sprint 4 alongside
// the scheduler (DEF-017).
//
// Kenya Law uses the AKN (Akoma Ntoso) HTML rendering for statutes; all
// statute pages have URL pattern:
//   https://kenyalaw.org/akn/ke/act/<year>/<num>/eng@<date>
// or for chapter-of-laws revisions:
//   https://kenyalaw.org/akn/ke/act/<year>/<num>
//
// We treat the canonicalId as the AKN path tail (e.g. "2019/24" or
// "2010/constitution"). The scraper resolves the URL itself.

import * as cheerio from 'cheerio'
import { CorpusError } from '@parasol/core'
import type { RawDocument } from '../types.js'
import type { Jurisdiction, DocumentType } from '@parasol/core'
import type { Scraper } from './types.js'
import { politeFetch } from './types.js'

const DEFAULT_BASE = 'https://kenyalaw.org'

// Sprint 1 fixture: the three acts called out in docs/sprint-1-plan.md
// + Constitution. Full enumeration in Sprint 4.
const SPRINT1_ACT_IDS: ReadonlyArray<{
  canonicalId: string
  title: string
  sourceType: DocumentType
}> = [
  { canonicalId: '2010/constitution', title: 'Constitution of Kenya, 2010', sourceType: 'statute' },
  { canonicalId: '2019/24', title: 'Data Protection Act, 2019', sourceType: 'statute' },
  { canonicalId: '2015/17', title: 'Companies Act, 2015', sourceType: 'statute' },
  { canonicalId: '1998/2', title: 'Kenya Information and Communications Act, 1998', sourceType: 'statute' },
]

export interface KenyaLawScraperOptions {
  baseUrl?: string
  // Optional override for politeFetch options (used by tests to avoid 2s waits).
  fetchOptions?: Parameters<typeof politeFetch>[1]
}

export class KenyaLawScraper implements Scraper {
  readonly slug = 'kenya-acts'
  private readonly baseUrl: string
  private readonly fetchOptions: Parameters<typeof politeFetch>[1]

  constructor(opts: KenyaLawScraperOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '')
    this.fetchOptions = opts.fetchOptions ?? {}
  }

  // Sprint 1: fixed list. Sprint 4: paginate the Acts index page.
  async *listAvailable(limit?: number): AsyncIterable<string> {
    const items = limit ? SPRINT1_ACT_IDS.slice(0, limit) : SPRINT1_ACT_IDS
    for (const item of items) {
      yield item.canonicalId
    }
  }

  async fetchDocument(canonicalId: string): Promise<RawDocument | null> {
    const url = this.buildUrl(canonicalId)
    const res = await politeFetch(url, this.fetchOptions)
    if (res.status === 404) return null
    if (res.status >= 400) {
      throw new CorpusError(
        `kenyalaw fetch failed: HTTP ${res.status} for ${url}`,
        this.slug,
      )
    }

    const fixture = SPRINT1_ACT_IDS.find((i) => i.canonicalId === canonicalId)
    const title = fixture?.title ?? extractTitle(res.body) ?? canonicalId
    const sourceType: DocumentType = fixture?.sourceType ?? 'statute'
    const jurisdiction: Jurisdiction = 'kenya'
    const effectiveDate = parseEffectiveDate(canonicalId)

    return {
      canonicalId,
      jurisdiction,
      sourceType,
      title,
      sourceUrl: url,
      retrievedAt: new Date(),
      effectiveDate,
      contentType: res.contentType.startsWith('text/html') ? 'text/html' : 'text/plain',
      body: res.body,
      metadata: {
        scraper: 'kenya-acts',
        akn_path: canonicalId,
      },
    }
  }

  buildUrl(canonicalId: string): string {
    // canonicalId = "2019/24" or "2010/constitution"
    return `${this.baseUrl}/akn/ke/act/${canonicalId}/eng@`.replace(/@$/, '')
  }
}

// Extract <title> or <h1> from raw HTML. Used as a fallback when the
// canonical id isn't in the fixture set.
function extractTitle(html: string): string | null {
  const $ = cheerio.load(html)
  const title = $('title').first().text().trim() || $('h1').first().text().trim()
  return title || null
}

// Try to parse the effective date from the canonical id. "2019/24" → 2019.
// Returns the year's Jan 1 as a placeholder — real dates land in Sprint 4
// when we parse the AKN metadata.
function parseEffectiveDate(canonicalId: string): Date | null {
  const m = canonicalId.match(/^(\d{4})/)
  if (!m) return null
  return new Date(`${m[1]}-01-01T00:00:00Z`)
}
