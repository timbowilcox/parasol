// Scraper interface.
//
// One scraper per source. Each scraper is responsible for:
// 1. Discovering canonical document ids for the source (listAvailable)
// 2. Fetching one document at a time (fetchDocument)
// 3. Polite rate limiting and User-Agent identification
//
// The orchestrator (ingest.ts) handles iteration, idempotency (re-fetch
// skipping based on existing corpus_documents rows), and persistence.

import type { RawDocument } from '../types.js'

export interface Scraper {
  // Stable slug — must match a row in corpus_sources.slug.
  readonly slug: string

  // Discover available canonical ids in the source. May be paginated; the
  // scraper handles pagination internally and yields all ids it can reach.
  // For Sprint 1 we cap with `limit`; full enumeration lands in Sprint 4.
  listAvailable(limit?: number): AsyncIterable<string>

  // Fetch a single document by canonical id. Returns null if the id no
  // longer resolves (e.g. removed from source).
  fetchDocument(canonicalId: string): Promise<RawDocument | null>
}

// ─── Polite fetch helper ───────────────────────────────────────────────────
// Shared by scrapers. Enforces a minimum delay between calls per host and
// sets a Parasol User-Agent. Returns response text + content-type.

const lastFetchByHost = new Map<string, number>()

export interface PoliteFetchOptions {
  // Minimum ms between calls to the same host. Default: 2000.
  minIntervalMs?: number
  // Override the User-Agent (default reads CORPUS_USER_AGENT env or
  // a Parasol-identified fallback).
  userAgent?: string
  // Per-request timeout. Default: 30s.
  timeoutMs?: number
}

const DEFAULT_INTERVAL = 2000
const DEFAULT_TIMEOUT = 30000

export async function politeFetch(
  url: string,
  opts: PoliteFetchOptions = {},
): Promise<{ status: number; body: string; contentType: string }> {
  const interval = opts.minIntervalMs ?? DEFAULT_INTERVAL
  const userAgent = opts.userAgent
    ?? process.env['CORPUS_USER_AGENT']
    ?? 'Parasol Corpus Ingestion (admin@parasol.co.ke)'
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT

  const host = new URL(url).host
  const now = Date.now()
  const last = lastFetchByHost.get(host) ?? 0
  const waitMs = Math.max(0, interval - (now - last))
  if (waitMs > 0) {
    await new Promise((r) => setTimeout(r, waitMs))
  }
  lastFetchByHost.set(host, Date.now())

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': userAgent, Accept: 'text/html, application/xhtml+xml, application/xml, text/plain;q=0.9, */*;q=0.8' },
      signal: controller.signal,
    })
    const body = await res.text()
    return {
      status: res.status,
      body,
      contentType: res.headers.get('content-type') ?? 'text/html',
    }
  } finally {
    clearTimeout(timeout)
  }
}

// Test hook: clear the per-host throttle (used by unit tests so they don't
// have to wait 2s between mocked calls).
export function __resetPoliteThrottle(): void {
  lastFetchByHost.clear()
}
