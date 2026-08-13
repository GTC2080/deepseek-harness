import type { ObservableSnapshot } from './contract/store.ts'

const SELECTION_STORAGE_KEY = 'dsh.sessions.current'
const SELECTION_COOKIE_NAME = 'dsh.desktop.sessions.current'
const MAX_SELECTION_BYTES = 2_048
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

type SelectionRecord = Record<string, unknown>

function isDesktop(): boolean {
  const platform = (globalThis as { __DSH_DESKTOP_PLATFORM__?: unknown })
    .__DSH_DESKTOP_PLATFORM__
  return platform === 'macos' || platform === 'windows'
}

function isRecord(value: unknown): value is SelectionRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isValidSelection(raw: string): boolean {
  if (raw.length > MAX_SELECTION_BYTES) return false
  try {
    const selection: unknown = JSON.parse(raw)
    if (!isRecord(selection)) return false
    if (selection.sessionId !== undefined && typeof selection.sessionId !== 'string') return false
    if (selection.subagentAddress === undefined) return true
    if (!isRecord(selection.subagentAddress)) return false
    return typeof selection.subagentAddress.parentSessionId === 'string'
      && typeof selection.subagentAddress.childSessionId === 'string'
      && (selection.subagentAddress.mode === 'one-shot'
        || selection.subagentAddress.mode === 'continuable')
  } catch {
    return false
  }
}

function expireSelectionCookie(): void {
  document.cookie = `${SELECTION_COOKIE_NAME}=; Max-Age=0; Path=/; SameSite=Strict`
}

function readSelectionCookie(): string | undefined {
  if (!isDesktop() || typeof document === 'undefined') return undefined
  try {
    const prefix = `${SELECTION_COOKIE_NAME}=`
    const encoded = document.cookie
      .split(';')
      .map(part => part.trim())
      .find(part => part.startsWith(prefix))
      ?.slice(prefix.length)
    if (encoded === undefined) return undefined
    const raw = decodeURIComponent(encoded)
    if (isValidSelection(raw)) return raw
    expireSelectionCookie()
  } catch (error) {
    console.error('desktop session selection cookie read failed:', error)
  }
  return undefined
}

function writeSelectionCookie(raw: string): void {
  if (!isDesktop() || typeof document === 'undefined' || !isValidSelection(raw)) return
  try {
    document.cookie = `${SELECTION_COOKIE_NAME}=${encodeURIComponent(raw)}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Path=/; SameSite=Strict`
  } catch (error) {
    console.error('desktop session selection cookie write failed:', error)
  }
}

/**
 * Seed the current random-port origin from the desktop WebView's host-scoped
 * cookie. An existing same-origin localStorage value is migrated once when
 * the durable cookie does not exist yet.
 */
export function restoreDesktopSessionSelection(): void {
  if (!isDesktop() || typeof localStorage === 'undefined') return
  try {
    const durable = readSelectionCookie()
    if (durable !== undefined) {
      localStorage.setItem(SELECTION_STORAGE_KEY, durable)
      return
    }
    const local = localStorage.getItem(SELECTION_STORAGE_KEY)
    if (local === null) return
    if (isValidSelection(local)) {
      writeSelectionCookie(local)
    } else {
      localStorage.removeItem(SELECTION_STORAGE_KEY)
    }
  } catch (error) {
    console.error('desktop session selection restore failed:', error)
  }
}

/**
 * Mirror later selection writes to a cookie shared by all loopback ports.
 * @param selection - current Session selection store.
 * @returns disposer that stops mirroring later selection changes.
 */
export function mirrorDesktopSessionSelection(
  selection: ObservableSnapshot<unknown>,
): () => void {
  if (!isDesktop()) return () => {}
  return selection.subscribe(() => {
    writeSelectionCookie(JSON.stringify(selection.getSnapshot()))
  })
}

/**
 * Check whether the first desktop migration still needs a real Session fallback.
 * @returns true only when no durable desktop selection exists.
 */
export function needsDesktopSessionSelectionFallback(): boolean {
  return isDesktop() && readSelectionCookie() === undefined
}
