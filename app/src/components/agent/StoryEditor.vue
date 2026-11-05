<script setup>
import {watch,onBeforeUnmount,ref} from 'vue'
import {useEditor,EditorContent} from '@tiptap/vue-3'
import {storyExtensions} from '../../services/story-richtext.js'
import DOMPurify from 'dompurify'
import {useStoryStore} from '../../stores/story.js'
import {normalizeText} from '../../services/project/text.js'
const story=useStoryStore(),localError=ref('')
const editor=useEditor({extensions:storyExtensions(),content:DOMPurify.sanitize(story.active?.html||'<p></p>'),editorProps:{attributes:{class:'story-prose',role:'textbox','aria-label':'故事工作稿','aria-multiline':'true',spellcheck:'false'}},onUpdate:({editor:e})=>{
  try{const html=DOMPurify.sanitize(e.getHTML());story.edit({html,text:normalizeText(html,'html')});localError.value=''}catch(e){localError.value=e.message}
}})
watch(()=>[story.active?.id,story.active?.revision,story.active?.html],()=>{
  const e=editor.value,doc=story.active
  if(e&&doc&&e.getHTML()!==doc.html)e.commands.setContent(DOMPurify.sanitize(doc.html),false)
})
watch(()=>story.readOnly,locked=>editor.value?.setEditable(!locked),{immediate:true})
watch(editor,e=>e?.setEditable(!story.readOnly))
onBeforeUnmount(()=>editor.value?.destroy())
</script>
<template>
  <div class="story-editor">
    <div class="story-edit-tools" aria-label="正文编辑工具"><span>{{story.readOnly&&!story.busy?'其他窗口正在编辑':'当前工作稿'}}</span><button title="加粗" aria-label="加粗" :disabled="story.readOnly" @mousedown.prevent @click="editor?.chain().focus().toggleBold().run()"><b>B</b></button><button title="斜体" aria-label="斜体" :disabled="story.readOnly" @mousedown.prevent @click="editor?.chain().focus().toggleItalic().run()"><i>I</i></button><button :disabled="story.readOnly||!editor?.can().undo()" @click="editor?.chain().focus().undo().run()">撤销</button><span class="story-word-count">{{story.active?.text.replace(/\s/g,'').length||0}} 字 · 自动保存</span></div>
    <EditorContent :editor="editor" />
    <p v-if="localError" role="alert">{{localError}}</p>
  </div>
</template>
<style>
.story-editor{height:100%;min-height:0;display:flex;flex-direction:column;color:inherit}.story-edit-tools{display:flex;align-items:center;gap:12px;font:13px/1.5 sans-serif;padding:10px 0 16px;color:var(--story-muted,var(--text-dim));flex-shrink:0}.story-edit-tools button{color:inherit;background:transparent;border:0;padding:4px 7px;cursor:pointer}.story-edit-tools button:disabled{opacity:.35;cursor:default}.story-word-count{margin-left:auto}.story-editor>.tiptap,.story-editor>div:has(>.tiptap){flex:1;min-height:0}.story-prose{outline:none;font:18px/2.05 'Noto Serif SC','Microsoft YaHei',serif;min-height:250px;color:inherit;overflow-wrap:anywhere}.story-prose p{margin:0 0 1.3em}.story-prose blockquote{border-left:2px solid currentColor;padding-left:1em;margin-left:0;opacity:.85}.story-editor .ProseMirror-focused{outline:none}.story-prose h1,.story-prose h2,.story-prose h3{line-height:1.6}.story-prose::selection{background:#b9a16e55}
</style>
