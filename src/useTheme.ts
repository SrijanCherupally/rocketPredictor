import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'
const THEME_KEY = 'apexflite-theme-v1'

export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem(THEME_KEY) as Theme | null
      if (stored === 'light' || stored === 'dark') return stored
    } catch { /* storage may be unavailable */ }

    // Detect system preference
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    return 'light'
  })

  useEffect(() => {
    try { localStorage.setItem(THEME_KEY, theme) } catch { /* storage may be unavailable */ }
    document.documentElement.setAttribute('data-theme', theme)
  }, [theme])

  const setTheme = (newTheme: Theme) => setThemeState(newTheme)
  const toggleTheme = () => setThemeState((current) => current === 'light' ? 'dark' : 'light')

  return { theme, setTheme, toggleTheme }
}
