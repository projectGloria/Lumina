/**
 * Installing the speech engines and models that ship inside Lumina.
 *
 * Nothing here downloads anything. A pack is either carried in this build — in
 * which case installing it is a copy — or it is not, in which case the user
 * can point at a folder holding one. That is the whole feature: dictation set
 * up on a machine that has never been online.
 */
import { useCallback, useEffect, useState } from 'react'
import type { SpeechInstallProgress, SpeechPack } from '@shared/types'
import { toast } from '../../store/uiStore'
import { Icon } from '../Icon'

function megabytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`
  return `${Math.round(bytes / 1024 / 1024)} MB`
}

export default function SpeechPacks({ onChanged }: { onChanged?: () => void }): React.JSX.Element {
  const [packs, setPacks] = useState<SpeechPack[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<SpeechInstallProgress | null>(null)

  const refresh = useCallback(async () => {
    setPacks(await window.lumina.voice.packs())
    onChanged?.()
  }, [onChanged])

  useEffect(() => {
    void refresh()
  }, [refresh])

  // Copying a gigabyte-plus GPU engine takes long enough that a still panel
  // reads as a hung one.
  useEffect(() => window.lumina.voice.onPackProgress(setProgress), [])

  const run = async (id: string, action: () => Promise<string | null>): Promise<void> => {
    setBusy(id)
    setProgress(null)
    try {
      const failure = await action()
      if (failure) toast(failure, 'error')
    } finally {
      setBusy(null)
      setProgress(null)
      void refresh()
    }
  }

  const anyBundled = packs.some((pack) => pack.bundled)

  return (
    <section className="settings-section">
      <h3 className="settings-heading">Speech packs</h3>
      <p className="voice-blurb">
        {anyBundled
          ? 'Included in this copy of Lumina. Installing copies them onto this machine — nothing is downloaded.'
          : 'This build ships without speech packs. You can still install one from a folder or a USB stick — nothing is downloaded.'}
      </p>

      {packs.map((pack) => {
        const working = busy === pack.id
        const percent =
          working && progress?.id === pack.id && progress.total
            ? Math.round((progress.copied / progress.total) * 100)
            : null

        return (
          <div className="field-row pack-row" key={pack.id}>
            <div>
              <div className="field-label">
                {pack.name}
                {pack.installed ? <span className="pack-tag is-on">Installed</span> : null}
                {!pack.installed && pack.bundled ? <span className="pack-tag">Included</span> : null}
                {!pack.bundled && !pack.installed ? (
                  <span className="pack-tag is-off">Not in this build</span>
                ) : null}
              </div>
              <div className="field-hint">
                {pack.description}
                {pack.bundled ? ` · ${megabytes(pack.size)}` : ''}
                {pack.requiresGpu ? ' · needs an NVIDIA GPU' : ''}
              </div>
            </div>

            <div className="field-control">
              {percent !== null ? <span className="pack-progress">{percent}%</span> : null}
              {pack.installed ? (
                <button
                  className="voice-btn"
                  disabled={working}
                  onClick={() => void run(pack.id, () => window.lumina.voice.removePack(pack.id))}
                  data-tooltip="Delete it from this machine"
                >
                  Remove
                </button>
              ) : (
                <button
                  className="voice-btn is-stop"
                  disabled={!pack.bundled || working}
                  onClick={() => void run(pack.id, () => window.lumina.voice.installPack(pack.id))}
                  data-tooltip={pack.bundled ? 'Copy it onto this machine' : 'Not included in this build'}
                >
                  <Icon name="download" size={13} />
                  {working ? 'Installing…' : 'Install'}
                </button>
              )}
            </div>
          </div>
        )
      })}

      <div className="field-row">
        <div>
          <div className="field-label">Install from a folder</div>
          <div className="field-hint">
            For a build with no packs, or one you copied across on a USB stick.
          </div>
        </div>
        <div className="field-control">
          <button
            className="voice-btn"
            disabled={busy !== null}
            onClick={() => void run('import', () => window.lumina.voice.importPack())}
          >
            Choose folder…
          </button>
        </div>
      </div>
    </section>
  )
}
