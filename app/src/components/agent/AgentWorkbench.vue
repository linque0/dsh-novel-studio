<script setup>
import {ref,watch} from 'vue'
import {useUiStore} from '../../stores/ui.js'
import LegacyAgentWorkbench from './LegacyAgentWorkbench.vue'
import StoryScene from './StoryScene.vue'
const advanced=ref(false)
const ui=useUiStore()
watch(()=>ui.workbenchMode,mode=>{if(mode==='agent')advanced.value=false})
</script>
<template>
  <div class="agent-surface">
    <StoryScene v-show="!advanced" @advanced="advanced=true" />
    <div v-show="advanced" class="agent-legacy-surface"><button class="story-return" @click="advanced=false">← 返回故事现场</button><LegacyAgentWorkbench /></div>
  </div>
</template>
<style scoped>.agent-surface,.agent-legacy-surface{height:100%;min-height:0}.agent-legacy-surface{position:relative}.story-return{position:absolute;right:18px;bottom:12px;z-index:8;background:#263a3c;color:#fff;border:1px solid #9badad;border-radius:5px;padding:9px 15px;cursor:pointer}</style>
