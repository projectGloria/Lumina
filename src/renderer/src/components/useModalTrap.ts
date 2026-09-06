import { useEffect, useRef } from 'react'

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'

interface UseModalTrapOptions {
  onClose?: () => void
  initialFocusRef?: React.RefObject<HTMLElement | null>
}

export function useModalTrap<T extends HTMLElement = HTMLDivElement>(
  options: UseModalTrapOptions = {}
): React.RefObject<T | null> {
  const containerRef = useRef<T>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)

  useEffect(() => {
    previousActiveElement.current = document.activeElement as HTMLElement | null

    const container = containerRef.current
    if (container) {
      if (options.initialFocusRef?.current) {
        options.initialFocusRef.current.focus()
      } else {
        const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
        first?.focus()
      }
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      if (!containerRef.current) return

      if (e.key === 'Escape' && options.onClose) {
        e.preventDefault()
        e.stopPropagation()
        options.onClose()
        return
      }

      if (e.key === 'Tab') {
        const focusable = Array.from(
          containerRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)
        ).filter((el) => el.offsetParent !== null || el === document.activeElement)

        if (focusable.length === 0) {
          e.preventDefault()
          return
        }

        const first = focusable[0]
        const last = focusable[focusable.length - 1]

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      previousActiveElement.current?.focus()
    }
  }, [options.onClose])

  return containerRef
}
