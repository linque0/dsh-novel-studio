<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef, watch } from 'vue'
import { Vector3 } from 'three'
import { clamp, ease, localPosition, networkModel, orbitPoint, planetSizeValue, rotation, scaleOrbitRadius, spacePlanets, spacingValue, TUNING, withOrbitSpacingReference } from './planet-scene.js'
import { paintNetwork } from './draw-planets.js'
import PlanetSizeControl from './PlanetSizeControl.vue'
import { advanceCenterGlow, CENTER_GLOW_COLOR_MODES, CENTER_GLOW_EFFECTS, hasCenterColorModes, normalizeCenterGlow } from './center-glow.js'
import { entryCircleScale, entryReferenceRadius, MIN_ENTRY_RADIUS } from './entry-circles.js'
import './planet-network.css'

const props = defineProps({
  sets: { type: Array, required: true }, nodes: { type: Array, required: true },
  links: { type: Array, required: true }, initialPositions: { type: Object, default: () => ({}) },
  workTitle: { type: String, default: '未命名作品' },
  satellites: { type: Array, default: () => [] },
  initialSpacing: { type: Object, default: () => ({}) },
  initialOrbitSettings: { type: Object, default: () => ({}) },
  initialCenterGlow: { type: Object, default: () => ({}) },
  initialEntryRadii: { type: Object, default: () => ({}) },
  initialPlanetSizes: { type: Object, default: () => ({}) },
  embedded: Boolean,
  location: { type: Object, required: true },
  onLayoutChange: Function, onSpacingChange: Function, onOpenEntry: Function,
  onOpenTarget: Function, onEditRelations: Function, onOrbitSettingsChange: Function,
  onCenterGlowChange: Function, onEntryRadiusChange: Function, onPlanetSizeChange: Function
})
const emit = defineEmits(['open-entry', 'open-target', 'edit-relations', 'navigate', 'heading'])
const model = computed(() => networkModel(props.sets, props.nodes, props.links, props.satellites))
const satelliteId = ref('')
const satellite = computed(() => model.value.bySatellite.get(satelliteId.value))
const positions = shallowRef(props.initialPositions)
const framingPositions = shallowRef(props.initialPositions)
const entryRadii = shallowRef(props.initialEntryRadii)
const planetSizes = shallowRef(props.initialPlanetSizes)
const entryResize = shallowRef(null)
const spacingBySystem = shallowRef(props.initialSpacing)
const orbitSettings = shallowRef(props.initialOrbitSettings)
const layoutOpen = ref(false), layoutButton = ref(null)
const orbitEditing = ref(false), activeOrbit = ref('')
const orbitPreview = shallowRef(null)
const hoverOrbit = ref('')
const speedMenu = ref(null)
const speedPanel = ref(null)
const stage = ref(null), canvas = ref(null)
const setId = ref(''), nodeId = ref(''), bridgeId = ref('')
const centerMenu = ref(null), centerPanel = ref(null)
const centerGlowSettings = shallowRef(props.initialCenterGlow)
const centerSaveErrors = shallowRef({})
const centerSaves = new Map()
const centerGlow = computed(() => normalizeCenterGlow(centerGlowSettings.value[setId.value]))
let centerGlowTime = 0
const reduced = ref(false), zoom = ref(1)
const entryPreview = ref(false), status = ref(''), dragActive = ref(false)
const spacing = computed(() => spacingValue(spacingBySystem.value[setId.value]))
const currentOrbitSettings = computed(() =>
  withOrbitSpacingReference(orbitSettings.value[setId.value] || {}, props.initialSpacing[setId.value]))
const referenceSpacing = computed(() => currentOrbitSettings.value.spacingReference ?? 100)
function layoutSystem(orbitSpacing) {
  const current = model.value.system(setId.value)
  return {
    ...current,
    planets: spacePlanets(current.planets, framingPositions.value, orbitSpacing, currentOrbitSettings.value)
  }
}
const referenceSystem = computed(() => layoutSystem(referenceSpacing.value))
const system = computed(() => spacing.value === referenceSpacing.value ? referenceSystem.value : layoutSystem(spacing.value))
const activeTrack = computed(() => system.value.planets.find(body => body.orbitId === activeOrbit.value))
const activeSet = computed(() => system.value.center)
const selected = computed(() => model.value.byBody.get(nodeId.value))
const relationOwner = computed(() => selected.value || activeSet.value)
const bridge = computed(() => system.value.bridges.find(item => item.id === bridgeId.value))
const activeLinks = computed(() => selected.value?.links || bridge.value?.links || [])
const canEditDepth = computed(() => selected.value && system.value.planets.some(body =>
  body.id === selected.value.parent?.id))
const internalCount = computed(() => system.value.routes.reduce((count, route) =>
  count + (route.from && route.to ? route.links.length : 0), 0))
function ancestors(item) {
  const path = []
  for (let parent = item?.parent; parent; parent = parent.parent) path.unshift(parent)
  return path
}
const breadcrumb = computed(() => ancestors(activeSet.value))
const heading = computed(() => {
  const center = activeSet.value
  const path = center ? [...breadcrumb.value, center] : []
  const stats = center
    ? `${center.entries.length} 个直属条目 · ${internalCount.value} 条可见关系`
    : `${system.value.planets.length} 个设定集 · ${model.value.byNode.size} 个条目 · ${system.value.bridges.filter(item => !item.withinBody).length} 组跨集关系`
  return { path: path.map(({id, title}) => ({ id, title })), title: center?.title || '设定集总览', stats }
})
const depth = computed(() => canEditDepth.value ? localPosition(selected.value, positions.value).length() : TUNING.detailRadius)
const overviewView = () => rotation(.24, -.15)
const flightDuration = 560
const scene = { view: overviewView(), zoom: 1, time: 0, pan: new Vector3(), offset: new Vector3() }
const hoverLabel = ref(null)
const poses = new Map()
const names = new Map()
let motionPhases = new Map()
watch(system, (next, previous) => {
  if (next.center?.id !== previous.center?.id) return
  const before = new Map(previous.planets.map(body => [body.id, body]))
  for (const body of next.planets) {
    const old = before.get(body.id)
    if (!old) continue
    const phase = motionPhases.get(body.id) || { orbit: 0, spin: 0 }
    motionPhases.set(body.id, {
      orbit: phase.orbit + old.orbitPhase - body.orbitPhase + (old.orbitSpeed - body.orbitSpeed) * scene.time,
      spin: phase.spin + (old.spinSpeed - body.spinSpeed) * scene.time
    })
  }
}, { flush: 'sync' })
let tween = null, glide = null, lastClick = null
let ctx, observer, motion, frame, painted, gesture, previousFrame
let flight = null
let orbitFraming = null
let size = { width: 0, height: 0 }, hoverId = '', lastFrame = 0
let idleSince = performance.now(), idleSpeed = 0
const pointers = new Map()

function draw() {
  if (!ctx || !size.width || !size.height) return
  const now = performance.now()
  const progress = flight ? clamp((now - flight.start) / flightDuration, 0, 1) : 1
  const arrival = ease(clamp((progress - .46) / .54, 0, 1))
  const camera = flight ? {
    ...scene,
    entryZoom: scene.zoom,
    zoom: scene.zoom * (.83 + .17 * arrival),
    pan: scene.pan.clone().multiplyScalar(arrival),
    offset: scene.offset.clone().multiplyScalar(arrival)
  } : scene
  const data = system.value
  const preview = orbitPreview.value
  const display = preview ? {
    ...data, planets: data.planets.map(body => body.orbitId === activeOrbit.value
      ? { ...body, orbitRadius: preview.radius } : body)
  } : data
  painted = paintNetwork(ctx, size, display, camera, {
    positions: positions.value, framingPositions: framingPositions.value, names,
    entryRadii: entryRadii.value, entryResize: entryResize.value,
    planetSizes: planetSizes.value, planetSettingsId: speedMenu.value?.body.id,
    nodeId: nodeId.value, bridgeId: bridgeId.value, hoverId,
    workTitle: props.workTitle, reduced: reduced.value, satelliteId: satelliteId.value,
    centerGlow: centerGlow.value, centerGlowTime,
    motionPhases, orbitEditing: orbitEditing.value, activeOrbit: orbitEditing.value ? activeOrbit.value : '',
    hoverOrbit: orbitEditing.value ? hoverOrbit.value : '',
    mergeOrbit: preview?.target, framingData: orbitFraming,
    spacingFramingData: spacing.value === referenceSpacing.value ? null : referenceSystem.value
  })
  if (previousFrame && flight) {
    const { x, y, scale } = flight
    const approach = clamp(progress / .78, 0, 1)
    const focus = approach ** 2 * (3 - 2 * approach)
    const magnify = Math.exp(Math.log(scale) * approach ** 1.65)
    const shiftX = (size.width / 2 - x) * focus + x * (1 - magnify)
    const shiftY = (size.height / 2 - y) * focus + y * (1 - magnify)
    ctx.globalAlpha = 1 - ease(clamp((progress - .48) / .42, 0, 1))
    ctx.drawImage(previousFrame, shiftX, shiftY, size.width * magnify, size.height * magnify)
    ctx.globalAlpha = 1
  } else if (previousFrame && tween) {
    ctx.globalAlpha = 1 - ease(clamp((now - tween.start) / TUNING.transition, 0, 1))
    ctx.drawImage(previousFrame, 0, 0, size.width, size.height)
    ctx.globalAlpha = 1
  }
}

function measure() {
  const { clientWidth: width, clientHeight: height } = stage.value
  if ((gesture?.kind === 'orbit' || gesture?.kind === 'resize') && (width !== size.width || height !== size.height)) cancelGesture()
  if (flight && (width !== size.width || height !== size.height)) interact()
  const ratio = Math.min(devicePixelRatio || 1, 2)
  size = { width, height }
  canvas.value.width = Math.round(width * ratio)
  canvas.value.height = Math.round(height * ratio)
  ctx?.setTransform(ratio, 0, 0, ratio, 0, 0)
  positionSpeedMenu()
  positionCenterMenu()
  draw()
}

function interact() {
  idleSince = performance.now()
  idleSpeed = 0
  tween = null
  glide = null
  previousFrame = null
  flight = null
}

function animate(now) {
  const dt = Math.min(40, lastFrame ? now - lastFrame : 0)
  lastFrame = now
  if (flight) {
    if (now - flight.start >= flightDuration) {
      flight = previousFrame = null
      idleSince = now
    }
    draw()
  } else if (tween) {
    const progress = clamp((now - tween.start) / TUNING.transition, 0, 1)
    scene.view.copy(tween.from).slerp(tween.to, ease(progress))
    scene.pan.copy(tween.panFrom).lerp(tween.panTo, ease(progress))
    scene.zoom = tween.zoomFrom + (tween.zoomTo - tween.zoomFrom) * ease(progress)
    if (progress >= 1) { tween = null; previousFrame = null }
    draw()
  } else if (glide) {
    turn(glide.x * dt, glide.y * dt)
    const decay = Math.exp(-dt / 115)
    glide.x *= decay
    glide.y *= decay
    if (Math.hypot(glide.x, glide.y) < .008) glide = null
    draw()
  } else if (centerMenu.value && !reduced.value && !document.hidden && centerGlow.value.speed > 0) {
    centerGlowTime = advanceCenterGlow(centerGlowTime, dt, centerGlow.value.speed)
    draw()
  } else if (!reduced.value && !pointers.size && !layoutOpen.value && !orbitEditing.value && !speedMenu.value && !centerMenu.value
      && !document.hidden && now - idleSince >= TUNING.idleDelay) {
    idleSpeed = Math.min(1, idleSpeed + dt / 1100)
    const step = dt * idleSpeed
    scene.time += step
    centerGlowTime = advanceCenterGlow(centerGlowTime, step, centerGlow.value.speed)
    draw()
  }
  frame = requestAnimationFrame(animate)
}

function cameraTo(view, scale, fromScale = scene.zoom, pan = scene.pan.clone()) {
  zoom.value = scale
  if (reduced.value || document.hidden) {
    scene.view.copy(view)
    scene.pan.copy(pan)
    scene.zoom = scale
    draw()
    return
  }
  tween = {
    start: performance.now(), from: scene.view.clone(), to: view, zoomFrom: fromScale, zoomTo: scale,
    panFrom: scene.pan.clone(), panTo: pan
  }
  scene.zoom = fromScale
  draw()
}

function capturePreviousView() {
  if (reduced.value || document.hidden || !canvas.value?.width || !canvas.value?.height) return
  previousFrame = document.createElement('canvas')
  previousFrame.width = canvas.value.width
  previousFrame.height = canvas.value.height
  previousFrame.getContext('2d').drawImage(canvas.value, 0, 0)
}

function enterPlanet(id, fly = false, anchor) {
  if (id === setId.value || (id && !model.value.byBody.has(id))) return
  if (gesture?.kind === 'orbit' || gesture?.kind === 'resize') cancelGesture()
  if (flight) { interact(); draw() }
  const target = fly && (anchor || painted?.projected.get(id) || painted?.bodyPoints.get(id))
  interact()
  capturePreviousView()
  poses.set(setId.value, {
    view: scene.view.clone(), zoom: scene.zoom, time: scene.time, pan: scene.pan.clone(), offset: scene.offset.clone(), motionPhases, centerGlowTime
  })
  hoverId = ''
  hoverLabel.value = null
  names.clear()
  lastClick = null
  layoutOpen.value = false
  orbitEditing.value = false
  hoverOrbit.value = ''
  activeOrbit.value = ''
  speedMenu.value = null
  centerMenu.value = null
  orbitFraming = null
  setId.value = id
  bridgeId.value = ''
  clearSelection()
  const pose = poses.get(id)
  motionPhases = pose?.motionPhases || new Map()
  scene.time = pose?.time ?? 0
  centerGlowTime = pose?.centerGlowTime ?? 0
  scene.view.copy(pose?.view || overviewView())
  scene.pan.copy(pose?.pan || new Vector3())
  scene.offset.copy(pose?.offset || new Vector3())
  const scale = pose?.zoom ?? 1
  if (target && previousFrame) {
    scene.zoom = zoom.value = scale
    const { x, y, radius } = target
    flight = {
      start: performance.now(), x, y,
      scale: clamp(Math.hypot(size.width, size.height) * .53 / Math.max(4, radius), 2.2, 24)
    }
    draw()
    return
  }
  cameraTo(scene.view.clone(), scale, scale)
}

function reportLocation() {
  emit('navigate', { rootId: setId.value || null, activeId: nodeId.value || setId.value || null })
}

function goToPlanet(id, fly = false, anchor) {
  if (id === setId.value) return
  enterPlanet(id, fly, anchor)
  reportLocation()
}

function applyLocation() {
  const { rootId, activeId } = props.location
  const center = rootId || ''
  const target = activeId && activeId !== rootId ? model.value.byBody.get(activeId) : null
  if (center === setId.value && (target?.id || '') === nodeId.value) return
  if (center !== setId.value) enterPlanet(center)
  if (target) selectNode(target, true, true, false)
  else closeDetails(false)
}

function selectNode(node, focus = false, keepSystem = false, notify = true) {
  if (!node) return
  satelliteId.value = ''
  bridgeId.value = ''
  if (!keepSystem) {
    const home = node.parent?.parent?.id || ''
    if (home !== setId.value) enterPlanet(home)
    else interact()
  } else interact()
  nodeId.value = node.id
  if (notify) reportLocation()
  entryPreview.value = false
  const point = painted?.projected.get(node.id) || painted?.bodyPoints.get(node.id)
  if (focus && point) cameraTo(scene.view.clone(), Math.max(2, scene.zoom), scene.zoom, point.world)
  else draw()
}

function clearSelection() {
  satelliteId.value = ''
  nodeId.value = ''
  entryPreview.value = false
}

function closeDetails(notify = true) {
  const hadSelection = !!nodeId.value
  clearSelection()
  if (notify && hadSelection) reportLocation()
  bridgeId.value = ''
  interact()
  draw()
}

function showBridge(id) {
  interact()
  const hadSelection = !!nodeId.value
  clearSelection()
  bridgeId.value = id
  if (hadSelection) reportLocation()
  draw()
}

function showSatellite(id) {
  if (!model.value.bySatellite.has(id)) return
  interact()
  const hadSelection = !!nodeId.value
  clearSelection()
  bridgeId.value = ''
  satelliteId.value = id
  if (hadSelection) reportLocation()
  draw()
}

function openEntry() {
  if (!selected.value) return
  if (props.onOpenEntry) emit('open-entry', selected.value.id)
  else entryPreview.value = true
}

function persist(next) {
  positions.value = next
  framingPositions.value = next
  status.value = '布局已调整'
  reportSave(props.onLayoutChange?.(next), '布局已保存', '当前无法保存布局')
  draw()
}

async function reportSave(result, success, failure) {
  try {
    if (await result === false) status.value = failure
    else if (success) status.value = success
  } catch { status.value = failure }
}

function saveEntryRadius(id, radius) {
  const next = { ...entryRadii.value }
  if (radius === null) delete next[id]
  else next[id] = radius
  entryRadii.value = next
  reportSave(props.onEntryRadiusChange?.(id, radius), '条目大小已保存', '当前无法保存条目大小')
  draw()
}

function adjustSpacing(value, save = false) {
  if (gesture?.kind === 'orbit') cancelGesture()
  orbitFraming = null
  interact()
  const next = { ...spacingBySystem.value }
  if (value == null) delete next[setId.value]
  else next[setId.value] = spacingValue(value)
  spacingBySystem.value = next
  if (save) reportSave(props.onSpacingChange?.(next, setId.value), '', '当前无法保存轨道间距')
  draw()
}

function updateOrbitSetting(group, id, value) {
  const current = currentOrbitSettings.value
  const entries = { ...current[group] }
  if (value == null) delete entries[id]
  else entries[id] = value
  orbitSettings.value = { ...orbitSettings.value, [setId.value]: { ...current, [group]: entries } }
  saveOrbitSettings()
  draw()
}

function saveOrbitSettings() {
  reportSave(props.onOrbitSettingsChange?.(orbitSettings.value), '', '当前无法保存轨道设置')
}

function commitOrbits(track) {
  const current = currentOrbitSettings.value
  const { radius, target } = orbitPreview.value
  const before = system.value.planets
  const radii = { ...current.radii }
  const joins = { ...current.joins }
  const reference = current.spacingReference ?? spacing.value
  if (!current.independent) {
    for (const body of before) {
      if (body.orbitRadius !== body.defaultOrbitRadius || Object.hasOwn(radii, body.orbitId)) {
        radii[body.orbitId] = scaleOrbitRadius(body.orbitRadius, spacing.value, reference)
      }
    }
  }
  if (target) {
    for (const id of Object.keys(joins)) {
      if (joins[id] === track.id) joins[id] = target
    }
    joins[track.id] = target
    delete radii[track.id]
    activeOrbit.value = target
  } else radii[track.id] = scaleOrbitRadius(radius, spacing.value, reference)
  orbitPreview.value = null
  const next = { speeds: current.speeds, radii, joins, independent: true }
  if (Number.isFinite(current.spacingReference) || !target) next.spacingReference = reference
  orbitSettings.value = {
    ...orbitSettings.value, [setId.value]: next
  }
  if (target) {
    spreadJoinedBodies(before, track.id, target)
    status.value = '已合并轨道'
  }
  saveOrbitSettings()
  draw()
}

function spreadJoinedBodies(before, source, target) {
  const tau = 2 * Math.PI
  const joined = new Set(before.filter(body => body.orbitId === source).map(body => body.id))
  const group = system.value.planets.filter(body => body.orbitId === target)
  const phaseAt = body => body.orbitPhase + body.orbitSpeed * scene.time
  const angles = group.filter(body => !joined.has(body.id)).map(body =>
    ((phaseAt(body) + (motionPhases.get(body.id)?.orbit || 0)) % tau + tau) % tau)
  if (!angles.length) return
  for (const body of group) {
    if (!joined.has(body.id)) continue
    angles.sort((a, b) => a - b)
    let widest = 0, middle = 0
    for (const [index, angle] of angles.entries()) {
      const gap = (angles[index + 1] ?? angles[0] + tau) - angle
      if (gap <= widest) continue
      widest = gap
      middle = (angle + gap / 2) % tau
    }
    const phase = motionPhases.get(body.id)
    if (phase) phase.orbit = middle - phaseAt(body)
    angles.push(middle)
  }
}

function changeSpeed(kind, event) {
  const value = event.target.valueAsNumber
  const body = speedMenu.value?.body
  if (!body) return
  const speed = Number.isFinite(value) ? clamp(value, 0, 1000) : speedOf(body, kind)
  event.target.value = speed
  if (speed === speedOf(body, kind)) return
  updateOrbitSetting('speeds', body.id, { ...currentOrbitSettings.value.speeds?.[body.id], [kind]: speed })
}

function planetSizeOf(id) {
  return planetSizeValue(planetSizes.value[id])
}

function setPlanetSize(id, value, save = false) {
  const size = planetSizeValue(value)
  const next = { ...planetSizes.value }
  if (size === 100) delete next[id]
  else next[id] = size
  planetSizes.value = next
  if (save) reportSave(props.onPlanetSizeChange?.(id, next[id] ?? null), '星体大小已保存', '当前无法保存星体大小')
  draw()
}

function updateCenterGlow(field, value) {
  centerGlowSettings.value = {
    ...centerGlowSettings.value,
    [setId.value]: normalizeCenterGlow({ ...centerGlow.value, [field]: value })
  }
  draw()
}

function restoreCenterGlow() {
  const next = { ...centerGlowSettings.value }
  delete next[setId.value]
  centerGlowSettings.value = next
  draw()
  void saveCenterGlow()
}

async function saveCenterGlow() {
  const id = setId.value
  const attempt = Symbol()
  centerSaves.set(id, attempt)
  const error = { ...centerSaveErrors.value }
  delete error[id]
  centerSaveErrors.value = error
  try {
    const result = await props.onCenterGlowChange?.(id, centerGlowSettings.value[id] || null)
    if (result === false) throw new Error('Center glow could not be saved')
  } catch {
    if (centerSaves.get(id) === attempt) centerSaveErrors.value = { ...centerSaveErrors.value, [id]: true }
  } finally {
    if (centerSaves.get(id) === attempt) centerSaves.delete(id)
  }
}

async function openCenterMenu(point) {
  if (!point) return
  interact()
  closeSpeedMenu()
  layoutOpen.value = false
  centerMenu.value = { anchorX: point.x, anchorY: point.y, x: point.x, y: point.y }
  draw()
  await nextTick()
  positionCenterMenu()
  centerPanel.value?.focus({ preventScroll: true })
}

function positionCenterMenu() {
  if (!centerMenu.value || !centerPanel.value) return
  const { width, height } = centerPanel.value.getBoundingClientRect()
  const { anchorX, anchorY } = centerMenu.value
  centerMenu.value = {
    anchorX, anchorY,
    x: clamp(anchorX, 8, Math.max(8, size.width - width - 8)),
    y: clamp(anchorY, 8, Math.max(8, size.height - height - 8))
  }
}

function closeCenterMenu(restoreFocus = false) {
  if (!centerMenu.value) return
  centerMenu.value = null
  if (restoreFocus) canvas.value?.focus({ preventScroll: true })
  idleSince = performance.now()
  draw()
}

async function openSpeedMenu(body, event, entryId = '') {
  if (!body) return
  event.preventDefault()
  closeCenterMenu()
  interact()
  layoutOpen.value = false
  const rect = canvas.value.getBoundingClientRect()
  const anchorX = event.clientX - rect.left
  const anchorY = event.clientY - rect.top
  speedMenu.value = { body, entryId, anchorX, anchorY, x: anchorX, y: anchorY }
  activeOrbit.value = body.orbitId || ''
  draw()
  await nextTick()
  positionSpeedMenu()
  speedPanel.value?.focus({ preventScroll: true })
}

function positionSpeedMenu() {
  if (!speedMenu.value || !speedPanel.value) return
  const { width, height } = speedPanel.value.getBoundingClientRect()
  speedMenu.value = {
    ...speedMenu.value,
    x: clamp(speedMenu.value.anchorX, 8, Math.max(8, size.width - width - 8)),
    y: clamp(speedMenu.value.anchorY, 8, Math.max(8, size.height - height - 8))
  }
}

function closeSpeedMenu(restoreFocus = false) {
  if (!speedMenu.value) return
  speedMenu.value = null
  if (restoreFocus) canvas.value?.focus({ preventScroll: true })
  draw()
}

function speedOf(body, kind) {
  return currentOrbitSettings.value.speeds?.[body?.id]?.[kind] ?? 100
}

function resetOrbits() {
  if (gesture?.kind === 'orbit') cancelGesture()
  orbitSettings.value = { ...orbitSettings.value, [setId.value]: { speeds: currentOrbitSettings.value.speeds } }
  orbitFraming = null
  activeOrbit.value = ''
  saveOrbitSettings()
  status.value = '已恢复全部轨道半径'
  draw()
}

function toggleOrbitEditing() {
  if (gesture?.kind === 'orbit') cancelGesture()
  interact()
  orbitEditing.value = !orbitEditing.value
  if (!orbitEditing.value) orbitFraming = null
  hoverOrbit.value = ''
  speedMenu.value = null
  draw()
}

function changeSpacingInput(event) {
  const value = event.target.valueAsNumber
  if (Number.isFinite(value)) adjustSpacing(value, true)
  event.target.value = spacing.value
}

function closeLayout() {
  layoutOpen.value = false
  layoutButton.value?.focus()
}

function positionAt(node, point, commit) {
  const bodyId = node.parent.id
  const next = {
    ...positions.value,
    [bodyId]: { ...positions.value[bodyId], [node.id]: point.toArray() }
  }
  if (commit) persist(next)
  else { positions.value = next; draw() }
}

function resetLayout() {
  const next = { ...positions.value }
  const bodyId = selected.value && painted?.projected.has(selected.value.id) ? selected.value.parent.id : ''
  for (const body of system.value.planets) {
    if (!bodyId || bodyId === body.id) delete next[body.id]
  }
  persist(next)
  status.value = bodyId ? '已恢复当前星体的自动布局' : '已恢复当前星系的自动布局'
}

function changeDepth(event) {
  if (!canEditDepth.value) return
  const point = localPosition(selected.value, positions.value)
  if (!point.lengthSq()) point.copy(selected.value.position)
  positionAt(selected.value, point.setLength(Number(event.target.value)), event.type === 'change')
}

function turn(x, y) {
  const delta = rotation(y * .008, x * .008)
  scene.view.premultiply(delta).normalize()
  scene.pan.applyQuaternion(delta)
}

function scaleTo(value) {
  scene.zoom = zoom.value = clamp(value, .65, 6)
  draw()
}

function changeZoom(factor) {
  if (gesture?.kind === 'orbit' || gesture?.kind === 'resize') return
  interact()
  scaleTo(scene.zoom * factor)
}
function resetView() {
  if (gesture?.kind === 'orbit' || gesture?.kind === 'resize') cancelGesture()
  orbitFraming = null
  interact()
  scene.offset.set(0, 0, 0)
  cameraTo(overviewView(), 1, scene.zoom, new Vector3())
}
function focusCurrent() {
  if (selected.value) selectNode(selected.value, true, true)
  else resetView()
}

function coordinates(e) {
  const rect = canvas.value.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function orbitAt(point) {
  let closest = null
  let best = 8
  for (const track of painted?.orbits || []) {
    for (let i = 1; i < track.points.length; i++) {
      const a = track.points[i - 1], b = track.points[i]
      const dx = b.x - a.x, dy = b.y - a.y
      const fraction = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1)
      const distance = Math.hypot(point.x - a.x - dx * fraction, point.y - a.y - dy * fraction)
      if (distance >= best) continue
      best = distance
      closest = { track, angle: (i - 1 + fraction) / (track.points.length - 1) * 2 * Math.PI }
    }
  }
  return closest
}

function startOrbitDrag(hit, point) {
  const { track, angle } = hit
  const { camera, orbits } = painted
  const direction = orbitPoint(1, angle).applyQuaternion(scene.view)
  const a = camera.project(orbitPoint(0, angle))
  const b = camera.project(direction)
  const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy)
  if (distance < .00001) return
  // Camera scale changes with depth. Invert the projected radial distance so
  // inward and outward drags stay under the pointer at any view angle.
  const perspective = 1 - a.scale / b.scale
  const scale = distance * (1 - perspective)
  const pixels = radius => radius * scale / (1 - radius * perspective)
  activeOrbit.value = track.id
  hoverOrbit.value = ''
  const framing = orbitFraming
  orbitFraming ||= system.value
  gesture = {
    kind: 'orbit', start: point, track, framing, pixels,
    screenX: dx / distance, screenY: dy / distance,
    radiusAt: projection => projection / Math.max(Number.EPSILON, scale + projection * perspective),
    targets: orbits.filter(other => other.id !== track.id)
  }
  draw()
}

function hitAt(point) {
  const hits = painted?.hits || []
  const distance = hit => Math.hypot(point.x - hit.x, point.y - hit.y)
  const marker = hits.findLast(hit => {
    if (hit.kind === 'node') return distance(hit) <= hit.radius
    if (hit.kind !== 'satellite') return false
    return Math.abs(point.x - hit.x) + Math.abs(point.y - hit.y) <= hit.radius
  })
  if (marker) return marker
  const count = hits.find(hit => hit.kind === 'bridge' && distance(hit) <= hit.radius)
  if (count) return count
  const covers = hit => hit.halfWidth
    ? Math.abs(point.x - hit.x) <= hit.halfWidth && Math.abs(point.y - hit.y) <= hit.halfHeight
    : distance(hit) <= hit.radius
  const work = painted?.work
  const path = (!work || distance(work) > work.radius + 7) && hits.find(hit => hit.paths?.some(points => points.some((end, index) => {
    if (!index) return false
    const start = points[index - 1]
    const dx = end.x - start.x, dy = end.y - start.y
    const t = clamp(((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy || 1), 0, 1)
    return Math.hypot(point.x - start.x - t * dx, point.y - start.y - t * dy) < 5
  })))
  if (path) return path
  return hits.filter(hit => hit.kind === 'planet' && covers(hit)).at(-1)
}

function resizeAt(point, hit) {
  if (orbitEditing.value || (hit && !hit.resizable)) return null
  const candidates = hit ? [hit] : [...(painted?.hits || [])].reverse()
  return candidates.find(({ x, y, radius, resizable }) => resizable
    && Math.abs(Math.hypot(point.x - x, point.y - y) - radius) <= Math.min(5, radius * .32))
}

function pinchDistance() {
  const [a, b] = pointers.values()
  return a && b ? Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) : 1
}

function onMenu(event) {
  if (!painted || gesture) return
  const point = coordinates(event)
  const hit = hitAt(point)
  const center = painted.work
  if (center && Math.hypot(point.x - center.x, point.y - center.y) <= center.radius
    && (!hit || (hit.kind === 'node' && hit.id === setId.value))) {
    void openCenterMenu(point)
    return
  }
  closeCenterMenu()
  const planetId = hit?.kind === 'planet' ? hit.id
    : hit?.kind === 'node' ? painted.projected.get(hit.id)?.planetId || hit.planetId || '' : ''
  const body = system.value.planets.find(item => item.id === planetId)
  if (body) openSpeedMenu(body, event, hit?.resizable ? hit.id : '')
  else if (speedMenu.value) closeSpeedMenu()
}

function onDown(event) {
  const middle = event.button === 1 && event.pointerType === 'mouse'
  if ((!middle && event.button !== 0) || pointers.size >= 2 || gesture?.kind === 'pan'
    || gesture?.kind === 'orbit' || gesture?.kind === 'resize' || (middle && pointers.size)) return
  if (middle) event.preventDefault()
  if (!painted) return
  layoutOpen.value = false
  closeSpeedMenu()
  closeCenterMenu()
  const wasFlying = !!flight
  interact()
  if (wasFlying) draw()
  hoverLabel.value = null
  const point = coordinates(event)
  pointers.set(event.pointerId, point)
  canvas.value.setPointerCapture(event.pointerId)
  if (middle) {
    hoverId = ''
    const camera = painted.camera
    gesture = { kind: 'pan', start: point, camera, offset: scene.offset.clone() }
    dragActive.value = true
    draw()
    return
  }
  if (pointers.size === 2) {
    if (gesture?.original) positions.value = gesture.original
    gesture = { kind: 'pinch', distance: pinchDistance(), scale: scene.zoom }
    dragActive.value = true
    draw()
    return
  }
  const hit = hitAt(point)
  const rim = resizeAt(point, hit)
  if (rim) {
    const planetScale = rim.planetId === rim.id ? planetSizeOf(rim.id) / 100 : 1
    gesture = { kind: 'resize', hit: rim, node: model.value.byNode.get(rim.id),
      startDistance: Math.hypot(point.x - rim.x, point.y - rim.y),
      scale: entryCircleScale(scene.zoom) * planetScale }
    return
  }
  if (orbitEditing.value && !hit) {
    const orbit = orbitAt(point)
    if (orbit) {
      startOrbitDrag(orbit, point)
      if (gesture?.kind === 'orbit') return
    }
  }
  const node = hit?.kind === 'node' ? model.value.byBody.get(hit.id) : null
  gesture = { kind: 'pointer', start: point, last: point, time: performance.now(), hit, node, moved: false, vx: 0, vy: 0 }
  const projected = node && painted?.projected.get(node.id)
  if (projected) {
    gesture.original = positions.value
    gesture.local = localPosition(node, positions.value)
    gesture.world = projected.world
    gesture.center = projected.center
    gesture.inverse = projected.orientation.clone().invert()
    gesture.localScale = TUNING.detailRadius / projected.sphereRadius
    const origin = painted.camera.project(projected.world)
    gesture.offset = { x: origin.x - point.x, y: origin.y - point.y }
  }
}

function onMove(event) {
  const point = coordinates(event)
  if (!pointers.has(event.pointerId)) {
    if (flight) return
    const hit = hitAt(point)
    const rim = resizeAt(point, hit)
    const activeHit = hit || rim
    const hover = activeHit?.id || ''
    if (hover !== hoverId) {
      hoverId = hover
      if (hover) interact()
      else idleSince = performance.now()
      draw()
    }
    const item = activeHit?.kind === 'node' ? model.value.byBody.get(hover)
      : activeHit?.kind === 'satellite' ? model.value.bySatellite.get(hover)?.target : null
    hoverLabel.value = item ? { title: item.title, x: activeHit.x, y: activeHit.y - activeHit.radius - 9 } : null
    const track = orbitEditing.value && !hit ? orbitAt(point) : null
    const nextOrbit = track?.track.id || ''
    if (hoverOrbit.value !== nextOrbit) {
      hoverOrbit.value = nextOrbit
      draw()
    }
    canvas.value.style.cursor = rim ? 'ew-resize' : hover ? 'pointer' : track ? 'ew-resize' : 'grab'
    return
  }
  pointers.set(event.pointerId, point)
  if (gesture?.kind === 'pinch') return scaleTo(gesture.scale * pinchDistance() / gesture.distance)
  if (gesture?.kind === 'resize') {
    const { id, x, y, radius } = gesture.hit
    const delta = Math.hypot(point.x - x, point.y - y) - gesture.startDistance
    if (!entryResize.value && Math.abs(delta) < Math.min(TUNING.dragThreshold, radius / 3)) return
    dragActive.value = true
    entryResize.value = { id, x, y, radius: Math.max(radius + delta, MIN_ENTRY_RADIUS * gesture.scale) }
    draw()
    return
  }
  if (gesture?.kind === 'orbit') {
    const { start, track, screenX, screenY, pixels, radiusAt, targets } = gesture
    const dx = point.x - start.x, dy = point.y - start.y
    if (!gesture.moved && Math.hypot(dx, dy) < TUNING.dragThreshold) return
    dragActive.value = gesture.moved = true
    const projection = pixels(track.radius) + dx * screenX + dy * screenY
    let nearest = null
    let threshold = 8
    for (const other of targets) {
      const distance = Math.abs(projection - pixels(other.radius))
      if (distance >= threshold) continue
      nearest = other
      threshold = distance
    }
    orbitPreview.value = { radius: nearest?.radius ?? Math.max(TUNING.workRadius + .34, radiusAt(projection)), target: nearest?.id }
    draw()
    return
  }
  if (gesture?.kind === 'pan') {
    const { start, camera, offset } = gesture
    scene.offset.copy(offset).add(camera.unproject(point.x, point.y, 0)
      .sub(camera.unproject(start.x, start.y, 0)))
    draw()
    return
  }
  if (!gesture) return
  const { start, last, node } = gesture
  const dx = point.x - start.x, dy = point.y - start.y
  if (!gesture.moved && Math.hypot(dx, dy) < TUNING.dragThreshold) return
  dragActive.value = gesture.moved = true
  if (node && gesture.local) {
    let local
    if (event.shiftKey) {
      const ray = gesture.local.clone()
      if (!ray.lengthSq()) ray.copy(node.position)
      local = ray.setLength(clamp(gesture.local.length() - dy * .015, .2, TUNING.maxNodeRadius))
    } else {
      local = painted.camera.unproject(point.x + gesture.offset.x, point.y + gesture.offset.y, gesture.world.z)
        .sub(gesture.center).applyQuaternion(gesture.inverse).multiplyScalar(gesture.localScale)
        .clampLength(0, TUNING.maxNodeRadius)
    }
    positionAt(node, local, false)
  } else {
    const now = performance.now(), dt = Math.max(8, now - gesture.time)
    const x = point.x - last.x, y = point.y - last.y
    gesture.vx = clamp(x / dt, -.9, .9)
    gesture.vy = clamp(y / dt, -.9, .9)
    gesture.time = now
    turn(x, y)
    draw()
  }
  gesture.last = point
}

function cancelGesture() {
  if (gesture?.original) positions.value = gesture.original
  if (gesture?.kind === 'pan') scene.offset.copy(gesture.offset)
  if (gesture?.kind === 'orbit') orbitFraming = gesture.framing
  orbitPreview.value = null
  entryResize.value = null
  const ids = [...pointers.keys()]
  gesture = null
  pointers.clear()
  for (const id of ids) if (canvas.value?.hasPointerCapture(id)) canvas.value.releasePointerCapture(id)
  dragActive.value = false
  interact()
  draw()
}

function onUp(event) {
  if (gesture?.kind === 'pan' && event.button !== 1) return
  if (!pointers.delete(event.pointerId) || !gesture) return
  if (gesture.kind === 'pinch') {
    if (pointers.size) return
    gesture = null
    dragActive.value = false
    idleSince = performance.now()
    return
  }
  const current = gesture
  const resized = entryResize.value
  entryResize.value = null
  gesture = null
  dragActive.value = false
  idleSince = performance.now()
  if (resized) {
    lastClick = null
    if (Math.abs(resized.radius - current.hit.radius) > .01) saveEntryRadius(resized.id, entryReferenceRadius(resized.radius, current.scale))
    else draw()
    return
  }
  if (current.kind === 'orbit') {
    lastClick = null
    if (current.moved) commitOrbits(current.track)
    else { orbitFraming = current.framing; draw() }
    return
  }
  if (current.kind === 'pan') {
    lastClick = null
    return
  }
  if (current.moved) {
    lastClick = null
    if (current.local) persist(positions.value)
    else if (!reduced.value && performance.now() - current.time < 80) glide = { x: current.vx, y: current.vy }
    return
  }
  const hit = current.hit
  if (hit?.kind === 'planet') goToPlanet(hit.id, true, painted.bodyPoints.get(hit.id) || hit)
  else if (hit?.kind === 'bridge') showBridge(hit.id)
  else if (hit?.kind === 'satellite') showSatellite(hit.id)
  else if (hit?.kind === 'node') {
    const now = performance.now()
    const double = lastClick?.id === hit.id && now - lastClick.time < 360
    lastClick = { id: hit.id, time: now }
    selectNode(current.node, double, true)
  } else closeDetails()
}

function onKey(event) {
  if (event.target === canvas.value && event.shiftKey && event.key === 'F10' && painted?.work) {
    event.preventDefault()
    void openCenterMenu(painted.work)
    return
  }
  if (event.key === 'Escape') {
    if (gesture) cancelGesture()
    else if (flight) { interact(); draw() }
    else if (centerMenu.value) closeCenterMenu(true)
    else if (speedMenu.value) closeSpeedMenu(true)
    else if (layoutOpen.value) closeLayout()
    else if (orbitEditing.value) toggleOrbitEditing()
    else if (selected.value || bridge.value || satellite.value) closeDetails()
    else if (setId.value) goToPlanet(activeSet.value?.parent?.id || '')
    else return
    event.preventDefault()
  } else if (event.target === canvas.value && !event.altKey && !event.ctrlKey && !event.metaKey && event.key.startsWith('Arrow')) {
    event.preventDefault()
    if (gesture?.kind === 'orbit' || gesture?.kind === 'resize') return
    interact()
    turn(event.key === 'ArrowRight' ? 18 : event.key === 'ArrowLeft' ? -18 : 0,
      event.key === 'ArrowDown' ? 18 : event.key === 'ArrowUp' ? -18 : 0)
    draw()
  }
}

function onLeave() { hoverId = ''; hoverOrbit.value = ''; hoverLabel.value = null; idleSince = performance.now(); draw() }
function changeMotion() {
  reduced.value = motion.matches
  if (tween) {
    scene.view.copy(tween.to)
    scene.pan.copy(tween.panTo)
    scene.zoom = tween.zoomTo
  }
  interact()
  draw()
}

watch(model, () => {
  if (gesture?.kind === 'orbit') cancelGesture()
  orbitFraming = null
  if (gesture?.kind === 'resize' && !model.value.byNode.has(gesture.hit.id)) cancelGesture()
  if (satelliteId.value && !satellite.value) satelliteId.value = ''
  if (setId.value && !activeSet.value) enterPlanet('')
  if (nodeId.value && !selected.value) clearSelection()
  if (bridgeId.value && !bridge.value) bridgeId.value = ''
  draw()
})
watch(() => props.location, applyLocation, { flush: 'post' })
watch([centerSaveErrors, () => centerGlow.value.effect], positionCenterMenu, { flush: 'post' })
watch(heading, value => emit('heading', value), { immediate: true })

let galaxyActive = false
function activateGalaxy() {
  if (galaxyActive) return
  galaxyActive = true
  motion?.addEventListener('change', changeMotion)
  window.addEventListener('resize', measure)
  window.addEventListener('blur', cancelGesture)
  if (!frame) frame = requestAnimationFrame(animate)
}
function deactivateGalaxy() {
  if (!galaxyActive) return
  galaxyActive = false
  motion?.removeEventListener('change', changeMotion)
  window.removeEventListener('resize', measure)
  window.removeEventListener('blur', cancelGesture)
  cancelAnimationFrame(frame)
  frame = 0
}
onMounted(async () => {
  ctx = canvas.value.getContext('2d')
  motion = matchMedia('(prefers-reduced-motion: reduce)')
  changeMotion()
  observer = new ResizeObserver(measure)
  observer.observe(stage.value)
  activateGalaxy()
  await nextTick()
  measure()
  applyLocation()
})
onActivated(() => {
  activateGalaxy()
  measure()
})
onDeactivated(() => {
  cancelGesture()
  deactivateGalaxy()
})
onBeforeUnmount(() => {
  observer?.disconnect()
  deactivateGalaxy()
})
</script>

<template>
  <section class="lpn" :class="{ 'lpn-embedded': embedded }" aria-label="关系星系" @keydown="onKey" :data-galaxy-center="setId" :data-galaxy-selection="nodeId">
    <div class="lpn-shell">
      <div class="lpn-workspace">
        <div ref="stage" class="lpn-stage" :class="{ 'is-dragging': dragActive, 'is-resizing': entryResize }">
          <canvas ref="canvas" tabindex="0" aria-label="三维关系画布，方向键旋转，Shift+F10 编辑中心发光，可通过设定目录定位条目，拖动条目圆边缘调整大小"
            @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="cancelGesture"
            @lostpointercapture="event => { if (pointers.has(event.pointerId)) cancelGesture() }" @pointerleave="onLeave"
            @wheel.prevent="changeZoom(Math.exp(-$event.deltaY * .0015))"
            @contextmenu.prevent="onMenu"
            @mousedown="event => { if (event.button === 1) event.preventDefault() }"
            @auxclick="event => { if (event.button === 1) event.preventDefault() }" />
          <span v-if="hoverLabel" class="lpn-node-hover"
            :data-edge="hoverLabel.x < 108 ? 'left' : hoverLabel.x > size.width - 108 ? 'right' : undefined"
            :style="{ left: clamp(hoverLabel.x, 10, size.width - 10) + 'px', top: Math.max(34, hoverLabel.y) + 'px' }">{{ hoverLabel.title }}</span>
          <div v-if="centerMenu" ref="centerPanel" class="lpn-speed-menu lpn-center-menu" role="dialog" tabindex="-1"
            aria-label="中心发光" :style="{ left: centerMenu.x + 'px', top: centerMenu.y + 'px' }" @contextmenu.prevent>
            <header class="lpn-speed-menu-header">
              <div><p class="lpn-speed-menu-head">中心发光</p><small>{{ activeSet?.title || workTitle }}</small></div>
              <button type="button" class="lpn-speed-close" aria-label="关闭中心发光" @click="closeCenterMenu(true)">×</button>
            </header>
            <PlanetSizeControl :value="planetSizeOf(setId)"
              @preview="setPlanetSize(setId, $event)" @commit="setPlanetSize(setId, $event, true)" />
            <label class="lpn-center-setting">
              <span>发光颜色</span>
              <input type="color" :value="centerGlow.color"
                @input="updateCenterGlow('color', $event.target.value)" @change="saveCenterGlow">
            </label>
            <label class="lpn-center-setting">
              <span>动效</span>
              <select aria-label="动效" :value="centerGlow.effect" @change="updateCenterGlow('effect', $event.target.value); saveCenterGlow()">
                <option v-for="(label, id) in CENTER_GLOW_EFFECTS" :key="id" :value="id">{{ label }}</option>
              </select>
            </label>
            <label v-if="hasCenterColorModes(centerGlow.effect)" class="lpn-center-setting">
              <span>配色方式</span>
              <select aria-label="配色方式" :value="centerGlow.colorMode"
                @change="updateCenterGlow('colorMode', $event.target.value); saveCenterGlow()">
                <option v-for="(label, id) in CENTER_GLOW_COLOR_MODES" :key="id" :value="id">{{ label }}</option>
              </select>
            </label>
            <label v-for="(label, field) in { brightness: '发光亮度', speed: '动效速度' }" :key="field" class="lpn-center-setting lpn-center-slider">
              <span>{{ label }}</span><output>{{ centerGlow[field] }}%</output>
              <input type="range" min="0" :max="field === 'brightness' ? 150 : 200" step="5"
                :aria-label="label" :value="centerGlow[field]"
                @input="updateCenterGlow(field, $event.target.valueAsNumber)" @change="saveCenterGlow">
            </label>
            <p v-if="centerSaveErrors[setId]" class="lpn-center-save-error" role="alert">
              中心样式未保存。<button type="button" class="lpn-pill" @click="saveCenterGlow">重试</button>
            </p>
            <div class="lpn-speed-menu-actions">
              <button type="button" class="lpn-pill" @click="restoreCenterGlow">恢复默认</button>
            </div>
          </div>
          <div v-if="speedMenu" ref="speedPanel" class="lpn-speed-menu" role="dialog" tabindex="-1" :aria-label="speedMenu.body.title + ' 星体设置'"
            :style="{ left: speedMenu.x + 'px', top: speedMenu.y + 'px' }" @contextmenu.prevent>
            <header class="lpn-speed-menu-header">
              <p class="lpn-speed-menu-head" :title="speedMenu.body.title">{{ speedMenu.body.title }}</p>
              <button type="button" class="lpn-speed-close" aria-label="关闭星体设置" @click="closeSpeedMenu(true)">×</button>
            </header>
            <div v-if="speedMenu.entryId" class="lpn-speed-menu-actions">
              <button type="button" class="lpn-pill" :disabled="!Number.isFinite(entryRadii[speedMenu.entryId])"
                @click="saveEntryRadius(speedMenu.entryId, null); closeSpeedMenu(true)">恢复条目圆默认大小</button>
            </div>
            <PlanetSizeControl :value="planetSizeOf(speedMenu.body.id)"
              @preview="setPlanetSize(speedMenu.body.id, $event)" @commit="setPlanetSize(speedMenu.body.id, $event, true)" />
            <label v-for="(label, kind) in { orbit: '公转速度', spin: '自转速度' }" :key="kind" class="lpn-speed-setting">
              <span>{{ label }}</span>
              <span class="lpn-speed-value"><input type="number" min="0" max="1000" step="any" :aria-label="label"
                :value="speedOf(speedMenu.body, kind)" @change="changeSpeed(kind, $event)" @keydown.enter.prevent="changeSpeed(kind, $event)"><span aria-hidden="true">%</span></span>
            </label>
            <div class="lpn-speed-menu-actions">
              <button type="button" class="lpn-pill" @click="updateOrbitSetting('speeds', speedMenu.body.id, null)">恢复默认速度</button>
            </div>
          </div>
          <div v-if="activeSet && !activeSet.entries.length" class="lpn-empty">还没有下级条目</div>
          <div v-else-if="!system.planets.length" class="lpn-empty">还没有设定集</div>
          <div class="lpn-legend" aria-hidden="true">
            <span><i class="lpn-key-mesh"></i>条目织网</span>
            <span><i class="lpn-key-line"></i>集内关系</span>
            <span><i class="lpn-key-cross"></i>{{ activeSet ? '星体间关系' : '跨集关系' }}</span>
            <span v-if="model.bySatellite.size"><i class="lpn-key-satellite"></i>关联对象</span>
          </div>
          <p class="lpn-stage-hint" :class="{ 'lpn-merge-hint': orbitPreview?.target }">{{ orbitPreview?.target ? '松手合并轨道' : orbitEditing ? '向内或向外拖动轨道 · Esc 退出轨道编辑' : '拖动圆边调整大小 · 左键拖动空白旋转 · 中键拖动平移' }}</p>
        </div>

        <aside v-if="selected || bridge || satellite" class="lpn-inspector" aria-label="关系摘要">
          <div class="lpn-inspector-head">
            <span>{{ satellite ? '关联对象' : bridge ? '关系明细' : entryPreview ? '条目预览' : '条目摘要' }}</span>
            <button type="button" class="lpn-icon" aria-label="关闭摘要" @click="closeDetails()">×</button>
          </div>
          <template v-if="satellite">
            <h2>{{ satellite.target.title }}</h2>
            <p class="lpn-summary">{{ satellite.target.kind === 'character' ? '人物' : satellite.target.kindLabel || '关联对象' }} · {{ satellite.label || '关联' }}</p>
            <p v-if="satellite.description" class="lpn-summary">{{ satellite.description }}</p>
            <p v-if="satellite.target.summary" class="lpn-summary">{{ satellite.target.summary }}</p>
            <button v-if="onOpenTarget" type="button" class="lpn-pill lpn-primary" @click="emit('open-target', satellite.target)">打开人物</button>
            <div class="lpn-list">
              <button type="button" @click="selectNode(satellite.owner, true)">{{ satellite.owner.title }}<small>定位所属条目</small></button>
            </div>
          </template>
          <template v-else>
            <h2>{{ selected?.title || bridge?.a.title + ' / ' + bridge?.b.title }}</h2>
            <p v-if="selected?.summary" class="lpn-summary">{{ selected.summary }}</p>
            <template v-if="selected && !entryPreview">
              <label v-if="canEditDepth" class="lpn-depth"><span>离球心距离</span><output>{{ depth.toFixed(2) }}</output>
                <input type="range" min=".2" :max="TUNING.maxNodeRadius" step=".05" :value="depth" @input="changeDepth" @change="changeDepth">
              </label>
              <div class="lpn-entry-actions">
                <button v-if="selected.entries.length && selected.id !== activeSet?.id" type="button" class="lpn-pill lpn-primary" @click="goToPlanet(selected.id, true)">进入下一级</button>
                <button type="button" class="lpn-pill" :class="{ 'lpn-primary': !selected.entries.length }" @click="openEntry">打开条目</button>
                <button v-if="selected.id !== setId && Number.isFinite(entryRadii[selected.id])" type="button"
                  class="lpn-pill" @click="saveEntryRadius(selected.id, null)">恢复自动大小</button>
              </div>
            </template>
            <p v-if="entryPreview && !selected?.summary" class="lpn-summary">该条目暂无摘要</p>
            <template v-if="selected?.satellites.length">
              <h3>关联对象</h3>
              <div class="lpn-list">
                <button v-for="item in selected.satellites" :key="item.id" type="button" @click="showSatellite(item.id)">{{ item.target.title }}<small>{{ item.label || '关联' }}</small></button>
              </div>
            </template>
            <h3>{{ activeLinks.length }} 条关系</h3>
            <div class="lpn-list">
              <template v-for="link in activeLinks" :key="link.id">
                <div v-if="bridge" class="lpn-bridge-row">
                  <button type="button" @click="selectNode(link.from, true)">{{ link.from.title }}</button>
                  <span :title="link.description">{{ link.label || '关联' }}</span>
                  <button type="button" @click="selectNode(link.to, true)">{{ link.to.title }}</button>
                </div>
                <button v-else type="button" @click="selectNode(link.from === selected ? link.to : link.from, true)">
                  {{ (link.from === selected ? link.to : link.from).title }}<small>{{ (link.to === selected && link.reverseLabel) || link.label || '关联' }}{{ link.description ? ' · ' + link.description : '' }}</small>
                </button>
              </template>
              <p v-if="!activeLinks.length">该条目暂无关联关系</p>
            </div>
          </template>
        </aside>
      </div>

      <footer class="lpn-footer">
        <div class="lpn-footer-left">
          <div v-if="system.planets.length" class="lpn-layout" @focusout="event => { if (!event.currentTarget.contains(event.relatedTarget)) layoutOpen = false }">
            <button ref="layoutButton" type="button" class="lpn-pill" :aria-expanded="layoutOpen" @click="closeCenterMenu(); layoutOpen = !layoutOpen">布局</button>
            <div v-if="layoutOpen" class="lpn-layout-panel" aria-label="当前星系布局">
              <label class="lpn-depth">
                <span>轨道间距</span>
                <span class="lpn-setting-value"><input type="number" min="0" step="any" aria-label="轨道间距百分比" :value="spacing" @change="changeSpacingInput">%</span>
                <input type="range" min="0" max="500" step="1" :value="Math.min(spacing, 500)" aria-label="轨道间距"
                  @input="adjustSpacing($event.target.valueAsNumber)" @change="adjustSpacing($event.target.valueAsNumber, true)">
              </label>
              <div class="lpn-layout-scale"><span>紧凑</span><span>宽松</span></div>
              <button type="button" class="lpn-pill" @click="adjustSpacing(null, true)">恢复默认间距</button>
              <div class="lpn-orbit-controls">
                <button type="button" class="lpn-pill" :aria-pressed="orbitEditing" @click="toggleOrbitEditing">
                  {{ orbitEditing ? '退出轨道编辑' : '拖拽轨道半径' }}
                </button>
                <output v-if="activeTrack" class="lpn-orbit-radius">当前轨道半径 {{ activeTrack.orbitRadius.toFixed(2) }}</output>
                <p class="lpn-orbit-tip">拖动轨道线调整半径，重合时松手即可合并。右键星体可设置速度。</p>
                <button v-if="currentOrbitSettings.radii" type="button" class="lpn-pill" @click="resetOrbits">恢复默认轨道</button>
              </div>
            </div>
          </div>
          <button v-if="system.planets.length" type="button" class="lpn-pill" @click="resetLayout">恢复自动布局</button>
          <button v-if="onEditRelations && relationOwner" type="button" class="lpn-pill" @click="emit('edit-relations', relationOwner.id)">编辑关联</button>
          <small role="status">{{ status }}</small>
        </div>
        <div class="lpn-zoom" aria-label="画布视角">
          <button type="button" aria-label="缩小" @click="changeZoom(1 / 1.15)">−</button>
          <button type="button" aria-label="重置视角" title="重置视角" @click="resetView">{{ Math.round(zoom * 100) }}%</button>
          <button type="button" aria-label="放大" @click="changeZoom(1.15)">+</button>
          <button type="button" @click="focusCurrent">聚焦</button>
        </div>
      </footer>
    </div>
  </section>
</template>
