// A skin describes supported surfaces; unsupported surfaces retain the user's original theme.
// audience: 'desktop' = 桌面版可见；'plugin' = 仅插件构建由 installDshSkin() 强制，不进桌面选择器。
/* R1 唯一外观：桌面皮肤已全部收敛删除，SKINS 只剩「隐现」一项。 */
export const SKINS = Object.freeze([
  { id: 'dsh', label: '隐现', description: '流动底、玻璃封面与胶囊顶栏（插件版唯一外观）', surfaces: ['shelf', 'work', 'panel'], palette: null, audience: 'plugin' }
])

/* 按受众取皮肤：省略 audience 时只给桌面皮肤（向后兼容旧调用）。 */
export function visibleSkins(audience = 'desktop') {
  return SKINS.filter(skin => (skin.audience || 'desktop') === audience)
}

/* 构建期常量在 node/vitest 直接 import 时并不存在，必须 typeof 守卫，不能裸引用。 */
export function isPluginBuild() {
  return typeof __NS_PLUGIN__ !== 'undefined' && __NS_PLUGIN__
}

/* 唯一外观不按受众裁剪：桌面受众已无可给的皮肤，返回空列表会让选择器与 normalizeSkin 一起失焦。 */
export function visibleSkinsForBuild() {
  const list = visibleSkins(isPluginBuild() ? 'plugin' : 'desktop')
  return list.length ? list : SKINS
}

/* 只认当前构建可见的皮肤：命中就用它，否则回落到第一个可见皮肤（唯一外观即 dsh，不再回落 original）。 */
export function normalizeSkin(value) {
  const visible = visibleSkinsForBuild()
  return visible.some(skin => skin.id === value) ? value : visible[0].id
}

/* 三种面（书架 / 工作台 / 面板）都由唯一外观提供，不再按 surface 挑皮肤或回落第二套。 */
export function resolveSkin() {
  return SKINS[0]
}
