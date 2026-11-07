<script setup>defineProps({items:Array})</script>
<template><div class="metric-band"><div v-for="m in items" :key="m.label" class="metric" :data-stat="m.key"><span>{{m.label}}</span><b :class="m.negative?'loss':m.accent?'accent':''">{{m.value}}</b><small v-if="m.unit">{{m.unit}}</small></div></div></template>
