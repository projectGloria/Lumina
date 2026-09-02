import { useState } from 'react'
import { Icon } from './Icon'
import ProfileAvatar from './ProfileAvatar'
import { useProfiles } from '../store/profileStore'

/** Shown at the start of every launch until a profile is chosen and (if locked) unlocked. */
export default function ProfilePicker(): React.JSX.Element {
  const profiles = useProfiles((s) => s.profiles)
  const select = useProfiles((s) => s.select)
  const create = useProfiles((s) => s.create)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const submitCreate = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      await create(trimmed)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="welcome profile-screen">
      <div className="welcome-card profile-card">
        <div className="welcome-mark">
          <Icon name="book" size={26} />
        </div>
        <h1>{profiles.length ? 'Who’s this?' : 'Welcome to Lumina'}</h1>
        <p className="welcome-lede">
          {profiles.length
            ? 'Choose a profile to continue.'
            : 'Create a profile to get started. A password is optional and, if set, only locks the app’s UI — it does not encrypt your notes on disk.'}
        </p>

        {profiles.length ? (
          <div className="profile-list">
            {profiles.map((p) => (
              <button key={p.id} className="profile-list-item" onClick={() => select(p.id)}>
                <ProfileAvatar profile={p} size={38} />
                <span className="profile-list-copy">
                  <span className="profile-list-name truncate">{p.name}</span>
                  <span className="profile-list-meta">
                    {p.passwordHash ? 'Password protected' : p.vaultPath ? 'Ready to open' : 'No vault selected'}
                  </span>
                </span>
                {p.passwordHash ? <Icon name="lock" size={14} className="profile-list-lock" /> : null}
                <Icon name="forward" size={15} className="profile-list-action" />
              </button>
            ))}
          </div>
        ) : null}

        {creating ? (
          <div className="profile-create-row">
            <input
              type="text"
              autoFocus
              placeholder="Profile name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitCreate()
                if (e.key === 'Escape') setCreating(false)
              }}
            />
            <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={() => void submitCreate()}>
              {busy ? 'Creating…' : 'Create'}
            </button>
          </div>
        ) : (
          <button className="btn btn-primary welcome-cta profile-new" onClick={() => setCreating(true)}>
            <Icon name="plus" size={15} />
            New profile
          </button>
        )}
      </div>
    </div>
  )
}
