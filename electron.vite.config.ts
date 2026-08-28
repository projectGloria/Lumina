import { resolve, sep } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

/**
 * Force a full reload when anything under `src/renderer/src/editor` changes.
 *
 * The CodeMirror instance is built once inside an effect keyed on the note
 * path, so React Fast Refresh keeps the component mounted and the old
 * extension set running. Edits to the editor then appear to do nothing, which
 * is a genuinely confusing way to lose an afternoon.
 */
function reloadEditorModules(): Plugin {
  return {
    name: 'lumina:reload-editor-modules',
    handleHotUpdate({ file, server }) {
      if (file.split(sep).join('/').includes('/src/renderer/src/editor/')) {
        server.hot.send({ type: 'full-reload' })
        return []
      }
      return undefined
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    plugins: [react(), reloadEditorModules()],
    build: {
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') }
      }
    }
  }
})
