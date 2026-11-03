import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

// 出力にまとめたパッケージのライセンスの一覧を、それぞれの出力フォルダに作る。
// electron-builder.yml の extraFiles で、インストール先の licenses/ に置く
const license = { fileName: 'THIRD_PARTY_LICENSES.md' }

export default defineConfig({
  main: {
    build: { license }
  },
  preload: {
    build: {
      // 画面は sandbox: true で動かす。sandbox の preload は npm のパッケージを require できないので、
      // @electron-toolkit/preload などは外に出さず preload に同梱する（electron は組み込みなので外のまま）
      externalizeDeps: false,
      license
    }
  },
  renderer: {
    build: { license },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()]
  }
})
