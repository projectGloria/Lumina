import { Icon } from './Icon'
import { useUi } from '../store/uiStore'

/** Brief, central confirmation for an explicit save without adding toast noise. */
export default function SaveIndicator(): React.JSX.Element | null {
  const pulse = useUi((s) => s.savePulse)
  if (!pulse) return null

  return (
    <div key={pulse} className="save-indicator" role="status" aria-live="polite">
      <Icon name="check" size={18} />
      <span>Saved</span>
    </div>
  )
}
