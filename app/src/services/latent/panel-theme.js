export function normalizePanelTheme(value) {
  return value === 'light' ? 'light' : 'dark'
}

export function resolvePanelTheme(value) {
  return normalizePanelTheme(value)
}
