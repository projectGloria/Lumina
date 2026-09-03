import { useMemo } from 'react'
import { vaultFolders } from '@shared/homePaths'
import { Icon } from '@/components/Icon'
import { useVault } from '@/store/vaultStore'

/**
 * Shared by the cards that scope themselves to one folder.
 *
 * A folder filter that resolves to nothing is the same problem the scratch pad
 * has when its note goes away, and it gets the same answer: keep what the user
 * stored, say that it points at nothing, and offer the way out. The
 * alternatives are both silent — an empty list looks like a card that is
 * working, and clearing the filter repoints the card at the whole vault, which
 * is a scope the user never asked for and no visible reason for the forty rows
 * that arrive. Keeping it also means a folder that comes back under the same
 * name is picked up again on purpose rather than inherited by accident.
 */
export function useMissingFolder(folder: string): boolean {
  const tree = useVault((s) => s.tree)
  return useMemo(() => !!folder && !vaultFolders(tree).has(folder), [tree, folder])
}

/** What such a card draws instead of a list it can never fill. */
export function MissingFolderNotice({
  folder,
  onClear
}: {
  folder: string
  onClear: () => void
}): React.JSX.Element {
  return (
    <div className="home-scope-missing">
      <p className="home-widget-empty">
        This card is limited to <code>{folder}</code>, which is not a folder in this vault.
      </p>
      <button className="btn btn-small" onClick={onClear}>
        <Icon name="close" size={13} />
        <span>Use the whole vault</span>
      </button>
    </div>
  )
}
