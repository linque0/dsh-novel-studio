<script setup>
import { computed } from 'vue'
import { entryWeightMeta } from '../services/lore-weights.js'

const props = defineProps({
  weight: { type: String, default: 'standard' },
  size: { type: Number, default: 12 }
})

const meta = computed(() => entryWeightMeta(props.weight))
</script>

<template>
  <svg
    class="lore-weight-icon"
    :class="`is-${meta.id}`"
    :width="size"
    :height="size"
    viewBox="0 0 16 16"
    fill="none"
    aria-hidden="true"
  >
    <!-- 核心：长十字星芒 + 深底四芒外廓 + 空心菱核 -->
    <template v-if="meta.id === 'core'">
      <path d="M8 .6V15.4M.6 8H15.4" stroke="var(--lw-cyan, #47D7E8)" stroke-width="1" opacity=".86" />
      <path
        d="M8 2.1L9.8 6.2L13.9 8L9.8 9.8L8 13.9L6.2 9.8L2.1 8L6.2 6.2Z"
        fill="var(--lw-core-fill, #04070D)"
        stroke="var(--lw-white, #EAF3FF)"
        stroke-width="1.15"
      />
      <path d="M8 5.4L10.6 8L8 10.6L5.4 8Z" stroke="var(--lw-cyan, #47D7E8)" stroke-width="1" />
    </template>

    <!-- 关键：圆形球核 + -26° 倾斜细椭圆环 + 左上弦月 + 伴星点 -->
    <template v-else-if="meta.id === 'key'">
      <ellipse
        cx="8"
        cy="8"
        rx="6.8"
        ry="2.2"
        transform="rotate(-26 8 8)"
        stroke="var(--lw-cyan, #47D7E8)"
        stroke-width="1.15"
      />
      <circle
        cx="8"
        cy="8"
        r="3.8"
        fill="var(--lw-core-fill, #060E1C)"
        stroke="var(--lw-dim, rgba(159, 180, 204, 0.52))"
        stroke-width=".85"
      />
      <path d="M4.7 9.2A3.8 3.8 0 0 1 9.6 4.4A3.1 3.1 0 0 0 4.7 9.2Z" fill="var(--lw-white, #EAF3FF)" />
      <circle cx="13.2" cy="5.8" r="1.25" fill="var(--lw-white, #EAF3FF)" />
    </template>

    <!-- 标准：双切面实心竖菱形 -->
    <template v-else-if="meta.id === 'standard'">
      <path d="M8 2.0V14.0L3.9 8Z" fill="var(--lw-white, #EAF3FF)" />
      <path d="M8 2.0L12.1 8L8 14.0Z" fill="var(--lw-cyan-soft, #5CE1F2)" opacity=".50" />
      <path d="M8 2.0L12.1 8L8 14.0L3.9 8Z" stroke="var(--lw-white, #EAF3FF)" stroke-width=".95" />
    </template>

    <!-- 点缀：±28° 交叉双细菱 + 中心亮星点 -->
    <template v-else-if="meta.id === 'accent'">
      <path
        d="M8 1.9L9.8 8L8 14.1L6.2 8Z"
        transform="rotate(-28 8 8)"
        fill="var(--lw-violet, #8C7BFF)"
        fill-opacity=".42"
        stroke="var(--lw-moon, #96B6FF)"
        stroke-width=".95"
      />
      <path
        d="M8 1.9L9.8 8L8 14.1L6.2 8Z"
        transform="rotate(28 8 8)"
        fill="var(--lw-white, #EAF3FF)"
        fill-opacity=".55"
        stroke="var(--lw-white, #EAF3FF)"
        stroke-width=".95"
      />
      <path d="M8 6.1L9.9 8L8 9.9L6.1 8Z" fill="var(--lw-white, #FFFFFF)" />
    </template>

    <!-- 末节：方案 N · 两段 180° 错位 75° 细旋弧 + 中心针尖圆点 -->
    <template v-else>
      <path d="M3.4 6.4A4.9 4.9 0 0 1 9.6 3.4" stroke="var(--lw-white, #EAF3FF)" stroke-width="1.25" stroke-linecap="round" />
      <path d="M12.6 9.6A4.9 4.9 0 0 1 6.4 12.6" stroke="var(--lw-cyan, #47D7E8)" stroke-width="1.25" stroke-linecap="round" />
      <circle cx="8" cy="8" r="1.8" fill="var(--lw-white, #FFFFFF)" />
    </template>
  </svg>
</template>
