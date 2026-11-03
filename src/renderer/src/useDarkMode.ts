import { useEffect, useState } from 'react'

const QUERY = '(prefers-color-scheme: dark)'

/** OS がダークモードか（切り替えにも追従する） */
export function useDarkMode(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia(QUERY).matches)
  useEffect(() => {
    const media = window.matchMedia(QUERY)
    const onChange = (): void => setDark(media.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return dark
}
