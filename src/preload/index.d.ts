import { ElectronAPI } from '@electron-toolkit/preload'
import type { MokkanApi } from '../shared/api'

declare global {
  interface Window {
    electron: ElectronAPI
    api: MokkanApi
  }
}
