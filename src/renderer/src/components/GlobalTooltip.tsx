import { useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'

export default function GlobalTooltip(): React.ReactPortal | null {
  const [tooltip, setTooltip] = useState<{ text: string; x: number; y: number } | null>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let hideTimeout: ReturnType<typeof setTimeout>

    const onMouseOver = (e: MouseEvent): void => {
      const target = e.target as HTMLElement | null
      const el = target?.closest('[data-tooltip]') as HTMLElement | null
      
      if (el) {
        clearTimeout(hideTimeout)
        const text = el.getAttribute('data-tooltip')
        if (text) {
          const rect = el.getBoundingClientRect()
          setTooltip({
            text,
            x: rect.left + rect.width / 2,
            y: rect.bottom + 8
          })
        }
      } else {
        // Debounce hiding to avoid flickering when moving between adjacent tooltip elements
        hideTimeout = setTimeout(() => setTooltip(null), 10)
      }
    }

    const onMouseLeave = (): void => {
      setTooltip(null)
    }

    const onScroll = (): void => {
      setTooltip(null)
    }

    window.addEventListener('mouseover', onMouseOver)
    document.addEventListener('mouseleave', onMouseLeave)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('click', onScroll, true) // hide on click

    return () => {
      window.removeEventListener('mouseover', onMouseOver)
      document.removeEventListener('mouseleave', onMouseLeave)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('click', onScroll, true)
      clearTimeout(hideTimeout)
    }
  }, [])

  useEffect(() => {
    if (tooltip && tooltipRef.current) {
      const el = tooltipRef.current
      const rect = el.getBoundingClientRect()
      const padding = 8
      let newX = tooltip.x
      let newY = tooltip.y

      // Adjust for right edge
      if (newX + rect.width / 2 > window.innerWidth - padding) {
        newX = window.innerWidth - rect.width / 2 - padding
      }
      // Adjust for left edge
      if (newX - rect.width / 2 < padding) {
        newX = rect.width / 2 + padding
      }
      // Adjust for bottom edge
      if (newY + rect.height > window.innerHeight - padding) {
        // Put above the element if no space below
        newY = tooltip.y - rect.height - 16 - (el.parentElement?.getBoundingClientRect().height ?? 0) // rough estimation
      }

      el.style.left = `${newX}px`
      el.style.top = `${newY}px`
      // Opacity starts at 0, transition to 1
      requestAnimationFrame(() => {
        el.style.opacity = '1'
        el.style.transform = 'translateX(-50%) translateY(0)'
      })
    }
  }, [tooltip])

  if (!tooltip) return null

  return createPortal(
    <div
      ref={tooltipRef}
      className="global-tooltip"
      style={{
        position: 'fixed',
        top: tooltip.y,
        left: tooltip.x,
        transform: 'translateX(-50%) translateY(-4px)',
        opacity: 0,
        zIndex: 9999,
        pointerEvents: 'none'
      }}
    >
      {tooltip.text}
    </div>,
    document.body
  )
}
