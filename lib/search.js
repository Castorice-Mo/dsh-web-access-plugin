/**
 * Web search backends.
 *
 * Two plain-HTTP engines (Bing, DuckDuckGo HTML) cover the common case in under
 * a second, and the same Bing query can be routed through headless Edge when a
 * page needs the browser's own network stack. No API key is required anywhere.
 */
import { requestText } from './http.js'
import { decodeRedirect, firstHref, inlineText } from './html.js'
import { renderWithEdge } from './edge.js'

const ENGINES = ['bing', 'duckduckgo', 'edge']

function normalizeUrl(url) {
  if (!url) return ''
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return ''
    return parsed.toString()
  } catch {
    return ''
  }
}

/**
 * Parse one Bing results page.
 * Bing keeps every organic result in `<li class="b_algo">`, so splitting on the
 * class marker is enough: each chunk is parsed only from its own head.
 */
export function parseBing(html, limit) {
  const sources = []
  const chunks = String(html).split('class="b_algo"')
  for (let index = 1; index < chunks.length && sources.length < limit; index += 1) {
    const chunk = chunks[index].slice(0, 6000)
    const heading = /<h2\b[^>]*>([\s\S]*?)<\/h2>/i.exec(chunk)
    if (!heading) continue
    const url = normalizeUrl(decodeRedirect(firstHref(heading[1]), 'https://www.bing.com'))
    if (!url) continue
    const title = inlineText(heading[1]) || url
    const snippetMatch =
      /<p\b[^>]*class="[^"]*b_lineclamp[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(chunk) ??
      /<div\b[^>]*class="[^"]*b_caption[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(chunk) ??
      /<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(chunk)
    const snippet = snippetMatch ? inlineText(snippetMatch[1]).slice(0, 400) : ''
    sources.push({ url, title, ...(snippet ? { snippet } : {}) })
  }
  return sources
}

/** Parse one DuckDuckGo HTML (no-JavaScript) results page. */
export function parseDuckDuckGo(html, limit) {
  const sources = []
  const pattern = /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/gi
  let match
  while ((match = pattern.exec(String(html))) !== null && sources.length < limit) {
    const anchor = match[0]
    const url = normalizeUrl(decodeRedirect(firstHref(anchor), 'https://duckduckgo.com'))
    if (!url) continue
    const title = inlineText(match[1]) || url
    const after = String(html).slice(match.index, match.index + 4000)
    const snippetMatch = /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i.exec(after)
    const snippet = snippetMatch ? inlineText(snippetMatch[1]).slice(0, 400) : ''
    sources.push({ url, title, ...(snippet ? { snippet } : {}) })
  }
  return sources
}

async function searchBing(query, limit, options) {
  const response = await requestText(
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.min(limit * 2, 30)}&setlang=zh-Hans`,
    { timeoutMs: options.timeoutMs },
  )
  if (response.statusCode !== 200) {
    throw new Error(`Bing returned HTTP ${response.statusCode}`)
  }
  return parseBing(response.body, limit)
}

async function searchDuckDuckGo(query, limit, options) {
  const response = await requestText(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    // Short budget: this endpoint regularly stalls, and it is the last resort.
    { timeoutMs: Math.min(Number(options.timeoutMs) || 20000, 9000) },
  )
  if (response.statusCode !== 200) {
    throw new Error(`DuckDuckGo returned HTTP ${response.statusCode}`)
  }
  return parseDuckDuckGo(response.body, limit)
}

async function searchThroughEdge(query, limit, options) {
  const { html } = await renderWithEdge(
    `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.min(limit * 2, 30)}`,
    {
      edgePath: options.edgePath,
      timeoutMs: options.edgeTimeoutMs,
      virtualTimeBudgetMs: options.edgeVirtualTimeMs,
    },
  )
  return parseBing(html, limit)
}

const RUNNERS = {
  bing: searchBing,
  duckduckgo: searchDuckDuckGo,
  edge: searchThroughEdge,
}

/**
 * Run one query against the requested engine and fall back through the others.
 * @returns {Promise<{sources:Array<{url:string,title:string,snippet?:string}>, engine:string, attempts:Array<{engine:string,error?:string,count:number}>}>}
 */
export async function searchWeb(query, options = {}) {
  const limit = Math.max(1, Math.min(Number(options.maxResults ?? 8), 30))
  const requested = String(options.engine ?? 'auto').toLowerCase()
  // Fast plain-HTTP first; headless Edge second because it is the engine that
  // survives anti-bot degradation on Chinese queries; DuckDuckGo last, since
  // its no-JavaScript endpoint is the one most likely to be unreachable.
  let order = requested === 'auto' ? ['bing', 'edge', 'duckduckgo'] : [requested]
  if (requested !== 'auto' && requested !== 'edge') order = [...order, 'edge']
  order = order.filter((engine) => ENGINES.includes(engine))

  const attempts = []
  const minimum = queryTerms(query).length > 1 ? 2 : 1
  let best = null

  for (const engine of order) {
    try {
      const sources = await RUNNERS[engine](query, limit, options)
      const score = relevance(query, sources)
      attempts.push({ engine, count: sources.length, relevance: score })
      // A degraded engine can echo the query in its page title while returning
      // results for a different topic (observed with Bing on Chinese queries).
      // Results sharing too few key terms are not accepted silently; the next
      // engine still gets a turn, and the best candidate is kept aside.
      if (sources.length > 0) {
        if (score >= minimum) {
          return { sources: sources.slice(0, limit), engine, attempts, lowConfidence: false }
        }
        attempts[attempts.length - 1].discarded = 'results did not match the query terms'
        if (!best || score > best.score) best = { sources, engine, score }
      }
    } catch (error) {
      attempts.push({ engine, count: 0, error: error.message })
    }
  }

  // Every engine missed. Returning nothing hides a usable lead, while returning
  // it unmarked overstates the evidence, so it comes back flagged instead.
  if (best) {
    return {
      sources: best.sources.slice(0, limit),
      engine: best.engine,
      attempts,
      lowConfidence: true,
    }
  }
  return { sources: [], engine: order[order.length - 1] ?? 'none', attempts, lowConfidence: false }
}

/** Distinct query terms: CJK runs split into 2-character words, plus latin words. */
export function queryTerms(query) {
  const text = String(query)
  const terms = new Set()
  for (const latin of text.toLowerCase().match(/[a-z0-9][a-z0-9+#._-]{1,}/g) ?? []) {
    terms.add(latin)
  }
  for (const run of text.match(/[\u4e00-\u9fff]+/g) ?? []) {
    if (run.length <= 2) {
      terms.add(run)
      continue
    }
    for (let index = 0; index + 2 <= run.length; index += 1) {
      terms.add(run.slice(index, index + 2))
    }
  }
  return [...terms]
}

/** How many distinct query terms appear in the returned titles and snippets. */
export function relevance(query, sources) {
  const terms = queryTerms(query)
  if (terms.length === 0 || sources.length === 0) return 0
  const haystack = sources
    .map((source) => `${source.title ?? ''} ${source.snippet ?? ''} ${source.url ?? ''}`)
    .join(' ')
    .toLowerCase()
  let hits = 0
  for (const term of terms) if (haystack.includes(term)) hits += 1
  return hits
}
