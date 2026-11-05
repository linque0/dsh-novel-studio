// Application navigation is shared by every shelf and workbench skin.
export const APP_NAVIGATION = Object.freeze([
  { key: 'shelf', label: '书架' },
  { key: 'chapters', label: '正文' },
  { key: 'outline', label: '大纲' },
  { key: 'lore', label: '设定' },
  { key: 'characters', label: '人物' },
  { key: 'snippets', label: '灵感' },
  { key: 'settings', label: '设置' }
])

export const WORK_NAVIGATION = APP_NAVIGATION.filter(item => !['shelf', 'settings'].includes(item.key))
