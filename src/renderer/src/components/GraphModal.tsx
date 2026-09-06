import GraphView from './GraphView'
import { Icon } from './Icon'
import { useUi } from '../store/uiStore'
import { useModalTrap } from './useModalTrap'

/** The whole-vault graph, given the room it needs. */
export default function GraphModal(): React.JSX.Element {
  const close = useUi((s) => s.closeModal)
  const trapRef = useModalTrap({ onClose: close })

  return (
    <div className="overlay center" onMouseDown={close}>
      <div
        ref={trapRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="graph-modal-title"
        className="modal graph-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2 id="graph-modal-title" className="modal-title">Graph</h2>
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
