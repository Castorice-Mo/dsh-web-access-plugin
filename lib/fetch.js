/**
 * Page retrieval: plain HTTP first, headless Edge when the HTML alone is too
 * thin to answer with (client-rendered pages, consent walls, JS-only bodies).
 */
import { requestText } from './http.js'
import { extractTitle, htmlToText, proseLineCount } from './html.js'
import { renderWithEdge } from './edge.js'

const THIN_TEXT_CHARS = 700
const THIN_PROSE_LINES = 3

/**
 * "Too thin" must catch two different failures: a nearly empty body, and a
 * menu-only shell where a lot of short labels outnumber the actual article.
 */
function isThin(text) {
  return text.length < THIN_TEXT_CHARS || proseLineCount(text) < THIN_PROSE_LINES
}

function looksLikeHtml(contentType, body) {
  if (/html|xml/i.test(contentType)) return true
  const head = String(body).slice(0, 512).trim().toLowerCase()
  return head.startsWith('<!doctype') || head.startsWith('<html') || head.includes('<body')
}

/**
 * @returns {Promise<{url:string, finalUrl:string, statusCode:number, title:string,
 *   text:string, truncated:boolean, mode:'http'|'edge', notes:string[]}>}
 */
export async function fetchPage(url, options = {}) {
  const {
    mode = 'auto',
    maxChars = 20000,
    timeoutMs = 20000,
    edgeTimeoutMs = 45000,
    edgeVirtualTimeMs = 6000,
    edgePath,
  } = options

  const notes = []
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`unsupported protocol: ${parsed.protocol}`)
  }

  let httpResult
  if (mode !== 'edge') {
    try {
      httpResult = await requestText(url, { timeoutMs })
    } catch (error) {
      notes.push(`HTTP fetch failed: ${error.message}`)
      if (mode === 'http') throw error
    }
  }

  if (httpResult && mode !== 'edge') {
    const isHtml = looksLikeHtml(httpResult.contentType, httpResult.body)
    const extracted = isHtml
      ? htmlToText(httpResult.body, { maxChars })
      : {
          text: String(httpResult.body).slice(0, maxChars).trim(),
          truncated: String(httpResult.body).length > maxChars,
        }
    const title = isHtml ? extractTitle(httpResult.body) : ''
    const thin = isThin(extracted.text)

    if (mode === 'http' || !thin) {
      return {
        url,
        finalUrl: httpResult.finalUrl,
        statusCode: httpResult.statusCode,
        title,
        text: extracted.text,
        truncated: extracted.truncated,
        mode: 'http',
        notes,
      }
    }
    const proseLines = proseLineCount(extracted.text)
    notes.push(
      `HTTP body was too thin (${extracted.text.length} chars, ${proseLines} prose line${proseLines === 1 ? '' : 's'}), re-rendered with Edge`,
    )
  }

  try {
    const rendered = await renderWithEdge(url, {
      edgePath,
      timeoutMs: edgeTimeoutMs,
      virtualTimeBudgetMs: edgeVirtualTimeMs,
    })
    const extracted = htmlToText(rendered.html, { maxChars })
    const title = extractTitle(rendered.html)
    if (extracted.text.length === 0) {
      throw new Error('Edge rendered the page but no readable text was found')
    }
    return {
      url,
      finalUrl: url,
      // Edge reports no HTTP status through --dump-dom; reuse the probe's own
      // status when one exists so a 404 is not silently reported as 200.
      statusCode: httpResult?.statusCode ?? 200,
      title,
      text: extracted.text,
      truncated: extracted.truncated,
      mode: 'edge',
      notes,
    }
  } catch (error) {
    if (httpResult) {
      const extracted = looksLikeHtml(httpResult.contentType, httpResult.body)
        ? htmlToText(httpResult.body, { maxChars })
        : { text: String(httpResult.body).slice(0, maxChars), truncated: false }
      notes.push(`Edge render failed: ${error.message}`)
      return {
        url,
        finalUrl: httpResult.finalUrl,
        statusCode: httpResult.statusCode,
        title: looksLikeHtml(httpResult.contentType, httpResult.body)
          ? extractTitle(httpResult.body)
          : '',
        text: extracted.text,
        truncated: extracted.truncated,
        mode: 'http',
        notes,
      }
    }
    throw error
  }
}
