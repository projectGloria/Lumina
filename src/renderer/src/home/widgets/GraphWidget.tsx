import GraphView from '@/components/GraphView'
import { defineWidget } from './types'

/**
 * The vault graph, in a card.
 *
 * `GraphView` draws to a canvas and sizes itself from its host, so it drops
 * into a widget as-is — and it parks its simulation once the layout settles,
 * which is what makes it cheap enough to leave sitting on a board.
 */
function Graph(): React.JSX.Element {
  return (
    <div
      className="home-graph"
      // The board is a scrolling page, so a wheel over this card scrolls it
      // rather than zooming the graph — stopped in the capture phase, before
      // the canvas's own zoom listener sees it. Zoom lives in the full graph
      // (Ctrl+G), where there is nothing behind it to scroll.
      onWheelCapture={(e) => e.stopPropagation()}
    >
      <GraphView scope="global" />
    </div>
  )
}

export const graphWidget = defineWidget<Record<string, unknown>>({
  type: 'graph',
  name: 'Graph',
  description: 'Every note and the links between them',
  icon: 'graph',
  defaultSize: { w: 2, h: 3 },
  minSize: { w: 1, h: 2 },
  defaultConfig: {},
  accent: 'quiet',
  Component: Graph
})
