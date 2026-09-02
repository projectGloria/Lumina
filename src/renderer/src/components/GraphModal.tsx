import { useEffect } from 'react'
import GraphView from './GraphView'
import { Icon } from './Icon'
import { useUi } from '../store/uiStore'

/** The whole-vault graph, given the room it needs. */
export default function GraphModal(): React.JSX.Element {
  const close = useUi((s) => s.closeModal)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div className="overlay center" onMouseDown={close}>
      <div className="modal graph-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">Graph</h2>
          <span className="modal-hint">Scroll to zoom · drag to pan · click a note to open it</span>
          <button className="icon-btn" onClick={close} data-tooltip="Close" aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <GraphView scope="global" />
      </div>
    </div>
  )
}
