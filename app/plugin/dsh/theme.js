/* DSH 插件版的 naive-ui 主题映射（M1-C2）。
 *
 * 只做一件事：把宿主那套中性色写成 naive 的 themeOverrides，让弹窗 / 下拉 / 输入框
 * 不再是浅色积木。取值是写死的中性色常量（与 dsh.css 里每个 var() 的回退一致），
 * iframe 内拿不到宿主令牌时也不会掉回 naive 默认的白底与亮蓝。
 *
 * 明暗来源：iframe 文档根上的 data-ns-dark='1'（宿主 shim 镜像过去）。
 * 首选监听 window 的 'ns-theme-changed' 事件；该事件不存在时，MutationObserver 观察
 * documentElement.dataset.nsDark 是等价的回退——两条路都只是把同一个读取动作再跑一次。
 * 主题本身只在这里定义，组件层不写颜色。 */

import { computed, onScopeDispose, ref } from 'vue'

/* 中性色常量：深色（宿主 alias 层）与浅色各一套。 */
const DARK = {
  bg: '#151517', layer1: '#232324', layer2: '#2c2c2e',
  text1: '#f9fafb', text2: '#cfd3d6', text3: '#81858c',
  border: 'rgba(255,255,255,.12)', accent: '#7aaaff', error: '#f25a5a', success: '#22c55e',
  /* 玻璃面：与 language.css 的 --nsx-glass-1 同色同透明度，面板后面透出页面底色 */
  glass: '#232324e0'
}
const LIGHT = {
  bg: '#ffffff', layer1: '#fafafa', layer2: '#ffffff',
  text1: '#0f1115', text2: '#61666b', text3: '#81858c',
  border: 'rgba(0,0,0,.10)', accent: '#4176e6', error: '#ec1313', success: '#22c55e',
  /* 玻璃面：与 language.css 的 --nsx-glass-1 同色同透明度，面板后面透出页面底色 */
  glass: '#ffffffd9'
}

/* 圆角 10 / 12 / 16：控件 10，容器 12，大面板 16 —— 与 language.css 的胶囊/面板半径同一档。
 * 字号 14 / 12。 */
const RADIUS = { xs: '10px', sm: '8px', md: '12px', lg: '16px' }
const FONT = { base: '14px', small: '12px' }
const LINE = '1.6'
/* 末尾补 Noto Serif SC：中文无衬线缺字时落到与现代字重匹配的标题字族，而不是随机的系统宋体。 */
const FONT_FAMILY = '-apple-system, "Segoe UI", "Microsoft YaHei", "Noto Serif SC", system-ui, sans-serif'
const SHADOW = '0 6px 24px rgba(0,0,0,.32), 0 1px 3px rgba(0,0,0,.24)'

function buildOverrides(c) {
  return {
    common: {
      fontFamily: FONT_FAMILY,
      fontSize: FONT.base,
      fontSizeSmall: FONT.small,
      fontSizeMedium: FONT.base,
      lineHeight: LINE,
      heightMedium: '32px',
      heightSmall: '28px',
      heightTiny: '24px',
      borderRadius: RADIUS.md,
      borderRadiusSmall: RADIUS.xs,

      primaryColor: c.accent,
      primaryColorHover: c.accent,
      primaryColorPressed: c.accent,
      primaryColorSuppl: c.accent,
      infoColor: c.accent,
      infoColorHover: c.accent,
      infoColorPressed: c.accent,
      infoColorSuppl: c.accent,
      successColor: c.success,
      successColorHover: c.success,
      successColorPressed: c.success,
      successColorSuppl: c.success,
      errorColor: c.error,
      errorColorHover: c.error,
      errorColorPressed: c.error,
      errorColorSuppl: c.error,

      textColorBase: c.text1,
      textColor1: c.text1,
      textColor2: c.text2,
      textColor3: c.text3,
      textColorDisabled: c.text3,
      placeholderColor: c.text3,
      placeholderColorDisabled: c.text3,
      iconColor: c.text2,
      iconColorHover: c.text1,
      iconColorPressed: c.text1,
      iconColorDisabled: c.text3,

      bodyColor: c.bg,
      cardColor: c.layer1,
      modalColor: c.layer2,
      popoverColor: c.layer2,
      inputColor: c.layer1,
      inputColorDisabled: c.layer1,
      tableColor: c.layer1,
      tableHeaderColor: c.layer1,
      actionColor: c.layer1,
      tagColor: c.layer1,
      codeColor: c.layer1,
      tabColor: c.layer1,
      railColor: c.border,
      progressRailColor: c.border,

      borderColor: c.border,
      dividerColor: c.border,
      hoverColor: c.border,
      pressedColor: c.border,

      closeIconColor: c.text3,
      closeIconColorHover: c.text1,
      closeIconColorPressed: c.text1,
      closeColorHover: c.border,
      closeColorPressed: c.border,
      clearColor: c.text3,
      clearColorHover: c.text2,
      clearColorPressed: c.text1,

      scrollbarColor: c.border,
      scrollbarColorHover: c.text3,
      boxShadow1: SHADOW,
      boxShadow2: SHADOW,
      boxShadow3: SHADOW
    },

    Button: {
      textColor: c.text2,
      textColorHover: c.text1,
      textColorPressed: c.text1,
      textColorFocus: c.text1,
      textColorDisabled: c.text3,
      textColorText: c.text2,
      textColorTextHover: c.text1,
      textColorTextPressed: c.text1,
      textColorTextFocus: c.text1,
      textColorTextDisabled: c.text3,
      textColorGhost: c.text2,
      textColorGhostHover: c.text1,
      textColorGhostPressed: c.text1,
      textColorGhostFocus: c.text1,
      textColorGhostDisabled: c.text3,
      color: c.layer1,
      colorHover: c.layer2,
      colorPressed: c.layer2,
      colorFocus: c.layer2,
      colorDisabled: c.bg,
      colorPrimary: c.accent,
      colorHoverPrimary: c.accent,
      colorPressedPrimary: c.accent,
      colorFocusPrimary: c.accent,
      colorDisabledPrimary: c.bg,
      colorText: 'transparent',
      colorHoverText: c.border,
      colorPressedText: c.border,
      colorFocusText: c.border,
      colorDisabledText: 'transparent',
      colorGhost: 'transparent',
      colorHoverGhost: c.border,
      colorPressedGhost: c.border,
      colorFocusGhost: c.border,
      colorDisabledGhost: 'transparent',
      textColorPrimary: c.bg,
      textColorHoverPrimary: c.bg,
      textColorPressedPrimary: c.bg,
      textColorFocusPrimary: c.bg,
      textColorDisabledPrimary: c.text3,
      border: '0.5px solid ' + c.border,
      borderHover: '0.5px solid ' + c.border,
      borderPressed: '0.5px solid ' + c.border,
      borderFocus: '0.5px solid ' + c.accent,
      borderDisabled: '0.5px solid ' + c.border,
      borderPrimary: '0.5px solid ' + c.accent,
      borderHoverPrimary: '0.5px solid ' + c.accent,
      borderPressedPrimary: '0.5px solid ' + c.accent,
      borderFocusPrimary: '0.5px solid ' + c.accent,
      borderDisabledPrimary: '0.5px solid ' + c.border,
      borderText: 'none',
      borderGhost: 'none',
      borderRadiusTiny: RADIUS.sm,
      borderRadiusSmall: RADIUS.sm,
      borderRadius: RADIUS.sm,
      borderRadiusLarge: RADIUS.md,
      fontSizeSmall: FONT.small,
      fontSizeMedium: FONT.base,
      heightTiny: '24px',
      heightSmall: '28px',
      heightMedium: '32px',
      fontWeight: '500'
    },

    Input: {
      color: c.layer1,
      colorFocus: c.layer1,
      colorDisabled: c.bg,
      colorError: c.layer1,
      colorWarning: c.layer1,
      textColor: c.text1,
      textColorDisabled: c.text3,
      placeholderColor: c.text3,
      placeholderColorDisabled: c.text3,
      caretColor: c.accent,
      border: '0.5px solid ' + c.border,
      borderHover: '0.5px solid ' + c.text3,
      borderFocus: '0.5px solid ' + c.accent,
      borderDisabled: '0.5px solid ' + c.border,
      borderError: '0.5px solid ' + c.error,
      borderWarning: '0.5px solid ' + c.text3,
      boxShadowFocus: 'none',
      boxShadowError: 'none',
      boxShadowWarning: 'none',
      borderRadius: RADIUS.sm,
      fontSize: FONT.base,
      heightMedium: '32px',
      lineHeight: LINE
    },

    Modal: {
      color: c.layer2,
      textColor: c.text1,
      boxShadow: SHADOW,
      borderRadius: RADIUS.lg,
      fontSize: FONT.base,
      lineHeight: LINE,
      titleTextColor: c.text1,
      titleFontSize: FONT.base,
      titleFontWeight: '600',
      headerPadding: '16px 20px 10px',
      footerMargin: '16px 20px 0',
      iconMargin: '0 0 12px',
      closeIconColor: c.text3,
      closeIconColorHover: c.text1,
      closeIconColorPressed: c.text1,
      closeColorHover: c.border,
      closeColorPressed: c.border
    },

    Card: {
      color: c.glass,
      colorModal: c.layer2,
      colorPopover: c.layer2,
      colorTarget: c.layer1,
      colorEmbedded: c.layer1,
      textColor: c.text1,
      titleTextColor: c.text1,
      borderColor: c.border,
      borderColorModal: c.border,
      borderColorPopover: c.border,
      borderRadius: RADIUS.md,
      titleFontSize: FONT.base,
      titleFontWeight: '600',
      fontSize: FONT.base,
      lineHeight: LINE,
      paddingMedium: '14px 16px',
      boxShadow: 'none'
    },

    Dropdown: {
      color: c.glass,
      optionColorHover: c.border,
      optionColorPressed: c.border,
      optionColorActive: c.border,
      optionTextColor: c.text2,
      optionTextColorHover: c.text1,
      optionTextColorPressed: c.text1,
      optionTextColorActive: c.text1,
      optionTextColorChildActive: c.accent,
      optionTextColorChildActiveHover: c.accent,
      optionOpacityDisabled: '0.4',
      optionFontSize: FONT.base,
      optionHeightMedium: '30px',
      optionHeightSmall: '26px',
      optionHeightTiny: '22px',
      padding: '4px',
      borderRadius: RADIUS.md,
      dividerColor: c.border,
      labelColor: c.text3,
      labelFontSize: FONT.small,
      boxShadow: SHADOW
    },

    Tooltip: {
      color: c.layer2,
      textColor: c.text1,
      borderRadius: RADIUS.sm,
      boxShadow: SHADOW,
      padding: '5px 9px',
      fontSize: FONT.small
    },

    Popover: {
      color: c.glass,
      textColor: c.text1,
      borderRadius: RADIUS.md,
      boxShadow: SHADOW,
      fontSize: FONT.base,
      padding: '10px 12px',
      titleTextColor: c.text1,
      titleFontSize: FONT.base,
      titleFontWeight: '600',
      headerPadding: '8px 12px 0',
      closeIconColor: c.text3,
      closeIconColorHover: c.text1,
      closeColorHover: c.border
    },

    DataTable: {
      textColor: c.text2,
      tdColor: c.layer1,
      tdColorHover: c.layer2,
      tdColorStriped: c.layer1,
      tdColorSorting: c.layer2,
      tdTextColor: c.text2,
      thColor: c.layer1,
      thColorHover: c.layer2,
      thColorSorting: c.layer2,
      thTextColor: c.text1,
      thFontWeight: '600',
      thFontSize: FONT.small,
      borderColor: c.border,
      borderRadius: RADIUS.md,
      fontSize: FONT.base,
      thPaddingMedium: '8px 10px',
      tdPaddingMedium: '8px 10px'
    },

    Pagination: {
      itemColor: 'transparent',
      itemColorHover: c.border,
      itemColorPressed: c.border,
      itemColorActive: c.border,
      itemColorActiveHover: c.border,
      itemColorDisabled: 'transparent',
      itemTextColor: c.text2,
      itemTextColorHover: c.text1,
      itemTextColorPressed: c.text1,
      itemTextColorActive: c.text1,
      itemTextColorDisabled: c.text3,
      itemBorder: '0.5px solid ' + c.border,
      itemBorderActive: '0.5px solid ' + c.border,
      itemBorderRadius: RADIUS.sm,
      itemSize: '26px',
      itemFontSize: FONT.small,
      itemFontWeightActive: '600',
      jumperTextColor: c.text2,
      quickJumperColor: c.layer1
    },

    Tag: {
      borderRadius: RADIUS.sm,
      heightSmall: '20px',
      heightMedium: '24px',
      fontSizeSmall: FONT.small,
      fontSizeMedium: FONT.small,
      textColor: c.text2,
      color: c.layer1,
      borderWidth: '0.5px',
      border: '0.5px solid ' + c.border,
      textColorPrimary: c.accent,
      textColorSuccess: c.success,
      textColorError: c.error,
      colorPrimary: c.layer1,
      colorSuccess: c.layer1,
      colorError: c.layer1,
      borderPrimary: '0.5px solid ' + c.accent,
      borderSuccess: '0.5px solid ' + c.success,
      borderError: '0.5px solid ' + c.error
    },

    Switch: {
      railColor: c.border,
      railColorActive: c.accent,
      buttonColor: c.text1,
      boxShadow: 'none',
      buttonBoxShadow: 'none',
      railHeight: '18px',
      railWidth: '32px',
      buttonHeight: '14px',
      buttonWidth: '14px'
    },

    Checkbox: {
      size: '16px',
      color: 'transparent',
      colorChecked: c.accent,
      colorDisabled: 'transparent',
      colorDisabledChecked: c.border,
      border: '0.5px solid ' + c.text3,
      borderChecked: '0.5px solid ' + c.accent,
      borderDisabled: '0.5px solid ' + c.border,
      borderDisabledChecked: '0.5px solid ' + c.border,
      textColor: c.text1,
      textColorDisabled: c.text3,
      checkMarkColor: c.bg
    },

    Radio: {
      textColor: c.text1,
      textColorDisabled: c.text3,
      boxShadow: 'inset 0 0 0 0.5px ' + c.text3,
      boxShadowHover: 'inset 0 0 0 0.5px ' + c.text1,
      boxShadowActive: 'inset 0 0 0 0.5px ' + c.accent,
      boxShadowFocus: 'inset 0 0 0 0.5px ' + c.accent,
      boxShadowDisabled: 'inset 0 0 0 0.5px ' + c.border,
      color: 'transparent',
      colorDisabled: 'transparent',
      dotColorActive: c.accent,
      dotColorDisabled: c.border,
      buttonColor: c.layer1,
      buttonBorderColor: c.border,
      buttonTextColor: c.text2,
      buttonTextColorHover: c.text1,
      buttonColorActive: c.layer2,
      buttonTextColorActive: c.text1,
      buttonBorderColorActive: c.accent
    },

    Select: {
      menuColor: c.layer2,
      menuBoxShadow: SHADOW,
      menuBorderRadius: RADIUS.md,
      menuPadding: '4px',
      optionArrowColor: c.text3,
      optionHeightMedium: '30px',
      optionHeightSmall: '26px',
      optionHeightTiny: '22px',
      optionFontSize: FONT.base,
      optionTextColor: c.text2,
      optionTextColorActive: c.text1,
      optionTextColorPressed: c.text1,
      optionTextColorDisabled: c.text3,
      optionCheckMarkColor: c.accent,
      optionColorHover: c.border,
      optionColorPressed: c.border,
      optionColorActive: c.border,
      optionOpacityDisabled: '0.4'
    },

    Message: {
      color: c.layer2,
      colorInfo: c.layer2,
      colorSuccess: c.layer2,
      colorWarning: c.layer2,
      colorError: c.layer2,
      colorLoading: c.layer2,
      textColor: c.text1,
      textColorInfo: c.text1,
      textColorSuccess: c.text1,
      textColorWarning: c.text1,
      textColorError: c.text1,
      textColorLoading: c.text1,
      iconColorInfo: c.accent,
      iconColorSuccess: c.success,
      iconColorWarning: c.text2,
      iconColorError: c.error,
      boxShadow: SHADOW,
      borderRadius: RADIUS.sm,
      fontSize: FONT.base,
      padding: '10px 14px',
      closeIconColor: c.text3,
      closeIconColorHover: c.text1,
      closeColorHover: c.border
    }
  }
}

export const darkOverrides = buildOverrides(DARK)
export const lightOverrides = buildOverrides(LIGHT)

const DARK_THEME = Object.freeze({ dark: true, overrides: darkOverrides })
const LIGHT_THEME = Object.freeze({ dark: false, overrides: lightOverrides })

function readDshDark() {
  if (typeof document === 'undefined') return true
  const root = document.documentElement
  const flag = root && root.dataset ? root.dataset.nsDark : null
  return flag === '1' || flag === 'true'
}

/* 返回 computed<{ dark, overrides }>：:theme（darkTheme | null）与 :theme-overrides
 * 都从这一个 computed 派生，保证两者永远同源。 */
export function useDshOverrides() {
  const dark = ref(readDshDark())
  const sync = () => { dark.value = readDshDark() }

  let observer = null
  if (typeof window !== 'undefined') {
    window.addEventListener('ns-theme-changed', sync)
    if (typeof MutationObserver === 'function' && typeof document !== 'undefined' && document.documentElement) {
      observer = new MutationObserver(sync)
      observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-ns-dark'] })
    }
  }
  if (onScopeDispose) {
    onScopeDispose(() => {
      if (typeof window !== 'undefined') window.removeEventListener('ns-theme-changed', sync)
      if (observer) { observer.disconnect(); observer = null }
    })
  }

  return computed(() => (dark.value ? DARK_THEME : LIGHT_THEME))
}
