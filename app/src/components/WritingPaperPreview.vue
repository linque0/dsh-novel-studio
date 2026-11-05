<script setup>
import {computed} from 'vue'
import {useUiStore} from '../stores/ui'
import {WRITING_PAPERS} from '../services/writing-paper.js'
import '../styles/writing-paper.css'
const ui=useUiStore(),paper=computed(()=>WRITING_PAPERS.find(p=>p.id===ui.writingPaperStyle))
</script>
<template>
  <aside class="writing-paper-preview" :data-paper-skin="ui.skin" :data-paper-theme="ui.theme" :data-writing-paper="ui.writingPaperStyle" aria-label="正文纸面与字体预览">
    <div class="writing-paper-surface paper-preview-page"><div class="paper-preview-running"><span>排版预览</span><span>01</span></div><h2>第一章 · 初雪</h2><div class="paper-preview-copy" :style="{fontFamily:'var(--editor-font)',fontSize:ui.fontSize+'px'}"><p>穹顶大厅的钟声在雾中回荡了十二下。窗外的雪落得很轻。</p><p>她翻开手边的书，故事便有了新的开始。</p></div><footer>{{paper?.label}}</footer></div>
  </aside>
</template>
