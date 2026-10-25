import type { PdvApi } from '@shared/ipc'

declare global {
  interface Window {
    pdv: PdvApi
  }
}
