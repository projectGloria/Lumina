import { useEffect, useState } from 'react'
import type { VaultInfo } from '@shared/types'
import { Icon } from './Icon'
import { openVaultPath, pickVault } from '../lib/actions'
import { useVault } from '../store/vaultStore'

/**
 * The screen before a vault is open.
 *
 * A vault is just a folder of markdown, so this is deliberately blunt about
 * that: pick a folder, and the notes are yours on disk either way.
 */
export default function Welcome(): React.JSX.Element {
  const loading = useVault((s) => s.loading)
  const [recent, setRecent] = useState<VaultInfo[]>([])

  useEffect(() => {
    let cancelled = false
    void window.lumina.vault
      .recent()
      .then((vaults) => {
        if (!cancelled) setRecent(vaults)
      })
      .catch(() => {
        if (!cancelled) setRecent([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <div className="welcome">
      <div className="welcome-card">
        <div className="welcome-mark">
          <Icon name="book" size={26} />
        </div>
        <h1>Lumina</h1>
        <p className="welcome-lede">
          A local note app. Your notes are plain markdown files in a folder you choose — no
          account, no sync, nothing to lock you in.
        </p>

        <button className="btn btn-primary welcome-cta" onClick={() => void pickVault()} disabled={loading}>
          {loading ? 'Opening…' : 'Choose a folder'}
        </button>
        <p className="welcome-note">
          Pick an empty folder and Lumina fills it with a few notes to get you started, or point
          it at markdown you already have.
        </p>

        {recent.length ? (
          <div className="welcome-recent">
            <div className="panel-subtitle">Recent vaults</div>
            {recent.map((vault) => (
              <button
                key={vault.path}
                className="welcome-recent-item"
                onClick={() => void openVaultPath(vault.path)}
              >
                <Icon name="vault" size={15} />
                <span className="welcome-recent-name">{vault.name}</span>
                <span className="welcome-recent-path truncate">{vault.path}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
