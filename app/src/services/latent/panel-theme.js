export function normalizePanelTheme(value) {
  return value === 'light' || value === 'dark' ? value : 'host'
}

export function resolvePanelTheme(value, hostDark) {
  const mode = normalizePanelTheme(value)
  if (mode !== 'host') return mode
  return hostDark ? 'dark' : 'light'
}
