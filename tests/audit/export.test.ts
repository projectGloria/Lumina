import { expect, test } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { embedLocalImages } from '../../src/main/export'

test('preserves image attributes in exported HTML', async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'lumina-audit-export-'))
  try {
    await fs.writeFile(path.join(vault, 'image.png'), Buffer.from([1, 2, 3]))
    const result = await embedLocalImages('<img src="image.png" alt="example">', vault)
    expect(result).toBe('<img src="data:image/png;base64,AQID" alt="example">')
  } finally {
    if (path.dirname(vault) !== path.resolve(os.tmpdir()) || !path.basename(vault).startsWith('lumina-audit-export-')) throw new Error('Unsafe cleanup path')
    await fs.rm(vault, { recursive: true, force: true })
  }
})
