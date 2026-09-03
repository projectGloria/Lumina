/**
 * One inline SVG sprite for the whole app.
 *
 * Icons are stroked with `currentColor` at 1.7px on a 24px grid, which keeps
 * them consistent with the interface weight and lets them inherit theme
 * colours without any extra plumbing.
 *
 * Each entry is raw SVG markup (a string) rather than JSX so the same glyph
 * can be reused outside React — the live-preview editor builds icon widgets
 * with plain DOM calls (`createIconElement`) and needs the identical shapes.
 */

const PATHS: Record<string, string> = {
  files: '<path d="M3 5.5A1.5 1.5 0 014.5 4h4L10 6h9.5A1.5 1.5 0 0121 7.5v11A1.5 1.5 0 0119.5 20h-15A1.5 1.5 0 013 18.5v-13z" />',
  search: '<circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" />',
  tag: '<path d="M11 3H4a1 1 0 00-1 1v7l9.5 9.5a1.5 1.5 0 002.1 0l6-6a1.5 1.5 0 000-2.1L11 3z" /><circle cx="7.5" cy="7.5" r="1.2" />',
  star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.7l5.9-.9L12 3.5z" />',
  graph: '<circle cx="6" cy="17" r="2.5" /><circle cx="18" cy="17" r="2.5" /><circle cx="12" cy="6" r="2.5" /><path d="M10.6 8.1L7.4 14.9M13.4 8.1l3.2 6.8M8.5 17h7" />',
  link: '<path d="M10 13.5a3.5 3.5 0 004.9.5l2.6-2.6a3.5 3.5 0 00-4.9-4.9l-1.3 1.3" /><path d="M14 10.5a3.5 3.5 0 00-4.9-.5L6.5 12.6a3.5 3.5 0 004.9 4.9l1.3-1.3" />',
  globe: '<circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.4 2.5 3.6 5.5 3.6 9s-1.2 6.5-3.6 9M12 3c-2.4 2.5-3.6 5.5-3.6 9s1.2 6.5 3.6 9" />',
  outline: '<path d="M4 6h4M10 6h10M4 12h4M10 12h10M4 18h4M10 18h10" />',
  settings: '<circle cx="12" cy="12" r="3" /><path d="M19.4 14.5a1.6 1.6 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.6 1.6 0 00-1.8-.3 1.6 1.6 0 00-1 1.5v.2a2 2 0 11-4 0v-.1a1.6 1.6 0 00-1-1.5 1.6 1.6 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.6 1.6 0 00.3-1.8 1.6 1.6 0 00-1.5-1H3a2 2 0 110-4h.1a1.6 1.6 0 001.5-1 1.6 1.6 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.6 1.6 0 001.8.3H9a1.6 1.6 0 001-1.5V3a2 2 0 114 0v.1a1.6 1.6 0 001 1.5 1.6 1.6 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.6 1.6 0 00-.3 1.8V9a1.6 1.6 0 001.5 1h.2a2 2 0 110 4h-.1a1.6 1.6 0 00-1.5 1z" />',
  plus: '<path d="M12 5v14M5 12h14" />',
  folderPlus: '<path d="M3 6.5A1.5 1.5 0 014.5 5h4L10 7h9.5A1.5 1.5 0 0121 8.5v10A1.5 1.5 0 0119.5 20h-15A1.5 1.5 0 013 18.5v-12z" /><path d="M12 11v6M9 14h6" />',
  chevronRight: '<path d="M9.5 5.5l6 6.5-6 6.5" />',
  chevronDown: '<path d="M5.5 9.5l6.5 6 6.5-6" />',
  close: '<path d="M6 6l12 12M18 6L6 18" />',
  dots: '<circle cx="12" cy="5.5" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="12" cy="18.5" r="1.4" />',
  panelLeft: '<rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9.5 4v16" />',
  panelRight: '<rect x="3" y="4" width="18" height="16" rx="2" /><path d="M14.5 4v16" />',
  sun: '<circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4" />',
  moon: '<path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />',
  back: '<path d="M15 5.5L8.5 12l6.5 6.5" />',
  forward: '<path d="M9 5.5l6.5 6.5L9 18.5" />',
  file: '<path d="M6 3.5h7l5 5v12H6z" /><path d="M13 3.5v5h5" />',
  folder: '<path d="M3 6.5A1.5 1.5 0 014.5 5h4L10 7h9.5A1.5 1.5 0 0121 8.5v10A1.5 1.5 0 0119.5 20h-15A1.5 1.5 0 013 18.5v-12z" />',
  trash: '<path d="M4.5 7h15M9.5 7V5h5v2M7 7l1 13h8l1-13" />',
  edit: '<path d="M4 20h4L19 9a2.1 2.1 0 00-3-3L5 17v3z" /><path d="M15.5 6.5l3 3" />',
  external: '<path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M18 14v5.5A1.5 1.5 0 0116.5 21h-11A1.5 1.5 0 014 19.5v-11A1.5 1.5 0 015.5 7H11" />',
  check: '<path d="M4.5 12.5l5 5 10-11" />',
  // A finished list, as distinct from an empty one — the tasks card needs to
  // say "everything is ticked off" without reusing the glyph for a bare tick.
  checkCircle: '<circle cx="12" cy="12" r="9" /><path d="M8.2 12.3l2.6 2.6 5-5.4" />',
  focus: '<path d="M4 9V5.5A1.5 1.5 0 015.5 4H9M15 4h3.5A1.5 1.5 0 0120 5.5V9M20 15v3.5a1.5 1.5 0 01-1.5 1.5H15M9 20H5.5A1.5 1.5 0 014 18.5V15" />',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 018 0v3M12 14v3" />',
  palette: '<path d="M12 3a9 9 0 000 18c1 0 1.7-.8 1.7-1.7 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.1 0-1 .8-1.7 1.7-1.7h2A4.6 4.6 0 0021 10.6C21 6.4 16.9 3 12 3z" /><circle cx="7.5" cy="11" r="1.2" /><circle cx="10.5" cy="7" r="1.2" /><circle cx="15.5" cy="7.5" r="1.2" />',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2" /><path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M6.5 13.5h.01M17 13.5h.01M9.5 13.5h5" />',
  info: '<circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" />',
  home: '<path d="M3.6 10.7L12 4l8.4 6.7V19a1.5 1.5 0 01-1.5 1.5h-3.4V14H8.5v6.5H5.1A1.5 1.5 0 013.6 19v-8.3z" />',
  image: '<rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="8.5" cy="10" r="1.5" /><path d="M4 17l4.5-4.5 3 3L15.5 11l4.5 4.5" />',
  grid: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />',
  book: '<path d="M4 4.5A1.5 1.5 0 015.5 3H19v18H5.5A1.5 1.5 0 014 19.5v-15z" /><path d="M4 17.5A1.5 1.5 0 015.5 16H19" />',
  clock: '<circle cx="12" cy="12" r="9" /><path d="M12 7v5.2l3.2 2" />',
  hash: '<path d="M6 9h13M5 15h13M10.5 4l-2 16M16.5 4l-2 16" />',
  refresh: '<path d="M20 12a8 8 0 10-2.3 5.6" /><path d="M20 6v5h-5" />',
  download: '<path d="M12 4v11M7.5 11L12 15.5 16.5 11M5 19.5h14" />',
  vault: '<rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="12" cy="12" r="3.5" /><path d="M12 8.5V6M12 18v-2.5" />',
  pin: '<path d="M14.5 3.5l6 6-3.2 1.6-3.3 5.2-1.4-1.4-4 4-1-1 4-4-1.4-1.4 5.2-3.3L14.5 3.5z" />',
  slash: '<path d="M14.5 4.5l-5 15" />',
  bolt: '<path d="M13 3L5.5 13.5H11l-1 7.5 8-11H12l1-7z" />',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11.5a6.5 6.5 0 0013 0M12 18v3M9 21h6" />',
  micOff: '<path d="M9 5a3 3 0 016 0v5m-.9 3.1A3 3 0 019 11V9" /><path d="M5.5 11.5a6.5 6.5 0 009.9 5.6M18.5 11.5a6.4 6.4 0 01-.5 2.5M12 18v3M9 21h6" /><path d="M4 4l16 16" />',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" />',
  waveform: '<path d="M4 11v2M8 8v8M12 5v14M16 8.5v7M20 11v2" />',
  speaker: '<path d="M4 9.5h3.5L12.5 5v14L7.5 14.5H4v-5z" /><path d="M16 9.5a4 4 0 010 5M18.5 7a7.5 7.5 0 010 10" />',
  play: '<path d="M8 5.5l10 6.5-10 6.5v-13z" />',
  pause: '<path d="M9.5 5.5v13M14.5 5.5v13" />',
  skipBack: '<path d="M17 6.5v11L9 12l8-5.5z" /><path d="M6.5 6v12" />',
  skipForward: '<path d="M7 6.5L15 12l-8 5.5v-11z" /><path d="M17.5 6v12" />'
}

export type IconName = keyof typeof PATHS

const SVG_ATTRS: Record<string, string> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '1.7',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
  focusable: 'false'
}

/** Builds a standalone `<svg>` element for contexts outside React, e.g. CodeMirror widgets. */
export function createIconElement(
  name: IconName,
  size = 16,
  className?: string,
  ownerDocument: Document = document
): SVGSVGElement {
  const svg = ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg')
  for (const [attr, value] of Object.entries(SVG_ATTRS)) svg.setAttribute(attr, value)
  svg.setAttribute('width', String(size))
  svg.setAttribute('height', String(size))
  if (className) svg.setAttribute('class', className)
  svg.innerHTML = PATHS[name]
  return svg
}

export function Icon({
  name,
  size = 16,
  className,
  style
}: {
  name: IconName
  size?: number
  className?: string
  style?: React.CSSProperties
}): React.JSX.Element {
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: PATHS[name] }}
    />
  )
}
