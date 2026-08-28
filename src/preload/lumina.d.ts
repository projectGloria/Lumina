import type { LuminaApi } from './index'

declare global {
  interface Window {
    lumina: LuminaApi
  }
}

export {}
