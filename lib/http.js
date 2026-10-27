/**
 * Minimal HTTP text retrieval with redirects and charset decoding.
 *
 * No dependency is used on purpose: the bundle must load in a profile whose
 * node_modules contains nothing but the bundle itself.
 */
import { request as httpsRequest } from 'node:https'
import { request as httpRequest } from 'node:http'
import { URL } from 'node:url'

const DEFAULT_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36 Edg/156.0.0.0'

/** Decode a body using the charset advertised by the server or the markup. */
export function decodeBody(buffer, contentType = '') {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType)?.[1]
  const head = buffer.subarray(0, 4096).toString('latin1')
  const fromMeta =
    /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)?.[1] ??
    /<meta[^>]+content=["'][^"']*charset=([\w-]+)/i.exec(head)?.[1]
  const charset = (fromHeader ?? fromMeta ?? 'utf-8').toLowerCase()
  const normalized = charset === 'gb2312' || charset === 'gbk' ? 'gbk' : charset
  try {
    return new TextDecoder(normalized, { fatal: false }).decode(buffer)
  } catch {
    return buffer.toString('utf8')
  }
}

/**
 * GET a URL and return its decoded text.
 * @returns {Promise<{statusCode:number, contentType:string, body:string, finalUrl:string, redirects:number}>}
 */
export function requestText(url, options = {}) {
  const {
    headers = {},
    timeoutMs = 20000,
    maxRedirects = 4,
    maxBytes = 6 * 1024 * 1024,
    signal,
  } = options

  return new Promise((resolve, reject) => {
    let redirects = 0

    const visit = (target) => {
      let parsed
      try {
        parsed = new URL(target)
      } catch {
        reject(new Error(`invalid URL: ${target}`))
        return
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        reject(new Error(`unsupported protocol: ${parsed.protocol}`))
        return
      }

      const send = parsed.protocol === 'https:' ? httpsRequest : httpRequest
      const req = send(
        parsed,
        {
          method: 'GET',
          headers: {
            'user-agent': DEFAULT_UA,
            accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'accept-language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
            'accept-encoding': 'identity',
            ...headers,
          },
          timeout: timeoutMs,
        },
        (res) => {
          const status = res.statusCode ?? 0
          const location = res.headers.location

          if (status >= 300 && status < 400 && location && redirects < maxRedirects) {
            redirects += 1
            res.resume()
            visit(new URL(location, parsed).toString())
            return
          }

          const chunks = []
          let size = 0
          res.on('data', (chunk) => {
            size += chunk.length
            if (size <= maxBytes) chunks.push(chunk)
          })
          res.on('end', () => {
            const buffer = Buffer.concat(chunks)
            resolve({
              statusCode: status,
              contentType: String(res.headers['content-type'] ?? ''),
              body: decodeBody(buffer, String(res.headers['content-type'] ?? '')),
              finalUrl: parsed.toString(),
              redirects,
              truncatedAtSource: size > maxBytes,
            })
          })
          res.on('error', reject)
        },
      )

      req.on('timeout', () => {
        req.destroy(new Error(`request timed out after ${timeoutMs}ms: ${target}`))
      })
      req.on('error', reject)

      if (signal) {
        if (signal.aborted) {
          req.destroy(new Error('aborted'))
          return
        }
        const onAbort = () => req.destroy(new Error('aborted'))
        signal.addEventListener('abort', onAbort, { once: true })
        req.on('close', () => signal.removeEventListener('abort', onAbort))
      }

      req.end()
    }

    visit(url)
  })
}
