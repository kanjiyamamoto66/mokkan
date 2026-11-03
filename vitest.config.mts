import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // 画面を使わないロジック（frontmatterの読み書き、往復テストなど）をNode上で試す
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts']
  }
})
