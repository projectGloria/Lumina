import ProfileAvatar from './ProfileAvatar'
import { useProfiles } from '../store/profileStore'
import { useUi } from '../store/uiStore'

/** Bottom-of-rail profile switcher — who's using the app right now. */
export default function ProfileIndicator(): React.JSX.Element | null {
  const profiles = useProfiles((s) => s.profiles)
  const activeId = useProfiles((s) => s.activeId)
  const signOut = useProfiles((s) => s.signOut)
  const refresh = useProfiles((s) => s.refresh)
  const profile = profiles.find((p) => p.id === activeId)

  if (!profile) return null

  return (
    <button
      className="icon-btn rail-btn profile-indicator"
      data-tooltip={`Profile: ${profile.name} — click to switch`}
      aria-label="Switch profile"
      onClick={(e) => {
        useUi.getState().showContextMenu({
          x: e.clientX,
          y: e.clientY,
          items: [
            { label: 'Switch profile', onSelect: () => void signOut() },
            {
              label: 'Rename profile',
              onSelect: () => {
                useUi.getState().showPrompt({
                  title: 'Rename profile',
                  label: 'Name',
                  initial: profile.name,
                  confirmLabel: 'Rename',
                  onSubmit: async (value) => {
                    const next = value.trim()
                    if (!next) return 'Give it a name'
                    await window.lumina.profiles.rename(profile.id, next)
                    await refresh()
                  }
                })
              }
            },
            {
              label: profile.passwordHash ? 'Change password…' : 'Set a password…',
              onSelect: () => {
                useUi.getState().showPrompt({
                  title: profile.passwordHash ? 'Change password' : 'Set a password',
                  label: 'New password (leave blank to remove)',
                  initial: '',
                  confirmLabel: 'Save',
                  onSubmit: async (value) => {
                    await window.lumina.profiles.setPassword(profile.id, value.trim() || null)
                    await refresh()
                  }
                })
              }
            },
            { separator: true, label: 'sep1' },
            {
              label: 'Delete profile',
              danger: true,
              onSelect: () => {
                useUi.getState().showConfirm({
                  title: `Delete "${profile.name}"?`,
                  body: 'This removes the profile only — its vault and notes on disk are untouched.',
                  confirmLabel: 'Delete',
                  danger: true,
                  onConfirm: async () => {
                    await window.lumina.profiles.remove(profile.id)
                    await signOut()
                  }
                })
              }
            }
          ]
        })
      }}
    >
      <ProfileAvatar profile={profile} size={18} />
    </button>
  )
}
