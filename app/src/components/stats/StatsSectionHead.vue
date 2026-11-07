<script setup>defineProps({kicker:String,title:String,note:String})</script>
<template><div class="section-head"><div><div v-if="kicker" class="micro">{{kicker}}</div><h2>{{title}}</h2><p v-if="note">{{note}}</p></div><slot/></div></template>
