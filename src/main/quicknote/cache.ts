import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { parseSession, type Session } from '../../shared/quicknoteSession'
export class SessionCache {
  private queue: Promise<void> = Promise.resolve()
  private contents = new Map<string, { text: string; savedText: string | null | undefined; hash: string }>()
  constructor(private file: string) {}
  async load(): Promise<Session> {
    let manifestRead = false
    try {
      const value = JSON.parse(await fs.readFile(this.file, 'utf8'))
      manifestRead = true
      if (value.version !== 2) return parseSession(value)
      if (!Array.isArray(value.buffers)) throw new Error('Invalid session cache')
      const buffers = await Promise.all(value.buffers.map(async (entry: Record<string, unknown>) => {
        const { content, ...metadata } = entry
        if (typeof content !== 'string' || !/^[a-f0-9]{64}$/.test(content)) throw new Error('Invalid cache reference')
        const text = JSON.parse(await fs.readFile(path.join(this.file + '.contents', content + '.json'), 'utf8'))
        return { ...metadata, ...text }
      }))
      return parseSession({ version: 1, buffers })
    }
    catch (error) {
      if (!manifestRead && (error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, buffers: [] }
      throw error
    }
  }
  write(value: unknown): Promise<void> {
    const session = parseSession(value)
    const buffers = session.buffers.map((draft) => ({ ...draft }))
    this.queue = this.queue.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true })
      const directory = this.file + '.contents'
      await fs.mkdir(directory, { recursive: true })
      const keep = new Set<string>()
      const manifest = []
      const nextContents = new Map<string, { text: string; savedText: string | null | undefined; hash: string }>()
      for (const { text, savedText, ...metadata } of buffers) {
        const cached = this.contents.get(metadata.id)
        let content: string
        if (cached && cached.text === text && cached.savedText === savedText) content = cached.hash
        else {
          const body = JSON.stringify({ text, savedText })
          content = createHash('sha256').update(body).digest('hex')
          const temporary = path.join(directory, content + '.tmp')
          await fs.writeFile(temporary, body, 'utf8')
          await fs.rename(temporary, path.join(directory, content + '.json'))
        }
        nextContents.set(metadata.id, { text, savedText, hash: content })
        const name = content + '.json'
        keep.add(name)
        manifest.push({ ...metadata, content })
      }
      const temp = this.file + '.tmp'
      await fs.writeFile(temp, JSON.stringify({ version: 2, buffers: manifest }), 'utf8')
      await fs.rename(temp, this.file)
      this.contents = nextContents
      // Only generated, unreferenced content files in this cache directory.
      for (const name of await fs.readdir(directory)) {
        if (/^[a-f0-9]{64}\.json$/.test(name) && !keep.has(name)) await fs.unlink(path.join(directory, name)).catch(() => {})
      }
    })
    return this.queue
  }
}
