/**
 * 关系星系 Canvas 2D 透视绘制引擎：
 * 负责构建星系视野适配与投影相机（galaxyFraming / galaxyProjection），
 * 并按远近深度排序逐帧绘制星尘、引力势阱网格、中心恒星辉光、轨道环、星体星座与跨模块卫星。
 */
import { Vector3 } from 'three'
import {
  CENTER_ELEVATION,
  clamp,
  fitOverviewFrame,
  makeCamera,
  orbitPlaneToWorld,
  orbitPoint,
  orbitPosition,
  overviewExtent,
  planetSizeValue,
  relaxSetEntries,
  rotation,
  TUNING,
  worldToOrbitUV
} from './planet-scene.js'
import { entryCircleGlyphs, entryCircleScale, entryDisplayRadius, layoutEntryCircleText } from './entry-circles.js'
import { trimProjected } from './relation-path.js'
import {
  DEFAULT_CENTER_GLOW,
  centerGlowEdge,
  centerGlowPulse,
  centerGlowSample,
  centerGlowWave,
  mixRgb,
  resolveCenterSpectrum,
  rgbaString,
  rgbToHex,
  samplePrismColor
} from './center-glow.js'
import { CONTOUR_POINTS, galaxyTerrain, MESH_STYLES, terrainDepth } from './galaxy-terrain.js'

const TAU = 2 * Math.PI
const TIER_RADII = [0, 7.8, 5.4, 3.8]
const canvasTextWidths = new WeakMap()

function textWidth(ctx, value) {
  let fonts = canvasTextWidths.get(ctx)
  if (!fonts) canvasTextWidths.set(ctx, fonts = new Map())
  let widths = fonts.get(ctx.font)
  if (!widths) fonts.set(ctx.font, widths = new Map())
  if (!widths.has(value)) {
    if (widths.size >= 4096) widths.clear()
    widths.set(value, ctx.measureText(value).width)
  }
  return widths.get(value)
}

const _tmpA = new Vector3()
const _tmpB = new Vector3()
const _tmpPt = new Vector3()

function outlinedText(ctx, text, x, y) {
  // Single GPU-atlas cached fillText matching Scheme B crisp typography (zero CJK path tessellation).
  ctx.fillText(text, x, y)
}
const overviewFraming = new WeakMap()

const STARDUST = Array.from({ length: 96 }, (_, i) => ({
  x: ((Math.sin(i * 12.9898 + 1.2) * 43758.5453) % 1 + 1) % 1,
  y: ((Math.sin(i * 78.233 + 3.4) * 23421.6312) % 1 + 1) % 1,
  depth: 0.2 + (i % 3) * 0.4,
  alpha: 0.07 + (i % 4) * 0.032,
  cyan: i % 3 === 0
}))

const SATELLITE_COLORS = {
  character: '#EAF3FF',
  outline: '#47D7E8',
  olnode: '#96B6FF',
  chapter: '#B6A6FF',
  snippet: '#7CD4E6'
}

const MODULE_BADGE = {
  character: '人物',
  outline: '大纲',
  olnode: '画布',
  chapter: '正文',
  snippet: '灵感'
}

function cleanAndTruncateTitle(raw, maxChars = 7) {
  const cleaned = String(raw || '未命名').replace(/^\[[^\]]+\]\s*/, '').trim() || '未命名'
  const chars = [...cleaned]
  if (chars.length <= maxChars) return cleaned
  return chars.slice(0, maxChars).join('') + '…'
}

function getOverviewFraming(data, positions, view, width, height) {
  const cached = overviewFraming.get(data)
  if (cached && cached.positions === positions && cached.width === width && cached.height === height
    && cached.view.equals(view)) return cached
  const extent = overviewExtent(data.planets, positions)
  const fit = fitOverviewFrame(data.planets, positions, view, width, height, extent)
  const framing = { positions, view: view.clone(), width, height, extent, ...fit }
  overviewFraming.set(data, framing)
  return framing
}

export function galaxyFraming(size, data, positions, view, spacingData) {
  const { width, height } = size
  const framing = getOverviewFraming(data, positions, view, width, height)
  const baseline = spacingData ? getOverviewFraming(spacingData, positions, view, width, height) : framing
  const fit = Math.min(baseline.fit, Math.max(framing.fit, baseline.fit * .66))
  const shift = fit / framing.fit
  return { extent: Math.max(baseline.extent, framing.extent), fit, x: framing.x * shift, y: framing.y * shift }
}

export function galaxyProjection({ width, height }, scene, framing = scene.framing) {
  return makeCamera(width, height, scene.zoom * framing.fit, framing.extent, scene, scene.view,
    (framing.x || 0) * scene.zoom, (framing.y || 0) * scene.zoom)
}

function hexToRgba(hex, alpha) {
  const raw = String(hex || '').trim()
  if (!raw.startsWith('#') || (raw.length !== 7 && raw.length !== 4)) return `rgba(71, 215, 232, ${alpha})`
  const full = raw.length === 4
    ? `#${raw[1]}${raw[1]}${raw[2]}${raw[2]}${raw[3]}${raw[3]}`
    : raw
  const r = parseInt(full.slice(1, 3), 16)
  const g = parseInt(full.slice(3, 5), 16)
  const b = parseInt(full.slice(5, 7), 16)
  return Number.isFinite(r) ? `rgba(${r}, ${g}, ${b}, ${alpha})` : `rgba(71, 215, 232, ${alpha})`
}

function rotVec(x, y, z, rx, ry, rz) {
  const cx = Math.cos(rx), sx = Math.sin(rx)
  const cy = Math.cos(ry), sy = Math.sin(ry)
  const cz = Math.cos(rz), sz = Math.sin(rz)
  const y1 = y * cx - z * sx
  const z1 = y * sx + z * cx
  const x2 = x * cy + z1 * sy
  const z2 = -x * sy + z1 * cy
  const x3 = x2 * cz - y1 * sz
  const y3 = x2 * sz + y1 * cz
  return new Vector3(x3, y3, z2)
}

export function paintNetwork(ctx, size, data, scene, state = {}) {
  const { width, height } = size
  ctx.clearRect(0, 0, width, height)
  const framing = scene.framing || galaxyFraming(size, state.framingData || data, state.framingPositions, scene.view, state.spacingFramingData)
  const camera = galaxyProjection(size, scene, framing)

  const hits = []
  const projected = new Map()
  const bodyPoints = new Map()
  const nodeList = []
  const leafPoints = []
  const satellites = []
  let animationPending = false
  const overview = !data.center
  const entryZoom = scene.entryZoom ?? scene.zoom
  const entryScale = entryCircleScale(entryZoom)
  const crystalScale = clamp(Math.pow(entryZoom, .28), .82, 1.35)
  const detailText = entryZoom >= 1
  const resize = state.entryResize
  const planetResize = state.planetResize
  const layers = state.layers || { weave: true, intra: true, cross: true, satellite: true }
  const solo = state.soloLayer || ''
  const layerAlpha = key => {
    if (!layers[key]) return 0
    if (solo && solo !== key) return 0.14
    return 1
  }

  function entryGeometry(node, point, planetScale = 1, cap = Infinity) {
    if (resize?.id === node.id) return { x: resize.x, y: resize.y, radius: resize.radius, glyphRadius: Math.min(resize.radius, cap), multiline: detailText }
    const saved = state.entryRadii?.[node.id]
    const scale = entryScale * planetScale
    const manual = Number.isFinite(saved) && Number.isFinite(saved * scale)
    const tierBase = TIER_RADII[node.tier ?? 3]
    const radius = manual ? entryDisplayRadius(saved, scale) : Math.min(cap, tierBase * (.78 + .42 * point.depthNorm) * crystalScale * planetScale)
    return {
      radius, glyphRadius: Math.min(radius, cap),
      multiline: manual && detailText,
      manual
    }
  }

  const origin = new Vector3(0, CENTER_ELEVATION, 0).applyQuaternion(scene.view)
  const work = camera.project(origin)
  const centerScale = planetSizeValue(state.planetSizes?.[data.center?.id ?? '']) / 100
  const CORE_WORLD_RADIUS = .52
  work.radius = clamp(CORE_WORLD_RADIUS * work.scale, 28, 72) * centerScale
  work.coreScale = (CORE_WORLD_RADIUS / .44) * centerScale
  if (data.center) {
    const anchor = { ...work, world: origin, center: origin, planetId: data.center.id, front: true, id: data.center.id }
    bodyPoints.set(data.center.id, anchor)
    hits.push({ ...anchor, kind: 'node', id: data.center.id })
  }

  // 先预计算各行星/子星体坐标与引力势阱参数，确保 3D 引力网格随拖轨与缩放实时形变
  const viewInverse = scene.view.clone().invert()
  const bodies = data.planets.map(planet => {
    const phase = state.motionPhases?.get(planet.id)
    const localCenter = orbitPosition(planet, scene.time, phase?.orbit)
    const center = localCenter.clone().applyQuaternion(scene.view)
    const uv = worldToOrbitUV(localCenter)
    const orientation = scene.view.clone().multiply(rotation(0.24, planet.spinPhase + planet.spinSpeed * scene.time + (phase?.spin || 0)))
    const baseRadius = planet.radius * TUNING.bodyScale
    const planetScale = planetSizeValue(planetResize?.id === planet.id ? planetResize.size : state.planetSizes?.[planet.id]) / 100
    const radius = baseRadius * planetScale
    const pos = camera.project(center)
    const baseCaliper = Math.max(baseRadius * pos.scale, planet.entries.length ? 16 : 9)
    const caliperRadius = planetResize?.id === planet.id ? planetResize.radius : baseCaliper * planetScale
    const sigma = (planet.entries.length ? clamp(radius * .74, .42, .58) : .34) * planetScale
    const wellDepth = planet.entries.length
      ? (0.56 + Math.min(10, planet.entries.length) * 0.048) * Math.pow(planetScale, 0.94)
      : 0.16 * Math.pow(planetScale, 0.94)
    return {
      planet, localCenter, center, uv, orientation, baseRadius, planetScale, radius,
      pos, baseCaliper, caliperRadius,
      well: {
        id: planet.id,
        u: uv.u,
        v: uv.v,
        radius,
        inverseVariance: 1 / (2 * sigma * sigma),
        depth: wellDepth
      }
    }
  }).sort((a, b) => a.pos.z - b.pos.z)

  const wells = bodies.map(b => b.well)
  const outer = Math.max(0, ...bodies.map(body => body.planet.orbitRadius * Math.max(body.planet.orbitAspect || 1, body.planet.orbitAspectZ || 1)))
  const field = galaxyTerrain(data.routes || data, Math.max(5.8, Math.ceil((outer + .95) * 2) / 2), wells, scene.time, !!state.orbitPreview)

  // 先投射各设定集下属条目（保留完整 3D 切面与坐标映射）
  const focusBlend = state.reduced || !state.focusWeights ? 1 : 1 - Math.exp(-(state.focusDt ?? 16) / 75)
  const approach = (value, target) => Math.abs(target - value) < .012 ? target : value + (target - value) * focusBlend
  for (const body of bodies) {
    const { planet, center, orientation, planetScale, radius, caliperRadius, pos } = body
    const localPoints = relaxSetEntries(planet, state.positions?.[planet.id], planetScale)
    for (const [index, node] of planet.entries.entries()) {
      const local = state.entryDrag?.id === node.id ? state.entryDrag.local : localPoints[index]
      const world = local.clone().multiplyScalar(radius / TUNING.detailRadius).applyQuaternion(orientation).add(center)
      const point = camera.project(world)
      const distance = camera.distance - point.z
      const vx = distance > 2.2 ? -world.x / distance : 0
      const vy = distance > 2.2 ? -world.y / distance : 0
      const facing = ((world.x - center.x) * vx + (world.y - center.y) * vy + world.z - center.z)
        / (radius * Math.hypot(vx, vy, 1))
      const front = facing >= 0
      const priority = node.id === state.nodeId || node.id === resize?.id ? 4
        : node.id === state.hoverId ? 3 : front ? 1 : 0
      const geom = entryGeometry(node, point, 1, caliperRadius * (node.tier === 1 ? .22 : .16))
      const entry = {
        ...point, ...geom, world, center, orientation, facing, front, local,
        primary: planet.coreEntryId === node.id, priority, id: node.id, node, planetId: planet.id, sphereRadius: radius
      }
      projected.set(node.id, entry)
      nodeList.push(entry)
    }
    const leaf = !planet.entries.length && !!planet.parent
    const geometry = leaf
      ? entryGeometry(planet, pos, planetScale)
      : { radius: caliperRadius }
    const priority = planet.id === state.nodeId || planet.id === resize?.id || planet.id === state.planetSettingsId ? 4
      : planet.id === state.hoverId || planet.id === state.rimHoverId || planet.id === state.resizingSetId ? 3 : 1
    const anchor = { ...pos, ...geometry, world: center, center, planetId: planet.id, front: true, id: planet.id, priority }
    if (leaf) {
      leafPoints.push({ ...anchor, node: planet, facing: 1 })
    } else {
      hits.push({
        ...anchor,
        kind: 'planet',
        rimRadius: caliperRadius,
        baseCaliper: body.baseCaliper,
        resizableRim: true
      })
    }
    bodyPoints.set(planet.id, anchor)
  }

  const activeId = state.draggingNodeId || state.hoverId || state.satelliteId || state.nodeId || state.planetSettingsId
  const ownerOf = id => projected.get(id)?.planetId || bodyPoints.get(id)?.planetId
  let focusedSetId = ownerOf(activeId)
  if (activeId && !focusedSetId) {
    for (const [id, items] of data.rolledSatellites || []) {
      if (!items.some(item => item.id === activeId)) continue
      focusedSetId = ownerOf(id)
      break
    }
  }
  const bodyById = new Map(bodies.map(body => [body.planet.id, body]))
  const focusedBody = focusedSetId && bodyById.get(focusedSetId)
  if (focusedBody && !focusedBody.planet.entries.length && !focusedBody.planet.bridges?.length
    && focusedSetId === state.hoverId && !state.nodeId && !state.planetSettingsId) {
    focusedSetId = ''
  }
  const related = new Set([focusedSetId])
  if (focusedSetId) {
    for (const route of data.routes) {
      const from = ownerOf(route.from?.id), to = ownerOf(route.to?.id)
      if (from === focusedSetId) related.add(to)
      if (to === focusedSetId) related.add(from)
    }
  }
  for (const body of bodies) {
    const id = body.planet.id
    const dimTarget = !focusedSetId || related.has(id) ? 1 : .20
    const revealTarget = !overview || id === focusedSetId ? 1 : 0
    const lensTarget = overview && body.planet.entries.length > 0 && id === focusedSetId ? 1.12 : 1
    const previous = state.focusWeights?.get(id) ?? { dim: 1, reveal: overview ? 0 : 1, lens: 1 }
    body.dim = approach(previous.dim, dimTarget)
    body.reveal = approach(previous.reveal, revealTarget)
    body.lens = approach(previous.lens ?? 1, lensTarget)
    state.focusWeights?.set(id, { dim: body.dim, reveal: body.reveal, lens: body.lens })
    animationPending ||= body.dim !== dimTarget || body.reveal !== revealTarget || body.lens !== lensTarget
  }
  for (const point of [...nodeList, ...leafPoints, ...bodyPoints.values()]) {
    const body = bodyById.get(point.planetId)
    point.dim = body?.dim ?? 1
    point.reveal = body?.reveal ?? 1
    point.lens = body?.lens ?? 1
  }

  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  const centerGlow = state.centerGlow || DEFAULT_CENTER_GLOW
  const centerGlowSec = state.reduced ? 0 : (state.centerGlowTime || 0) / 1000
  const centerSpectrum = state.centerSpectrum || resolveCenterSpectrum(centerGlow, state.backdropPalette)

  // 1. 远景微距冷色星尘 + 3D 高斯引力势阱曲面网格 + 等高波纹 + Z 轴测高垂线
  drawTopologyGravityMesh(ctx, width, height, scene, camera, bodies, field, nodeList, work, state, centerSpectrum, centerGlow, centerGlowSec)

  // 2. 轨道参数输出 + 仅在轨道编辑/拖拽激活时浮现冰青全息极坐标测绘轨道环
  const orbits = drawSurveyOrbits(ctx, data.planets, camera, work, state)

  // 3. 中心主星：悬浮八面体棱镜陀螺核（响应背景/自定义色板、色彩方式、亮度、动效、速度）
  drawPrismCore(
    ctx, camera, origin, scene.view, work,
    data.center?.title || state.workTitle,
    centerGlow,
    centerSpectrum,
    centerGlowSec,
    state.reduced, state.rotating,
    width, height
  )

  // 4. 各设定集星域（四象限断弧卡尺 / 空设定集虚线棱形切片）+ 星座切面与骨架织网
  const weaveOpacity = layerAlpha('weave')
  for (const body of bodies) {
    const isLeaf = !body.planet.entries.length && !!body.planet.parent
    if (!isLeaf) drawTopologyDomain(ctx, body, state, projected)
    if (weaveOpacity > 0) drawConstellationWeave(ctx, body, projected, state, weaveOpacity * body.dim)
  }

  // 4.5 条目拖拽时：绘制连接所属星域中心的极细全息牵引丝与径向微标
  if (state.draggingNodeId) {
    const draggedEntry = projected.get(state.draggingNodeId)
    const ownerAnchor = draggedEntry && bodyPoints.get(draggedEntry.planetId)
    if (draggedEntry && ownerAnchor) {
      drawEntryDragTether(ctx, ownerAnchor, draggedEntry)
    }
  }

  // 5. 收集跨模块关联卫星（支持从隐藏深层子孙自动归并挂载至可见锚点，沿倾斜微轨子环缓慢公转）
  const satFor = id => data.rolledSatellites?.get(id)
  if (data.center) {
    const centerSats = satFor(data.center.id) ?? data.center.satellites
    if (centerSats?.length) {
      const anchor = bodyPoints.get(data.center.id)
      satellites.push(...placeSatellites(camera, {
        center: origin, orientation: scene.view, radius: work.radius / Math.max(1, work.scale)
      }, { ...anchor, node: data.center }, centerSats, scene.time, state.reduced))
    }
  }
  for (const body of bodies) {
    for (const node of body.planet.entries) {
      const nodeSats = satFor(node.id) ?? node.satellites
      if (!nodeSats?.length) continue
      const entry = projected.get(node.id)
      if (entry) satellites.push(...placeSatellites(camera, body, entry, nodeSats, scene.time, state.reduced))
    }
    const bodySats = satFor(body.planet.id) ?? body.planet.satellites
    if (bodySats?.length) {
      const anchor = bodyPoints.get(body.planet.id)
      satellites.push(...placeSatellites(camera, body, { ...anchor, node: body.planet }, bodySats, scene.time, state.reduced))
    }
  }
  for (const sat of satellites) {
    const show = sat.id === state.hoverId || sat.id === state.satelliteId
      || sat.owner?.id === state.hoverId || sat.owner?.id === state.nodeId
      || state.soloLayer === 'satellite'
    const key = `sat:${sat.id}`
    const prev = state.focusWeights?.get(key) ?? (show ? 1 : 0)
    sat.labelAlpha = approach(prev, show ? 1 : 0)
    state.focusWeights?.set(key, sat.labelAlpha)
    animationPending ||= sat.labelAlpha !== (show ? 1 : 0)
  }

  // 6. 集内关系（绷紧星座直线段）与跨集关系（3D 高空抛物跃迁光带 + 下方引力势阱地面虚线投影）
  const pathsByBridge = new Map()
  for (const link of data.routes) {
    const a = projected.get(link.from?.id) || bodyPoints.get(link.from?.id)
    const b = projected.get(link.to?.id) || bodyPoints.get(link.to?.id)
    if (!a && !b) continue
    const { cross, bridgeId } = link
    const layerKey = cross ? 'cross' : 'intra'
    const alphaGain = layerAlpha(layerKey)
    const emphasized = link.from?.id === state.nodeId || link.to?.id === state.nodeId
      || link.from?.id === state.hoverId || link.to?.id === state.hoverId
      || !!bridgeId && bridgeId === state.bridgeId
    if (!alphaGain && !emphasized) continue
    if (!a || !b) {
      if (emphasized) drawOutsideRibbon(ctx, camera, link, a || b, scene.time, !state.reduced, true)
      continue
    }
    const dim = Math.min(a.dim, b.dim) * (state.bridgeId && !emphasized ? .45 : 1)
    const baseGain = emphasized ? 1 : alphaGain * dim * (cross && solo !== 'cross' ? .62 : 1)
    if (cross) {
      const samples = computeParabolicCrossPoints(camera, scene, viewInverse, a, b, state.rotating && !emphasized ? 14 : 22)
      const trimmed = trimProjected(samples, a, b)
      if (trimmed.length < 2) continue
      drawCrossRibbon(ctx, camera, scene, viewInverse, field, a, samples, trimmed, link, emphasized, baseGain, state, centerSpectrum, centerGlow, centerGlowSec)
      if (bridgeId) {
        const list = pathsByBridge.get(bridgeId) || []
        list.push(trimmed)
        pathsByBridge.set(bridgeId, list)
      }
    } else {
      const trimmed = trimProjected([a, b], a, b)
      if (trimmed.length < 2) continue
      drawIntraBeam(ctx, trimmed, link, a, b, emphasized, baseGain)
      if (bridgeId) {
        const list = pathsByBridge.get(bridgeId) || []
        list.push(trimmed)
        pathsByBridge.set(bridgeId, list)
      }
    }
  }

  // 7. 跨模块关联卫星牵引丝
  const satAlpha = layerAlpha('satellite')
  if (satAlpha > 0) {
    for (const sat of satellites) drawTether(ctx, sat, state.satelliteId, state.hoverId, satAlpha)
  }

  // 8. 按 Z 轴绘制晶体条目节点 + 跨模块棱晶卫星
  const markers = [...nodeList, ...leafPoints, ...(satAlpha > 0 ? satellites : [])]
  markers.sort((a, b) => a.z - b.z || String(a.id).localeCompare(String(b.id)))
  for (const point of markers) {
    if (point.item) {
      drawTopologySatellite(ctx, point, state, satAlpha)
      hits.push({
        kind: 'satellite',
        id: point.id,
        x: point.x,
        y: point.y,
        radius: point.radius,
        ownerId: point.owner.node.id
      })
    } else {
      if (state.names) measureName(ctx, state.names, point.node, point)
      drawCrystalNode(ctx, point, state)
      hits.push({
        kind: 'node',
        id: point.id,
        x: point.x,
        y: point.y,
        z: point.z,
        radius: point.radius,
        resizable: true,
        planetId: point.planetId
      })
    }
  }

  // 9. 桥接计数微晶标
  for (const bridge of data.bridges) {
    const paths = pathsByBridge.get(bridge.id)
    if (!paths) continue
    const first = paths[0]
    const badge = first[Math.floor(first.length / 2)]
    const active = bridge.id === state.bridgeId || bridge.id === state.hoverId
    drawBridgeBadge(ctx, badge.x, badge.y, String(bridge.links.length), active)
    hits.push({ kind: 'bridge', id: bridge.id, ...badge, radius: 11, paths, count: bridge.links.length })
  }

  // 10. 去胶囊化建筑测绘铭牌与 2D 防碰撞条目微标签
  drawTopologyLabels(ctx, width, height, work, bodies, bodyById, [...nodeList, ...leafPoints], satellites, hits, state, satAlpha, overview, scene)

  ctx.globalAlpha = 1
  return { hits, camera, work, projected, bodyPoints, orbits, animationPending }
}

function drawEntryDragTether(ctx, ownerAnchor, draggedEntry) {
  ctx.save()
  ctx.strokeStyle = '#47D7E8'
  ctx.lineWidth = 1.15
  ctx.globalAlpha = 0.88
  ctx.setLineDash([3, 3])
  ctx.beginPath()
  ctx.moveTo(ownerAnchor.x, ownerAnchor.y)
  ctx.lineTo(draggedEntry.x, draggedEntry.y)
  ctx.stroke()
  ctx.setLineDash([])

  const arm = 3.5
  ctx.beginPath()
  ctx.moveTo(ownerAnchor.x - arm, ownerAnchor.y); ctx.lineTo(ownerAnchor.x + arm, ownerAnchor.y)
  ctx.moveTo(ownerAnchor.x, ownerAnchor.y - arm); ctx.lineTo(ownerAnchor.x, ownerAnchor.y + arm)
  ctx.stroke()

  const midX = (ownerAnchor.x + draggedEntry.x) * 0.5
  const midY = (ownerAnchor.y + draggedEntry.y) * 0.5 - 7
  const distWorld = draggedEntry.world && draggedEntry.center ? draggedEntry.world.distanceTo(draggedEntry.center) : 0
  ctx.font = '600 9.5px "JetBrains Mono", Consolas, monospace'
  ctx.fillStyle = '#47D7E8'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  outlinedText(ctx, `Δr // ${distWorld.toFixed(2)}`, midX, midY)
  ctx.restore()
}

function drawTopologyGravityMesh(ctx, width, height, scene, camera, bodies, field, nodeList, work, state, centerSpectrum, centerGlow, centerGlowSec) {
  ctx.save()
  // 微距十字冷银星尘（同步响应旋转与平移视差）
  const shiftX = (scene.yaw || 0) * 115 + (scene.panX || 0) * .25
  const shiftY = (scene.pitch || 0) * 85 + (scene.panY || 0) * .25
  for (let i = 0; i < STARDUST.length; i++) {
    const p = STARDUST[i]
    const x = ((p.x * width + shiftX * p.depth) % width + width) % width
    const y = ((p.y * height + shiftY * p.depth) % height + height) % height
    ctx.globalAlpha = p.alpha
    ctx.fillStyle = p.cyan ? '#47D7E8' : '#b8d0ec'
    ctx.fillRect(x - 0.65, y - 0.65, 1.3, 1.3)
  }

  camera.projectWorldBuffer(field.vertices, field.screen)
  camera.projectWorldBuffer(field.contours, field.contourScreen)
  const { screen, counts, buckets, contourScreen } = field
  for (let index = 0; index < counts.length; index++) {
    if (!counts[index]) continue
    const points = buckets[index]
    const style = MESH_STYLES[index] || MESH_STYLES[1]
    ctx.beginPath()
    for (let i = 0; i < counts[index]; i += 2) {
      const a = points[i], b = points[i + 1]
      ctx.moveTo(screen[a], screen[a + 1])
      ctx.lineTo(screen[b], screen[b + 1])
    }
    ctx.strokeStyle = style.color
    ctx.lineWidth = style.width
    ctx.globalAlpha = style.alpha
    ctx.stroke()
  }

  function drawContour(start, color, alpha, dashed) {
    ctx.beginPath()
    ctx.moveTo(contourScreen[start], contourScreen[start + 1])
    for (let i = start + 2; i < start + CONTOUR_POINTS * 2; i += 2) {
      ctx.lineTo(contourScreen[i], contourScreen[i + 1])
    }
    ctx.setLineDash(dashed ? [2.5, 3.5] : [])
    ctx.strokeStyle = color
    ctx.lineWidth = .8
    ctx.globalAlpha = alpha
    ctx.stroke()
  }

  const coreContourA = rgbToHex(samplePrismColor(centerSpectrum, centerGlow.colorMode, centerGlow.effect, centerGlowSec, { role: 'primary', layer: 0.80, slot: 0 }))
  const coreContourB = rgbToHex(samplePrismColor(centerSpectrum, centerGlow.colorMode, centerGlow.effect, centerGlowSec, { role: 'accent', layer: 0.24, slot: 2 }))
  drawContour(0, coreContourA, .28, false)
  drawContour(CONTOUR_POINTS * 2, coreContourB, .18, true)

  for (const body of bodies) {
    const planet = body.planet
    const active = state.hoverId === planet.id || state.nodeId === planet.id || state.rimHoverId === planet.id
      || state.resizingSetId === planet.id || state.planetSettingsId === planet.id
    const alpha = (active ? .42 : planet.total ? .18 : .07) * body.dim
    const color = active ? '#47D7E8' : planet.color
    const offset = field.offsets.get(planet.id)
    drawContour(offset, color, alpha, false)
    drawContour(offset + CONTOUR_POINTS * 2, color, alpha * .72, true)
  }
  ctx.setLineDash([])

  const drawPlumb = (topProj, u, v, color, alpha, hi) => {
    const bot = camera.projectWorld(orbitPlaneToWorld(u, v, terrainDepth(field, u, v)))
    ctx.setLineDash([2, 3.2])
    ctx.strokeStyle = hi ? '#47D7E8' : color
    ctx.lineWidth = hi ? 1.15 : 0.72
    ctx.globalAlpha = alpha * (hi ? 0.88 : 0.36)
    ctx.beginPath()
    ctx.moveTo(topProj.x, topProj.y)
    ctx.lineTo(bot.x, bot.y)
    ctx.stroke()
    ctx.setLineDash([])

    const arm = hi ? 4.2 : 3.0
    ctx.lineWidth = hi ? 1.15 : 0.85
    ctx.globalAlpha = alpha * (hi ? 0.95 : 0.55)
    ctx.beginPath()
    ctx.moveTo(bot.x - arm, bot.y)
    ctx.lineTo(bot.x + arm, bot.y)
    ctx.moveTo(bot.x, bot.y - arm)
    ctx.lineTo(bot.x, bot.y + arm)
    ctx.stroke()

    if (hi) {
      const d = 6
      ctx.globalAlpha = alpha * 0.68
      ctx.beginPath()
      ctx.moveTo(bot.x, bot.y - d)
      ctx.lineTo(bot.x + d, bot.y)
      ctx.lineTo(bot.x, bot.y + d)
      ctx.lineTo(bot.x - d, bot.y)
      ctx.closePath()
      ctx.stroke()
    }
  }

  // 主星与设定集测高垂线
  drawPlumb(work, 0, 0, coreContourA, 1, false)
  for (const b of bodies) {
    const p = b.planet
    const hi = state.hoverId === p.id || state.nodeId === p.id || state.rimHoverId === p.id
      || state.resizingSetId === p.id || state.planetSettingsId === p.id
    drawPlumb(b.pos, b.uv.u, b.uv.v, p.color, (p.total ? 1 : .56) * b.dim, hi)
  }
  // 重点或悬停条目测高垂线
  for (const n of nodeList) {
    const hi = state.hoverId === n.id || state.nodeId === n.id
    const hub = (n.node.links?.length || 0) >= 2 && (n.planetId === state.hoverId || n.planetId === state.nodeId)
    if (!hi && !hub) continue
    const { x, z } = n.world.clone().applyQuaternion(camera.inverse)
    drawPlumb(n, x, z, n.node.color || '#8CB4FF', hi ? .96 : .62, hi)
  }

  ctx.restore()
}

function drawSurveyOrbits(ctx, planets, camera, work, state) {
  const preview = state.orbitPreview
  const showTracks = Boolean(state.orbitEditing || state.activeOrbit || state.hoverOrbit || state.mergeOrbit || preview)
  if (!showTracks) return planets.filter(body => body.orbitId === body.id)
    .map(body => ({ id: body.orbitId, radius: body.orbitRadius, elevation: body.elevationB, aspect: body.orbitAspect || 1, aspectZ: body.orbitAspectZ || 1 }))
  const tracks = new Map()
  for (const planet of planets) {
    if (!tracks.has(planet.orbitId) || planet.orbitId === planet.id) tracks.set(planet.orbitId, planet)
  }
  const orbits = []
  for (const planet of tracks.values()) {
    const radius = planet.orbitRadius
    const aspect = planet.orbitAspect || 1
    const aspectZ = planet.orbitAspectZ || 1
    const points = Array.from({ length: 97 }, (_, i) =>
      camera.projectWorld(orbitPoint(radius, i / 96 * TAU, planet.elevationB, aspect, aspectZ)))
    orbits.push({ id: planet.orbitId, radius, elevation: planet.elevationB, aspect, aspectZ, points })
    if (state.mergeOrbit && state.activeOrbit === planet.orbitId) continue
    const merging = state.mergeOrbit === planet.orbitId
    const active = merging || state.activeOrbit === planet.orbitId || state.hoverOrbit === planet.orbitId
    ctx.save()
    ctx.strokeStyle = merging ? '#F2CF9C' : active ? '#47D7E8' : '#7aa4cc'
    ctx.globalAlpha = merging ? 0.95 : active ? 0.88 : 0.36
    ctx.lineWidth = merging ? 2.1 : active ? 1.45 : 0.85
    ctx.setLineDash(active ? [] : [4.5, 4])
    strokePoints(ctx, points)
    ctx.setLineDash([])
    // 全息极坐标轨道刻度短线与刻度点
    const step = active ? 4 : 8
    for (let i = 0; i < points.length - 1; i += step) {
      const major = i % 16 === 0
      const pt = points[i]
      if (active && major && work) {
        const dx = pt.x - work.x, dy = pt.y - work.y
        const len = Math.hypot(dx, dy) || 1
        const tx = dx / len * 4.5, ty = dy / len * 4.5
        ctx.strokeStyle = merging ? '#F2CF9C' : '#EAF3FF'
        ctx.lineWidth = 0.95
        ctx.globalAlpha = 0.88
        ctx.beginPath()
        ctx.moveTo(pt.x - tx, pt.y - ty)
        ctx.lineTo(pt.x + tx, pt.y + ty)
        ctx.stroke()
      } else {
        ctx.fillStyle = merging ? '#F2CF9C' : '#47D7E8'
        ctx.globalAlpha = active ? 0.82 : 0.42
        ctx.fillRect(pt.x - 1, pt.y - 1, 2, 2)
      }
    }
    ctx.restore()
  }

  // 拖拽星域或轨道时：绘制冰青全息极坐标径向矢量线与角度/半径微标
  if (preview && work) {
    const r = preview.radius
    const ang = Number.isFinite(preview.angle) ? preview.angle : 0
    const target = planets.find(planet => planet.id === preview.planetId) || tracks.get(preview.trackId)
    const targetPt = camera.projectWorld(orbitPoint(r, ang, target?.elevationB, target?.orbitAspect, target?.orbitAspectZ))
    const col = preview.target ? '#F2CF9C' : '#47D7E8'
    ctx.save()
    ctx.strokeStyle = col
    ctx.lineWidth = 1.05
    ctx.globalAlpha = 0.78
    ctx.setLineDash([3, 3.5])
    ctx.beginPath()
    ctx.moveTo(work.x, work.y)
    ctx.lineTo(targetPt.x, targetPt.y)
    ctx.stroke()
    ctx.setLineDash([])

    const deg = Math.round(((ang * 180 / Math.PI) % 360 + 360) % 360)
    const label = preview.target
      ? `MERGE // R ${r.toFixed(2)} · 并轨就绪`
      : `POLAR // R ${r.toFixed(2)} · θ ${String(deg).padStart(3, '0')}°`
    const midX = (work.x + targetPt.x) * 0.5
    const midY = (work.y + targetPt.y) * 0.5 - 9
    ctx.font = '600 9.5px "JetBrains Mono", Consolas, monospace'
    ctx.fillStyle = preview.target ? '#F2CF9C' : '#EAF3FF'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    outlinedText(ctx, label, midX, midY)
    ctx.restore()
  }

  return orbits.sort((a, b) => a.radius - b.radius)
}

function drawPrismCore(ctx, camera, origin, view, center, title, glow, spectrum, t, reduced, rotating, width, height) {
  const { brightness, effect, colorMode } = glow
  const r = center.radius
  const light = brightness / 100
  const whole = centerGlowSample(effect, colorMode, t)
  const breathing = effect === 'breathe'
  const pulsing = effect === 'pulse'
  const sweeping = effect === 'sweep'
  const rippling = effect === 'ripple'
  const opal = colorMode === 'opal'
  const breathGain = breathing ? centerGlowPulse(whole.phase) : 0.94
  const pulseFlash = pulsing ? Math.pow(Math.max(0, 1 - whole.phase * 1.45), 2) : 0

  const platinum = spectrum.platinum || spectrum.highlight
  const coreGlowRgb = spectrum.coreGlow || spectrum.primary
  const primaryTint = samplePrismColor(spectrum, colorMode, effect, t, { role: 'primary', layer: 0.78, slot: 0 })
  const accentTint = samplePrismColor(spectrum, colorMode, effect, t, { role: 'accent', layer: 0.28, slot: 2 })
  const deepTint = mixRgb(spectrum.deep, accentTint, 0.22)

  ctx.save()

  // 1. 三段折射径向光场（外围主彩→副彩→深邃折射影）+ 核内紧致微光
  if (light > 0) {
    const outer = r * (2.15 + (breathing ? 0.18 * (breathGain - 0.88) : 0) + pulseFlash * 0.14)
    const aura = ctx.createRadialGradient?.(center.x, center.y, r * 0.06, center.x, center.y, outer)
    if (aura?.addColorStop) {
      aura.addColorStop(0, rgbaString(primaryTint, clamp((0.20 + pulseFlash * 0.08) * light * breathGain, 0, 0.36)))
      aura.addColorStop(0.45, rgbaString(accentTint, clamp(0.11 * light * breathGain, 0, 0.22)))
      aura.addColorStop(0.78, rgbaString(deepTint, clamp(0.042 * light * breathGain, 0, 0.10)))
      aura.addColorStop(1, rgbaString(deepTint, 0))
      ctx.fillStyle = aura
      ctx.beginPath()
      ctx.arc(center.x, center.y, outer, 0, TAU)
      ctx.fill()
    }
    const innerR = r * (0.56 + pulseFlash * 0.10)
    const inner = ctx.createRadialGradient?.(center.x, center.y, r * 0.02, center.x, center.y, innerR)
    if (inner?.addColorStop) {
      inner.addColorStop(0, rgbaString(coreGlowRgb, clamp((0.25 + pulseFlash * 0.14) * light * breathGain, 0, 0.44)))
      inner.addColorStop(0.55, rgbaString(primaryTint, clamp(0.10 * light * breathGain, 0, 0.20)))
      inner.addColorStop(1, rgbaString(primaryTint, 0))
      ctx.fillStyle = inner
      ctx.beginPath()
      ctx.arc(center.x, center.y, innerR, 0, TAU)
      ctx.fill()
    }
  }

  // 2. 引力脉动双层渐隐扩展波纹
  if (pulsing && light > 0 && !reduced) {
    for (const [waveIndex, offset] of [0, 0.48].entries()) {
      const p = (whole.phase + offset) % 1
      const env = centerGlowWave(p)
      if (env <= 0.01) continue
      const waveR = r * (1.02 + 1.06 * p)
      const waveColor = mixRgb(coreGlowRgb, accentTint, p)
      ctx.strokeStyle = rgbaString(waveColor, Math.min(0.82, light * env * (waveIndex ? 0.62 : 0.96)))
      ctx.lineWidth = waveIndex ? 0.95 : 1.45
      ctx.globalAlpha = 1
      ctx.beginPath()
      ctx.arc(center.x, center.y, waveR, 0, TAU)
      ctx.stroke()
    }
  }

  const worldRadius = .44 * center.coreScale
  const projectLocal = v => camera.project(v.multiplyScalar(worldRadius).applyQuaternion(view).add(origin))

  // 3. 3 道三维正交旋转陀螺仪子午环（欧泊三彩还原设计稿外铂白 / 中主彩 / 内副彩分工）
  const gyros = [
    { rad: 1.48, rx: 0.35 + t * 0.16, ry: -0.22 + t * 0.11, rz: 0.18, role: 'platinum', layer: 0.18, slot: 0, alpha: 0.48, ticks: 24 },
    { rad: 1.28, rx: 1.22 - t * 0.14, ry: 0.48 + t * 0.19, rz: -0.52, role: 'primary', layer: 0.56, slot: 1, alpha: 0.58, ticks: 16 },
    { rad: 1.12, rx: -0.68 + t * 0.12, ry: 1.05 - t * 0.15, rz: 0.84, role: 'accent', layer: 0.90, slot: 2, alpha: 0.48, ticks: 12 }
  ]

  const segmentedRing = !rotating && (sweeping || colorMode === 'prism' || colorMode === 'layered' || rippling)
  for (const g of gyros) {
    const segs = rotating ? 28 : segmentedRing ? 36 : 48
    const pts = new Array(segs + 1)
    for (let i = 0; i <= segs; i++) {
      const a = (i / segs) * TAU
      const local = rotVec(Math.cos(a) * g.rad, 0, Math.sin(a) * g.rad, g.rx, g.ry, g.rz)
      pts[i] = projectLocal(local)
    }
    const ringGain = clamp((0.38 + 0.62 * light) * (breathGain + pulseFlash * 0.22), 0.26, 1.14)
    const ringBaseRgb = samplePrismColor(spectrum, colorMode, effect, t, { role: g.role, layer: g.layer, slot: g.slot, angle: g.slot * 2.09 })

    if (segmentedRing) {
      for (let i = 0; i < segs; i++) {
        const aMid = ((i + 0.5) / segs) * TAU
        const segRgb = opal
          ? ringBaseRgb
          : samplePrismColor(spectrum, colorMode, effect, t, { role: g.role, layer: g.layer, slot: g.slot, angle: aMid })
        const edgeBoost = centerGlowEdge(effect, aMid, t + g.slot * 0.68)
        const strokeRgb = sweeping
          ? mixRgb(segRgb, platinum, clamp(edgeBoost * 0.80, 0, 0.88))
          : rippling
            ? mixRgb(segRgb, platinum, edgeBoost * 0.22)
            : segRgb
        const alpha = clamp(
          g.alpha * ringGain * (sweeping ? 0.36 + edgeBoost * 1.16 : rippling ? 0.74 + edgeBoost * 0.44 : 0.98),
          0.14,
          0.98
        )
        ctx.strokeStyle = rgbaString(strokeRgb, alpha)
        ctx.lineWidth = sweeping ? 0.72 + edgeBoost * 1.28 : rippling ? 0.76 + edgeBoost * 0.36 : 0.86
        ctx.globalAlpha = 1
        ctx.beginPath()
        ctx.moveTo(pts[i].x, pts[i].y)
        ctx.lineTo(pts[i + 1].x, pts[i + 1].y)
        ctx.stroke()
      }
    } else {
      ctx.beginPath()
      for (let i = 0; i <= segs; i++) {
        if (i === 0) ctx.moveTo(pts[i].x, pts[i].y)
        else ctx.lineTo(pts[i].x, pts[i].y)
      }
      ctx.strokeStyle = rgbaString(ringBaseRgb, clamp(g.alpha * ringGain, 0.16, 0.96))
      ctx.lineWidth = rippling ? 0.86 + 0.30 * Math.abs(Math.sin(t * 1.9 + g.slot)) : 0.84
      ctx.globalAlpha = 1
      ctx.stroke()
    }

    for (let group = 0; group < (rotating ? 1 : 2); group++) {
      const major = group === 0
      ctx.beginPath()
      for (let k = 0; k < g.ticks; k++) {
        if (major !== (k % 4 === 0)) continue
        const a = k / g.ticks * TAU
        const radial = rotVec(Math.cos(a) * g.rad, 0, Math.sin(a) * g.rad, g.rx, g.ry, g.rz)
        const pIn = projectLocal(radial.clone().multiplyScalar(major ? .92 : .96))
        const pOut = projectLocal(radial.multiplyScalar(major ? 1.05 : 1.02))
        ctx.moveTo(pIn.x, pIn.y)
        ctx.lineTo(pOut.x, pOut.y)
      }
      const tickRgb = major ? platinum : ringBaseRgb
      ctx.strokeStyle = rgbaString(tickRgb, clamp(g.alpha * ringGain * (major ? 1.15 : 0.74), 0.14, 0.98))
      ctx.lineWidth = major ? 0.95 : 0.62
      ctx.globalAlpha = 1
      ctx.stroke()
    }
  }

  // 4. 半透明晶体八面体棱镜核（8 面棋盘式三色交错 + 晶面内部折射微渐变 + 刀锋铂白正面棱边）
  const spinY = t * 0.28
  const spinX = Math.sin(t * 0.35) * 0.16
  const spinZ = 0.14
  const rawVerts = [
    [0, 1.06, 0],
    [0, -1.06, 0],
    [0.78, 0, 0],
    [0, 0, 0.78],
    [-0.78, 0, 0],
    [0, 0, -0.78]
  ]
  const verts = rawVerts.map(v => projectLocal(rotVec(v[0], v[1], v[2], spinX, spinY, spinZ)))
  const faces = [
    { idx: [0, 2, 3], slot: 0, role: 'platinum', layer: 0.92, baseAlpha: 0.15 },
    { idx: [0, 3, 4], slot: 1, role: 'primary', layer: 0.78, baseAlpha: 0.21 },
    { idx: [0, 4, 5], slot: 2, role: 'accent', layer: 0.62, baseAlpha: 0.19 },
    { idx: [0, 5, 2], slot: 3, role: 'primary', layer: 0.82, baseAlpha: 0.16 },
    { idx: [1, 3, 2], slot: 4, role: 'accent', layer: 0.44, baseAlpha: 0.20 },
    { idx: [1, 4, 3], slot: 5, role: 'platinum', layer: 0.34, baseAlpha: 0.12 },
    { idx: [1, 5, 4], slot: 6, role: 'primary', layer: 0.22, baseAlpha: 0.18 },
    { idx: [1, 2, 5], slot: 7, role: 'accent', layer: 0.36, baseAlpha: 0.15 }
  ].map(f => {
    const p0 = verts[f.idx[0]], p1 = verts[f.idx[1]], p2 = verts[f.idx[2]]
    return { ...f, p0, p1, p2, zAvg: (p0.z + p1.z + p2.z) / 3 }
  }).sort((a, b) => a.zAvg - b.zAvg)

  for (const f of faces) {
    const cx = (f.p0.x + f.p1.x + f.p2.x) / 3
    const cy = (f.p0.y + f.p1.y + f.p2.y) / 3
    const aAvg = Math.atan2(cy - center.y, cx - center.x)
    const rim = centerGlowEdge(effect, aAvg, t)
    const faceRgb = samplePrismColor(spectrum, colorMode, effect, t, { role: f.role, slot: f.slot, angle: aAvg, layer: f.layer })
    const isFront = f.zAvg > center.z
    const fillGain = clamp((0.50 + 0.54 * light) * (breathGain + pulseFlash * 0.24), 0.34, 1.18)
    const depthGain = isFront ? 1.12 : 0.86
    const faceAlpha = clamp(f.baseAlpha * fillGain * depthGain * (0.86 + rim * 0.38), 0.06, 0.34)

    ctx.beginPath()
    ctx.moveTo(f.p0.x, f.p0.y)
    ctx.lineTo(f.p1.x, f.p1.y)
    ctx.lineTo(f.p2.x, f.p2.y)
    ctx.closePath()

    const midEx = (f.p1.x + f.p2.x) * 0.5
    const midEy = (f.p1.y + f.p2.y) * 0.5
    const grad = ctx.createLinearGradient?.(f.p0.x, f.p0.y, midEx, midEy)
    if (grad?.addColorStop) {
      const litEnd = mixRgb(faceRgb, f.role === 'platinum' ? platinum : coreGlowRgb, isFront ? 0.24 : 0.10)
      const shadowEnd = mixRgb(faceRgb, deepTint, f.role === 'platinum' ? 0.14 : 0.28)
      grad.addColorStop(0, rgbaString(litEnd, clamp(faceAlpha * 1.18, 0.06, 0.38)))
      grad.addColorStop(1, rgbaString(shadowEnd, clamp(faceAlpha * 0.72, 0.04, 0.28)))
      ctx.fillStyle = grad
    } else {
      ctx.fillStyle = rgbaString(faceRgb, faceAlpha)
    }
    ctx.globalAlpha = 1
    ctx.fill()

    // 刀锋级正面铂白棱边 + 高纯半透背面折射棱边
    const edgeRgb = isFront
      ? mixRgb(platinum, faceRgb, sweeping ? (1 - rim) * 0.16 : 0.08)
      : (opal ? primaryTint : faceRgb)
    const edgeAlpha = isFront
      ? clamp((0.80 + rim * 0.16) * clamp(0.68 + 0.36 * light, 0.56, 1.08), 0.52, 0.96)
      : clamp((0.34 + rim * 0.22) * fillGain, 0.20, 0.68)
    ctx.strokeStyle = rgbaString(edgeRgb, edgeAlpha)
    ctx.lineWidth = isFront ? (sweeping ? 1.05 + rim * 0.45 : 1.08) : 0.72
    ctx.stroke()
  }

  // 5. 内部晶轴与四芒光学衍射星芯 + 极细十字衍射针芒
  const axisRgb = mixRgb(primaryTint, coreGlowRgb, 0.28)
  ctx.strokeStyle = rgbaString(axisRgb, clamp((0.46 + pulseFlash * 0.36) * light * breathGain, 0.22, 0.90))
  ctx.lineWidth = 0.76 + pulseFlash * 0.30
  ctx.globalAlpha = 1
  ctx.beginPath()
  ctx.moveTo(verts[0].x, verts[0].y); ctx.lineTo(verts[1].x, verts[1].y)
  ctx.moveTo(verts[2].x, verts[2].y); ctx.lineTo(verts[4].x, verts[4].y)
  ctx.moveTo(verts[3].x, verts[3].y); ctx.lineTo(verts[5].x, verts[5].y)
  ctx.stroke()

  const coreScale = 1 + (breathing ? (breathGain - 0.90) * 0.22 : 0) + pulseFlash * 0.24
  const coreArm = r * 0.27 * coreScale
  if (light > 0) {
    const raySpan = coreArm * 1.72
    const rayAlpha = clamp((0.44 + pulseFlash * 0.28) * light * breathGain, 0.14, 0.72)
    for (const [dx, dy] of [[raySpan, 0], [0, raySpan]]) {
      const rayGrad = ctx.createLinearGradient?.(center.x - dx, center.y - dy, center.x + dx, center.y + dy)
      if (rayGrad?.addColorStop) {
        rayGrad.addColorStop(0, rgbaString(coreGlowRgb, 0))
        rayGrad.addColorStop(0.38, rgbaString(coreGlowRgb, rayAlpha * 0.55))
        rayGrad.addColorStop(0.5, rgbaString(platinum, rayAlpha))
        rayGrad.addColorStop(0.62, rgbaString(coreGlowRgb, rayAlpha * 0.55))
        rayGrad.addColorStop(1, rgbaString(coreGlowRgb, 0))
        ctx.strokeStyle = rayGrad
      } else {
        ctx.strokeStyle = rgbaString(coreGlowRgb, rayAlpha * 0.5)
      }
      ctx.lineWidth = 0.85
      ctx.beginPath()
      ctx.moveTo(center.x - dx, center.y - dy)
      ctx.lineTo(center.x + dx, center.y + dy)
      ctx.stroke()
    }
  }

  const drawStar = (arm, fillStyle) => {
    ctx.fillStyle = fillStyle
    ctx.beginPath()
    ctx.moveTo(center.x, center.y - arm)
    ctx.lineTo(center.x + arm * 0.30, center.y - arm * 0.30)
    ctx.lineTo(center.x + arm, center.y)
    ctx.lineTo(center.x + arm * 0.30, center.y + arm * 0.30)
    ctx.lineTo(center.x, center.y + arm)
    ctx.lineTo(center.x - arm * 0.30, center.y + arm * 0.30)
    ctx.lineTo(center.x - arm, center.y)
    ctx.lineTo(center.x - arm * 0.30, center.y - arm * 0.30)
    ctx.closePath()
    ctx.fill()
  }
  if (light > 0) drawStar(coreArm * 1.42, rgbaString(coreGlowRgb, clamp(0.32 * light * breathGain, 0.10, 0.48)))
  drawStar(coreArm, rgbaString(platinum, clamp(0.76 + 0.24 * light, 0.64, 1)))

  // 6. 中心铭牌（恢复设计稿深空柔影冷铂排印并同步高饱和主彩微标）
  const labelY = clamp(center.y + r * 1.58, 24, height - 28)
  const labelX = clamp(center.x, 70, width - 70)
  ctx.globalAlpha = 0.98
  const fontSize = Math.round(clamp(r * .32, 11, 13.5) * 2) / 2
  ctx.font = `600 ${fontSize}px "PingFang SC", "Microsoft YaHei", sans-serif`
  ctx.fillStyle = rgbaString(platinum, 0.98)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = '#04070D'
  ctx.shadowBlur = 7
  const fitTitle = fitText(ctx, title || '设定集总览', Math.min(200, width * 0.42))
  outlinedText(ctx, fitTitle, labelX, labelY)

  ctx.font = '500 9px "JetBrains Mono", Consolas, monospace'
  ctx.fillStyle = rgbaString(primaryTint, 0.86)
  ctx.globalAlpha = 1
  outlinedText(ctx, 'PRISM CORE // 00', labelX, labelY + 13)
  ctx.shadowBlur = 0
  ctx.restore()
}

function drawTopologyDomain(ctx, body, state, projected) {
  const { planet: s, pos, caliperRadius: baseR } = body
  const lens = body.lens || 1
  const r = baseR * (state.rimHoverId === s.id || state.resizingSetId === s.id ? 1 : lens)
  const x = pos.x, y = pos.y
  const isEmpty = s.entries.length === 0
  const hasDraggedChild = Boolean(state.draggingNodeId && projected?.get(state.draggingNodeId)?.planetId === s.id)
  const isRimActive = state.rimHoverId === s.id || state.resizingSetId === s.id || state.orbitPreview?.planetId === s.id
  const isSetHovered = state.hoverId === s.id || state.nodeId === s.id || state.planetSettingsId === s.id || hasDraggedChild || lens > 1.02
  const col = s.color || '#8CB4FF'
  const baseAlpha = (isRimActive || isSetHovered ? .95 : .78) * body.dim

  ctx.save()
  if (lens > 1.008 && !isEmpty) {
    ctx.strokeStyle = '#47D7E8'
    ctx.lineWidth = 1.05
    ctx.globalAlpha = clamp((lens - 1) / .12, 0, 1) * .28 * body.dim
    ctx.beginPath()
    ctx.arc(x, y, r + 5, 0, TAU)
    ctx.stroke()
  }
  if (isEmpty) {
    const rot = (state.centerGlowTime || 0) * 0.00038
    ctx.setLineDash([4.5, 4])
    ctx.strokeStyle = isRimActive ? '#47D7E8' : col
    ctx.lineWidth = isRimActive ? 1.45 : 0.85
    ctx.globalAlpha = baseAlpha * (isRimActive ? 0.92 : 0.38)
    ctx.beginPath()
    for (let i = 0; i < 8; i++) {
      const a = i * (TAU / 8) + Math.PI / 8
      const rad = i % 2 === 0 ? r * 1.02 : r * 0.88
      const px = x + Math.cos(a) * rad
      const py = y + Math.sin(a) * rad
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.stroke()
    ctx.setLineDash([])

    ctx.strokeStyle = col
    ctx.lineWidth = 0.6
    ctx.globalAlpha = baseAlpha * 0.22
    ctx.beginPath()
    ctx.moveTo(x - r * 0.62, y); ctx.lineTo(x + r * 0.62, y)
    ctx.moveTo(x, y - r * 0.62); ctx.lineTo(x, y + r * 0.62)
    ctx.stroke()

    for (let layer = 0; layer < 2; layer++) {
      const dr = (layer === 0 ? 10.5 : 5.6) * clamp(r / 42, 0.72, 1.3)
      const ang = layer === 0 ? rot : -rot * 1.4
      ctx.strokeStyle = layer === 0 ? '#47D7E8' : '#EAF3FF'
      ctx.lineWidth = layer === 0 ? .95 : 0.75
      ctx.globalAlpha = baseAlpha * (isSetHovered || isRimActive ? .76 : (layer === 0 ? .52 : .38))
      ctx.beginPath()
      for (let k = 0; k < 4; k++) {
        const a = ang + k * (Math.PI * 0.5)
        const px = x + Math.cos(a) * dr
        const py = y + Math.sin(a) * dr
        if (k === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.closePath()
      ctx.stroke()
    }
  } else {
    const activeCol = isRimActive ? '#47D7E8' : isSetHovered ? '#EAF3FF' : col
    const bracketAlpha = baseAlpha * (isRimActive ? 0.96 : isSetHovered ? 0.76 : 0.44)
    const span = 0.48
    const serifLen = isRimActive ? 6.2 : 4.2

    // Batch all 4 quadrant caliper arcs + serifs into a single stroke call.
    ctx.strokeStyle = activeCol
    ctx.lineWidth = isRimActive ? 1.65 : isSetHovered ? 1.2 : 0.92
    ctx.globalAlpha = bracketAlpha
    ctx.beginPath()
    for (let q = 0; q < 4; q++) {
      const midA = q * (Math.PI * 0.5) + Math.PI * 0.25
      const a0 = midA - span
      const a1 = midA + span
      const c0 = Math.cos(a0), s0 = Math.sin(a0)
      const c1 = Math.cos(a1), s1 = Math.sin(a1)
      ctx.moveTo(x + c0 * r, y + s0 * r)
      ctx.arc(x, y, r, a0, a1)
      ctx.moveTo(x + c0 * r, y + s0 * r)
      ctx.lineTo(x + c0 * (r - serifLen), y + s0 * (r - serifLen))
      ctx.moveTo(x + c1 * r, y + s1 * r)
      ctx.lineTo(x + c1 * (r - serifLen), y + s1 * (r - serifLen))
    }
    ctx.stroke()

    if (!state.rotating || isRimActive) {
      ctx.lineWidth = .7
      ctx.globalAlpha = bracketAlpha * .7
      ctx.beginPath()
      for (let q = 0; q < 4; q++) {
        const midA = q * (Math.PI * 0.5) + Math.PI * 0.25
        const a0 = midA - span
        const a1 = midA + span
        for (let t = 1; t <= 3; t++) {
          const ta = a0 + (a1 - a0) * (t / 4)
          const tickL = t === 2 ? 4.2 : 2.4
          const ct = Math.cos(ta), st = Math.sin(ta)
          ctx.moveTo(x + ct * (r - tickL), y + st * (r - tickL))
          ctx.lineTo(x + ct * r, y + st * r)
        }
      }
      ctx.stroke()
    }

    const arm = isRimActive ? 3.5 : 2.3
    ctx.strokeStyle = isRimActive ? '#47D7E8' : col
    ctx.lineWidth = 0.8
    ctx.globalAlpha = baseAlpha * (isRimActive ? 0.92 : 0.48)
    ctx.beginPath()
    for (let p = 0; p < 4; p++) {
      const pa = p * (Math.PI * 0.5)
      const px = x + Math.cos(pa) * r
      const py = y + Math.sin(pa) * r
      ctx.moveTo(px - arm, py); ctx.lineTo(px + arm, py)
      ctx.moveTo(px, py - arm); ctx.lineTo(px, py + arm)
    }
    ctx.stroke()
  }

  if (isRimActive) {
    ctx.setLineDash([2, 3.5])
    ctx.strokeStyle = '#47D7E8'
    ctx.lineWidth = 0.85
    ctx.globalAlpha = 0.65
    ctx.beginPath()
    ctx.arc(x, y, r + 5, 0, TAU)
    ctx.stroke()
    ctx.setLineDash([])

    for (let q = 0; q < 4; q++) {
      const ha = q * (Math.PI * 0.5) + Math.PI * 0.25
      const hx = x + Math.cos(ha) * r
      const hy = y + Math.sin(ha) * r
      const d = 4.2
      ctx.fillStyle = '#04070D'
      ctx.strokeStyle = '#47D7E8'
      ctx.lineWidth = 1.25
      ctx.globalAlpha = 0.98
      ctx.beginPath()
      ctx.moveTo(hx, hy - d)
      ctx.lineTo(hx + d, hy)
      ctx.lineTo(hx, hy + d)
      ctx.lineTo(hx - d, hy)
      ctx.closePath()
      ctx.fill()
      ctx.stroke()
    }
  }
  ctx.restore()
}

function drawConstellationWeave(ctx, body, projected, state, alphaGain) {
  const { planet } = body
  const col = planet.color || '#8CB4FF'
  const isSetFocused = state.hoverId === planet.id || state.nodeId === planet.id
    || state.resizingSetId === planet.id || state.rimHoverId === planet.id
    || state.soloLayer === 'weave'
  ctx.save()

  if (planet.entries.length >= 3 && (!state.rotating || isSetFocused)) {
    for (const [na, nb, nc] of planet.triangles) {
      const pa = projected.get(na.id), pb = projected.get(nb.id), pc = projected.get(nc.id)
      if (!pa || !pb || !pc) continue
      ctx.beginPath()
      ctx.moveTo(pa.x, pa.y)
      ctx.lineTo(pb.x, pb.y)
      ctx.lineTo(pc.x, pc.y)
      ctx.closePath()
      ctx.fillStyle = hexToRgba(col, (.016 + .032 * (isSetFocused ? 1 : body.reveal)) * alphaGain)
      ctx.globalAlpha = 1
      ctx.fill()
    }
  }

  ctx.strokeStyle = isSetFocused ? '#9BE8F5' : col
  ctx.lineWidth = isSetFocused ? .85 : .72
  const groups = isSetFocused || state.rotating ? 1 : 2
  for (let band = 0; band < groups; band++) {
    ctx.beginPath()
    let segments = 0
    for (const [from, to] of planet.weave) {
      const a = projected.get(from.id), b = projected.get(to.id)
      if (!a || !b || (groups === 2 && Number(a.facing + b.facing >= 0) !== band)) continue
      const dx = b.x - a.x, dy = b.y - a.y
      const length = Math.hypot(dx, dy)
      const fromRadius = a.glyphRadius ?? a.radius, toRadius = b.glyphRadius ?? b.radius
      if (length <= fromRadius + toRadius) continue
      ctx.moveTo(a.x + dx * fromRadius / length, a.y + dy * fromRadius / length)
      ctx.lineTo(b.x - dx * toRadius / length, b.y - dy * toRadius / length)
      segments++
    }
    if (segments) {
      ctx.globalAlpha = (isSetFocused ? .46 : groups === 1 ? .26 : .22 + .12 * band) * alphaGain
      ctx.stroke()
    }
  }
  ctx.setLineDash([])
  ctx.restore()
}

function drawIntraBeam(ctx, points, link, a, b, emphasized, baseGain) {
  const exposed = a.front && b.front
  ctx.save()
  ctx.strokeStyle = emphasized ? '#EAF3FF' : (a.node?.color || '#8CB4FF')
  ctx.lineWidth = emphasized ? .85 : .76
  ctx.globalAlpha = clamp((emphasized ? 0.96 : exposed ? 0.74 : 0.44) * baseGain, 0, 1)
  strokePoints(ctx, points)

  const p0 = points[0], p1 = points[points.length - 1]
  const midX = (p0.x + p1.x) * 0.5, midY = (p0.y + p1.y) * 0.5
  const dx = p1.x - p0.x, dy = p1.y - p0.y
  const len = Math.hypot(dx, dy) || 1
  if (len > 18) {
    const nx = -dy / len * 2.8, ny = dx / len * 2.8
    ctx.strokeStyle = emphasized ? '#47D7E8' : '#9FB4CC'
    ctx.lineWidth = 0.75
    ctx.globalAlpha = clamp((emphasized ? 0.95 : 0.52) * baseGain, 0, 1)
    ctx.beginPath()
    ctx.moveTo(midX - nx, midY - ny)
    ctx.lineTo(midX + nx, midY + ny)
    ctx.stroke()
  }
  ctx.restore()
}

function computeParabolicCrossPoints(camera, scene, viewInverse, a, b, steps) {
  _tmpA.copy(a.world).applyQuaternion(viewInverse)
  _tmpB.copy(b.world).applyQuaternion(viewInverse)
  const au = _tmpA.x, av = _tmpA.z, ay = _tmpA.y
  const bu = _tmpB.x, bv = _tmpB.z, by = _tmpB.y
  const sDx = b.x - a.x, sDy = b.y - a.y
  const sDist = Math.hypot(sDx, sDy) || 1
  const horizRatio = clamp(Math.abs(sDx) / sDist, 0.18, 1)
  const wDist = _tmpA.distanceTo(_tmpB)
  const midU = (au + bu) * 0.5, midV = (av + bv) * 0.5
  const normR = Math.hypot(midU, midV) || 0.01
  const radialPush = (1 - horizRatio) * 0.62 + (normR < 1.35 ? (1.35 - normR) * 0.45 : 0.18)
  const outU = (midU / normR) * radialPush
  const outV = (midV / normR) * radialPush
  const archH = (0.28 + 0.58 * horizRatio) * (0.72 + Math.min(0.65, wDist * 0.14))

  const samples = new Array(steps + 1)
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const para = 4 * t * (1 - t)
    const u = au + (bu - au) * t + outU * para
    const v = av + (bv - av) * t + outV * para
    const y = ay + (by - ay) * t + archH * para
    _tmpPt.set(u, y, v).applyQuaternion(scene.view)
    const pt = camera.project(_tmpPt)
    pt.u = u
    pt.v = v
    samples[i] = pt
  }
  samples[0] = a
  samples[steps] = b
  return samples
}

function drawCrossRibbon(ctx, camera, scene, viewInverse, field, a, samples, trimmed, link, emphasized, baseGain, state, centerSpectrum, centerGlow, centerGlowSec) {
  // 地面扭曲势阱阴影虚线弧
  if (emphasized || state.soloLayer === 'cross' || (!state.rotating && baseGain > .35)) {
    const shadowPts = new Array(samples.length)
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i]
      let u = s.u, v = s.v
      if (u == null) {
        _tmpA.copy(s.world || a.world).applyQuaternion(viewInverse)
        u = _tmpA.x
        v = _tmpA.z
      }
      const d = terrainDepth(field, u, v)
      _tmpPt.set(u, -d, v).applyQuaternion(scene.view)
      shadowPts[i] = camera.project(_tmpPt)
    }
    ctx.setLineDash([2.5, 4])
    ctx.strokeStyle = emphasized ? '#47D7E8' : '#7aa4cc'
    ctx.lineWidth = emphasized ? 1.05 : 0.72
    ctx.globalAlpha = clamp((emphasized ? 0.56 : 0.24) * baseGain, 0, 1)
    strokePoints(ctx, shadowPts)
    if (emphasized && shadowPts.length && trimmed.length) {
      const midTop = trimmed[Math.floor(trimmed.length / 2)]
      const midBot = shadowPts[Math.floor(shadowPts.length / 2)]
      ctx.setLineDash([1.5, 3.5])
      ctx.globalAlpha = 0.36
      ctx.lineWidth = 0.7
      ctx.beginPath()
      ctx.moveTo(midTop.x, midTop.y)
      ctx.lineTo(midBot.x, midBot.y)
      ctx.stroke()
    }
    ctx.setLineDash([])
  }

  // 外层折射光晕
  if (!state.rotating || emphasized) {
    ctx.strokeStyle = emphasized ? '#47D7E8' : '#8C7BFF'
    ctx.lineWidth = emphasized ? 4.2 : 2.5
    ctx.globalAlpha = clamp((emphasized ? .26 : .13) * baseGain, 0, 1)
    strokePoints(ctx, trimmed)
  }

  // 核心锐利跃迁光线
  ctx.strokeStyle = emphasized ? '#EAF3FF' : '#65d6e8'
  ctx.lineWidth = emphasized ? 1.65 : 1.05
  ctx.globalAlpha = clamp((emphasized ? 0.98 : 0.84) * baseGain, 0, 1)
  strokePoints(ctx, trimmed)

  // 流动晶体脉冲
  if (!state.reduced && trimmed.length >= 2 && (emphasized || state.soloLayer === 'cross')) {
    const u = ((state.centerGlowTime || 0) * 0.00032 + (link.phase || 0)) % 1
    const pulseGlowRgb = centerSpectrum
      ? samplePrismColor(centerSpectrum, centerGlow?.colorMode || 'opal', centerGlow?.effect || 'ripple', centerGlowSec || 0, { role: 'primary', layer: 0.72, angle: u * TAU })
      : [71, 215, 232]
    const pulseCoreRgb = centerSpectrum?.platinum || centerSpectrum?.highlight || [234, 243, 255]
    drawCrystalPulse(ctx, trimmed, u, pulseCoreRgb, pulseGlowRgb, emphasized ? 3.2 : 2.2)
  }
}

function drawCrystalPulse(ctx, samples, u, coreRgb, glowRgb, size) {
  const idx = Math.min(samples.length - 2, Math.floor(u * (samples.length - 1)))
  const frac = u * (samples.length - 1) - idx
  const p0 = samples[idx], p1 = samples[idx + 1]
  const x = p0.x + (p1.x - p0.x) * frac
  const y = p0.y + (p1.y - p0.y) * frac
  const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x)
  ctx.save()
  ctx.translate(x, y)
  ctx.rotate(ang)
  const grad = ctx.createLinearGradient?.(-size * 4.5, 0, size * 1.2, 0)
  if (grad?.addColorStop) {
    grad.addColorStop(0, rgbaString(glowRgb, 0))
    grad.addColorStop(0.7, rgbaString(glowRgb, 0.92))
    grad.addColorStop(1, rgbaString(coreRgb, 1))
    ctx.strokeStyle = grad
  } else {
    ctx.strokeStyle = rgbaString(glowRgb, 0.92)
  }
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(-size * 4.2, 0)
  ctx.lineTo(size * 0.8, 0)
  ctx.stroke()

  ctx.fillStyle = rgbaString(coreRgb, 1)
  ctx.beginPath()
  ctx.moveTo(size * 1.35, 0)
  ctx.lineTo(0, size * 0.68)
  ctx.lineTo(-size * 1.05, 0)
  ctx.lineTo(0, -size * 0.68)
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

function drawOutsideRibbon(ctx, camera, link, point, elapsed, moving, active) {
  const direction = point.world.clone().setZ(0)
  if (!direction.lengthSq()) direction.x = 1
  const world = point.world.clone().addScaledVector(direction.normalize(), (point.radius + 24) / Math.max(1, point.scale))
  const end = { ...camera.project(world), world, center: world, radius: 2 }
  const pts = trimProjected([point, end], point, end)
  ctx.save()
  ctx.strokeStyle = '#47D7E8'
  ctx.lineWidth = active ? 2.1 : 1.5
  ctx.globalAlpha = active ? 0.94 : 0.6
  strokePoints(ctx, pts)
  ctx.fillStyle = '#EAF3FF'
  ctx.fillRect(end.x - 1.5, end.y - 1.5, 3, 3)
  ctx.restore()
}

function placeSatellites(camera, body, owner, satList, elapsed = 0, reduced = false) {
  const { center, orientation, radius } = body
  const surface = owner.world.clone().sub(center).normalize()
  if (!surface.lengthSq()) {
    if (owner.node?.position) surface.copy(owner.node.position).normalize()
    else surface.set(1, 0, 0)
    surface.applyQuaternion(orientation)
  }
  const axis = new Vector3(0, 1, 0).applyQuaternion(orientation)
  if (Math.abs(axis.dot(surface)) > 0.9) axis.set(1, 0, 0).applyQuaternion(orientation)
  const tangent = new Vector3().crossVectors(surface, axis).normalize()
  const bitangent = new Vector3().crossVectors(surface, tangent).normalize()
  const spread = satList.length > 5 ? 0.44 : 0.39
  const orbitCenter = owner.world.clone().addScaledVector(surface, radius * 0.33)
  const spinOffset = reduced ? 0 : (elapsed || 0) * 0.00018 + (String(owner.id || '').length * 0.41)

  // 生成宿主外围极细倾斜微轨子环采样点
  const ringSteps = 28
  const ringPoints = []
  for (let i = 0; i <= ringSteps; i++) {
    const a = (i / ringSteps) * TAU
    const ptWorld = orbitCenter.clone()
      .addScaledVector(tangent, Math.cos(a) * radius * spread)
      .addScaledVector(bitangent, Math.sin(a) * radius * spread)
    ringPoints.push(camera.project(ptWorld))
  }

  const placed = []
  for (const [index, item] of satList.entries()) {
    const angle = index * TAU / satList.length + spinOffset
    const world = orbitCenter.clone()
      .addScaledVector(tangent, Math.cos(angle) * radius * spread)
      .addScaledVector(bitangent, Math.sin(angle) * radius * spread)
    const proj = camera.project(world)
    const markerRadius = 2.8 + .6 * proj.depthNorm
    placed.push({
      ...proj,
      radius: markerRadius,
      owner,
      item,
      id: item.id,
      orbitRing: index === 0 ? ringPoints : null
    })
  }
  return placed
}

function drawTether(ctx, satellite, selectedId, hoverId, satAlpha) {
  const { owner, item, orbitRing } = satellite
  const active = item.id === selectedId || item.id === hoverId
  const hostActive = owner.id === hoverId || owner.planetId === hoverId
  const col = SATELLITE_COLORS[item.target?.kind] || '#47D7E8'
  ctx.save()

  // 1. 宿主外围极细倾斜微轨子环
  if (orbitRing && orbitRing.length > 2) {
    ctx.strokeStyle = active || hostActive ? '#47D7E8' : col
    ctx.lineWidth = active || hostActive ? 0.85 : 0.62
    ctx.globalAlpha = (active || hostActive ? .44 : .11) * satAlpha * owner.dim
    ctx.setLineDash([2, 3.2])
    strokePoints(ctx, orbitRing)
    ctx.setLineDash([])
  }

  // 2. 卫星至宿主的极淡虚线牵引丝
  ctx.globalAlpha = (active ? .84 : .16) * satAlpha * owner.dim
  ctx.strokeStyle = active ? '#EAF3FF' : col
  ctx.lineWidth = active ? 1.1 : 0.72
  ctx.setLineDash(active ? [] : [2.2, 2.6])
  strokePoints(ctx, trimProjected([owner, satellite], owner, satellite))
  ctx.setLineDash([])
  ctx.restore()
}

function drawTopologySatellite(ctx, satellite, state, satAlpha) {
  const { x, y, radius: r, item } = satellite
  const active = item.id === state.satelliteId || item.id === state.hoverId
  const kind = item.target?.kind || 'character'
  const col = SATELLITE_COLORS[kind] || '#47D7E8'
  ctx.save()
  ctx.globalAlpha = (active || state.soloLayer === 'satellite' ? 1 : .64) * satAlpha * satellite.owner.dim

  if (active) {
    const lockR = r * 1.65
    ctx.strokeStyle = col
    ctx.lineWidth = 0.85
    ctx.beginPath()
    ctx.moveTo(x, y - lockR); ctx.lineTo(x + lockR, y)
    ctx.lineTo(x, y + lockR); ctx.lineTo(x - lockR, y)
    ctx.closePath()
    ctx.stroke()
  }

  if (kind === 'character') {
    // 人物 = 温润鎏金/暖白微棱环星标（微棱环 + 暖白四芒星核）
    ctx.strokeStyle = active ? '#FFF8EB' : col
    ctx.lineWidth = active ? 1.05 : 0.8
    ctx.beginPath()
    ctx.arc(x, y, r * 1.15, 0, TAU)
    ctx.stroke()

    const arm = r * 1.05
    const waist = r * 0.34
    ctx.fillStyle = active ? '#FFFDF8' : '#FFF1D6'
    ctx.strokeStyle = col
    ctx.lineWidth = 0.75
    ctx.beginPath()
    ctx.moveTo(x, y - arm)
    ctx.lineTo(x + waist, y - waist)
    ctx.lineTo(x + arm, y)
    ctx.lineTo(x + waist, y + waist)
    ctx.lineTo(x, y + arm)
    ctx.lineTo(x - waist, y + waist)
    ctx.lineTo(x - arm, y)
    ctx.lineTo(x - waist, y - waist)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  } else if (kind === 'outline') {
    // 大纲 = 冰川青菱形书签微晶（修长切面菱晶 + 内部晶脊线）
    const ry = r * 1.18
    const rx = r * 0.78
    ctx.fillStyle = active ? '#EAF3FF' : col
    ctx.beginPath()
    ctx.moveTo(x, y - ry); ctx.lineTo(x, y + ry); ctx.lineTo(x - rx, y)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = active ? col : hexToRgba(col, 0.45)
    ctx.beginPath()
    ctx.moveTo(x, y - ry); ctx.lineTo(x + rx, y); ctx.lineTo(x, y + ry)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = active ? '#FFFFFF' : '#EAF3FF'
    ctx.lineWidth = active ? 1.2 : 0.85
    ctx.beginPath()
    ctx.moveTo(x, y - ry); ctx.lineTo(x + rx, y); ctx.lineTo(x, y + ry); ctx.lineTo(x - rx, y)
    ctx.closePath()
    ctx.stroke()
  } else if (kind === 'chapter' || kind === 'olnode') {
    // 正文/画布 = 淡靛紫方棱微片（双色斜切方棱晶片 + 中心微十字）
    const s = r * 0.82
    ctx.fillStyle = active ? '#EAF3FF' : hexToRgba(col, 0.38)
    ctx.strokeStyle = active ? '#FFFFFF' : col
    ctx.lineWidth = active ? 1.2 : 0.9
    ctx.beginPath()
    ctx.rect(x - s, y - s, s * 2, s * 2)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = active ? col : '#EAF3FF'
    ctx.beginPath()
    ctx.moveTo(x, y - s * 0.65); ctx.lineTo(x + s * 0.65, y)
    ctx.lineTo(x, y + s * 0.65); ctx.lineTo(x - s * 0.65, y)
    ctx.closePath()
    ctx.fill()
  } else {
    // 灵感 = 薄荷青六芒棱晶
    ctx.fillStyle = active ? '#EAF3FF' : hexToRgba(col, 0.42)
    ctx.strokeStyle = active ? '#FFFFFF' : col
    ctx.lineWidth = active ? 1.15 : 0.85
    ctx.beginPath()
    for (let i = 0; i < 6; i++) {
      const a = i * (TAU / 6) - Math.PI * 0.5
      const px = x + Math.cos(a) * r
      const py = y + Math.sin(a) * r
      if (i === 0) ctx.moveTo(px, py)
      else ctx.lineTo(px, py)
    }
    ctx.closePath()
    ctx.fill()
    ctx.stroke()
  }
  ctx.restore()
}

function drawCrystalNode(ctx, point, state) {
  const emphasized = point.priority >= 3 || point.id === state.nodeId || point.id === state.hoverId
  const hub = point.node.tier === 1
  const light = clamp((point.facing + 0.15) / 0.3, 0, 1)
  const alpha = (emphasized ? 1 : .66 + .34 * light) * point.dim
  const col = point.node?.color || '#8CB4FF'
  const r = point.glyphRadius ?? point.radius
  const x = point.x, y = point.y

  ctx.globalAlpha = alpha

  // 手动拖拽调大后展示极细校准外圈（方便视觉识别可拖拽边）
  if (emphasized) {
    ctx.strokeStyle = '#47D7E8'
    ctx.lineWidth = 0.95
    ctx.setLineDash([2.5, 3])
    ctx.beginPath()
    ctx.arc(x, y, point.radius, 0, TAU)
    ctx.stroke()
    ctx.setLineDash([])
  }

  if (hub) {
    const spike = r * (emphasized ? 2.65 : 2.05)
    ctx.strokeStyle = emphasized ? '#47D7E8' : col
    ctx.lineWidth = emphasized ? 0.95 : 0.72
    ctx.globalAlpha = alpha * (emphasized ? 0.88 : 0.52)
    ctx.beginPath()
    ctx.moveTo(x - spike, y); ctx.lineTo(x + spike, y)
    ctx.moveTo(x, y - spike); ctx.lineTo(x, y + spike)
    ctx.stroke()

    const outR = r * 1.24
    const waist = r * 0.36
    ctx.globalAlpha = alpha
    ctx.fillStyle = 'rgba(4, 9, 18, 0.90)'
    ctx.strokeStyle = emphasized ? '#47D7E8' : '#EAF3FF'
    ctx.lineWidth = emphasized ? 1.45 : 1.1
    ctx.beginPath()
    ctx.moveTo(x, y - outR)
    ctx.lineTo(x + waist, y - waist)
    ctx.lineTo(x + outR, y)
    ctx.lineTo(x + waist, y + waist)
    ctx.lineTo(x, y + outR)
    ctx.lineTo(x - waist, y + waist)
    ctx.lineTo(x - outR, y)
    ctx.lineTo(x - waist, y - waist)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    const inR = r * 0.62
    ctx.strokeStyle = emphasized ? '#EAF3FF' : col
    ctx.lineWidth = .85
    ctx.beginPath()
    ctx.moveTo(x, y - inR); ctx.lineTo(x + inR, y)
    ctx.lineTo(x, y + inR); ctx.lineTo(x - inR, y)
    ctx.closePath()
    ctx.stroke()

    const coreD = 1.9
    ctx.fillStyle = '#EAF3FF'
    ctx.beginPath()
    ctx.moveTo(x, y - coreD); ctx.lineTo(x + coreD, y)
    ctx.lineTo(x, y + coreD); ctx.lineTo(x - coreD, y)
    ctx.closePath()
    ctx.fill()
  } else {
    const ry = r * 1.14
    const rx = r * .84
    if (emphasized) {
      const lockR = ry * 1.55
      ctx.strokeStyle = '#47D7E8'
      ctx.lineWidth = .9
      ctx.globalAlpha = alpha * .82
      ctx.beginPath()
      ctx.moveTo(x, y - lockR); ctx.lineTo(x + lockR * .82, y)
      ctx.lineTo(x, y + lockR); ctx.lineTo(x - lockR * .82, y)
      ctx.closePath()
      ctx.stroke()
    }
    ctx.globalAlpha = alpha
    ctx.fillStyle = emphasized ? '#EAF3FF' : col
    ctx.beginPath()
    ctx.moveTo(x, y - ry); ctx.lineTo(x, y + ry); ctx.lineTo(x - rx, y)
    ctx.closePath()
    ctx.fill()

    ctx.fillStyle = emphasized ? '#47D7E8' : hexToRgba(col, .46)
    ctx.beginPath()
    ctx.moveTo(x, y - ry); ctx.lineTo(x + rx, y); ctx.lineTo(x, y + ry)
    ctx.closePath()
    ctx.fill()

    ctx.strokeStyle = emphasized ? '#FFFFFF' : '#EAF3FF'
    ctx.lineWidth = emphasized ? 1.15 : .8
    ctx.beginPath()
    ctx.moveTo(x, y - ry); ctx.lineTo(x + rx, y); ctx.lineTo(x, y + ry); ctx.lineTo(x - rx, y)
    ctx.closePath()
    ctx.stroke()
  }
}

function drawBridgeBadge(ctx, x, y, text, active) {
  ctx.save()
  ctx.font = '600 10px "JetBrains Mono", Consolas, monospace'
  const w = Math.max(18, textWidth(ctx, text) + 11)
  ctx.fillStyle = 'rgba(6, 11, 20, 0.90)'
  ctx.strokeStyle = active ? '#47D7E8' : 'rgba(71, 215, 232, 0.48)'
  ctx.lineWidth = active ? 1.2 : 0.85
  ctx.beginPath()
  ctx.roundRect?.(x - w / 2, y - 8, w, 16, 3)
  ctx.fill()
  ctx.stroke()
  textAt(ctx, x, y, text, active ? '#EAF3FF' : '#47D7E8')
  ctx.restore()
}

function findLabelBox6(point, boxW, boxH, width, height, occupied, obstacles = [], toward = null, allowFallback = false) {
  const margin = 10
  const maxW = Math.max(24, width - margin * 2)
  const maxH = Math.max(16, height - margin * 2)
  const w = Math.min(boxW, maxW)
  const h = Math.min(boxH, maxH)
  const halfW = w * .5, halfH = h * .5
  const r = point.radius || 0
  const refX = toward ? toward.x : width * .5
  const refY = toward ? toward.y : height * .51
  const preferRight = point.x >= refX - 4
  const preferDown = point.y >= refY
  const gap = 7
  const hOffset = r + gap + halfW
  const vOffset = r + gap + halfH

  const candidates = [
    { lx: point.x + (preferRight ? hOffset : -hOffset), ly: point.y },
    { lx: point.x + (preferRight ? -hOffset : hOffset), ly: point.y },
    { lx: point.x, ly: point.y + (preferDown ? vOffset : -vOffset) },
    { lx: point.x, ly: point.y + (preferDown ? -vOffset : vOffset) },
    { lx: point.x + (preferRight ? hOffset - 2 : -(hOffset - 2)), ly: point.y - Math.max(14, r * .45 + halfH) },
    { lx: point.x + (preferRight ? -(hOffset - 2) : hOffset - 2), ly: point.y + Math.max(14, r * .45 + halfH) }
  ]

  const hitAny = (box, other) =>
    box.x1 < other.x2 && box.x2 > other.x1 && box.y1 < other.y2 && box.y2 > other.y1

  for (const cand of candidates) {
    const x1 = cand.lx - halfW, x2 = cand.lx + halfW
    const y1 = cand.ly - halfH, y2 = cand.ly + halfH
    if (x1 < margin || x2 > width - margin || y1 < margin || y2 > height - margin) continue
    const box = { x: cand.lx, y: cand.ly, x1, x2, y1, y2 }
    if (occupied.some(other => hitAny(box, other)) || obstacles.some(other => hitAny(box, other))) continue
    occupied.push(box)
    return box
  }

  if (!allowFallback) return null
  const cand = candidates[0]
  const x = clamp(cand.lx, margin + halfW, width - margin - halfW)
  const y = clamp(cand.ly, margin + halfH, height - margin - halfH)
  const box = { x, y, x1: x - halfW, x2: x + halfW, y1: y - halfH, y2: y + halfH }
  occupied.push(box)
  return box
}

function drawTopologyLabels(ctx, width, height, work, bodies, bodyById, nodes, satellites, hits, state, satAlpha, overview, scene) {
  const occupied = []
  // Pre-seed HUD safe zones (top legend, bottom hint bar, bottom-right zoom toolbar + 10px padding).
  if (Array.isArray(state.hudBoxes) && state.hudBoxes.length) {
    for (const box of state.hudBoxes) occupied.push(box)
  } else {
    occupied.push(
      { x1: 0, y1: 0, x2: Math.min(width, 420), y2: 56 },
      { x1: 0, y1: Math.max(0, height - 46), x2: Math.min(width, 560), y2: height },
      { x1: Math.max(0, width - 220), y1: Math.max(0, height - 46), x2: width, y2: height }
    )
  }

  const centerLabelY = clamp(work.y + work.radius * 1.58, 24, height - 28)
  occupied.push({
    x1: work.x - Math.max(work.radius + 12, 74),
    y1: work.y - work.radius - 10,
    x2: work.x + Math.max(work.radius + 12, 74),
    y2: centerLabelY + 22
  })
  for (const hit of hits) {
    if (hit.kind !== 'bridge') continue
    occupied.push({ x1: hit.x - 13, x2: hit.x + 13, y1: hit.y - 9, y2: hit.y + 9 })
  }
  const domainBoxes = bodies.map(body => {
    const r = body.caliperRadius * (body.lens || 1) + 2
    return { id: body.planet.id, x1: body.pos.x - r, y1: body.pos.y - r,
      x2: body.pos.x + r, y2: body.pos.y + r }
  })
  const active = id => id === state.hoverId || id === state.nodeId || id === state.draggingNodeId
    || id === state.rimHoverId || id === state.resizingSetId || id === state.planetSettingsId
  const hoveredTargetId = state.draggingNodeId || state.hoverId
  const zoomLevel = scene.entryZoom ?? scene.zoom
  const zoomReveal2 = clamp((zoomLevel - 1.14) / .14, 0, 1)
  const zoomReveal3 = clamp((zoomLevel - 1.22) / .12, 0, 1)

  const drawNodeLabel = (node, allowFallback = false) => {
    const hi = active(node.id)
    const tier = node.node.tier ?? 3
    const core = tier === 1
    const zoomRev = tier <= 1 ? 1 : tier === 2 ? zoomReveal2 : zoomReveal3
    const visibility = hi ? 1 : (!overview && tier <= 2 ? 1 : Math.max(node.reveal, tier <= 1 ? 1 : zoomRev))
    if (visibility < .03) return
    ctx.font = `${hi || core ? 600 : 500} ${hi || core ? 11.2 : 10.2}px "PingFang SC", "Microsoft YaHei", sans-serif`
    const title = fitText(ctx, cleanAndTruncateTitle(node.node.title, 7), 96)
    const labelWidth = textWidth(ctx, title)
    const hostBody = bodyById.get(node.planetId)
    const toward = hostBody ? hostBody.pos : { x: work.x, y: work.y }
    const otherDomains = domainBoxes.filter(box => box.id !== node.planetId)
    const box = findLabelBox6(node, labelWidth + 10, 18, width, height, occupied, otherDomains, toward, allowFallback)
    if (!box) return
    ctx.globalAlpha = visibility * node.dim * (hi ? .96 : .84)
    ctx.strokeStyle = hi ? '#47D7E8' : node.node.color
    ctx.lineWidth = hi ? .95 : .72
    const attachX = clamp(node.x, box.x1 + 2, box.x2 - 2)
    const attachY = box.y + (core || hi ? 8.5 : 0)
    ctx.beginPath()
    const dx = attachX - node.x, dy = attachY - node.y
    const dist = Math.hypot(dx, dy) || 1
    const rStart = Math.min(dist * .75, (node.glyphRadius ?? node.radius) + 1)
    ctx.moveTo(node.x + dx * rStart / dist, node.y + dy * rStart / dist)
    ctx.lineTo(attachX, attachY)
    if (core || hi) {
      ctx.moveTo(box.x1 + 4, box.y + 8.5)
      ctx.lineTo(box.x2 - 4, box.y + 8.5)
    }
    ctx.stroke()
    ctx.globalAlpha = visibility * node.dim * (hi ? 1 : .92)
    ctx.fillStyle = hi ? '#FFFFFF' : (core ? '#EAF3FF' : '#d6e6fa')
    ctx.textAlign = 'center'
    outlinedText(ctx, title, box.x, box.y)
  }

  const drawSatLabel = (sat, allowFallback = false) => {
    const hi = sat.id === state.satelliteId || sat.id === state.hoverId
    const visibility = sat.labelAlpha ?? (hi ? 1 : 0)
    if (satAlpha <= 0 || visibility < .03) return
    const kind = sat.item.target?.kind
    const base = `${MODULE_BADGE[kind] || '关联'} · ${cleanAndTruncateTitle(sat.item.target?.title, 6)}`
    const label = sat.id === state.hoverId || sat.id === state.satelliteId ? `${base} · 双击跳转` : base
    ctx.font = '500 9.5px "PingFang SC", "Microsoft YaHei", sans-serif'
    const satObstacles = domainBoxes.filter(box => box.id !== sat.owner?.planetId)
    const box = findLabelBox6(sat, textWidth(ctx, label) + 10, 17, width, height, occupied, satObstacles, sat.owner, allowFallback)
    if (!box) return
    ctx.globalAlpha = visibility * satAlpha * sat.owner.dim * (hi ? 1 : .86)
    ctx.fillStyle = SATELLITE_COLORS[kind] || '#EAF3FF'
    ctx.textAlign = 'center'
    outlinedText(ctx, label, box.x, box.y)
  }

  ctx.save()
  ctx.textBaseline = 'middle'

  // 1. Priority #1: Active hovered / dragged entry or satellite draws first.
  const hoveredNode = hoveredTargetId && nodes.find(node => node.id === hoveredTargetId)
  const hoveredSat = !hoveredNode && hoveredTargetId && satellites.find(sat => sat.id === hoveredTargetId)
  if (hoveredNode) drawNodeLabel(hoveredNode, true)
  else if (hoveredSat) drawSatLabel(hoveredSat, true)

  // 2. Priority #2: Set domain architectural drafting titles (Scheme B 45° leader + baseline + WELL // ΔZ).
  const hitTest = (box, other) =>
    box.x1 < other.x2 && box.x2 > other.x1 && box.y1 < other.y2 && box.y2 > other.y1
  const bodyPriority = body => Number(active(body.planet.id)) * 1e6 + (body.planet.total ? 1e3 : 0) + body.planet.total
  for (const body of [...bodies].sort((a, b) => bodyPriority(b) - bodyPriority(a))) {
    const planet = body.planet
    if (planet.parent && !planet.entries.length) continue
    const hi = active(planet.id)
    const empty = !planet.total
    const showSub = !empty || hi
    const subtitle = showSub ? (empty ? 'WELL // EMPTY' : `WELL // ΔZ +${planet.elevationB.toFixed(2)}`) : ''
    const font = `600 ${empty && !hi ? 10.5 : 12}px "PingFang SC", "Microsoft YaHei", sans-serif`
    ctx.font = font
    const title = fitText(ctx, cleanAndTruncateTitle(planet.title, empty && !hi ? 7 : 9), 118)
    const titleWidth = textWidth(ctx, title)
    const count = `[${String(planet.total).padStart(2, '0')}]`
    const monoFont = '600 9.5px "JetBrains Mono", Consolas, monospace'
    ctx.font = monoFont
    const countWidth = textWidth(ctx, count)
    const subWidth = subtitle ? textWidth(ctx, subtitle) + 8 : 0
    const ruleW = Math.max(titleWidth + countWidth + 18, subWidth + 6)
    const point = { ...body.pos, radius: body.caliperRadius * (body.lens || 1) }
    const otherDomains = domainBoxes.filter(box => box.id !== planet.id)
    const isUpperNorth = point.y < work.y - 28 && Math.abs(point.x - work.x) < work.radius * 3.4
    const preferDirY = isUpperNorth || point.y < work.y - point.radius * 1.45 ? -1 : 1
    const diag = 11

    const makeSetCand = (dirY, shiftX = 0) => {
      const sx = point.x - ruleW * 0.28 + shiftX
      const sy = point.y + dirY * (point.radius + 3)
      const kx = sx + diag
      const ky = sy + dirY * diag
      const ex = kx + ruleW
      const box = {
        sx, sy, kx, ky, ex,
        x: (kx + ex) * 0.5,
        y: ky - 2,
        x1: Math.min(sx, kx) - 4,
        x2: ex + 6,
        y1: ky - 19,
        y2: ky + (showSub ? 15 : 8)
      }
      return box
    }
    const setCandidates = [
      makeSetCand(preferDirY, 0),
      makeSetCand(-preferDirY, 0),
      makeSetCand(preferDirY, -ruleW * 0.35),
      makeSetCand(preferDirY, ruleW * 0.35),
      makeSetCand(-preferDirY, -ruleW * 0.35),
      makeSetCand(-preferDirY, ruleW * 0.35)
    ]

    let chosenSet = null
    for (const cand of setCandidates) {
      if (cand.x1 < 10 || cand.x2 > width - 10 || cand.y1 < 10 || cand.y2 > height - 10) continue
      if (occupied.some(other => hitTest(cand, other)) || otherDomains.some(other => hitTest(cand, other))) continue
      chosenSet = cand
      break
    }
    if (!chosenSet && hi) {
      const fb = setCandidates[0]
      const dx = clamp(fb.x1, 10, Math.max(10, width - 10 - (fb.x2 - fb.x1))) - fb.x1
      const dy = clamp(fb.y1, 10, Math.max(10, height - 10 - (fb.y2 - fb.y1))) - fb.y1
      chosenSet = { ...fb, sx: fb.sx + dx, kx: fb.kx + dx, ex: fb.ex + dx, x: fb.x + dx,
        sy: fb.sy + dy, ky: fb.ky + dy, y: fb.y + dy,
        x1: fb.x1 + dx, x2: fb.x2 + dx, y1: fb.y1 + dy, y2: fb.y2 + dy }
    }
    if (!chosenSet) continue
    occupied.push(chosenSet)

    const { sx, sy, kx, ky, ex } = chosenSet
    const lineCol = hi ? '#47D7E8' : planet.color
    ctx.globalAlpha = body.dim * (hi ? 1 : empty ? .50 : .92)
    ctx.strokeStyle = lineCol
    ctx.lineWidth = hi ? 1.1 : empty ? .65 : .85
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(kx, ky)
    ctx.lineTo(ex, ky)
    ctx.stroke()

    ctx.beginPath()
    ctx.moveTo(ex, ky - 4)
    ctx.lineTo(ex, ky + 3)
    ctx.stroke()

    ctx.fillStyle = '#04070D'
    ctx.beginPath()
    ctx.moveTo(sx, sy - 2.5); ctx.lineTo(sx + 2.5, sy)
    ctx.lineTo(sx, sy + 2.5); ctx.lineTo(sx - 2.5, sy)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    const textY = ky - 8
    ctx.textAlign = 'left'
    ctx.font = font
    ctx.fillStyle = hi ? '#FFFFFF' : empty ? '#ADC2DB' : '#EAF3FF'
    outlinedText(ctx, title, kx + 2, textY)

    ctx.font = monoFont
    ctx.fillStyle = hi || !empty ? '#47D7E8' : '#7E97B8'
    ctx.textAlign = 'right'
    outlinedText(ctx, count, ex - 3, textY)

    if (subtitle) {
      ctx.font = '500 8.5px "JetBrains Mono", Consolas, monospace'
      ctx.fillStyle = hi ? 'rgba(138, 184, 224, 0.85)' : 'rgba(138, 168, 204, 0.62)'
      ctx.textAlign = 'left'
      outlinedText(ctx, subtitle, kx + 2, ky + 8)
    }
    hits.push({ kind: 'planet', id: planet.id, x: chosenSet.x, y: chosenSet.y, radius: 0,
      halfWidth: (chosenSet.x2 - chosenSet.x1) * .5, halfHeight: (chosenSet.y2 - chosenSet.y1) * .5 })
  }

  // 3. Priority #3..#5: Tier 1 > Tier 2 > Tier 3 entry labels (skip non-hovered on collision).
  const sortedNodes = nodes
    .filter(node => node !== hoveredNode)
    .filter(node => (node.node.tier ?? 3) <= 1 || zoomReveal2 >= .03 || node.reveal >= .03 || active(node.id))
    .sort((a, b) => Number(active(b.id)) - Number(active(a.id))
      || (a.node.tier ?? 3) - (b.node.tier ?? 3)
      || b.reveal - a.reveal
      || b.depthNorm - a.depthNorm)
  for (const node of sortedNodes) {
    drawNodeLabel(node, active(node.id))
  }

  // 4. Priority #6: Satellite labels (only when directly hovered, direct host hovered, or legend solo).
  if (satAlpha > 0) {
    for (const sat of satellites) {
      if (sat === hoveredSat) continue
      drawSatLabel(sat, sat.id === state.satelliteId)
    }
  }
  ctx.restore()
}


function strokePoints(ctx, points) {
  if (points.length < 2) return
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y)
  ctx.stroke()
}

function measureName(ctx, names, node, point) {
  const name = names.get(node.id) || {}
  const title = node.title?.trim() || '未命名节点'
  const { multiline } = point
  const text = multiline && node.summary
    ? node.summary.startsWith(title) ? node.summary : title + ' ' + node.summary
    : title
  const radius = Math.floor(point.radius * 2) / 2
  if (name.radius !== radius || name.text !== text || name.multiline !== multiline) {
    const fontSize = multiline ? clamp(Math.floor(radius * 0.52), 8, 12) : clamp(radius * 0.62, 8, 13)
    const font = `500 ${fontSize}px "Microsoft YaHei", sans-serif`
    const lineHeight = fontSize * 1.2
    ctx.font = font
    name.text = text
    name.radius = radius
    name.multiline = multiline
    name.lines = layoutEntryCircleText(value => textWidth(ctx, value),
      text === node.summary && node.glyphs ? node.glyphs : entryCircleGlyphs(text), radius, multiline, lineHeight, fontSize)
    name.font = font
    name.lineHeight = lineHeight
    names.set(node.id, name)
  }
  return name
}

function fitText(ctx, text, available) {
  const value = String(text || '未命名')
  if (textWidth(ctx, value) <= available) return value
  const chars = [...value]
  while (chars.length && textWidth(ctx, chars.join('') + '…') > available) chars.pop()
  return chars.length || textWidth(ctx, '…') <= available ? chars.join('') + '…' : ''
}

function textAt(ctx, x, y, text, color) {
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'center'
  outlinedText(ctx, text, x, y)
}
