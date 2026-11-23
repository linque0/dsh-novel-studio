<!--
  FlowTransitionOverlay.vue — 挂载于 body 的全屏流体转场画布覆盖层，驱动页面切换液态过渡动效。
-->
<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { flowTransition } from '../services/latent/flow-transition.js'
import { createLiquidTransition } from '../services/latent/liquid-transition.js'

const props = defineProps({ scene: { type: Object, default: null } })
const canvas = ref(null)
let animation
let detach

onMounted(() => {
  animation = createLiquidTransition(canvas.value, () => props.scene)
  detach = flowTransition.attach(animation.prepare)
})

onBeforeUnmount(() => {
  detach?.()
  animation?.dispose()
})
</script>

<template>
  <Teleport to="body">
    <canvas ref="canvas" class="flow-liquid-overlay" aria-hidden="true" hidden />
  </Teleport>
</template>

<style scoped>
.flow-liquid-overlay {
  position: fixed;
  box-sizing: content-box;
  border: 0;
  z-index: 9999;
  pointer-events: none;
}
</style>
