/**
 * Everything that used to be the Electron main process: talking to the league
 * API (a Cloudflare Worker that commits to the repo's `data` branch) and the
 * browser-native replacements for file dialogs and the clipboard.
 */
import type { LeagueData } from '@shared/types'
import type { ImportResult } from '@shared/importXlsx'
import type { AppendRequest, LeagueSnapshot, Role } from '@shared/protocol'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message)
  }
}

const WORKER_URL = ((import.meta.env.VITE_WORKER_URL as string | undefined) ?? '').replace(/\/+$/, '')

/** Dev with no worker configured runs against an in-memory copy of the seed data. */
export const usingLocalBackend = import.meta.env.DEV && !WORKER_URL

interface Backend {
  getLeague(): Promise<LeagueSnapshot>
  auth(code: string): Promise<Role>
  append(req: AppendRequest, code: string): Promise<LeagueSnapshot>
  putLeague(data: LeagueData, baseSha: string, code: string, enteredBy?: string): Promise<LeagueSnapshot>
}

async function call(path: string, init: RequestInit & { code?: string }): Promise<LeagueSnapshot> {
  if (!WORKER_URL) throw new ApiError(0, 'League API URL is not configured (VITE_WORKER_URL)')
  let res: Response
  try {
    res = await fetch(WORKER_URL + path, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(init.code ? { 'X-League-Code': init.code } : {})
      }
    })
  } catch {
    throw new ApiError(0, 'Could not reach the league server — check your connection')
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new ApiError(res.status, (body.error as string) ?? `Request failed (${res.status})`)
  return body as unknown as LeagueSnapshot
}

const httpBackend: Backend = {
  getLeague: () => call('/league', { method: 'GET' }),
  auth: async (code) => {
    const res = (await call('/auth', { method: 'POST', body: JSON.stringify({ code }) })) as unknown as { role: Role }
    return res.role
  },
  append: (req, code) => call('/append', { method: 'POST', code, body: JSON.stringify(req) }),
  putLeague: (data, baseSha, code, enteredBy) =>
    call('/league', { method: 'PUT', code, body: JSON.stringify({ data, baseSha, enteredBy }) })
}

let backendP: Promise<Backend> | null = null
function backend(): Promise<Backend> {
  if (!backendP) {
    backendP =
      import.meta.env.DEV && !WORKER_URL
        ? import('./localBackend').then((m) => m.localBackend)
        : Promise.resolve(httpBackend)
  }
  return backendP
}

export const getLeague = async (): Promise<LeagueSnapshot> => (await backend()).getLeague()
export const authCode = async (code: string): Promise<Role> => (await backend()).auth(code)
export const appendEntry = async (req: AppendRequest, code: string): Promise<LeagueSnapshot> =>
  (await backend()).append(req, code)
export const putLeague = async (
  data: LeagueData,
  baseSha: string,
  code: string,
  enteredBy?: string
): Promise<LeagueSnapshot> => (await backend()).putLeague(data, baseSha, code, enteredBy)

// ---- files & clipboard (replacing the native dialogs) ----

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  a.click()
}

export function downloadJson(data: LeagueData, filename: string): void {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }))
  downloadDataUrl(url, filename)
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((res) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = () => res(input.files?.[0] ?? null)
    // Dismissing the dialog fires 'cancel' (Chromium 113+) — without this the promise
    // never settles and the caller's await dangles forever.
    input.oncancel = () => res(null)
    input.click()
  })
}

export async function importJsonFile(): Promise<LeagueData | null> {
  const file = await pickFile('.json,application/json')
  if (!file) return null
  const parsed = JSON.parse(await file.text()) as LeagueData
  if (parsed?.version !== 1 || !Array.isArray(parsed.seasons)) throw new Error('Not a league data file')
  return parsed
}

export async function importXlsxFile(): Promise<ImportResult | null> {
  const file = await pickFile('.xlsx,.xlsm')
  if (!file) return null
  // Lazy: keeps the ~500KB SheetJS chunk out of the normal page load.
  const { importWorkbook } = await import('@shared/importXlsx')
  return importWorkbook(new Uint8Array(await file.arrayBuffer()))
}

/**
 * Copy a PNG to the clipboard. Must be invoked synchronously from the click
 * handler — the render promise goes INTO the ClipboardItem (Safari requires
 * this form, and it keeps the user-gesture window open while rendering).
 * Returns false where the clipboard API is unavailable (caller falls back to a download).
 */
export async function copyPngToClipboard(render: () => Promise<Blob>): Promise<boolean> {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': render() })])
    return true
  } catch {
    return false
  }
}
