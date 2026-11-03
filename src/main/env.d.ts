/// <reference types="electron-vite/node" />

// templates/ の原本を文字列としてアプリに同梱する（Vite の ?raw）
declare module '*.md?raw' {
  const content: string
  export default content
}
