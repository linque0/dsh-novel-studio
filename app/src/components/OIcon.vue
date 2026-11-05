<!-- OIcon 内联 SVG 图标（美化方案 §6.9）：24 viewBox / 1.5px 描边 / 圆帽圆角 / 继承 currentColor；
     emoji 与字符图标退出交互位的统一替代。用法：<OIcon name="search" :size="14" /> -->
<script setup>
import { computed } from 'vue'

const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 16 }
})

const ICONS = {
  manuscript: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8 7h8M8 11h8M8 15h5"/>',
  network: '<rect x="3" y="3" width="6" height="5" rx="1"/><rect x="15" y="3" width="6" height="5" rx="1"/><rect x="9" y="16" width="6" height="5" rx="1"/><path d="M6 8v4h12V8M12 12v4"/>',
  layers: '<path d="M3 7l9-5 9 5-9 5zM3 12l9 5 9-5M3 17l9 5 9-5"/>',
  sparkle: '<path d="M12 2l2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5z"/>',
  back: '<path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  split: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M12 4v16"/>',
  download: '<path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/>',
  upload: '<path d="M12 15V3"/><path d="M7 8l5-5 5 5"/><path d="M4 21h16"/>',
  stats: '<path d="M5 20v-8"/><path d="M12 20V6"/><path d="M19 20v-5"/><path d="M3 20h18"/>',
  trash: '<path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/>',
  bookmark: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  history: '<path d="M3 11a9 9 0 1 1 2.6 7.4"/><path d="M3 4v7h7"/><path d="M12 7v5l3 2"/>',
  'bookmark-filled': '<path fill="currentColor" stroke="none" d="M6 3h12v18l-6-4-6 4z"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  close: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  edit: '<path d="M17 3l4 4L7 21H3v-4z"/><path d="M14 6l4 4"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2v.8a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.8a2 2 0 0 0-1.1-1.8l-1.8-.9a2 2 0 0 1-1.1-1.8V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1z"/>',
  tag: '<path d="M12.6 2.6A2 2 0 0 0 11.2 2H4a2 2 0 0 0-2 2v7.2a2 2 0 0 0 .6 1.4l8.7 8.7a2.4 2.4 0 0 0 3.4 0l6.6-6.6a2.4 2.4 0 0 0 0-3.4z"/><circle cx="7.5" cy="7.5" r="1"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  'caret-right': '<path d="M9 6l6 6-6 6"/>',
  'caret-down': '<path d="M6 9l6 6 6-6"/>',
  'arrow-right': '<path d="M5 12h14"/><path d="M12 5l7 7-7 7"/>',
  'arrow-up': '<path d="M12 19V5"/><path d="M5 12l7-7 7 7"/>',
  shape: '<path d="M12 3l8 9-8 9-8-9z"/>',
  diamond: '<path d="M12 3l8 9-8 9-8-9z"/>',
  note: '<path d="M4 4h16v12l-4 4H4z"/><path d="M16 20v-4h4"/><path d="M8 9h8"/><path d="M8 13h5"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7.1-7.1l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7.1 7.1l1.7-1.7"/>',
  textbox: '<rect x="3" y="6" width="18" height="12" rx="1.5"/><path d="M7 10h10"/><path d="M7 14h7"/>',
  container: '<path d="M4 8h16v12H4z"/><path d="M4 8l2-4h12l2 4"/><path d="M10 12h4"/>',
  flag: '<path d="M5 21V4"/><path d="M5 4h13l-3 4 3 4H5"/>',
  rows: '<path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/>',
  anchor: '<circle cx="12" cy="5" r="3"/><path d="M12 8v13"/><path d="M5 12H3a9 9 0 0 0 18 0h-2"/>',
  image: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5L5 21"/>',
  books: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="M4.9 4.9l1.4 1.4"/><path d="M17.7 17.7l1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M4.9 19.1l1.4-1.4"/><path d="M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
  'circle-layout': '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/>',
  star: '<path d="M12 3l2.7 5.4 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L3.3 9.3l6-.9z"/>',
  'star-filled': '<path fill="currentColor" stroke="none" d="M12 3l2.7 5.4 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L3.3 9.3l6-.9z"/>',
  fit: '<path d="M4 9V4h5"/><path d="M15 4h5v5"/><path d="M20 15v5h-5"/><path d="M9 20H4v-5"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M20 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h6"/>',
  'map-pin': '<path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  landmark: '<path d="M3 21h18"/><path d="M5 21V11"/><path d="M9.6 21V11"/><path d="M14.4 21V11"/><path d="M19 21V11"/><path d="M12 3l9 5H3z"/>',
  megaphone: '<path d="M3 11v2a1 1 0 0 0 1 1h2l9 5V5L6 10H4a1 1 0 0 0-1 1z"/><path d="M18 9.5a4 4 0 0 1 0 5"/>',
  user: '<circle cx="12" cy="8" r="3.6"/><path d="M5 20c1.2-4 3.6-5.8 7-5.8s5.8 1.8 7 5.8"/>'
}
const body = computed(() => ICONS[props.name] || '')
</script>

<template>
  <svg
    class="oicon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    v-html="body"
  ></svg>
</template>

<style>
.oicon {
  flex: none;
  vertical-align: -0.18em;
}
</style>
