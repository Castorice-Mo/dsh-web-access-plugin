/**
 * Dependency-free HTML helpers: entity decoding, readable-text extraction,
 * title extraction and Bing/DuckDuckGo result parsing support.
 */

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  ndash: '\u2013',
  mdash: '\u2014',
  hellip: '\u2026',
  middot: '\u00b7',
  laquo: '\u00ab',
  raquo: '\u00bb',
  copy: '\u00a9',
  reg: '\u00ae',
  trade: '\u2122',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
  bull: '\u2022',
  times: '\u00d7',
  deg: '\u00b0',
  rarr: '\u2192',
  larr: '\u2190',
}

/** Decode named and numeric HTML entities. */
export function decodeEntities(text) {
  if (!text.includes('&')) return text
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]{1,31});/g, (whole, body) => {
    if (body[0] === '#') {
      const isHex = body[1] === 'x' || body[1] === 'X'
      const code = Number.parseInt(isHex ? body.slice(2) : body.slice(1), isHex ? 16 : 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole
      try {
        return String.fromCodePoint(code)
      } catch {
        return whole
      }
    }
    const named = NAMED_ENTITIES[body.toLowerCase()]
    return named ?? whole
  })
}

/** Collapse HTML to a single readable line (used for titles and snippets). */
export function inlineText(html) {
  return decodeEntities(String(html ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/** Extract `<title>` text. */
export function extractTitle(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return match ? inlineText(match[1]) : ''
}

/** Resolve the URL of the first anchor inside an HTML fragment. */
export function firstHref(fragment) {
  const match = /<a\b[^>]*?\shref\s*=\s*["']([^"']+)["']/i.exec(fragment)
  return match ? decodeEntities(match[1]) : ''
}

/** Remove elements whose content is never readable text. */
function stripNonContent(html) {
  let out = html
  out = out.replace(/<!--[\s\S]*?-->/g, ' ')
  const discarded = [
    'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'object',
    // Navigation furniture: without this, a menu-heavy shell outranks the article.
    'nav', 'aside', 'footer',
  ]
  for (const tag of discarded) {
    out = out.replace(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi'), ' ')
    out = out.replace(new RegExp(`<${tag}\\b[^>]*\\/?>`, 'gi'), ' ')
  }
  out = out.replace(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi, ' ')
  return out
}

/**
 * Pick the content container. `<body>` contains every other candidate, so it
 * can never win a length comparison; the longest article/main block is taken
 * (sidebars are often the first match in document order) and body is only the
 * fallback when no such block holds real text.
 */
function pickContentRoot(html) {
  let best = ''
  let bestLength = 0
  for (const tag of ['article', 'main']) {
    const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'gi')
    let match
    while ((match = pattern.exec(html)) !== null) {
      const length = visibleLength(match[1])
      if (length > bestLength) {
        best = match[1]
        bestLength = length
      }
    }
  }
  if (bestLength >= 300) return best
  const body = /<body\b[^>]*>([\s\S]*)<\/body\s*>/i.exec(html)
  return body ? body[1] : html
}

/** Character length of the readable text of a fragment. */
function visibleLength(html) {
  return inlineText(html).length
}

/** Count lines long enough to be prose rather than menu labels. */
export function proseLineCount(text) {
  return String(text)
    .split('\n')
    .filter((line) => line.trim().length >= 40).length
}

/**
 * Convert HTML to readable plain text.
 * Block elements become line breaks, list items become "- " rows,
 * tables keep one cell per " | " separated line group.
 */
export function htmlToText(html, options = {}) {
  const { maxChars = 20000 } = options
  let out = stripNonContent(String(html ?? ''))
  out = pickContentRoot(out)

  out = out.replace(/<br\s*\/?>/gi, '\n')
  out = out.replace(/<\/(p|div|section|article|header|footer|aside|h[1-6]|pre|blockquote|tr|dd|dt|figure|figcaption|details|summary)\s*>/gi, '\n')
  out = out.replace(/<(p|div|section|article|header|footer|aside|h[1-6]|pre|blockquote|tr|dd|dt|figure|figcaption|details|summary)\b[^>]*>/gi, '\n')
  out = out.replace(/<(td|th)\b[^>]*>/gi, ' | ')
  out = out.replace(/<li\b[^>]*>/gi, '\n- ')
  out = out.replace(/<\/(li|ul|ol|table|thead|tbody|tfoot)\s*>/gi, '\n')
  out = out.replace(/<hr\s*\/?>/gi, '\n---\n')

  out = out.replace(/<[^>]*>/g, ' ')
  out = decodeEntities(out)

  out = out
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').replace(/^\s*\|?\s*\|\s*$/, '').trim())
    .filter((line, index, all) => line !== '' || (index > 0 && all[index - 1] !== ''))
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  if (out.length > maxChars) {
    return { text: `${out.slice(0, charsOnBoundary(out, maxChars))}`, truncated: true }
  }
  return { text: out, truncated: false }
}

function charsOnBoundary(text, maxChars) {
  const slice = text.slice(0, maxChars)
  const boundary = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('\u3002'), slice.lastIndexOf('. '))
  return boundary > maxChars * 0.6 ? boundary + 1 : maxChars
}

/** Strip a single Bing/DuckDuckGo redirect wrapper, returning the target URL. */
export function decodeRedirect(href, base) {
  if (!href) return ''
  let target = href
  try {
    if (target.startsWith('//')) target = `https:${target}`
    const absolute = new URL(target, base)
    const encodedU = absolute.searchParams.get('u')
    if (encodedU && encodedU.startsWith('a1')) {
      const raw = Buffer.from(encodedU.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
      if (/^https?:\/\//i.test(raw)) return raw
    }
    const uddg = absolute.searchParams.get('uddg')
    if (uddg) return uddg
    return absolute.toString()
  } catch {
    return href
  }
}

