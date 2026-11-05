<script setup>
// 桥接 naive-ui 的 message / dialog 到全局，便于非组件模块调用
import { useMessage, useDialog } from 'naive-ui'
const msg = useMessage()
const dlg = useDialog()
window.$msg = msg
window.$dlg = dlg
</script>

<template>
  <span style="display: none"></span>
</template>
