/**
 * Home: a per-vault dashboard of widgets, and the one tab that shows no note.
 *
 * It takes the right sidebar's width while a home tab is active (`App.tsx`
 * leaves that panel out) and owns nothing but its chrome: the cover, the
 * greeting, the mode toggle and the board. Everything a widget draws comes
 * from the stores that already hold it, so nothing here reaches for the
 * filesystem or the network.
 */
import { useState } from 'react'
import { formatDate } from '@shared/template'
import { Icon } from '@/components/Icon'
import { pickHomeCover } from '@/lib/actions'
import { useHome } from '@/store/homeStore'
import { useProfiles } from '@/store/profileStore'
import { useVault } from '@/store/vaultStore'
import HomeBoard from './HomeBoard'
import HomeCover from './HomeCover'

/** Which half of the day it is, in the words someone would actually use. */
export function greetingFor(date = new Date()): string {
  const hour = date.getHours()
  if (hour < 5) return 'Good night'
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export default function HomeView(): React.JSX.Element {
  const editing = useHome((s) => s.editing)
  const setEditing = useHome((s) => s.setEditing)
  const setCover = useHome((s) => s.setCover)
  const cover = useHome((s) => s.layout.cover)
  const activeId = useProfiles((s) => s.activeId)
  const profiles = useProfiles((s) => s.profiles)
  const vault = useVault((s) => s.vault)
  /**
   * Adjusting the cover is a mode of its own, ended by its own Done button —
   * a picture is one small job, and it should not require leaving a mode that
   * also governs every widget on the board.
   */
  const [coverEditing, setCoverEditing] = useState(false)

  // The profile's name is what the greeting is for; a vault with no profile
  // behind it still has a name worth using rather than a bare "Good evening".
  const name = profiles.find((p) => p.id === activeId)?.name ?? vault?.name ?? ''
  const now = new Date()

  const addCover = (): void => {
    void (async () => {
      const path = await pickHomeCover()
      if (!path) return
      setCover({ path, position: 50 })
      // Straight into adjustment: the first thing anyone wants after choosing
      // a photo is to say which part of it to show.
      setCoverEditing(true)
    })()
  }

  return (
    <div className={`home${editing ? ' is-editing' : ''}${cover ? ' has-cover' : ''}`}>
      {cover ? (
        <HomeCover
          cover={cover}
          editing={coverEditing}
          onEdit={() => setCoverEditing(true)}
          onDone={() => setCoverEditing(false)}
        />
      ) : null}

      <div className="home-content">
        <header className="home-header">
          <div className="home-heading">
            <h1 className="home-greeting">
              {greetingFor(now)}
              {name ? `, ${name}` : ''}
            </h1>
            <p className="home-date">{formatDate('DDDD, MMMM DD, YYYY', now)}</p>
          </div>

          <div className="home-header-actions">
            {!cover ? (
              <button className="btn" onClick={addCover}>
                <Icon name="image" size={15} />
                <span>Add a cover</span>
              </button>
            ) : null}

            <button
              className={`btn home-edit-toggle${editing ? ' is-active' : ''}`}
              aria-pressed={editing}
              onClick={() => setEditing(!editing)}
            >
              <Icon name={editing ? 'check' : 'edit'} size={15} />
              <span>{editing ? 'Done' : 'Edit layout'}</span>
            </button>
          </div>
        </header>

        <HomeBoard />
      </div>
    </div>
  )
}
