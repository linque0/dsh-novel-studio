<script setup>
import { outlineGlyphs } from './outline-glyphs.js'
defineProps({name:{type:String,default:'event'},size:{type:Number,default:18}})
</script>
<template><svg class="icon" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="outlineGlyphs[name]||outlineGlyphs.event"></svg></template>
