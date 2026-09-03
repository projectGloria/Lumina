import { Icon, type IconName } from '@/components/Icon'

/**
 * The two things a card shows when it has no rows to draw.
 *
 * Both live here rather than in each widget because the difference between
 * them is the whole point: an empty card has an answer ("nothing is
 * outstanding", "you have not starred anything"), and a card that is waiting
 * has none yet, so drawing an answer would be a lie it has to take back a
 * moment later.
 */

/**
 * Nothing to show, and that is the truth.
 *
 * Takes the card's own glyph rather than a shared one, so an empty card still
 * reads as the card it is, and an action where there is an obvious one — an
 * empty state that only describes the emptiness leaves the reader to work out
 * what to do about it.
 */
export function EmptyCard({
  icon,
  line,
  action
}: {
  icon: IconName
  line: string
  action?: { label: string; icon?: IconName; onSelect: () => void }
}): React.JSX.Element {
  return (
    <div className="home-empty">
      <Icon name={icon} size={22} className="home-empty-glyph" />
      <p className="home-empty-line">{line}</p>
      {action ? (
        <button className="btn btn-small" onClick={action.onSelect}>
          {action.icon ? <Icon name={action.icon} size={13} /> : null}
          <span>{action.label}</span>
        </button>
      ) : null}
    </div>
  )
}

/**
 * Waiting for a vault, drawn as the shape of the rows that are coming.
 *
 * Narrower than it looks useful for: the index arrives in the same payload as
 * the vault, so a card is never mid-load on a first run. The one window this
 * covers is a *switch* between vaults with the board on screen, where the
 * cards would otherwise keep drawing the outgoing vault's notes until the new
 * payload lands — a shimmer is more honest than another vault's data.
 */
export function LoadingCard({ rows = 3 }: { rows?: number }): React.JSX.Element {
  return (
    <div className="home-skeleton" aria-hidden="true">
      {Array.from({ length: Math.max(1, rows) }, (_, i) => (
        <span key={i} className="home-skeleton-row" />
      ))}
    </div>
  )
}
