<!-- 关系星系交互画布（LorePlanetNetwork）：
     承载 3D 透视投影的关系星系（恒星系/设定集 → 行星/子条目 → 卫星/跨模块互链），
     负责帧循环与惯性相机、点击下钻/飞行聚焦、拖拽改轨与并轨、卡尺缩放、
     中心恒星辉光与星体转速右键浮层、以及右侧摘要/关系检视面板。 -->
<script setup>
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, shallowRef, watch } from 'vue'
import { Vector3 } from 'three'
import {
  cameraPose, cameraView, centeredPan, CENTER_ELEVATION, clamp, GALAXY_CAMERA, localPosition, networkModel,
  orbitDragPoint, orbitPoint, overviewView, planetSizeValue, relaxSetEntries, scaleOrbitRadius, spacePlanets,
  spacingValue, stepCamera, TUNING, withOrbitSpacingReference, worldToOrbitUV
} from './planet-scene.js'
import { galaxyFraming, galaxyProjection, paintNetwork } from './draw-planets.js'
import PlanetSizeControl from './PlanetSizeControl.vue'
import LoreWeightIcon from '../../LoreWeightIcon.vue'
import { entryWeightMeta, normalizeEntryWeight } from '../../../services/lore-weights.js'
import {
  advanceCenterGlow,
  blendCenterSpectrum,
  CENTER_GLOW_COLOR_MODES,
  CENTER_GLOW_COLOR_SOURCES,
  CENTER_GLOW_EFFECTS,
  normalizeCenterGlow,
  resolveCenterSpectrum,
  rgbaString,
  rgbToHex,
  spectrumDistance
} from './center-glow.js'
import { entryCircleScale, entryReferenceRadius, MIN_ENTRY_RADIUS } from './entry-circles.js'
import './planet-network.css'

const props = defineProps({
  sets: { type: Array, required: true }, nodes: { type: Array, required: true },
  links: { type: Array, required: true }, initialPositions: { type: Object, default: () => ({}) },
  workTitle: { type: String, default: '未命名作品' },
  backdropPalette: { type: Object, default: null },
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
let entryResize = null
let planetResize = null
let rimHoverId = ''
const layers = ref({ weave: true, intra: true, cross: true, satellite: true })
const soloLayer = ref('')
const SAT_ACTION_LABEL = {
  character: '打开人物',
  outline: '打开大纲',
  olnode: '打开画布节点',
  chapter: '打开正文',
  snippet: '打开灵感'
}
const SAT_COLOR_MAP = {
  character: '#EAF3FF',
  outline: '#47D7E8',
  olnode: '#96B6FF',
  chapter: '#B6A6FF',
  snippet: '#7CE6C8'
}
const motionPaused = ref(false)
function toggleMotionPause() {
  motionPaused.value = !motionPaused.value
  status.value = motionPaused.value ? '已暂停星体运转' : '已恢复星体运转'
  if (!motionPaused.value) idleSince = performance.now() - TUNING.idleDelay
  draw()
}
function toggleLayer(key) {
  layers.value = { ...layers.value, [key]: !layers.value[key] }
  draw()
}
function setSoloLayer(key) {
  soloLayer.value = key
  draw()
}
const spacingBySystem = shallowRef(props.initialSpacing)
const orbitSettings = shallowRef(props.initialOrbitSettings)
const layoutOpen = ref(false), layoutButton = ref(null)
const orbitEditing = ref(false), activeOrbit = ref('')
let orbitPreview = null
let hoverOrbit = ''
const speedMenu = ref(null)
const speedPanel = ref(null)
const stage = ref(null), canvas = ref(null)
const setId = ref(''), nodeId = ref(''), bridgeId = ref('')
const centerMenu = ref(null), centerPanel = ref(null)
const centerGlowSettings = shallowRef(props.initialCenterGlow)
const centerSaveErrors = shallowRef({})
const centerSaves = new Map()
const centerGlow = computed(() => normalizeCenterGlow(centerGlowSettings.value[setId.value]))
const targetCenterSpectrum = computed(() => resolveCenterSpectrum(centerGlow.value, props.backdropPalette))
const centerAmbientStyle = computed(() => ({
  '--lpn-core-ambient': rgbaString(targetCenterSpectrum.value.primary, 0.062)
}))
const previewSwatchColors = computed(() => {
  const s = targetCenterSpectrum.value
  return [rgbToHex(s.platinum || s.highlight), rgbToHex(s.primary), rgbToHex(s.accent)]
})
const SPECTRUM_TRANSITION_MS = 500
let activeCenterSpectrum = targetCenterSpectrum.value
let spectrumFrom = null
let spectrumTo = null
let spectrumStart = 0
let centerGlowTime = 0
let nodeMotionTime = 0
const reduced = ref(false)
const hasAnimatedWeightedNodes = computed(() => {
  for (const planet of system.value.planets) {
    const pw = normalizeEntryWeight(planet.weight)
    if (!planet.entries.length && planet.parent && (pw === 'key' || pw === 'trivial')) return true
    for (const entry of planet.entries) {
      const w = normalizeEntryWeight(entry.weight)
      if (w === 'key' || w === 'trivial') return true
    }
  }
  return false
})

watch(targetCenterSpectrum, next => {
  if (!activeCenterSpectrum || reduced.value || document.hidden || spectrumDistance(activeCenterSpectrum, next) <= 0.5) {
    activeCenterSpectrum = next
    spectrumFrom = null
    spectrumTo = null
    draw()
    return
  }
  spectrumFrom = activeCenterSpectrum
  spectrumTo = next
  spectrumStart = performance.now()
  draw()
})

function stepCenterSpectrum(now) {
  if (!spectrumTo) return false
  const raw = (now - spectrumStart) / SPECTRUM_TRANSITION_MS
  if (raw >= 1) {
    activeCenterSpectrum = spectrumTo
    spectrumFrom = null
    spectrumTo = null
    return true
  }
  const eased = 1 - Math.pow(1 - Math.max(0, raw), 3)
  activeCenterSpectrum = blendCenterSpectrum(spectrumFrom, spectrumTo, eased)
  return true
}
const zoomReadout = ref(null), stageHint = ref(null)
const entryPreview = ref(false), status = ref('')
let dragActive = false
const spacing = computed(() => spacingValue(spacingBySystem.value[setId.value]))
const currentOrbitSettings = computed(() =>
  withOrbitSpacingReference(orbitSettings.value[setId.value] || {}, props.initialSpacing[setId.value]))
const referenceSpacing = computed(() => currentOrbitSettings.value.spacingReference ?? 100)
const layoutAspect = ref(16 / 9)
function layoutSystem(orbitSpacing) {
  const current = model.value.system(setId.value)
  const aspect = current.center ? 16 / 9 : layoutAspect.value
  return {
    ...current, layoutAspect: aspect,
    planets: spacePlanets(current.planets, framingPositions.value, orbitSpacing, currentOrbitSettings.value, aspect)
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
/** Strip duplicate leading title or identical description from inspector summaries. */
function distinctSummary(title, summary, extra = '') {
  const rawSummary = String(summary || '').trim()
  if (!rawSummary) return ''
  const rawTitle = String(title || '').trim()
  const rawExtra = String(extra || '').trim()
  if (rawSummary === rawTitle || (rawExtra && rawSummary === rawExtra)) return ''
  if (rawTitle && rawSummary.startsWith(rawTitle)) {
    const tail = rawSummary.slice(rawTitle.length)
    if (!tail || /^\s/.test(tail)) {
      const cleaned = tail.trim()
      if (!cleaned || cleaned === rawTitle || (rawExtra && cleaned === rawExtra)) return ''
      return cleaned
    }
  }
  return rawSummary
}
const selectedCrumbs = computed(() => (selected.value ? ancestors(selected.value) : []))
const selectedTitle = computed(() => {
  if (selected.value) return selected.value.title
  if (bridge.value) return `${bridge.value.a.title} / ${bridge.value.b.title}`
  return ''
})
const selectedSummary = computed(() => (selected.value ? distinctSummary(selected.value.title, selected.value.summary) : ''))
const selectedSatellites = computed(() => {
  if (!selected.value) return []
  return system.value.rolledSatellites?.get(selected.value.id) ?? selected.value.satellites ?? []
})
const satelliteSummary = computed(() => (satellite.value
  ? distinctSummary(satellite.value.target?.title, satellite.value.target?.summary, satellite.value.description)
  : ''))
const breadcrumb = computed(() => ancestors(activeSet.value))
const heading = computed(() => {
  const center = activeSet.value
  const path = center ? [...breadcrumb.value, center] : []
  const stats = center
    ? `${center.entries.length} 个直属条目 · ${internalCount.value} 条可见关系`
    : `${system.value.planets.length} 个设定集 · ${model.value.byNode.size} 个条目 · ${system.value.bridges.filter(item => !item.withinBody).length} 组跨集关系`
  return { path: path.map(({id, title}) => ({ id, title })), title: center?.title || '设定集总览', stats }
})
const depth = computed(() => {
  if (!canEditDepth.value) return TUNING.detailRadius
  const node = selected.value
  const body = node.parent
  const points = relaxSetEntries(body, positions.value[body.id], planetSizeOf(body.id) / 100)
  return points[body.entries.indexOf(node)].length()
})
const scene = { ...cameraPose(), view: overviewView(), time: 0, framing: null }
let targetCamera = cameraPose()
const angularVelocity = { yaw: 0, pitch: 0 }
let wheelUntil = 0
const hoverLabel = ref(null)
const poses = new Map()
const focusWeights = new Map()
let lastDraw = 0
let motionPhases = new Map()
watch(system, (next, previous) => {
  if (next.center?.id !== previous.center?.id || next.layoutAspect !== previous.layoutAspect) return
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
let lastClick = null
let ctx, observer, motion, frame, painted, gesture
let flight = null
let size = { width: 0, height: 0 }, hoverId = '', lastFrame = 0
let idleSince = performance.now(), idleSpeed = 0
const pointers = new Map()
let renderPending = false, lastHud = -Infinity
let entryDrag = null, hoverHit = null, shownHover = ''
let cachedHudBoxes = [], lastHintText = ''
const DEFAULT_STAGE_HINT = '拖拽星域调轨道 · 拖卡尺边缩放 · 拖条目微调 · 左键空白旋转 · 中键/Shift平移'

function measureHudBoxes() {
  const stageEl = stage.value
  if (!stageEl || !size.width || !size.height) return
  const base = stageEl.getBoundingClientRect()
  if (!base.width || !base.height) return
  const pad = 10
  const boxes = []
  const pushLocal = el => {
    const r = el?.getBoundingClientRect?.()
    if (!r || r.width < 2 || r.height < 2) return
    const x1 = clamp(r.left - base.left - pad, 0, size.width)
    const y1 = clamp(r.top - base.top - pad, 0, size.height)
    const x2 = clamp(r.right - base.left + pad, 0, size.width)
    const y2 = clamp(r.bottom - base.top + pad, 0, size.height)
    if (x2 > x1 && y2 > y1) boxes.push({ x1, y1, x2, y2 })
  }
  pushLocal(stageEl.querySelector('.lpn-legend'))
  pushLocal(stageHint.value)
  const zoomEl = stageEl.closest('.lpn')?.querySelector('.lpn-zoom')
  const zr = zoomEl?.getBoundingClientRect?.()
  if (zr && zr.width > 2 && zr.bottom > base.top && zr.top < base.bottom + 24) {
    boxes.push({
      x1: clamp(zr.left - base.left - pad, 0, size.width),
      y1: clamp(size.height - 38 - pad, 0, size.height),
      x2: size.width,
      y2: size.height
    })
  } else {
    boxes.push({ x1: Math.max(0, size.width - 210), y1: Math.max(0, size.height - 44), x2: size.width, y2: size.height })
  }
  cachedHudBoxes = boxes
}

function queueDraw() {
  renderPending = true
}

function syncCanvasHud(now) {
  if (!pointers.size && shownHover !== hoverId) {
    shownHover = hoverId
    hoverLabel.value = buildHoverCard(hoverHit, hoverId)
  }
  stage.value?.classList.toggle('is-dragging', dragActive)
  stage.value?.classList.toggle('is-resizing', Boolean(entryResize || planetResize))
  const hint = orbitPreview?.target ? '松手合并轨道'
    : orbitPreview ? `全息极轨校准 · R ${orbitPreview.radius.toFixed(2)}${Number.isFinite(orbitPreview.angle) ? ` · θ ${Math.round(orbitPreview.angle * 180 / Math.PI)}°` : ''}`
    : orbitEditing.value ? '向内或向外拖动轨道 · Esc 退出轨道编辑'
    : planetResize ? `星域缩放 · ${planetResize.size}%` : DEFAULT_STAGE_HINT
  if (stageHint.value && (now - lastHud >= 100 || !dragActive || orbitPreview?.target)) {
    if (stageHint.value.textContent !== hint) {
      stageHint.value.textContent = hint
      if (lastHintText !== hint) {
        lastHintText = hint
        measureHudBoxes()
      }
    }
    stageHint.value.classList.toggle('lpn-merge-hint', Boolean(orbitPreview?.target))
  }
  if (now - lastHud >= 100) {
    const percent = `${Math.round(scene.zoom * 100)}%`
    if (zoomReadout.value && zoomReadout.value.textContent !== percent) zoomReadout.value.textContent = percent
    lastHud = now
  }
}

function draw() {
  if (!ctx || !size.width || !size.height) return
  const now = performance.now()
  renderPending = false
  const focusDt = clamp(now - lastDraw, 1, 36)
  lastDraw = now
  const data = system.value
  const preview = orbitPreview
  const display = preview ? {
    ...data,
    planets: data.planets.map(body => {
      const draggingSingle = Boolean(preview.planetId)
      const sameOrbit = !draggingSingle && body.orbitId === activeOrbit.value
      const samePlanet = draggingSingle && body.id === preview.planetId
      if (!sameOrbit && !samePlanet) return body
      const next = { ...body }
      if (samePlanet && !preview.target && preview.detachPreview) next.orbitId = `__preview__${body.id}`
      if ((sameOrbit || samePlanet) && Number.isFinite(preview.radius)) next.orbitRadius = preview.radius
      if (samePlanet && Number.isFinite(preview.angle)) {
        const phaseOffset = (motionPhases.get(body.id)?.orbit || 0) + body.orbitSpeed * scene.time
        next.orbitPhase = preview.angle - phaseOffset
      }
      return next
    })
  } : data
  const draggingNodeId = gesture?.node && gesture?.moved ? gesture.node.id : ''
  const previewActiveOrbit = preview?.planetId && !preview.target && preview.detachPreview
    ? `__preview__${preview.planetId}` : activeOrbit.value
  painted = paintNetwork(ctx, size, display, scene, {
    positions: positions.value, framingPositions: framingPositions.value,
    entryRadii: entryRadii.value, entryResize, entryDrag,
    planetResize, resizingSetId: planetResize?.id || '',
    rimHoverId,
    draggingNodeId,
    orbitPreview: preview,
    layers: layers.value, soloLayer: soloLayer.value,
    planetSizes: planetSizes.value, planetSettingsId: speedMenu.value?.body.id,
    nodeId: nodeId.value, bridgeId: bridgeId.value, hoverId,
    workTitle: props.workTitle, reduced: reduced.value, satelliteId: satelliteId.value,
    centerGlow: centerGlow.value, centerGlowTime, nodeMotionTime,
    centerSpectrum: activeCenterSpectrum || targetCenterSpectrum.value,
    backdropPalette: props.backdropPalette,
    motionPhases, focusWeights, focusDt, hudBoxes: cachedHudBoxes,
    orbitEditing: orbitEditing.value, activeOrbit: (orbitEditing.value || preview) ? previewActiveOrbit : '',
    hoverOrbit: orbitEditing.value ? hoverOrbit : '',
    mergeOrbit: preview?.target,
    rotating: Boolean(gesture?.moved && gesture.kind === 'pointer' && !gesture.node && !gesture.planet)
      || Math.hypot(angularVelocity.yaw, angularVelocity.pitch) > .00028
  })
  painted.pose = cameraPose(scene)
  syncCanvasHud(now)
}

/* ---------- 星系实时布局与相机/动画循环 ---------- */
function refreshFraming(view = overviewView()) {
  if (!size.width || !size.height) return
  scene.framing = galaxyFraming(size, system.value, framingPositions.value, view,
    spacing.value === referenceSpacing.value ? null : referenceSystem.value)
}

function measure() {
  const { clientWidth: width, clientHeight: height } = stage.value
  const resized = width !== size.width || height !== size.height
  if (resized && (gesture || flight)) cancelGesture()
  const ratio = Math.min(devicePixelRatio || 1, 1.5)
  size = { width, height }
  if (width && height) layoutAspect.value = clamp(Math.round(width / height * 10) / 10, 1.3, 2.6)
  canvas.value.width = Math.round(width * ratio)
  canvas.value.height = Math.round(height * ratio)
  if (width && height) ctx?.setTransform(canvas.value.width / width, 0, 0, canvas.value.height / height, 0, 0)
  if (resized || !scene.framing) refreshFraming()
  measureHudBoxes()
  positionSpeedMenu()
  positionCenterMenu()
  draw()
}

function interact(hardStop = true) {
  idleSince = performance.now()
  if (!hardStop) return
  idleSpeed = 0
  wheelUntil = 0
  angularVelocity.yaw = angularVelocity.pitch = 0
  flight = null
  targetCamera = cameraPose(painted?.pose || scene)
  setCamera(targetCamera)
}

function animate(now) {
  const dt = Math.min(40, lastFrame ? now - lastFrame : 0)
  const drawnBeforeFrame = lastDraw
  lastFrame = now
  const paint = () => draw()
  const before = cameraPose(scene)
  const moving = stepCamera(scene, targetCamera, angularVelocity, dt, reduced.value)
  if (scene.yaw !== before.yaw || scene.pitch !== before.pitch) scene.view.copy(cameraView(scene))
  const changed = scene.yaw !== before.yaw || scene.pitch !== before.pitch || scene.panX !== before.panX
    || scene.panY !== before.panY || scene.zoom !== before.zoom || moving
  const spectrumMoved = stepCenterSpectrum(now)
  const glowRunning = !reduced.value && !document.hidden && centerGlow.value.speed > 0
  if (glowRunning) centerGlowTime = advanceCenterGlow(centerGlowTime, dt, centerGlow.value.speed)
  const nodeMotionRunning = !reduced.value && !document.hidden && !motionPaused.value && hasAnimatedWeightedNodes.value
  if (!reduced.value && !document.hidden && !motionPaused.value) nodeMotionTime += dt

  if (flight && !moving) {
    const next = flight
    flight = null
    // Take the destination anchor from the exact frame at the end of the push.
    draw()
    const anchor = painted.projected.get(next.id) || painted.bodyPoints.get(next.id)
    enterPlanet(next.id, {
      source: next.source,
      arrival: anchor && { anchor, camera: cameraPose(scene) }
    })
    reportLocation()
  } else if (flight || changed) {
    if (moving) paint()
    else draw()
  } else if (!reduced.value && !document.hidden) {
    const shouldPause = Boolean(
      motionPaused.value || pointers.size || dragActive || hoverId || rimHoverId
      || selected.value || bridge.value || satellite.value
      || layoutOpen.value || orbitEditing.value || speedMenu.value || centerMenu.value
    )
    let needPaint = glowRunning || nodeMotionRunning || spectrumMoved
    if (shouldPause) {
      if (idleSpeed > 0.001) {
        idleSpeed *= Math.exp(-dt / 180)
        if (idleSpeed < 0.002) idleSpeed = 0
        const step = dt * idleSpeed
        scene.time += step
        needPaint = true
      }
    } else if (now - idleSince >= Math.min(TUNING.idleDelay, 520)) {
      idleSpeed = Math.min(1, idleSpeed + (1 - idleSpeed) * (1 - Math.exp(-dt / 650)))
      const step = dt * idleSpeed
      scene.time += step
      needPaint = true
    }
    if (needPaint) paint()
  } else if (spectrumMoved) {
    paint()
  }
  if (!document.hidden && (renderPending || painted?.animationPending) && lastDraw === drawnBeforeFrame) paint()
  if (zoomReadout.value && now - lastHud >= 100 && zoomReadout.value.textContent !== `${Math.round(scene.zoom * 100)}%`) {
    syncCanvasHud(now)
  }
  frame = requestAnimationFrame(animate)
}

function setCamera(pose) {
  Object.assign(scene, pose)
  scene.view.copy(cameraView(scene))
}

function aimCamera(changes, repaint = true) {
  Object.assign(targetCamera, changes)
  const immediate = reduced.value || document.hidden
  if (immediate) setCamera(targetCamera)
  if (repaint || immediate) draw()
}

function enterPlanet(id, { source, arrival, initial } = {}) {
  if (id === setId.value || (id && !model.value.byBody.has(id))) return
  if (gesture) cancelGesture()
  interact()
  const current = cameraPose(scene)
  poses.set(setId.value, {
    camera: source || current, time: scene.time, motionPhases
  })
  hoverId = ''
  hoverLabel.value = null
  focusWeights.clear()
  lastClick = null
  layoutOpen.value = false
  orbitEditing.value = false
  hoverOrbit = ''
  activeOrbit.value = ''
  speedMenu.value = null
  centerMenu.value = null
  setId.value = id
  bridgeId.value = ''
  clearSelection()
  const pose = poses.get(id)
  motionPhases = pose?.motionPhases || new Map()
  scene.time = pose?.time ?? 0
  targetCamera = initial || arrival?.camera || pose?.camera || cameraPose({ yaw: current.yaw, pitch: current.pitch })
  targetCamera = cameraPose(targetCamera)
  setCamera(targetCamera)
  refreshFraming()
  if (arrival && scene.framing) {
    const camera = galaxyProjection(size, scene)
    const center = camera.projectWorld(new Vector3(0, CENTER_ELEVATION, 0))
    const scale = clamp(scene.zoom * arrival.anchor.scale / center.scale, GALAXY_CAMERA.minZoom, GALAXY_CAMERA.maxZoom)
    const ratio = scale / scene.zoom
    Object.assign(targetCamera, {
      zoom: scale,
      panX: arrival.anchor.x - size.width / 2 + centeredPan(camera, center, ratio).panX,
      panY: arrival.anchor.y - size.height * .51 + centeredPan(camera, center, ratio).panY
    })
    setCamera(targetCamera)
  }
  draw()
}


function reportLocation() {
  emit('navigate', { rootId: setId.value || null, activeId: nodeId.value || setId.value || null })
}

function goToPlanet(id, fly = false, anchor) {
  if (id === setId.value) {
    if (flight) { interact(); draw() }
    return
  }
  if (id && !model.value.byBody.has(id)) return
  if (gesture) cancelGesture()
  interact()
  const target = anchor || painted?.projected.get(id) || painted?.bodyPoints.get(id)
  if (fly && target && !reduced.value && !document.hidden) {
    flight = { id, source: cameraPose(scene) }
    focusPoint(target, Math.max(1.52, scene.zoom))
    return
  }
  let branch = activeSet.value
  while (branch?.parent && branch.parent.id !== id) branch = branch.parent
  const restored = poses.get(id)?.camera
  const from = (!id || branch?.parent?.id === id) && restored && painted?.work
  if (from && !reduced.value && !document.hidden) {
    enterPlanet(id, { initial: cameraPose(scene) })
    const destination = painted?.projected.get(branch?.id) || painted?.bodyPoints.get(branch?.id)
    if (destination) {
      const scale = clamp(scene.zoom * from.scale / destination.scale, GALAXY_CAMERA.minZoom, GALAXY_CAMERA.maxZoom)
      const ratio = scale / scene.zoom
      targetCamera = cameraPose({
        ...scene, zoom: scale,
        panX: from.x - size.width / 2 + centeredPan(painted.camera, destination, ratio).panX,
        panY: from.y - size.height * .51 + centeredPan(painted.camera, destination, ratio).panY
      })
      setCamera(targetCamera)
    }
    aimCamera(restored)
  } else enterPlanet(id)
  reportLocation()
}

function focusPoint(point, scale) {
  aimCamera({ zoom: scale, ...centeredPan(painted.camera, point, scale / painted.pose.zoom) })
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
  if (focus && point) focusPoint(point.world ? painted.camera.project(point.world) : point, Math.max(2, scene.zoom))
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

/* ---------- 轨道改径 / 并轨提交与角度重排 ---------- */
function commitOrbits(track) {
  const current = currentOrbitSettings.value
  const { radius, target, planetId, angle } = orbitPreview
  const before = system.value.planets
  const radii = { ...current.radii }
  const joins = { ...current.joins }
  const phases = { ...current.phases }
  const reference = current.spacingReference ?? spacing.value
  if (!current.independent) {
    for (const body of before) {
      if (body.orbitRadius !== body.defaultOrbitRadius || Object.hasOwn(radii, body.orbitId)) {
        radii[body.orbitId] = scaleOrbitRadius(body.orbitRadius, spacing.value, reference)
      }
    }
  }
  const siblings = planetId ? before.filter(body => body.orbitId === track.id && body.id !== planetId) : []
  let resolvedTarget = target
  if (planetId) {
    // Direct drag of a single body: detach from any shared ring while keeping siblings together.
    if (siblings.length && track.id === planetId) {
      const nextLead = siblings[0]
      const preservedRadius = scaleOrbitRadius(track.radius, spacing.value, reference)
      radii[nextLead.id] = preservedRadius
      delete joins[nextLead.id]
      for (const sibling of siblings.slice(1)) {
        joins[sibling.id] = nextLead.id
        delete radii[sibling.id]
      }
      if (resolvedTarget === planetId) resolvedTarget = nextLead.id
    }
    if (resolvedTarget && resolvedTarget !== planetId) {
      joins[planetId] = resolvedTarget
      delete radii[planetId]
      activeOrbit.value = resolvedTarget
    } else {
      delete joins[planetId]
      radii[planetId] = scaleOrbitRadius(radius, spacing.value, reference)
      activeOrbit.value = planetId
    }
    if (Number.isFinite(angle)) phases[planetId] = angle
  } else if (target) {
    for (const id of Object.keys(joins)) {
      if (joins[id] === track.id) joins[id] = target
    }
    joins[track.id] = target
    delete radii[track.id]
    activeOrbit.value = target
  } else {
    radii[track.id] = scaleOrbitRadius(radius, spacing.value, reference)
  }
  orbitPreview = null
  const next = { speeds: current.speeds, radii, joins, phases, independent: true }
  if (before.some(body => body.orbitAspect > 1)) next.ellipse = true
  const legacy = current.independent || current.pin || Object.keys(current.radii || {}).length || Object.keys(current.joins || {}).length
  if (!setId.value && (current.topology || !legacy)) next.topology = true
  if (Number.isFinite(current.spacingReference) || !resolvedTarget) next.spacingReference = reference
  orbitSettings.value = {
    ...orbitSettings.value, [setId.value]: next
  }
  if (resolvedTarget && !planetId) {
    spreadJoinedBodies(before, track.id, resolvedTarget)
    status.value = '已合并轨道'
  } else if (planetId) {
    const body = system.value.planets.find(planet => planet.id === planetId)
    const phase = motionPhases.get(planetId)
    if (body && phase) phase.orbit = -body.orbitSpeed * scene.time
    status.value = resolvedTarget ? '已合并轨道' : '轨道位置已保存'
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

function setCenterColorSource(source) {
  if (centerGlow.value.colorSource === source) return
  const patch = { colorSource: source }
  if (source === 'custom' && (!centerGlowSettings.value[setId.value] || centerGlow.value.colorSource !== 'custom')) {
    const s = targetCenterSpectrum.value
    patch.color = rgbToHex(s.primary)
    patch.accentColor = rgbToHex(s.accent)
  }
  centerGlowSettings.value = {
    ...centerGlowSettings.value,
    [setId.value]: normalizeCenterGlow({ ...centerGlow.value, ...patch })
  }
  draw()
  void saveCenterGlow()
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
  motionPhases = new Map()
  scene.time = 0
  activeOrbit.value = ''
  saveOrbitSettings()
  status.value = '已恢复全部轨道半径'
  draw()
}

function toggleOrbitEditing() {
  if (gesture?.kind === 'orbit') cancelGesture()
  interact()
  orbitEditing.value = !orbitEditing.value
  hoverOrbit = ''
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
  if (!commit) {
    entryDrag = { id: node.id, local: point }
    queueDraw()
    return
  }
  entryDrag = null
  const bodyId = node.parent.id
  const next = {
    ...positions.value,
    [bodyId]: { ...positions.value[bodyId], [node.id]: point.toArray() }
  }
  persist(next)
}

function resetLayout() {
  const next = { ...positions.value }
  const bodyId = selected.value && painted?.projected.has(selected.value.id) ? selected.value.parent.id : ''
  for (const body of system.value.planets) {
    if (!bodyId || bodyId === body.id) delete next[body.id]
  }
  if (!bodyId && (currentOrbitSettings.value.radii || currentOrbitSettings.value.phases || currentOrbitSettings.value.joins)) {
    orbitSettings.value = { ...orbitSettings.value, [setId.value]: { speeds: currentOrbitSettings.value.speeds } }
    activeOrbit.value = ''
    saveOrbitSettings()
  }
  persist(next)
  if (!bodyId) {
    motionPhases = new Map()
    scene.time = 0
    resetView()
  }
  status.value = bodyId ? '已恢复当前星体的自动布局' : '已恢复当前星系的自动布局'
}

function changeDepth(event) {
  if (!canEditDepth.value) return
  const point = painted?.projected.get(selected.value.id)?.local.clone() ?? localPosition(selected.value, positions.value)
  if (!point.lengthSq()) point.copy(selected.value.position)
  positionAt(selected.value, point.setLength(Number(event.target.value)), event.type === 'change')
}

function turn(x, y) {
  const { yawPerPixel, pitchPerPixel, pitchLimit } = GALAXY_CAMERA
  aimCamera({
    yaw: targetCamera.yaw + x * yawPerPixel,
    pitch: clamp(targetCamera.pitch + y * pitchPerPixel, -pitchLimit, pitchLimit)
  }, false)
}

function scaleTo(value) {
  aimCamera({ zoom: clamp(value, GALAXY_CAMERA.minZoom, GALAXY_CAMERA.maxZoom) }, false)
}

function changeZoom(factor, wheel = false) {
  if (gesture || pointers.size) return
  const now = performance.now()
  if (flight || (wheel && now > wheelUntil)) {
    const previousZoom = targetCamera.zoom
    const continuingZoom = !flight && previousZoom !== scene.zoom
    interact()
    if (continuingZoom) targetCamera.zoom = previousZoom
  }
  angularVelocity.yaw = angularVelocity.pitch = 0
  idleSince = now
  if (wheel) wheelUntil = now + 420
  scaleTo(targetCamera.zoom * factor)
}

function onWheel(event) {
  const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? size.height : 1)
  changeZoom(Math.exp(-delta * .0014), true)
}

function resetView() {
  if (gesture?.kind === 'orbit' || gesture?.kind === 'resize') cancelGesture()
  interact()
  refreshFraming()
  aimCamera(cameraPose())
}
function focusCurrent() {
  if (selected.value) selectNode(selected.value, true, true)
  else resetView()
}

function coordinates(e) {
  const rect = canvas.value.getBoundingClientRect()
  return { x: (e.clientX - rect.left) * size.width / (rect.width || 1),
    y: (e.clientY - rect.top) * size.height / (rect.height || 1) }
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
  const anchor = camera.projectWorld(orbitPoint(track.radius, angle, track.elevation, track.aspect))
  const direction = orbitPoint(1, angle)
  activeOrbit.value = track.id
  hoverOrbit = ''
  gesture = {
    kind: 'orbit', start: point, track, camera, anchor, direction, angle,
    targets: orbits.filter(other => other.id !== track.id)
  }
  draw()
}

/* ---------- 命中测试与指针手势（拖拽条目 / 改轨 / 卡尺缩放 / 旋转 / 平移） ---------- */
function hitAt(point) {
  const hits = painted?.hits || []
  const distance = hit => Math.hypot(point.x - hit.x, point.y - hit.y)
  const marker = hits.findLast(hit => {
    if (hit.kind === 'node') return distance(hit) <= (hit.hitRadius ?? hit.radius)
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
  if (orbitEditing.value) return null
  if (!hit || hit.kind === 'node') {
    const candidates = hit ? [hit] : [...(painted?.hits || [])].reverse()
    const entryHit = candidates.find(({ x, y, radius, resizable }) => resizable
      && Math.abs(Math.hypot(point.x - x, point.y - y) - radius) <= Math.min(5, radius * .32))
    if (entryHit) return { ...entryHit, mode: 'entry' }
  }
  if (!hit || hit.kind === 'planet') {
    const planetHit = [...(painted?.hits || [])].reverse().find(({ x, y, rimRadius, resizableRim }) => resizableRim
      && Math.abs(Math.hypot(point.x - x, point.y - y) - rimRadius) <= 7.5)
    if (planetHit) return { ...planetHit, mode: 'planet' }
  }
  return null
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
  shownHover = ''
  const point = coordinates(event)
  pointers.set(event.pointerId, point)
  canvas.value.setPointerCapture(event.pointerId)
  if (middle) {
    hoverId = ''
    gesture = { kind: 'pan', start: point, panX: scene.panX, panY: scene.panY }
    dragActive = true
    draw()
    return
  }
  if (pointers.size === 2) {
    entryDrag = null
    gesture = { kind: 'pinch', distance: pinchDistance(), scale: scene.zoom }
    dragActive = true
    draw()
    return
  }
  const hit = hitAt(point)
  const rim = resizeAt(point, hit)
  if (rim?.mode === 'planet') {
    gesture = {
      kind: 'resize', mode: 'planet', hit: rim,
      startDistance: Math.hypot(point.x - rim.x, point.y - rim.y),
      baseCaliper: rim.baseCaliper || (rim.rimRadius / (planetSizeOf(rim.id) / 100)),
    }
    return
  }
  if (rim) {
    const planetScale = rim.planetId === rim.id ? planetSizeOf(rim.id) / 100 : 1
    gesture = { kind: 'resize', mode: 'entry', hit: rim, node: model.value.byNode.get(rim.id),
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
  if (!hit && event.button === 0 && event.shiftKey) {
    hoverId = ''
    gesture = { kind: 'pan', start: point, panX: scene.panX, panY: scene.panY, shiftPan: true }
    dragActive = true
    draw()
    return
  }
  const node = hit?.kind === 'node' ? model.value.byBody.get(hit.id) : null
  const planet = hit?.kind === 'planet' && !hit.halfWidth ? system.value.planets.find(b => b.id === hit.id) : null
  gesture = { kind: 'pointer', start: point, last: point, samples: [{ ...point, time: event.timeStamp }], hit, node, planet, moved: false }
  const projected = node && painted?.projected.get(node.id)
  if (projected) {
    gesture.local = projected.local.clone()
    gesture.world = projected.world
    gesture.center = projected.center
    gesture.inverse = projected.orientation.clone().invert()
    gesture.localScale = TUNING.detailRadius / projected.sphereRadius
    gesture.camera = painted.camera
    const origin = painted.camera.project(projected.world)
    gesture.offset = { x: origin.x - point.x, y: origin.y - point.y }
  } else if (planet) {
    const anchor = painted?.bodyPoints.get(planet.id)
    if (anchor) {
      const hasSiblings = system.value.planets.some(b => b.orbitId === planet.orbitId && b.id !== planet.id)
      gesture.camera = painted.camera
      gesture.track = { id: planet.orbitId, radius: planet.orbitRadius }
      gesture.hasSiblings = hasSiblings
      gesture.planetScreenZ = anchor.z
      gesture.planetOffset = { x: anchor.x - point.x, y: anchor.y - point.y }
      gesture.targets = (painted?.orbits || []).filter(other => hasSiblings ? true : other.id !== planet.orbitId)
    }
  }
}

function buildHoverCard(activeHit, id) {
  if (!activeHit || !id) return null
  if (activeHit.kind === 'satellite') {
    const sat = model.value.bySatellite.get(id)
    if (!sat?.target) return null
    const kind = sat.target.kind
    return {
      kind: 'satellite',
      badge: sat.target.kindLabel || '关联',
      badgeColor: SAT_COLOR_MAP[kind] || '#47D7E8',
      relation: sat.label || '跨模块关联',
      title: sat.target.title || '未命名关联项',
      summary: distinctSummary(sat.target.title, sat.target.summary, sat.description) || sat.description || '',
      hint: '单击查看摘要 · 双击跳转至该模块',
      x: activeHit.x,
      y: activeHit.y - activeHit.radius - 10
    }
  }
  if (activeHit.kind === 'node') {
    const item = model.value.byBody.get(id)
    if (!item) return null
    const linkCount = item.links?.length || 0
    const satCount = (system.value.rolledSatellites?.get(item.id) ?? item.satellites ?? []).length
    const weightMeta = entryWeightMeta(item.weight)
    const domainTitle = item.parent?.title ? item.parent.title.slice(0, 10) : ''
    const badge = domainTitle ? `${domainTitle} · ${weightMeta.label}` : weightMeta.label
    return {
      kind: 'node',
      weight: weightMeta.id,
      badge,
      badgeColor: weightMeta.id === 'core' || weightMeta.id === 'key' ? '#47D7E8' : (item.color || '#8CB4FF'),
      relation: `${linkCount} 条关系${satCount ? ` · ${satCount} 关联` : ''}${item.entries?.length ? ` · ${item.entries.length} 子项` : ''}`,
      title: item.title,
      summary: distinctSummary(item.title, item.summary),
      hint: '单击查看摘要 · 拖拽调整位置',
      x: activeHit.x,
      y: activeHit.y - activeHit.radius - 10
    }
  }
  if (activeHit.kind === 'planet') {
    const planet = system.value.planets.find(b => b.id === id)
    if (!planet) return null
    const anchor = painted?.bodyPoints.get(id) || activeHit
    const r = anchor.radius || activeHit.rimRadius || 28
    return {
      kind: 'planet',
      badge: planet.entries?.length ? `设定集 · ${planet.entries.length} 条目` : '空设定集 · 待勘定',
      badgeColor: planet.color || '#47D7E8',
      relation: `${planet.bridges?.length || 0} 组跨集连接`,
      title: planet.title,
      summary: distinctSummary(planet.title, planet.summary),
      hint: '单击进入星域 · 拖拽调整轨道 · 拖卡尺边缩放',
      x: anchor.x,
      y: anchor.y - r - 10
    }
  }
  return null
}

function onMove(event) {
  const point = coordinates(event)
  if (!pointers.has(event.pointerId)) {
    if (flight) return
    const hit = hitAt(point)
    const rim = resizeAt(point, hit)
    const activeHit = hit || rim
    const hover = activeHit?.id || ''
    const nextRimHover = rim?.mode === 'planet' ? rim.id : ''
    if (hover !== hoverId || hover !== shownHover || nextRimHover !== rimHoverId) {
      hoverId = hover
      rimHoverId = nextRimHover
      if (hover || nextRimHover) interact(false)
      else idleSince = performance.now()
      hoverHit = activeHit
      queueDraw()
    }
    const track = orbitEditing.value && !hit ? orbitAt(point) : null
    const nextOrbit = track?.track.id || ''
    if (hoverOrbit !== nextOrbit) {
      hoverOrbit = nextOrbit
      queueDraw()
    }
    canvas.value.style.cursor = rim ? 'ew-resize' : hover ? 'pointer' : track ? 'ew-resize' : 'grab'
    return
  }
  pointers.set(event.pointerId, point)
  if (gesture?.kind === 'pinch') return scaleTo(gesture.scale * pinchDistance() / gesture.distance)
  if (gesture?.kind === 'resize') {
    if (gesture.mode === 'planet') {
      const { id, x, y, rimRadius } = gesture.hit
      const delta = Math.hypot(point.x - x, point.y - y) - gesture.startDistance
      if (!planetResize && Math.abs(delta) < TUNING.dragThreshold) return
      dragActive = true
      const nextRadius = clamp(rimRadius + delta, gesture.baseCaliper * .5, gesture.baseCaliper * 2)
      const nextSize = planetSizeValue(nextRadius / gesture.baseCaliper * 100)
      planetResize = { id, radius: nextRadius, size: nextSize }
      queueDraw()
      return
    }
    const { id, x, y, radius } = gesture.hit
    const delta = Math.hypot(point.x - x, point.y - y) - gesture.startDistance
    if (!entryResize && Math.abs(delta) < Math.min(TUNING.dragThreshold, radius / 3)) return
    dragActive = true
    entryResize = { id, x, y, radius: Math.max(radius + delta, MIN_ENTRY_RADIUS * gesture.scale) }
    queueDraw()
    return
  }
  if (gesture?.kind === 'orbit') {
    const { start, track, camera, anchor, direction, angle, targets } = gesture
    const dx = point.x - start.x, dy = point.y - start.y
    if (!gesture.moved && Math.hypot(dx, dy) < TUNING.dragThreshold) return
    dragActive = gesture.moved = true
    const world = orbitDragPoint(camera, anchor.x + dx, anchor.y + dy, anchor.z, track.elevation)
    const aspect = track.aspect || 1, aspectZ = track.aspectZ || 1
    const radius = Math.max(TUNING.workRadius + .34, world.x / aspect * direction.x + world.z / aspectZ * direction.z)
    const projected = camera.projectWorld(orbitPoint(radius, angle, track.elevation, aspect, aspectZ))
    let nearest = null
    let threshold = 8
    for (const other of targets) {
      const otherPoint = camera.projectWorld(orbitPoint(other.radius, angle, track.elevation, other.aspect || aspect, other.aspectZ || aspectZ))
      const distance = Math.hypot(projected.x - otherPoint.x, projected.y - otherPoint.y)
      if (distance >= threshold) continue
      nearest = other
      threshold = distance
    }
    orbitPreview = {
      trackId: track.id,
      radius: nearest?.radius ?? radius,
      angle,
      target: nearest?.id
    }
    queueDraw()
    return
  }
  if (gesture?.kind === 'pan') {
    const { start, panX, panY } = gesture
    aimCamera({ panX: panX + point.x - start.x, panY: panY + point.y - start.y }, false)
    return
  }
  if (!gesture) return
  const { start, last, node, planet } = gesture
  const dx = point.x - start.x, dy = point.y - start.y
  if (!gesture.moved && Math.hypot(dx, dy) < TUNING.dragThreshold) return
  dragActive = gesture.moved = true
  if (planet && gesture.track) {
    activeOrbit.value = gesture.track.id
    const x = point.x + gesture.planetOffset.x, y = point.y + gesture.planetOffset.y
    const uv = worldToOrbitUV(orbitDragPoint(gesture.camera, x, y, gesture.planetScreenZ, planet.elevationB))
    uv.u /= planet.orbitAspect || 1
    uv.v /= planet.orbitAspectZ || 1
    const rawRadius = Math.max(TUNING.workRadius + .34, Math.hypot(uv.u, uv.v))
    const rawAngle = ((Math.atan2(uv.v, uv.u) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    let nearest = null
    let threshold = 0.14
    for (const other of gesture.targets || []) {
      const dist = Math.abs(rawRadius - other.radius)
      if (dist >= threshold) continue
      nearest = other
      threshold = dist
    }
    orbitPreview = {
      planetId: planet.id,
      trackId: gesture.track.id,
      detachPreview: Boolean(gesture.hasSiblings),
      radius: nearest?.radius ?? rawRadius,
      angle: rawAngle,
      target: nearest?.id
    }
    queueDraw()
  } else if (node && gesture.local) {
    let local
    if (event.shiftKey) {
      const ray = gesture.local.clone()
      if (!ray.lengthSq()) ray.copy(node.position)
      local = ray.setLength(clamp(gesture.local.length() - dy * .015, .2, TUNING.detailRadius * .85))
    } else {
      local = gesture.camera.unproject(point.x + gesture.offset.x, point.y + gesture.offset.y, gesture.world.z)
        .sub(gesture.center).applyQuaternion(gesture.inverse).multiplyScalar(gesture.localScale)
        .clampLength(0, TUNING.detailRadius * .85)
    }
    positionAt(node, local, false)
  } else {
    const now = event.timeStamp
    const x = point.x - last.x, y = point.y - last.y
    gesture.samples.push({ ...point, time: now })
    while (gesture.samples.length > 2 && gesture.samples[1].time < now - 75) gesture.samples.shift()
    turn(x, y)
  }
  gesture.last = point
}

function cancelGesture() {
  const pan = gesture?.kind === 'pan' ? { panX: gesture.panX, panY: gesture.panY } : null
  entryDrag = null
  orbitPreview = null
  entryResize = null
  planetResize = null
  const ids = [...pointers.keys()]
  gesture = null
  pointers.clear()
  for (const id of ids) if (canvas.value?.hasPointerCapture(id)) canvas.value.releasePointerCapture(id)
  dragActive = false
  interact()
  if (pan) {
    Object.assign(targetCamera, pan)
    setCamera(targetCamera)
  }
  draw()
}

function onUp(event) {
  if (gesture?.kind === 'pan' && !gesture.shiftPan && event.button !== 1) return
  if (!pointers.delete(event.pointerId) || !gesture) return
  queueDraw()
  if (gesture.kind === 'pinch') {
    if (pointers.size) return
    gesture = null
    dragActive = false
    idleSince = performance.now()
    return
  }
  const current = gesture
  const resized = entryResize
  const planetResized = planetResize
  entryResize = null
  planetResize = null
  gesture = null
  dragActive = false
  idleSince = performance.now()
  if (planetResized) {
    lastClick = null
    setPlanetSize(planetResized.id, planetResized.size, true)
    return
  }
  if (resized) {
    lastClick = null
    if (Math.abs(resized.radius - current.hit.radius) > .01) saveEntryRadius(resized.id, entryReferenceRadius(resized.radius, current.scale))
    else draw()
    return
  }
  if (current.kind === 'orbit') {
    lastClick = null
    if (current.moved) commitOrbits(current.track)
    else draw()
    return
  }
  if (current.kind === 'pan') {
    lastClick = null
    return
  }
  if (current.moved) {
    lastClick = null
    if (current.planet && current.track && orbitPreview) {
      commitOrbits(current.track)
      if (!orbitEditing.value) activeOrbit.value = ''
    } else if (current.local && entryDrag) positionAt(current.node, entryDrag.local, true)
    else if (!reduced.value) {
      const newest = current.samples.at(-1)
      const oldest = current.samples[0]
      const pause = event.timeStamp - newest.time
      if (pause < 80 && newest !== oldest) {
        const dt = Math.max(1, newest.time - oldest.time)
        // Convert the prototype's nominal 16 ms samples to angular velocity per millisecond.
        const decay = Math.exp(-Math.max(0, pause) / GALAXY_CAMERA.release)
        angularVelocity.yaw = clamp((newest.x - oldest.x) / dt, -2.5, 2.5) * .00035 * 16 * decay
        angularVelocity.pitch = clamp((newest.y - oldest.y) / dt, -2.5, 2.5) * .0003 * 16 * decay
      }
    }
    return
  }
  const hit = current.hit
  if (hit?.kind === 'planet') goToPlanet(hit.id, true, painted.bodyPoints.get(hit.id) || hit)
  else if (hit?.kind === 'bridge') showBridge(hit.id)
  else if (hit?.kind === 'satellite') {
    const now = performance.now()
    const double = lastClick?.id === hit.id && now - lastClick.time < 360
    lastClick = { id: hit.id, time: now }
    showSatellite(hit.id)
    if (double) {
      const sat = model.value.bySatellite.get(hit.id)
      if (sat?.target) emit('open-target', sat.target)
    }
  } else if (hit?.kind === 'node') {
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
    if (!event.repeat || flight) interact()
    turn(event.key === 'ArrowRight' ? 18 : event.key === 'ArrowLeft' ? -18 : 0,
      event.key === 'ArrowDown' ? 18 : event.key === 'ArrowUp' ? -18 : 0)
  }
}

function onLeave() { hoverId = ''; rimHoverId = ''; hoverOrbit = ''; hoverLabel.value = null; idleSince = performance.now(); draw() }
function changeMotion() {
  reduced.value = motion.matches
  angularVelocity.yaw = angularVelocity.pitch = 0
  if (reduced.value) {
    if (spectrumTo) {
      activeCenterSpectrum = spectrumTo
      spectrumFrom = null
      spectrumTo = null
    }
    const next = flight
    flight = null
    setCamera(targetCamera)
    if (next) {
      enterPlanet(next.id, { source: next.source })
      reportLocation()
      return
    }
  }
  draw()
}

watch(model, () => {
  if (gesture?.kind === 'orbit') cancelGesture()
  if (gesture?.kind === 'resize' && !model.value.byBody.has(gesture.hit.id)) cancelGesture()
  if (satelliteId.value && !satellite.value) satelliteId.value = ''
  if (setId.value && !activeSet.value) enterPlanet('')
  if (nodeId.value && !selected.value) clearSelection()
  if (bridgeId.value && !bridge.value) bridgeId.value = ''
  draw()
})
watch(() => props.location, applyLocation, { flush: 'post' })
watch([centerSaveErrors, () => centerGlow.value.colorSource, () => centerGlow.value.colorMode, () => centerGlow.value.effect], positionCenterMenu, { flush: 'post' })
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
  <section class="lpn" :class="{ 'lpn-embedded': embedded }" :style="centerAmbientStyle" aria-label="关系星系" @keydown="onKey" :data-galaxy-center="setId" :data-galaxy-selection="nodeId">
    <div class="lpn-shell">
      <div class="lpn-workspace">
        <div ref="stage" class="lpn-stage">
          <canvas ref="canvas" tabindex="0" aria-label="三维关系画布，方向键旋转，Shift+F10 编辑中心发光，可通过设定目录定位条目，拖动条目圆边缘调整大小"
            @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="cancelGesture"
            @lostpointercapture="event => { if (pointers.has(event.pointerId)) cancelGesture() }" @pointerleave="onLeave"
            @wheel.prevent="onWheel"
            @contextmenu.prevent="onMenu"
            @mousedown="event => { if (event.button === 1) event.preventDefault() }"
            @auxclick="event => { if (event.button === 1) event.preventDefault() }" />
          <div v-if="hoverLabel" class="lpn-node-hover"
            :data-edge="hoverLabel.x < 126 ? 'left' : hoverLabel.x > size.width - 126 ? 'right' : undefined"
            :style="{ left: clamp(hoverLabel.x, 12, size.width - 12) + 'px', top: Math.max(46, hoverLabel.y) + 'px' }">
            <div class="lpn-hover-head">
              <span class="lpn-hover-badge" :style="{ '--badge-color': hoverLabel.badgeColor }">
                <LoreWeightIcon v-if="hoverLabel.weight" :weight="hoverLabel.weight" :size="12" />
                <span>{{ hoverLabel.badge }}</span>
              </span>
              <small v-if="hoverLabel.relation" class="lpn-hover-rel">{{ hoverLabel.relation }}</small>
            </div>
            <strong class="lpn-hover-title">{{ hoverLabel.title }}</strong>
            <p v-if="hoverLabel.summary" class="lpn-hover-desc">{{ hoverLabel.summary }}</p>
            <small v-if="hoverLabel.hint" class="lpn-hover-hint">{{ hoverLabel.hint }}</small>
          </div>
          <div v-if="centerMenu" ref="centerPanel" class="lpn-speed-menu lpn-center-menu" role="dialog" tabindex="-1"
            aria-label="中心星体设置" :style="{ left: centerMenu.x + 'px', top: centerMenu.y + 'px' }" @contextmenu.prevent>
            <header class="lpn-speed-menu-header">
              <div><p class="lpn-speed-menu-head">中心星体</p><small>{{ activeSet?.title || workTitle }}</small></div>
              <button type="button" class="lpn-speed-close" aria-label="关闭中心星体设置" @click="closeCenterMenu(true)">×</button>
            </header>
            <PlanetSizeControl :value="planetSizeOf(setId)"
              @preview="setPlanetSize(setId, $event)" @commit="setPlanetSize(setId, $event, true)" />
            <div class="lpn-center-setting lpn-center-source-row">
              <span>配色来源</span>
              <div class="lpn-center-segmented" role="radiogroup" aria-label="配色来源">
                <button v-for="(label, id) in CENTER_GLOW_COLOR_SOURCES" :key="id" type="button" role="radio"
                  :aria-checked="centerGlow.colorSource === id" :class="{ active: centerGlow.colorSource === id }"
                  @click="setCenterColorSource(id)">{{ label }}</button>
              </div>
            </div>
            <div v-if="centerGlow.colorSource !== 'custom'" class="lpn-center-backdrop-preview">
              <span class="lpn-center-swatch"
                :style="{ background: `linear-gradient(115deg, ${previewSwatchColors[0]} 0%, ${previewSwatchColors[1]} 52%, ${previewSwatchColors[2]} 100%)` }"
                aria-hidden="true" />
              <small>{{ centerGlow.colorSource === 'classic' ? '设计稿经典冷铂 × 冰青 × 星紫' : '自动同步作品封面与流动背景' }}</small>
            </div>
            <div v-else class="lpn-center-color-pickers" :class="{ single: centerGlow.colorMode === 'solid' }">
              <label class="lpn-center-color-field">
                <span>主色</span>
                <input type="color" aria-label="主色" :value="centerGlow.color"
                  @input="updateCenterGlow('color', $event.target.value)" @change="saveCenterGlow">
              </label>
              <label v-if="centerGlow.colorMode !== 'solid'" class="lpn-center-color-field">
                <span>副色</span>
                <input type="color" aria-label="副色" :value="centerGlow.accentColor"
                  @input="updateCenterGlow('accentColor', $event.target.value)" @change="saveCenterGlow">
              </label>
            </div>
            <label class="lpn-center-setting">
              <span>色彩方式</span>
              <select aria-label="色彩方式" :value="centerGlow.colorMode"
                @change="updateCenterGlow('colorMode', $event.target.value); saveCenterGlow()">
                <option v-for="(label, id) in CENTER_GLOW_COLOR_MODES" :key="id" :value="id">{{ label }}</option>
              </select>
            </label>
            <label class="lpn-center-setting">
              <span>光影动效</span>
              <select aria-label="光影动效" :value="centerGlow.effect"
                @change="updateCenterGlow('effect', $event.target.value); saveCenterGlow()">
                <option v-for="(label, id) in CENTER_GLOW_EFFECTS" :key="id" :value="id">{{ label }}</option>
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
          <div class="lpn-legend" role="group" aria-label="星图图层筛选">
            <button type="button" class="lpn-legend-pill" :class="{ 'is-off': !layers.weave, 'is-solo': soloLayer === 'weave' }"
              @click="toggleLayer('weave')" @mouseenter="setSoloLayer('weave')" @mouseleave="setSoloLayer('')">
              <i class="lpn-key-mesh"></i>条目织网
            </button>
            <button type="button" class="lpn-legend-pill" :class="{ 'is-off': !layers.intra, 'is-solo': soloLayer === 'intra' }"
              @click="toggleLayer('intra')" @mouseenter="setSoloLayer('intra')" @mouseleave="setSoloLayer('')">
              <i class="lpn-key-line"></i>集内关系
            </button>
            <button type="button" class="lpn-legend-pill" :class="{ 'is-off': !layers.cross, 'is-solo': soloLayer === 'cross' }"
              @click="toggleLayer('cross')" @mouseenter="setSoloLayer('cross')" @mouseleave="setSoloLayer('')">
              <i class="lpn-key-cross"></i>{{ activeSet ? '星体间关系' : '跨集关系' }}
            </button>
            <button type="button" class="lpn-legend-pill" :class="{ 'is-off': !layers.satellite, 'is-solo': soloLayer === 'satellite' }"
              @click="toggleLayer('satellite')" @mouseenter="setSoloLayer('satellite')" @mouseleave="setSoloLayer('')">
              <i class="lpn-key-satellite"></i>关联对象
            </button>
          </div>
          <p ref="stageHint" class="lpn-stage-hint"></p>
        </div>

        <aside v-if="selected || bridge || satellite" class="lpn-inspector" aria-label="关系摘要">
          <div class="lpn-inspector-head">
            <span class="lpn-inspector-kicker">
              <i class="lpn-inspector-dot" :style="{ '--dot-color': (selected || satellite?.owner || bridge?.a)?.color || 'var(--lpn-mint)' }" aria-hidden="true" />
              {{ satellite ? '关联对象' : bridge ? '关系明细' : entryPreview ? '条目预览' : '条目摘要' }}
            </span>
            <button type="button" class="lpn-icon" aria-label="关闭摘要" @click="closeDetails()">×</button>
          </div>
          <div class="lpn-inspector-body">
            <template v-if="satellite">
              <h2 :class="{ 'is-long': satellite.target.title.length > 24 }">{{ satellite.target.title }}</h2>
              <div class="lpn-inspector-meta">
                <span class="lpn-meta-chip is-accent">{{ satellite.target.kindLabel || '关联对象' }}</span>
                <span v-if="satellite.label" class="lpn-meta-chip">{{ satellite.label }}</span>
              </div>
              <p v-if="satellite.description" class="lpn-summary">{{ satellite.description }}</p>
              <p v-if="satelliteSummary" class="lpn-summary">{{ satelliteSummary }}</p>
              <div v-if="onOpenTarget" class="lpn-entry-actions">
                <button type="button" class="lpn-pill lpn-primary" @click="emit('open-target', satellite.target)">
                  {{ SAT_ACTION_LABEL[satellite.target.kind] || '打开关联对象' }}
                </button>
              </div>
              <section class="lpn-inspector-sec">
                <h3>所属条目</h3>
                <div class="lpn-list">
                  <button type="button" @click="selectNode(satellite.owner, true)">
                    <span class="lpn-row-title">{{ satellite.owner.title }}</span>
                    <small class="lpn-row-badge">定位所属</small>
                  </button>
                </div>
              </section>
            </template>
            <template v-else>
              <nav v-if="selected && selectedCrumbs.length" class="lpn-inspector-crumbs" aria-label="条目层级">
                <template v-for="(crumb, index) in selectedCrumbs" :key="crumb.id">
                  <i v-if="index" aria-hidden="true">›</i>
                  <button type="button" :title="crumb.title" @click="selectNode(crumb, true)">{{ crumb.title }}</button>
                </template>
              </nav>
              <h2 :class="{ 'is-long': selectedTitle.length > 24 }">{{ selectedTitle }}</h2>
              <div v-if="selected && (!selected.parent || selected.entries?.length || (selected.tags || []).length || normalizeEntryWeight(selected.weight) !== 'standard')" class="lpn-inspector-meta">
                <span v-if="!selected.parent" class="lpn-meta-chip is-accent">设定集</span>
                <span v-if="normalizeEntryWeight(selected.weight) !== 'standard'" class="lpn-meta-chip lpn-weight-chip" :class="`is-${normalizeEntryWeight(selected.weight)}`">
                  <LoreWeightIcon :weight="selected.weight" :size="12" />
                  <span>{{ entryWeightMeta(selected.weight).label }}</span>
                </span>
                <span v-if="selected.entries?.length" class="lpn-meta-chip">{{ selected.entries.length }} 个下级条目</span>
                <span v-for="tag in (selected.tags || []).slice(0, 6)" :key="tag" class="lpn-meta-chip lpn-tag-chip">{{ tag }}</span>
              </div>
              <p v-if="selectedSummary" class="lpn-summary">{{ selectedSummary }}</p>
              <p v-else-if="entryPreview" class="lpn-summary is-empty">暂无补充摘要</p>
              <template v-if="selected && !entryPreview">
                <label v-if="canEditDepth" class="lpn-depth lpn-depth-card"><span>离球心距离</span><output>{{ depth.toFixed(2) }}</output>
                  <input type="range" min=".2" :max="TUNING.detailRadius * .85" step=".05" :value="depth" @input="changeDepth" @change="changeDepth">
                </label>
                <div class="lpn-entry-actions">
                  <button v-if="selected.entries.length && selected.id !== activeSet?.id" type="button" class="lpn-pill lpn-primary" @click="goToPlanet(selected.id, true)">进入下一级</button>
                  <button type="button" class="lpn-pill" :class="{ 'lpn-primary': !selected.entries.length || selected.id === activeSet?.id }" @click="openEntry">打开条目</button>
                  <button v-if="selected.id !== setId && Number.isFinite(entryRadii[selected.id])" type="button"
                    class="lpn-pill" @click="saveEntryRadius(selected.id, null)">恢复自动大小</button>
                </div>
              </template>
              <section v-if="selectedSatellites.length" class="lpn-inspector-sec">
                <h3>关联对象 <small>{{ selectedSatellites.length }}</small></h3>
                <div class="lpn-list">
                  <button v-for="item in selectedSatellites" :key="item.id" type="button" @click="showSatellite(item.id)">
                    <span class="lpn-row-title">{{ item.target.title }}</span>
                    <small class="lpn-row-badge">{{ (item.target.kindLabel ? item.target.kindLabel + ' · ' : '') + (item.label || '关联') }}</small>
                  </button>
                </div>
              </section>
              <section class="lpn-inspector-sec">
                <h3>关联关系 <small>{{ activeLinks.length }}</small></h3>
                <div class="lpn-list">
                  <template v-for="link in activeLinks" :key="link.id">
                    <div v-if="bridge" class="lpn-bridge-row">
                      <button type="button" @click="selectNode(link.from, true)">{{ link.from.title }}</button>
                      <span :title="link.description">{{ link.label || '关联' }}</span>
                      <button type="button" @click="selectNode(link.to, true)">{{ link.to.title }}</button>
                    </div>
                    <button v-else type="button" @click="selectNode(link.from === selected ? link.to : link.from, true)">
                      <span class="lpn-row-title">{{ (link.from === selected ? link.to : link.from).title }}</span>
                      <small class="lpn-row-badge">{{ (link.to === selected && link.reverseLabel) || link.label || '关联' }}{{ link.description ? ' · ' + link.description : '' }}</small>
                    </button>
                  </template>
                  <p v-if="!activeLinks.length" class="lpn-rel-empty">该条目暂无关联关系</p>
                </div>
              </section>
            </template>
          </div>
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
                <p class="lpn-orbit-tip">可直接拖拽星域自由调整轨道半径与角度，或开启轨道编辑拖动轨道线；重合松手可并轨。右键星体设置速度。</p>
                <button v-if="currentOrbitSettings.radii || currentOrbitSettings.phases || currentOrbitSettings.joins" type="button" class="lpn-pill" @click="resetOrbits">恢复默认轨道</button>
              </div>
            </div>
          </div>
          <button v-if="system.planets.length" type="button" class="lpn-pill" @click="resetLayout">恢复自动布局</button>
          <button v-if="system.planets.length" type="button" class="lpn-pill" :class="{ 'is-active-pill': motionPaused }" :aria-pressed="motionPaused" @click="toggleMotionPause">
            {{ motionPaused ? '恢复运转' : '暂停运转' }}
          </button>
          <button v-if="onEditRelations && relationOwner" type="button" class="lpn-pill" @click="emit('edit-relations', relationOwner.id)">编辑关联</button>
          <small role="status">{{ status }}</small>
        </div>
        <div class="lpn-zoom" aria-label="画布视角">
          <button type="button" aria-label="缩小" @click="changeZoom(1 / 1.15)">−</button>
          <button ref="zoomReadout" type="button" aria-label="重置视角" title="重置视角" @click="resetView">100%</button>
          <button type="button" aria-label="放大" @click="changeZoom(1.15)">+</button>
          <button type="button" @click="focusCurrent">聚焦</button>
        </div>
      </footer>
    </div>
  </section>
</template>
