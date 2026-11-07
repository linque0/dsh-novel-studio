<script setup>
/* 设置面板窗口壳：界面本体由 SettingsWorkspace 提供，与主窗口共用同一份，
 * 这里只给一个纵向弹性容器——面板窗口的根是 flex 列，
 * 外壳要拿满高度（flex:1 + min-height:0），否则 .settings-shell 之外会留一条空白带。
 * 旧版 .sw-* 布局与 <style scoped> 整块随总稿改版删除：样式全在 plugin/dsh/settings-fusion.css。 */
import SettingsWorkspace from './settings/SettingsWorkspace.vue'
</script>

<template>
  <div style="flex: 1; min-height: 0; min-width: 0; display: flex; flex-direction: column">
    <SettingsWorkspace />
  </div>
</template>
