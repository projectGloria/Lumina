import { useEffect, useRef } from 'react'
import { rebaseConfigPath } from '@shared/homePaths'
import { Icon } from '@/components/Icon'
import { dropNote, ensureNote, holdNote, openNote, releaseNote } from '@/lib/actions'
import { useEditor } from '@/store/editorStore'
import { defineWidget, type WidgetProps, type WidgetSettingsProps } from './types'

interface ScratchConfig extends Record<string, unknown> {
  /** Vault-relative note this pad edits. */
  path: string
}

const DEFAULT_PATH = 'Scratch.md'

/**
 * A note edited in place on the board.
 *
 * It goes through `editorStore` rather than writing the file, so the pad and a
 * tab showing the same note share one buffer and one debounced autosave —
 * two writers on one path is how a note loses a paragraph.
 */
function Scratch({ config }: WidgetProps<ScratchConfig>): React.JSX.Element {
  const path = config.path || DEFAULT_PATH
  const buffer = useEditor((s) => s.buffers[path])
  const seen = useRef({ path, found: false })

  useEffect(() => {
    // Held for as long as the card is on screen: this pad is a reason for the
    // buffer to stay open in its own right, and without the hold anything that
    // released the note — ticking one of its tasks from the board, say —
    // closed the buffer this textarea is bound to.
    holdNote(path)
    void useEditor.getState().open(path)
    // Released on the way out, which only closes the buffer if no tab and no
    // other holder still wants it, so closing the board never drops text the
    // editor has on screen.
    return () => {
      dropNote(path)
      void releaseNote(path)
    }
  }, [path])

  /**
   * Whether the note is gone, rather than not loaded yet.
   *
   * A buffer that was here and then vanished is a note deleted or renamed
   * under the pad — the watcher closes the buffer directly, and no hold should
   * override that, since the file really has gone. Tracked rather than
   * inferred because a buffer that has never arrived looks identical: this is
   * also true on the first render, before the effect above has opened
   * anything, and on the render after the pad is pointed at another note.
   */
  if (seen.current.path !== path) seen.current = { path, found: false }
  if (buffer) seen.current.found = true
  const missing = !!buffer?.error || (seen.current.found && !buffer)

  if (missing) {
    return (
      <div className="home-scratch-missing">
        <p className="home-widget-empty">
          <code>{path}</code> is not in this vault yet.
        </p>
        <button
          className="btn btn-small"
          onClick={() => {
            void (async () => {
              if (await ensureNote(path)) await useEditor.getState().open(path)
            })()
          }}
        >
          <Icon name="plus" size={14} />
          <span>Create it</span>
        </button>
      </div>
    )
  }

  return (
    <div className="home-scratch">
      <textarea
        className="home-scratch-input"
        value={buffer?.content ?? ''}
        disabled={!buffer || buffer.loading}
        aria-label={`Scratch pad: ${path}`}
        placeholder="Anything you do not want to file yet…"
        onChange={(e) => useEditor.getState().setContent(path, e.target.value)}
      />
      <button
        className="home-scratch-open"
        data-tooltip={`Open ${path}`}
        onClick={() => openNote(path)}
      >
        <Icon name="external" size={13} />
        <span className="truncate">{path}</span>
      </button>
    </div>
  )
}

function ScratchSettings({
  config,
  setConfig
}: WidgetSettingsProps<ScratchConfig>): React.JSX.Element {
  return (
    <label className="home-setting">
      <span>Note</span>
      <input
        type="text"
        value={config.path}
        placeholder={DEFAULT_PATH}
        onChange={(e) => setConfig({ path: e.target.value })}
      />
    </label>
  )
}

export const scratchWidget = defineWidget<ScratchConfig>({
  type: 'scratch',
  name: 'Scratch pad',
  description: 'One note, edited straight from the board',
  icon: 'edit',
  defaultSize: { w: 2, h: 3 },
  minSize: { w: 1, h: 2 },
  defaultConfig: { path: DEFAULT_PATH },
  Component: Scratch,
  Settings: ScratchSettings,
  // A rename moves the pad's note with it. A delete does not clear the path:
  // that would fall back to `DEFAULT_PATH` and silently point the pad at a
  // different note, where saying the note is missing and offering to create it
  // is a state the user can see and undo.
  rebasePaths: (config, from, to) => rebaseConfigPath(config, 'path', from, to)
})
