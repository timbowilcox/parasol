import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { KenyaLawScraper } from './kenyalaw.js'
import { __resetPoliteThrottle } from './types.js'

const originalFetch = globalThis.fetch

beforeEach(() => {
  __resetPoliteThrottle()
})

afterEach(() => {
  globalThis.fetch = originalFetch
})

function mockFetch(map: Record<string, { status: number; body: string; contentType?: string }>) {
  globalThis.fetch = vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input.toString()
    const entry = map[url] ?? Object.entries(map).find(([k]) => url.startsWith(k))?.[1]
    if (!entry) throw new Error(`unmocked URL: ${url}`)
    return new Response(entry.body, {
      status: entry.status,
      headers: { 'content-type': entry.contentType ?? 'text/html' },
    })
  }) as never
}

describe('KenyaLawScraper.listAvailable', () => {
  it('yields fixture canonical ids', async () => {
    const scraper = new KenyaLawScraper({ fetchOptions: { minIntervalMs: 0 } })
    const ids: string[] = []
    for await (const id of scraper.listAvailable()) ids.push(id)
    expect(ids).toContain('2010/constitution')
    expect(ids).toContain('2019/24')
    expect(ids).toContain('2015/17')
    expect(ids).toContain('1998/2')
  })

  it('respects limit parameter', async () => {
    const scraper = new KenyaLawScraper({ fetchOptions: { minIntervalMs: 0 } })
    const ids: string[] = []
    for await (const id of scraper.listAvailable(2)) ids.push(id)
    expect(ids).toHaveLength(2)
  })
})

describe('KenyaLawScraper.fetchDocument', () => {
  it('returns a RawDocument for a known id', async () => {
    mockFetch({
      'https://new.kenyalaw.org/akn/ke/act/2019/24/eng': {
        status: 200,
        body: '<html><body><main><h1>Data Protection Act</h1><p>Be it enacted...</p></main></body></html>',
      },
    })
    const scraper = new KenyaLawScraper({ fetchOptions: { minIntervalMs: 0 } })
    const doc = await scraper.fetchDocument('2019/24')
    expect(doc).not.toBeNull()
    expect(doc!.canonicalId).toBe('2019/24')
    expect(doc!.title).toBe('Data Protection Act, 2019')  // from fixture, not extracted
    expect(doc!.jurisdiction).toBe('kenya')
    expect(doc!.sourceType).toBe('statute')
    expect(doc!.contentType).toBe('text/html')
    expect(doc!.body).toContain('Be it enacted')
    expect(doc!.effectiveDate?.getUTCFullYear()).toBe(2019)
  })

  it('returns null on 404', async () => {
    mockFetch({
      'https://new.kenyalaw.org/akn/ke/act/9999/99/eng': {
        status: 404,
        body: 'Not Found',
      },
    })
    const scraper = new KenyaLawScraper({ fetchOptions: { minIntervalMs: 0 } })
    const doc = await scraper.fetchDocument('9999/99')
    expect(doc).toBeNull()
  })

  it('throws CorpusError on 5xx', async () => {
    mockFetch({
      'https://new.kenyalaw.org/akn/ke/act/2019/24/eng': {
        status: 503,
        body: 'Service Unavailable',
      },
    })
    const scraper = new KenyaLawScraper({ fetchOptions: { minIntervalMs: 0 } })
    await expect(scraper.fetchDocument('2019/24')).rejects.toThrow(/HTTP 503/)
  })

  it('uses extracted title for non-fixture ids', async () => {
    mockFetch({
      'https://new.kenyalaw.org/akn/ke/act/2099/99/eng': {
        status: 200,
        body: '<html><head><title>Some Future Act, 2099</title></head><body>...</body></html>',
      },
    })
    const scraper = new KenyaLawScraper({ fetchOptions: { minIntervalMs: 0 } })
    const doc = await scraper.fetchDocument('2099/99')
    expect(doc!.title).toBe('Some Future Act, 2099')
  })
})
