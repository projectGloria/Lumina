export interface Draft {
  id: string
  createdAt: number
  updatedAt: number
  text: string
  cursor: number
}
export interface Session { version: 1; buffers: Draft[] }
export function parseSession(value: unknown): Session {
  const s = value as Session
  if (!s || s.version !== 1 || !Array.isArray(s.buffers)) throw new Error('Invalid session cache')
  const ids = new Set<string>()
  for (const b of s.buffers) {
    if (!b || typeof b.id !== 'string' || ids.has(b.id) || typeof b.text !== 'string' ||
      !Number.isFinite(b.createdAt) || !Number.isFinite(b.updatedAt) ||
      !Number.isInteger(b.cursor) || b.cursor < 0 || b.cursor > b.text.length) throw new Error('Invalid draft')
    ids.add(b.id)
  }
  return s
}
export interface QuickApi {
  load(): Promise<Session>
  persist(session: Session): Promise<void>
  save(draft: Draft): Promise<string | null>
  close(): void
  onFlush(callback: (token: number) => void): void
  flushed(token: number, error?: string): void
  exportSettings?(content: string): Promise<boolean>
  importSettings?(): Promise<string | null>
  getFonts?(): Promise<string[]>
  createDesktopShortcut?(): Promise<{ ok: boolean; path?: string; error?: string }>
  onNew?(callback: () => void): void
}
