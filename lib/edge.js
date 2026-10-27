/**
 * Microsoft Edge (Chromium) rendering.
 *
 * Edge is driven through its own headless "dump the DOM after load" mode, so
 * JavaScript-rendered pages are readable without any automation dependency.
 * A throwaway user-data-dir keeps the person's real Edge profile untouched.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const WINDOWS_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge Dev\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge Dev\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge Beta\\Application\\msedge.exe',
]

const POSIX_CANDIDATES = [
  '/usr/bin/microsoft-edge',
  '/usr/bin/microsoft-edge-stable',
  '/opt/microsoft/msedge/msedge',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
]

/** Resolve the Edge executable, honouring config and environment overrides. */
export function resolveEdgePath(configured) {
  const explicit = [configured, process.env.DSH_WEB_ACCESS_EDGE].filter(
    (value) => typeof value === 'string' && value.trim() !== '',
  )
  for (const candidate of explicit) {
    if (existsSync(candidate)) return candidate
  }
  const list = process.platform === 'win32' ? WINDOWS_CANDIDATES : POSIX_CANDIDATES
  for (const candidate of list) {
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/** Describe Edge availability without launching it. */
export function edgeStatus(configured) {
  const path = resolveEdgePath(configured)
  return { available: Boolean(path), path: path ?? null }
}

function killTree(child) {
  if (!child || child.killed) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
    } else {
      child.kill('SIGKILL')
    }
  } catch {
    // A best-effort cleanup: the process may already be gone.
  }
}

/**
 * Load a URL in headless Edge and return the post-JavaScript DOM.
 * @returns {Promise<{html:string, status:'rendered'}>}
 */
export async function renderWithEdge(url, options = {}) {
  const {
    edgePath,
    timeoutMs = 45000,
    virtualTimeBudgetMs = 6000,
    extraArgs = [],
  } = options

  const executable = resolveEdgePath(edgePath)
  if (!executable) {
    const error = new Error('Microsoft Edge executable not found')
    error.code = 'EDGE_NOT_FOUND'
    throw error
  }

  const profileDir = await mkdtemp(join(tmpdir(), 'dsh-web-access-edge-'))
  try {
    const args = [
      '--headless=new',
      '--disable-gpu',
      '--disable-extensions',
      '--disable-background-networking',
      '--disable-sync',
      '--metrics-recording-only',
      '--mute-audio',
      '--hide-scrollbars',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profileDir}`,
      `--virtual-time-budget=${virtualTimeBudgetMs}`,
      '--dump-dom',
      ...extraArgs,
      url,
    ]

    const stdout = await new Promise((resolve, reject) => {
      const child = spawn(executable, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })

      const out = []
      let settled = false
      const finish = (fn, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        fn(value)
      }
      const timer = setTimeout(() => {
        killTree(child)
        finish(reject, new Error(`Edge render timed out after ${timeoutMs}ms`))
      }, timeoutMs)

      child.stdout.on('data', (chunk) => out.push(chunk))
      child.stderr.on('data', () => {})
      child.on('error', (error) => finish(reject, error))
      child.on('close', () => finish(resolve, Buffer.concat(out).toString('utf8')))
    })

    if (!stdout || stdout.trim() === '') {
      throw new Error('Edge returned an empty DOM')
    }
    return { html: stdout, status: 'rendered' }
  } finally {
    await rm(profileDir, { recursive: true, force: true, maxRetries: 3 }).catch(() => {})
  }
}
