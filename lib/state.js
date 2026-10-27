/**
 * Per-conversation switch state.
 *
 * The switch belongs to one Session, not to the profile: enabling it in one
 * conversation must not silently start browsing in another. State is kept in the
 * Host process (a derived cache — the session log stays the source of truth for
 * what the model saw) and is exposed to the browser through the HTTP routes in
 * `index.js`.
 */

/** sessionId -> { enabled, updatedAt } */
const sessions = new Map()

/** @returns {boolean} */
export function isSessionEnabled(sessionId) {
  if (typeof sessionId !== 'string' || sessionId === '') return false
  return sessions.get(sessionId)?.enabled === true
}

/** @returns {{enabled:boolean, updatedAt:number|null}} */
export function sessionState(sessionId) {
  const record = typeof sessionId === 'string' ? sessions.get(sessionId) : undefined
  return { enabled: record?.enabled === true, updatedAt: record?.updatedAt ?? null }
}

export function setSessionEnabled(sessionId, enabled) {
  if (typeof sessionId !== 'string' || sessionId === '') {
    throw new Error('session id is required')
  }
  const record = { enabled: Boolean(enabled), updatedAt: Date.now() }
  sessions.set(sessionId, record)
  return record
}

export function enabledSessionCount() {
  let count = 0
  for (const record of sessions.values()) if (record.enabled) count += 1
  return count
}

export function forgetSession(sessionId) {
  sessions.delete(sessionId)
}

/** Only a plausible Session id may cross the route boundary. */
export function isPlausibleSessionId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(value)
}
