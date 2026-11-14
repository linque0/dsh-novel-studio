<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Vector3 } from 'three'
import { clamp, ease, localPosition, networkModel, orbitPoint, rotation, spacePlanets, spacingValue, TUNING } from './planet-scene.js'
import { paintNetwork } from './draw-planets.js'
import './planet-network.css'

const props = defineProps({
  sets: { type: Array, required: true }, nodes: { type: Array, required: true },
  links: { type: Array, required: true }, initialPositions: { type: Object, default: () => ({}) },
  workTitle: { type: String, default: '未命名作品' },
  satellites: { type: Array, default: () => [] },
  initialSpacing: { type: Object, default: () => ({}) },
  initialOrbitSettings: { type: Object, default: () => ({}) },
  embedded: Boolean,
  onLayoutChange: Function, onSpacingChange: Function, onOpenEntry: Function,
  onOpenTarget: Function, onEditRelations: Function, onOrbitSettingsChange: Function
})
const emit = defineEmits(['open-entry', 'open-target', 'edit-relations', 'select'])
const model = computed(() => networkModel(props.sets, props.nodes, props.links, props.satellites))
const satelliteId = ref('')
const satellite = computed(() => model.value.bySatellite.get(satelliteId.value))
const positions = shallowRef(props.initialPositions)
const framingPositions = shallowRef(props.initialPositions)
const spacingBySystem = shallowRef(props.initialSpacing)
const orbitSettings = shallowRef(props.initialOrbitSettings)
const layoutOpen = ref(false), layoutButton = ref(null)
const orbitEditing = ref(false), activeOrbit = ref(''), speedBodyId = ref('')
let hoverOrbit = ''
const stage = ref(null), canvas = ref(null), searchBox = ref(null)
const setId = ref(''), nodeId = ref(''), bridgeId = ref('')
const paused = ref(false), reduced = ref(false), zoom = ref(1)
const query = ref(''), searching = ref(false), indexOpen = ref(false)
const entryPreview = ref(false), status = ref(''), dragActive = ref(false)
const spacing = computed(() => spacingValue(spacingBySystem.value[setId.value]))
const currentOrbitSettings = computed(() => orbitSettings.value[setId.value] || {})
const system = computed(() => {
  const current = model.value.system(setId.value)
  return { ...current, planets: spacePlanets(current.planets, framingPositions.value, spacing.value, currentOrbitSettings.value) }
})
const speedBody = computed(() => system.value.planets.find(body => body.id === speedBodyId.value) || system.value.planets[0])
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
const entryPath = node => ancestors(node).map(item => item.title).join(' / ')
const searchResults = computed(() => {
  const term = query.value.trim().toLocaleLowerCase()
  if (!term) return []
  const matches = [...model.value.byBody.values()].filter(n =>
    [entryPath(n), n.title, n.summary].join(' ').toLocaleLowerCase().includes(term))
  const rank = n => n.title.toLocaleLowerCase() === term ? 0 : n.title.toLocaleLowerCase().includes(term) ? 1 : 2
  return matches.sort((a, b) => rank(a) - rank(b)).slice(0, 10)
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
let size = { width: 0, height: 0 }, hoverId = '', lastFrame = 0
let idleSince = performance.now(), idleSpeed = 0, keyboardFocus = false
const pointers = new Map()

function draw() {
  if (!ctx || !size.width || !size.height) return
  const now = performance.now()
  const progress = flight ? clamp((now - flight.start) / flightDuration, 0, 1) : 1
  const arrival = ease(clamp((progress - .46) / .54, 0, 1))
  const camera = flight ? {
    ...scene,
    zoom: scene.zoom * (.83 + .17 * arrival),
    pan: scene.pan.clone().multiplyScalar(arrival),
    offset: scene.offset.clone().multiplyScalar(arrival)
  } : scene
  painted = paintNetwork(ctx, size, system.value, camera, {
    positions: positions.value, framingPositions: framingPositions.value, names, now,
    nodeId: nodeId.value, bridgeId: bridgeId.value, hoverId,
    workTitle: props.workTitle, reduced: reduced.value, satelliteId: satelliteId.value,
    motionPhases, orbitEditing: orbitEditing.value, activeOrbit: orbitEditing.value ? activeOrbit.value : '',
    hoverOrbit: orbitEditing.value ? hoverOrbit : '',
    framingData: gesture?.kind === 'orbit' ? gesture.framing : undefined
  })
  if (previousFrame && flight) {
    const { x, y, scale } = flight
    const approach = clamp(progress / .78, 0, 1)
    const focus = approach ** 2 * (3 - 2 * approach)
    const magnify = Math.exp(Math.log(scale) * approach ** 1.65)
    const shiftX = (size.width / 2 - x) * focus + x * (1 - magnify)
    const shiftY = (size.height / 2 - y) * focus + y * (1 - magnify)
    ctx.globalAlpha = 1 - ease(clamp((progress - .48) / .42, 0, 1))
    ctx.fillStyle = '#302736'
    ctx.fillRect(0, 0, size.width, size.height)
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
  if (flight && (width !== size.width || height !== size.height)) interact()
  const ratio = Math.min(devicePixelRatio || 1, 2)
  size = { width, height }
  canvas.value.width = Math.round(width * ratio)
  canvas.value.height = Math.round(height * ratio)
  ctx?.setTransform(ratio, 0, 0, ratio, 0, 0)
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
  } else if (!paused.value && !reduced.value && !pointers.size && !hoverId && !searching.value
      && !indexOpen.value && !layoutOpen.value && !orbitEditing.value && !keyboardFocus && !nodeId.value && !bridgeId.value && !satelliteId.value
      && !document.hidden && now - idleSince >= TUNING.idleDelay) {
    idleSpeed = Math.min(1, idleSpeed + dt / 1100)
    const step = dt * idleSpeed
    scene.time += step
    draw()
  } else if (painted?.labelsPending && !document.hidden) draw()
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
  if (gesture?.kind === 'orbit') cancelGesture()
  if (flight) { interact(); draw() }
  const target = fly && (anchor || painted?.projected.get(id) || painted?.bodyPoints.get(id))
  interact()
  capturePreviousView()
  poses.set(setId.value, {
    view: scene.view.clone(), zoom: scene.zoom, time: scene.time, pan: scene.pan.clone(), offset: scene.offset.clone(), motionPhases
  })
  hoverId = ''
  hoverLabel.value = null
  names.clear()
  lastClick = null
  layoutOpen.value = false
  orbitEditing.value = false
  hoverOrbit = ''
  activeOrbit.value = speedBodyId.value = ''
  setId.value = id
  bridgeId.value = ''
  clearSelection()
  const pose = poses.get(id)
  motionPhases = pose?.motionPhases || new Map()
  scene.time = pose?.time ?? 0
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

function selectNode(node, focus = false, keepSystem = false) {
  if (!node) return
  satelliteId.value = ''
  bridgeId.value = ''
  const isVisible = painted?.projected.has(node.id) || painted?.bodyPoints.has(node.id)
  if (!keepSystem || !isVisible) {
    const home = node.parent?.parent?.id || ''
    if (home !== setId.value) enterPlanet(home)
    else interact()
  } else interact()
  nodeId.value = node.id
  emit('select', node.id)
  entryPreview.value = false
  const point = painted?.projected.get(node.id) || painted?.bodyPoints.get(node.id)
  if (focus && point) cameraTo(scene.view.clone(), Math.max(2, scene.zoom), scene.zoom, point.world)
  else draw()
}

function clearSelection() {
  satelliteId.value = ''
  nodeId.value = ''
  entryPreview.value = false
  emit('select', null)
}

function closeDetails() {
  clearSelection()
  bridgeId.value = ''
  interact()
  draw()
}

function showBridge(id) {
  interact()
  clearSelection()
  indexOpen.value = false
  bridgeId.value = id
  draw()
}

function showSatellite(id) {
  if (!model.value.bySatellite.has(id)) return
  interact()
  clearSelection()
  bridgeId.value = ''
  indexOpen.value = false
  satelliteId.value = id
  draw()
}

function openEntry() {
  if (!selected.value) return
  if (props.onOpenEntry) emit('open-entry', selected.value.id)
  else entryPreview.value = true
}

function chooseResult(node) {
  if (!node) return
  searching.value = false
  query.value = ''
  searchBox.value?.querySelector('input')?.blur()
  indexOpen.value = false
  selectNode(node, true)
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

function adjustSpacing(value, save = false) {
  interact()
  const next = { ...spacingBySystem.value }
  if (value == null) delete next[setId.value]
  else next[setId.value] = spacingValue(value)
  spacingBySystem.value = next
  if (save) reportSave(props.onSpacingChange?.(next), '', '当前无法保存星系间距')
  draw()
}

function updateOrbitSetting(group, id, value, save = true) {
  const current = currentOrbitSettings.value
  const entries = { ...current[group] }
  if (value == null) delete entries[id]
  else entries[id] = value
  orbitSettings.value = { ...orbitSettings.value, [setId.value]: { ...current, [group]: entries } }
  if (save) saveOrbitSettings()
  draw()
}

function saveOrbitSettings() {
  reportSave(props.onOrbitSettingsChange?.(orbitSettings.value), '', '当前无法保存轨道设置')
}

function changeSpeed(kind, event) {
  const value = event.target.valueAsNumber
  const body = speedBody.value
  if (!body || !Number.isFinite(value)) return
  const speed = clamp(value, 0, 1000)
  event.target.value = speed
  updateOrbitSetting('speeds', body.id, { ...currentOrbitSettings.value.speeds?.[body.id], [kind]: speed })
}

function toggleOrbitEditing() {
  interact()
  orbitEditing.value = !orbitEditing.value
  hoverOrbit = ''
  draw()
}

function selectSpeedBody(event) {
  speedBodyId.value = event.target.value
  activeOrbit.value = speedBody.value?.orbitId || ''
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
  if (gesture?.kind === 'orbit') return
  interact()
  scaleTo(scene.zoom * factor)
}
function resetView() {
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
  for (const [index, track] of (painted?.orbits || []).entries()) {
    for (let i = 1; i < track.points.length; i++) {
      const a = track.points[i - 1], b = track.points[i]
      const dx = b.x - a.x, dy = b.y - a.y
      const fraction = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1)
      const distance = Math.hypot(point.x - a.x - dx * fraction, point.y - a.y - dy * fraction)
      if (distance >= best) continue
      best = distance
      closest = { track, index, angle: (i - 1 + fraction) / (track.points.length - 1) * 2 * Math.PI }
    }
  }
  return closest
}

function startOrbitDrag(hit, point) {
  const { track, index, angle } = hit
  const { camera, orbits } = painted
  const project = radius => camera.project(orbitPoint(radius, angle).applyQuaternion(scene.view))
  const a = project(track.radius), b = project(track.radius + Math.max(.01, track.radius * .001))
  const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy)
  if (distance < .00001) return
  const inner = orbits[index - 1], outer = orbits[index + 1]
  activeOrbit.value = track.id
  hoverOrbit = ''
  gesture = {
    kind: 'orbit', start: point, track, framing: system.value, settings: orbitSettings.value,
    min: (inner ? inner.radius + inner.envelope : TUNING.workRadius + .34) + track.envelope + .03,
    max: outer ? outer.radius - outer.envelope - track.envelope - .03 : Number.MAX_SAFE_INTEGER,
    screenX: dx / distance, screenY: dy / distance, units: Math.max(.01, track.radius * .001) / distance
  }
  draw()
}

function hitAt(point) {
  const hits = painted?.hits || []
  const distance = hit => Math.hypot(point.x - hit.x, point.y - hit.y)
  const satelliteHit = hits.filter(hit => hit.kind === 'satellite' && distance(hit) <= hit.radius).at(-1)
  if (satelliteHit) return satelliteHit
  const count = hits.find(hit => hit.kind === 'bridge' && distance(hit) <= hit.radius)
  if (count) return count
  const covers = hit => hit.halfWidth
    ? Math.abs(point.x - hit.x) <= hit.halfWidth && Math.abs(point.y - hit.y) <= hit.halfHeight
    : distance(hit) <= hit.radius
  const nodes = hits.filter(hit => hit.kind === 'node' && covers(hit))
  if (nodes.length) return nodes.at(-1)
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

function pinchDistance() {
  const [a, b] = pointers.values()
  return a && b ? Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) : 1
}

function onDown(event) {
  const middle = event.button === 1 && event.pointerType === 'mouse'
  if ((!middle && event.button !== 0) || pointers.size >= 2 || gesture?.kind === 'pan'
    || gesture?.kind === 'orbit' || (middle && pointers.size)) return
  if (middle) event.preventDefault()
  if (!painted) return
  layoutOpen.value = false
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
    gesture.offset = { x: hit.x - point.x, y: hit.y - point.y }
  }
}

function onMove(event) {
  const point = coordinates(event)
  if (!pointers.has(event.pointerId)) {
    if (flight) return
    const hit = hitAt(point)
    const hover = hit?.id || ''
    if (hover !== hoverId) {
      hoverId = hover
      if (hover) interact()
      else idleSince = performance.now()
      draw()
    }
    const item = hit?.kind === 'node' ? model.value.byBody.get(hover)
      : hit?.kind === 'satellite' ? model.value.bySatellite.get(hover)?.target : null
    hoverLabel.value = item ? { title: item.title, x: hit.x, y: hit.y - hit.radius - 9 } : null
    const track = orbitEditing.value && !hit ? orbitAt(point) : null
    const nextOrbit = track?.track.id || ''
    if (hoverOrbit !== nextOrbit) {
      hoverOrbit = nextOrbit
      draw()
    }
    canvas.value.style.cursor = hover ? 'pointer' : track ? 'ew-resize' : 'grab'
    return
  }
  pointers.set(event.pointerId, point)
  if (gesture?.kind === 'pinch') return scaleTo(gesture.scale * pinchDistance() / gesture.distance)
  if (gesture?.kind === 'orbit') {
    const { start, track, screenX, screenY, units, min, max } = gesture
    const dx = point.x - start.x, dy = point.y - start.y
    if (!gesture.moved && Math.hypot(dx, dy) < TUNING.dragThreshold) return
    dragActive.value = gesture.moved = true
    const radius = clamp(track.radius + (dx * screenX + dy * screenY) * units, min, Math.max(min, max))
    updateOrbitSetting('radii', track.id, radius, false)
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
  if (gesture?.kind === 'orbit') orbitSettings.value = gesture.settings
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
  gesture = null
  dragActive.value = false
  idleSince = performance.now()
  if (current.kind === 'orbit') {
    lastClick = null
    if (current.moved) saveOrbitSettings()
    draw()
    return
  }
  if (current.kind === 'pan') {
    lastClick = null
    return
  }
  if (current.moved) {
    lastClick = null
    if (current.local) persist(positions.value)
    else if (!paused.value && !reduced.value && performance.now() - current.time < 80) glide = { x: current.vx, y: current.vy }
    return
  }
  const hit = current.hit
  if (hit?.kind === 'planet') enterPlanet(hit.id, true, painted.bodyPoints.get(hit.id) || hit)
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
  if (event.key === 'Escape') {
    if (gesture) cancelGesture()
    else if (flight) { interact(); draw() }
    else if (layoutOpen.value) closeLayout()
    else if (orbitEditing.value) toggleOrbitEditing()
    else if (searching.value) { searching.value = false; event.target.blur() }
    else if (indexOpen.value) indexOpen.value = false
    else if (selected.value || bridge.value || satellite.value) closeDetails()
    else if (setId.value) enterPlanet(activeSet.value?.parent?.id || '')
    else return
    event.preventDefault()
  } else if (event.target === canvas.value && event.key.startsWith('Arrow')) {
    event.preventDefault()
    if (gesture?.kind === 'orbit') return
    interact()
    turn(event.key === 'ArrowRight' ? 18 : event.key === 'ArrowLeft' ? -18 : 0,
      event.key === 'ArrowDown' ? 18 : event.key === 'ArrowUp' ? -18 : 0)
    draw()
  }
}

function onFocus(event) {
  keyboardFocus = event.target.matches(':focus-visible')
  if (keyboardFocus) {
    const wasFlying = !!flight
    interact()
    if (wasFlying) draw()
  }
}
function onBlur() { keyboardFocus = false; idleSince = performance.now() }
function onLeave() { hoverId = ''; hoverOrbit = ''; hoverLabel.value = null; idleSince = performance.now(); draw() }
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
  if (satelliteId.value && !satellite.value) satelliteId.value = ''
  if (setId.value && !activeSet.value) enterPlanet('')
  if (nodeId.value && !selected.value) clearSelection()
  if (bridgeId.value && !bridge.value) bridgeId.value = ''
  draw()
})
watch(paused, () => { idleSince = performance.now(); idleSpeed = 0; glide = null })
watch([searching, indexOpen], () => { idleSince = performance.now() })

onMounted(async () => {
  ctx = canvas.value.getContext('2d')
  motion = matchMedia('(prefers-reduced-motion: reduce)')
  changeMotion()
  motion.addEventListener('change', changeMotion)
  observer = new ResizeObserver(measure)
  observer.observe(stage.value)
  window.addEventListener('resize', measure)
  window.addEventListener('blur', cancelGesture)
  await nextTick()
  measure()
  frame = requestAnimationFrame(animate)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  motion?.removeEventListener('change', changeMotion)
  window.removeEventListener('resize', measure)
  window.removeEventListener('blur', cancelGesture)
  cancelAnimationFrame(frame)
})
</script>

<template>
  <section class="lpn" :class="{ 'lpn-embedded': embedded }" aria-label="关系星系" @keydown="onKey" @focusin="onFocus" @focusout="onBlur">
    <header class="lpn-header">
      <div v-if="!embedded" class="lpn-brand"><span class="lpn-brand-mark" aria-hidden="true">✦</span><strong>小说工坊</strong><small>LATENT</small></div>
      <div v-if="!embedded" class="lpn-location">设定 <span> / </span> 视觉导图 <span> / </span> <strong>关系星系</strong></div>
      <slot name="header-actions" />
      <button type="button" class="lpn-pill lpn-motion" :aria-pressed="paused || reduced" :disabled="reduced" @click="paused = !paused">
        <span aria-hidden="true">{{ paused || reduced ? '▶' : 'Ⅱ' }}</span>{{ reduced ? '减少动效' : paused ? '恢复运动' : '暂停运动' }}
      </button>
    </header>

    <div class="lpn-shell">
      <div class="lpn-heading">
        <div>
          <nav v-if="activeSet" class="lpn-breadcrumb" aria-label="星系层级">
            <button type="button" class="lpn-back" @click="enterPlanet('')">{{ workTitle }}</button>
            <template v-for="item in breadcrumb" :key="item.id">
              <span aria-hidden="true">/</span>
              <button type="button" class="lpn-back" @click="enterPlanet(item.id)">{{ item.title }}</button>
            </template>
            <span aria-hidden="true">/</span><span aria-current="location">{{ activeSet.title }}</span>
          </nav>
          <h1>{{ activeSet?.title || '设定集总览' }}</h1>
          <p v-if="activeSet">{{ activeSet.entries.length }} 个直属条目 <span>·</span> {{ internalCount }} 条可见关系</p>
          <p v-else>{{ system.planets.length }} 个设定集 <span>·</span> {{ model.byNode.size }} 个条目 <span>·</span> {{ system.bridges.filter(item => !item.withinBody).length }} 组跨集关系</p>
          <slot name="source-status" />
        </div>
        <div class="lpn-search" ref="searchBox" @focusout="event => { if (!searchBox?.contains(event.relatedTarget)) searching = false }">
          <label><span aria-hidden="true">⌕</span><input v-model="query" type="search" aria-label="搜索全部设定条目" placeholder="搜索全部设定条目" @focus="searching = true" @input="searching = true" @keydown.enter.prevent="chooseResult(searchResults[0])"></label>
          <div v-if="searching && query.trim()" class="lpn-results">
            <button v-for="result in searchResults" :key="result.id" type="button" @click="chooseResult(result)">
              {{ result.title }}<small>{{ entryPath(result) }}</small>
            </button>
            <p v-if="!searchResults.length">没有匹配的条目</p>
          </div>
        </div>
      </div>

      <div class="lpn-workspace">
        <div ref="stage" class="lpn-stage" :class="{ 'is-dragging': dragActive }">
          <canvas ref="canvas" tabindex="0" aria-label="三维关系画布，方向键旋转，条目列表可用于键盘定位"
            @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="cancelGesture"
            @lostpointercapture="event => { if (pointers.has(event.pointerId)) cancelGesture() }" @pointerleave="onLeave"
            @wheel.prevent="changeZoom(Math.exp(-$event.deltaY * .0015))"
            @mousedown="event => { if (event.button === 1) event.preventDefault() }"
            @auxclick="event => { if (event.button === 1) event.preventDefault() }" />
          <span v-if="hoverLabel" class="lpn-node-hover"
            :data-edge="hoverLabel.x < 108 ? 'left' : hoverLabel.x > size.width - 108 ? 'right' : undefined"
            :style="{ left: clamp(hoverLabel.x, 10, size.width - 10) + 'px', top: Math.max(34, hoverLabel.y) + 'px' }">{{ hoverLabel.title }}</span>
          <div v-if="activeSet && !activeSet.entries.length" class="lpn-empty">还没有下级条目</div>
          <div v-else-if="!system.planets.length" class="lpn-empty">还没有设定集</div>
          <div class="lpn-legend" aria-hidden="true">
            <span><i class="lpn-key-mesh"></i>条目织网</span>
            <span><i class="lpn-key-line"></i>集内关系</span>
            <span><i class="lpn-key-cross"></i>{{ activeSet ? '星体间关系' : '跨集关系' }}</span>
            <span v-if="model.bySatellite.size"><i class="lpn-key-satellite"></i>关联对象</span>
          </div>
          <p class="lpn-stage-hint">{{ orbitEditing ? '拖动轨道线改变半径 · Esc 退出轨道编辑' : '左键拖动空白旋转 · 中键拖动平移' }}</p>
        </div>

        <aside v-if="selected || bridge || satellite || indexOpen" class="lpn-inspector" aria-label="关系摘要">
          <div class="lpn-inspector-head">
            <span>{{ indexOpen ? activeSet ? '条目列表' : '设定集列表' : satellite ? '关联对象' : bridge ? '关系明细' : entryPreview ? '条目预览' : '条目摘要' }}</span>
            <button type="button" class="lpn-icon" aria-label="关闭摘要" @click="indexOpen ? indexOpen = false : closeDetails()">×</button>
          </div>
          <template v-if="indexOpen">
            <div class="lpn-list">
              <button v-for="item in system.planets" :key="item.id" type="button"
                @click="indexOpen = false; activeSet ? selectNode(item, true, true) : enterPlanet(item.id, true)">
                {{ item.title }}<small>{{ item.entries.length }} 个下级条目</small>
              </button>
              <p v-if="activeSet && !activeSet.entries.length">还没有下级条目</p>
            </div>
            <template v-if="system.bridges.length">
              <h3>关系分组</h3>
              <div class="lpn-list">
                <button v-for="connection in system.bridges" :key="connection.id" type="button" @click="showBridge(connection.id)">
                  {{ connection.a.title }} / {{ connection.b.title }}<small>{{ connection.links.length }} 条</small>
                </button>
              </div>
            </template>
          </template>
          <template v-else-if="satellite">
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
                <button v-if="selected.entries.length && selected.id !== activeSet?.id" type="button" class="lpn-pill lpn-primary" @click="enterPlanet(selected.id, true)">进入下一级</button>
                <button type="button" class="lpn-pill" :class="{ 'lpn-primary': !selected.entries.length }" @click="openEntry">打开条目</button>
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
          <button type="button" class="lpn-pill" :aria-expanded="indexOpen" @click="indexOpen = !indexOpen">{{ activeSet ? '条目列表' : '设定集列表' }}</button>
          <div v-if="system.planets.length" class="lpn-layout" @focusout="event => { if (!event.currentTarget.contains(event.relatedTarget)) layoutOpen = false }">
            <button ref="layoutButton" type="button" class="lpn-pill" :aria-expanded="layoutOpen" @click="layoutOpen = !layoutOpen">布局</button>
            <div v-if="layoutOpen" class="lpn-layout-panel" aria-label="当前星系布局">
              <label class="lpn-depth">
                <span>星体间距</span>
                <span class="lpn-setting-value"><input type="number" min="0" step="any" aria-label="星体间距百分比" :value="spacing" @change="changeSpacingInput">%</span>
                <input type="range" min="0" max="500" step="1" :value="Math.min(spacing, 500)" aria-label="星体间距"
                  @input="adjustSpacing($event.target.valueAsNumber)" @change="adjustSpacing($event.target.valueAsNumber, true)">
              </label>
              <div class="lpn-layout-scale"><span>紧凑</span><span>宽松</span></div>
              <button type="button" class="lpn-pill" @click="adjustSpacing(null, true)">恢复自动</button>
              <div class="lpn-orbit-controls">
                <button type="button" class="lpn-pill" :aria-pressed="orbitEditing" @click="toggleOrbitEditing">
                  {{ orbitEditing ? '退出轨道编辑' : '拖拽轨道半径' }}
                </button>
                <output v-if="activeTrack" class="lpn-orbit-radius">当前轨道半径 {{ activeTrack.orbitRadius.toFixed(2) }}</output>
                <button v-if="activeTrack && currentOrbitSettings.radii?.[activeTrack.orbitId] != null" type="button" class="lpn-pill"
                  @click="updateOrbitSetting('radii', activeTrack.orbitId, null)">恢复该轨道半径</button>
                <label class="lpn-speed-body">星体<select :value="speedBody?.id" @change="selectSpeedBody">
                  <option v-for="body in system.planets" :key="body.id" :value="body.id">{{ body.title }}</option>
                </select></label>
                <label v-for="(label, kind) in { orbit: '公转速度', spin: '自转速度' }" :key="kind" class="lpn-speed-setting">
                  {{ label }}
                  <span class="lpn-setting-value"><input type="number" min="0" max="1000" step="any" :aria-label="label"
                    :value="currentOrbitSettings.speeds?.[speedBody?.id]?.[kind] ?? 100" @change="changeSpeed(kind, $event)">%</span>
                </label>
                <button v-if="currentOrbitSettings.speeds?.[speedBody?.id]" type="button" class="lpn-pill"
                  @click="updateOrbitSetting('speeds', speedBody.id, null)">恢复该星体速度</button>
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
