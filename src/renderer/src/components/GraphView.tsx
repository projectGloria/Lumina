import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum
} from 'd3-force'
import { openNote } from '../lib/actions'
import { useSettings } from '../store/settingsStore'
import { titleOf, useVault } from '../store/vaultStore'
import { useWorkspace } from '../store/workspaceStore'

interface GraphNode extends SimulationNodeDatum {
  id: string
  title: string
  degree: number
  /** True for a link target that has no note behind it yet. */
  ghost: boolean
}

type GraphLink = SimulationLinkDatum<GraphNode>

interface Props {
  /** `local` shows the neighbourhood of the open note; `global` the whole vault. */
  scope: 'global' | 'local'
  depth?: number
}

/**
 * The vault as a force-directed map.
 *
 * Drawn on a canvas rather than SVG because a few thousand nodes in the DOM
 * stutter badly while panning, and the simulation is parked once it settles so
 * an idle graph costs nothing.
 */
export default function GraphView({ scope, depth = 2 }: Props): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const sim = useRef<Simulation<GraphNode, GraphLink> | null>(null)
  const nodesRef = useRef<GraphNode[]>([])
  const linksRef = useRef<GraphLink[]>([])
  const frame = useRef(0)

  const view = useRef({ x: 0, y: 0, k: 1 })
  const hovered = useRef<GraphNode | null>(null)
  const dragged = useRef<GraphNode | null>(null)
  const panning = useRef<{ x: number; y: number } | null>(null)
  const moved = useRef(0)

  const index = useVault((s) => s.index)
  const tabs = useWorkspace((s) => s.tabs)
  const activeTab = useWorkspace((s) => s.activeTab)
  const perf = useSettings((s) => s.settings.graphPerformanceMode)
  const mode = useSettings((s) => s.mode)
  const activeNote = tabs[activeTab]?.path ?? null

  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hoverLabel, setHoverLabel] = useState<string | null>(null)

  /* ------------------------------------------------------- build the graph */
  const graph = useMemo(() => {
    const notes = index.notes
    const degree = new Map<string, number>()
    const edges: [string, string][] = []
    const ghosts = new Set<string>()

    for (const [path, entry] of Object.entries(notes)) {
      for (const link of entry.links) {
        const target = link.to ?? `ghost:${link.target}`
        if (!link.to) ghosts.add(target)
        if (target === path) continue
        edges.push([path, target])
        degree.set(path, (degree.get(path) ?? 0) + 1)
        degree.set(target, (degree.get(target) ?? 0) + 1)
      }
    }

    let ids = new Set([...Object.keys(notes), ...ghosts])

    if (scope === 'local') {
      if (!activeNote || !notes[activeNote]) return { nodes: [], links: [] }
      // Walk out `depth` hops from the open note, following links both ways.
      const neighbours = new Map<string, Set<string>>()
      for (const [a, b] of edges) {
        if (!neighbours.has(a)) neighbours.set(a, new Set())
        if (!neighbours.has(b)) neighbours.set(b, new Set())
        neighbours.get(a)!.add(b)
        neighbours.get(b)!.add(a)
      }
      const reached = new Set([activeNote])
      let frontier = [activeNote]
      for (let d = 0; d < depth; d++) {
        const next: string[] = []
        for (const id of frontier) {
          for (const n of neighbours.get(id) ?? []) {
            if (!reached.has(n)) {
              reached.add(n)
              next.push(n)
            }
          }
        }
        frontier = next
      }
      ids = reached
    }

    const nodes: GraphNode[] = [...ids].map((id) => ({
      id,
      title: id.startsWith('ghost:') ? id.slice(6) : titleOf(id),
      degree: degree.get(id) ?? 0,
      ghost: id.startsWith('ghost:')
    }))

    const byId = new Map(nodes.map((n) => [n.id, n]))
    const seen = new Set<string>()
    const links: GraphLink[] = []
    for (const [a, b] of edges) {
      if (!byId.has(a) || !byId.has(b)) continue
      const key = a < b ? `${a}|${b}` : `${b}|${a}`
      if (seen.has(key)) continue
      seen.add(key)
      links.push({ source: byId.get(a)!, target: byId.get(b)! })
    }

    return { nodes, links }
  }, [index, scope, activeNote, depth])

  /* ---------------------------------------------------------------- sizing */
  useEffect(() => {
    const el = host.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      setSize({ w: Math.round(width), h: Math.round(height) })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /* ------------------------------------------------------------- rendering */
  const draw = useCallback(() => {
    const cv = canvas.current
    if (!cv || !size.w || !size.h) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    const style = getComputedStyle(document.documentElement)
    const token = (name: string): string => style.getPropertyValue(`--lum-${name}`).trim()
    const colors = {
      bg: token('bg'),
      node: token('graph-node'),
      active: token('graph-node-active') || token('accent'),
      ghost: token('graph-node-unresolved'),
      edge: token('graph-edge'),
      edgeActive: token('graph-edge-active'),
      label: token('graph-label') || token('text-muted'),
      accent: token('accent')
    }

    const dpr = window.devicePixelRatio || 1
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    ctx.fillStyle = colors.bg
    ctx.fillRect(0, 0, size.w, size.h)

    const { x: tx, y: ty, k } = view.current
    ctx.save()
    ctx.translate(tx, ty)
    ctx.scale(k, k)

    const hover = hovered.current
    const near = new Set<string>()
    if (hover) {
      near.add(hover.id)
      for (const link of linksRef.current) {
        const s = link.source as GraphNode
        const t = link.target as GraphNode
        if (s.id === hover.id) near.add(t.id)
        else if (t.id === hover.id) near.add(s.id)
      }
    }

    // Edges first so nodes sit on top of them.
    ctx.lineWidth = 1 / k
    for (const link of linksRef.current) {
      const s = link.source as GraphNode
      const t = link.target as GraphNode
      if (s.x == null || t.x == null) continue
      const lit = hover && (near.has(s.id) && near.has(t.id))
      ctx.strokeStyle = lit ? colors.edgeActive : colors.edge
      ctx.beginPath()
      ctx.moveTo(s.x, s.y ?? 0)
      ctx.lineTo(t.x, t.y ?? 0)
      ctx.stroke()
    }

    const radiusOf = (n: GraphNode): number => Math.min(14, 3.2 + Math.sqrt(n.degree) * 1.7)

    for (const node of nodesRef.current) {
      if (node.x == null || node.y == null) continue
      const r = radiusOf(node)
      const isActive = node.id === activeNote
      const dim = hover && !near.has(node.id)

      ctx.globalAlpha = dim ? 0.25 : 1
      ctx.fillStyle = isActive ? colors.active : node.ghost ? colors.ghost : colors.node
      ctx.beginPath()
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
      ctx.fill()

      if (isActive) {
        ctx.strokeStyle = colors.accent
        ctx.lineWidth = 2 / k
        ctx.beginPath()
        ctx.arc(node.x, node.y, r + 3 / k, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    // Labels only where they will be readable and not a solid wall of text.
    const showLabels = k > 0.75 || nodesRef.current.length < 40
    if (showLabels) {
      ctx.font = `${11 / k}px ${style.getPropertyValue('--lum-font-ui')}`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      for (const node of nodesRef.current) {
        if (node.x == null || node.y == null) continue
        const important = node.id === activeNote || node.id === hover?.id
        if (!important && hover) continue
        if (!important && node.degree < (perf ? 3 : 1)) continue
        ctx.fillStyle = important ? colors.accent : colors.label
        ctx.fillText(node.title.slice(0, 28), node.x, node.y + radiusOf(node) + 3 / k)
      }
    }

    ctx.restore()
  }, [size, activeNote, perf, mode])

  /* ------------------------------------------------------------ simulation */
  useEffect(() => {
    sim.current?.stop()
    nodesRef.current = graph.nodes
    linksRef.current = graph.links

    if (!graph.nodes.length || !size.w) {
      draw()
      return
    }

    const simulation = forceSimulation<GraphNode, GraphLink>(graph.nodes)
      .force('link', forceLink<GraphNode, GraphLink>(graph.links).id((d) => d.id).distance(48).strength(0.5))
      .force('charge', forceManyBody().strength(perf ? -60 : -130).distanceMax(420))
      .force('center', forceCenter(0, 0))
      .force('x', forceX(0).strength(0.035))
      .force('y', forceY(0).strength(0.035))
      .force('collide', forceCollide<GraphNode>().radius((d) => 8 + Math.sqrt(d.degree) * 2))
      .alphaDecay(perf ? 0.05 : 0.028)

    simulation.on('tick', () => {
      cancelAnimationFrame(frame.current)
      frame.current = requestAnimationFrame(draw)
    })
    // Settling the simulation is what keeps an open graph at zero CPU.
    simulation.on('end', draw)

    sim.current = simulation
    view.current = { x: size.w / 2, y: size.h / 2, k: view.current.k }

    return () => {
      simulation.stop()
      cancelAnimationFrame(frame.current)
    }
  }, [graph, size.w, size.h, perf, draw])

  useEffect(() => {
    draw()
  }, [draw, mode])

  /* --------------------------------------------------------- interactions */
  const toWorld = (e: React.PointerEvent | React.MouseEvent): { x: number; y: number } => {
    const rect = canvas.current!.getBoundingClientRect()
    const { x, y, k } = view.current
    return { x: (e.clientX - rect.left - x) / k, y: (e.clientY - rect.top - y) / k }
  }

  const nodeAt = (px: number, py: number): GraphNode | null => {
    let best: GraphNode | null = null
    let bestDist = Infinity
    for (const node of nodesRef.current) {
      if (node.x == null || node.y == null) continue
      const r = Math.min(14, 3.2 + Math.sqrt(node.degree) * 1.7) + 4
      const dx = node.x - px
      const dy = node.y - py
      const dist = dx * dx + dy * dy
      if (dist < r * r && dist < bestDist) {
        best = node
        bestDist = dist
      }
    }
    return best
  }

  /**
   * Zoom, attached by hand rather than through `onWheel`.
   *
   * React registers `wheel` at its root container as a *passive* listener, so
   * `preventDefault()` inside a synthetic `onWheel` is refused — Chromium logs
   * "Unable to preventDefault inside passive event listener invocation" and
   * the surface scrolls instead of zooming. Only a listener registered with
   * `{ passive: false }` may cancel the event, which is what makes the modal's
   * "scroll to zoom" true.
   */
  useEffect(() => {
    const el = canvas.current
    if (!el) return

    const onWheel = (e: WheelEvent): void => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = Math.exp(-e.deltaY * 0.0015)
      const k = Math.max(0.15, Math.min(5, view.current.k * factor))
      // Zoom toward the pointer rather than the canvas centre.
      view.current.x = mx - ((mx - view.current.x) * k) / view.current.k
      view.current.y = my - ((my - view.current.y) * k) / view.current.k
      view.current.k = k
      draw()
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [draw])

  return (
    <div className="graph-host" ref={host}>
      <canvas
        ref={canvas}
        width={size.w * (window.devicePixelRatio || 1)}
        height={size.h * (window.devicePixelRatio || 1)}
        style={{ width: size.w, height: size.h, cursor: hoverLabel ? 'pointer' : 'grab' }}
        onPointerDown={(e) => {
          moved.current = 0
          const { x, y } = toWorld(e)
          const node = nodeAt(x, y)
          e.currentTarget.setPointerCapture(e.pointerId)
          if (node) {
            dragged.current = node
            node.fx = node.x
            node.fy = node.y
            sim.current?.alphaTarget(0.25).restart()
          } else {
            panning.current = { x: e.clientX - view.current.x, y: e.clientY - view.current.y }
          }
        }}
        onPointerMove={(e) => {
          moved.current += Math.abs(e.movementX) + Math.abs(e.movementY)
          if (dragged.current) {
            const { x, y } = toWorld(e)
            dragged.current.fx = x
            dragged.current.fy = y
            return
          }
          if (panning.current) {
            view.current.x = e.clientX - panning.current.x
            view.current.y = e.clientY - panning.current.y
            draw()
            return
          }
          const { x, y } = toWorld(e)
          const node = nodeAt(x, y)
          if (node !== hovered.current) {
            hovered.current = node
            setHoverLabel(node ? node.title : null)
            draw()
          }
        }}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture?.(e.pointerId)
          const node = dragged.current
          if (node) {
            node.fx = null
            node.fy = null
            sim.current?.alphaTarget(0)
            // A press that never really moved counts as a click.
            if (moved.current < 4 && !node.ghost) openNote(node.id)
          }
          dragged.current = null
          panning.current = null
        }}
        onPointerCancel={() => {
          if (dragged.current) {
            dragged.current.fx = null
            dragged.current.fy = null
            sim.current?.alphaTarget(0)
          }
          dragged.current = null
          panning.current = null
        }}
        onPointerLeave={() => {
          hovered.current = null
          setHoverLabel(null)
          panning.current = null
          draw()
        }}
      />

      {!graph.nodes.length ? (
        <div className="graph-empty">
          {scope === 'local'
            ? 'Open a note with links to see its neighbourhood.'
            : 'Link some notes together and they will appear here.'}
        </div>
      ) : null}

      <div className="graph-legend">
        <span>{graph.nodes.length} notes</span>
        <span>{graph.links.length} links</span>
        {hoverLabel ? <span className="graph-hover truncate">{hoverLabel}</span> : null}
      </div>
    </div>
  )
}
