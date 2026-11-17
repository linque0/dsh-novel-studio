<script setup>
import { computed, shallowRef, watch } from 'vue'
import { db } from '../../../db/database'
import { useWorkStore } from '../../../stores/work'
import LorePlanetNetwork from './LorePlanetNetwork.vue'
import { lorePlanetData } from './lore-planet-data.js'
import { withOrbitSpacingReference } from './planet-scene.js'

defineProps({ location: { type: Object, required: true } })
const emit = defineEmits(['open-entry', 'open-target', 'edit-relations', 'navigate', 'heading'])
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
  function save(update) {
    return db.transaction('rw', db.appconfig, async () => {
      const previous = (await db.appconfig.get(key))?.value || {}
      await db.appconfig.put({ key, value: JSON.parse(JSON.stringify(update(previous))) })
    })
  }
  preferences.value = {
    initialPositions, initialSpacing, initialOrbitSettings,
    initialCenterGlow: saved?.centerGlow || {},
    initialEntryRadii: saved?.entryRadii || {},
    initialPlanetSizes: saved?.planetSizes || {},
    onLayoutChange: positions => save(previous => ({ ...previous, positions })),
    onSpacingChange: (spacing, systemId) => save(previous => {
      const settings = previous.orbitSettings?.[systemId]
      if (!settings) return { ...previous, spacing }
      const anchored = withOrbitSpacingReference(settings, previous.spacing?.[systemId])
      if (anchored === settings) return { ...previous, spacing }
      return { ...previous, spacing, orbitSettings: { ...previous.orbitSettings, [systemId]: anchored } }
    }),
    onOrbitSettingsChange: orbitSettings => save(previous => ({ ...previous, orbitSettings })),
    onPlanetSizeChange: (planetId, size) => save(previous => {
      const planetSizes = { ...previous.planetSizes }
      if (size === null) delete planetSizes[planetId]
      else planetSizes[planetId] = size
      return { ...previous, planetSizes }
    }),
    onEntryRadiusChange: (entryId, radius) => save(previous => {
      const entryRadii = { ...previous.entryRadii }
      if (radius === null) delete entryRadii[entryId]
      else entryRadii[entryId] = radius
      return { ...previous, entryRadii }
    }),
    onCenterGlowChange: (centerId, value) => save(previous => {
      const centerGlow = { ...previous.centerGlow }
      if (value) centerGlow[centerId] = value
      else delete centerGlow[centerId]
      return { ...previous, centerGlow }
    })
  }
}, { immediate: true })
</script>

<template>
  <LorePlanetNetwork v-if="preferences" :key="workId" embedded v-bind="{ ...data, ...preferences }"
    :work-title="work.work?.title" :location="location"
    @open-entry="emit('open-entry', $event)" @open-target="emit('open-target', $event)"
    @edit-relations="emit('edit-relations', $event)" @navigate="emit('navigate', $event)" @heading="emit('heading', $event)" />
</template>
