<script setup>
import { computed, shallowRef, watch } from 'vue'
import { db } from '../../../db/database'
import { useWorkStore } from '../../../stores/work'
import LorePlanetNetwork from './LorePlanetNetwork.vue'
import { lorePlanetData } from './lore-planet-data.js'

const emit = defineEmits(['open-entry', 'open-target', 'edit-relations', 'select'])
const work = useWorkStore()
const data = computed(() => lorePlanetData(work.liveMubu(), work.liveLoreLinks, work.liveCharacters))
const workId = computed(() => work.work?.id)
const preferences = shallowRef(null)

watch(workId, async (id, _previous, onCleanup) => {
  preferences.value = null
  if (!id) return
  let current = true
  onCleanup(() => { current = false })
  const key = 'loreGalaxy:' + id
  let saved
  try { saved = (await db.appconfig.get(key))?.value } catch { /* Use automatic layout when storage is unavailable. */ }
  if (!current) return
  const initialPositions = saved?.positions || {}
  const initialSpacing = saved?.spacing || {}
  const initialOrbitSettings = saved?.orbitSettings || {}
  let state = { positions: initialPositions, spacing: initialSpacing, orbitSettings: initialOrbitSettings }
  function save(patch) {
    state = { ...state, ...patch }
    return db.appconfig.put({ key, value: JSON.parse(JSON.stringify(state)) })
  }
  preferences.value = {
    initialPositions, initialSpacing, initialOrbitSettings,
    onLayoutChange: positions => save({ positions }),
    onSpacingChange: spacing => save({ spacing }),
    onOrbitSettingsChange: orbitSettings => save({ orbitSettings })
  }
}, { immediate: true })
</script>

<template>
  <LorePlanetNetwork v-if="preferences" :key="workId" embedded v-bind="{ ...data, ...preferences }"
    :work-title="work.work?.title"
    @open-entry="emit('open-entry', $event)" @open-target="emit('open-target', $event)"
    @edit-relations="emit('edit-relations', $event)" @select="emit('select', $event)" />
</template>
