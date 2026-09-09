import fs from 'node:fs/promises'
import path from 'node:path'
import { parseSession, type Session } from '../../shared/quicknoteSession'
export class SessionCache {
  private queue: Promise<void> = Promise.resolve()
  constructor(private file: string) {}
  async load(): Promise<Session> {
    try { return parseSession(JSON.parse(await fs.readFile(this.file, 'utf8'))) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { version: 1, buffers: [] }
      throw error
    }
  }
  write(value: unknown): Promise<void> {
    const text = JSON.stringify(parseSession(value))
    this.queue = this.queue.catch(() => {}).then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true })
      const temp = this.file + '.tmp'
      await fs.writeFile(temp, text, 'utf8')
      await fs.rename(temp, this.file)
    })
    return this.queue
  }
}
