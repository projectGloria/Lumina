import { useState } from 'react'
import { Icon } from './Icon'
import ProfileAvatar from './ProfileAvatar'
import { useProfiles } from '../store/profileStore'

/**
 * Blocks the app's UI behind a password for one profile.
 *
 * This is a UI gate only — a vault is an ordinary folder of `.md` files, so
 * locking a profile does not encrypt anything on disk.
 */
export default function PasslockScreen(): React.JSX.Element {
  const profiles = useProfiles((s) => s.profiles)
  const pendingId = useProfiles((s) => s.pendingId)
  const error = useProfiles((s) => s.error)
  const unlock = useProfiles((s) => s.unlock)
  const cancelUnlock = useProfiles((s) => s.cancelUnlock)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const profile = profiles.find((p) => p.id === pendingId)
  if (!profile) return <></>

  const submit = async (): Promise<void> => {
    if (!password || busy) return
    setBusy(true)
    try {
      await unlock(password)
    } finally {
      setBusy(false)
      setPassword('')
    }
  }

  return (
    <div className="welcome">
      <div className="welcome-card">
        <ProfileAvatar profile={profile} size={48} />
        <h1>{profile.name}</h1>
        <p className="welcome-lede">Enter the password to unlock this profile.</p>

        <div className="profile-create-row">
          <input
            type="password"
            autoFocus
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
            }}
          />
          <button className="btn btn-primary" disabled={!password || busy} onClick={() => void submit()}>
            {busy ? 'Checking…' : 'Unlock'}
          </button>
        </div>
        {error ? <p className="profile-error">{error}</p> : null}

        <button className="welcome-recent-item profile-back" onClick={cancelUnlock}>
          <Icon name="back" size={14} />
          <span>Choose a different profile</span>
        </button>
      </div>
    </div>
  )
}
