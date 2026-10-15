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

  /**
   * `onClose` held in a ref so the effect below can run exactly once.
   *
   * Most callers pass a stable Zustand action, but a caller that builds its
   * handler inline gets a new identity every render — and with `onClose` in the
   * dependency array that tore the trap down and set it up again on each one,
   * which meant re-focusing the first control (yanking focus out from under the
   * user, repeatedly, while anything in the modal was updating) and overwriting
   * the element to restore focus to with one inside the modal.
   */
  const onCloseRef = useRef(options.onClose)
  onCloseRef.current = options.onClose

  const initialFocusRef = useRef(options.initialFocusRef)
  initialFocusRef.current = options.initialFocusRef

  useEffect(() => {
    previousActiveElement.current = document.activeElement as HTMLElement | null

    const container = containerRef.current
    if (container) {
      if (initialFocusRef.current?.current) {
        initialFocusRef.current.current.focus()
      } else {
        const first = container.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
        first?.focus()
      }
    }

    const onKeyDown = (e: KeyboardEvent): void => {
      if (!containerRef.current) return

      if (e.key === 'Escape' && onCloseRef.current) {
        e.preventDefault()
        e.stopPropagation()
        onCloseRef.current()
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
      // Only meaningful on unmount, which — now that the effect runs once — is
      // the only time this cleanup runs.
      previousActiveElement.current?.focus()
    }
  }, [])

  return containerRef
}
