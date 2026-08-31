import type { Profile } from '@shared/types'

/** A colored initial standing in for a profile picture — there's no image upload yet. */
export default function ProfileAvatar({
  profile,
  size = 22
}: {
  profile: Pick<Profile, 'name' | 'color'>
  size?: number
}): React.JSX.Element {
  return (
    <span
      className="profile-avatar"
      style={{ width: size, height: size, background: profile.color, fontSize: size * 0.48 }}
    >
      {profile.name.trim().charAt(0).toUpperCase() || '?'}
    </span>
  )
}
