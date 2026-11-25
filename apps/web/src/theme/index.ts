import { useCallback, useSyncExternalStore } from 'react'
import { isThemePreset, type ThemePreset } from '@daymate/shared'

const STORAGE_KEY = 'daymate.theme'
const listeners = new Set<() => void>()

export function currentTheme(): ThemePreset {
  const t = document.documentElement.dataset.theme
  return isThemePreset(t) ? t : 'paper'
}

/** 切换主题并记在本机（index.html 的内联脚本在下次打开时提前套用）。M5 起再同步到服务端。 */
export function setTheme(theme: ThemePreset) {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    // 无痕模式等拿不到存储时，只在本次生效
  }
  listeners.forEach((fn) => fn())
}

export function useTheme(): [ThemePreset, (t: ThemePreset) => void] {
  const theme = useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    currentTheme,
  )
  return [theme, useCallback(setTheme, [])]
}
