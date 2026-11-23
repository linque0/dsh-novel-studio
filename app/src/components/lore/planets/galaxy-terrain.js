/**
 * 关系星系引力势阱地形网格生成器（galaxyTerrain）：
 * 按引力井分布动态计算 3D 线框凹陷高度、16 级微渐变颜色桶及势阱等高线环，
 * 仅在各井位或视野发生实质变化时重算网格以维持帧率。
 */
import { clamp, gravityWellDepth } from './planet-scene.js'

const terrainByScope = new WeakMap()
const meshByHalfLines = new Map()
const CELL_SIZE = 11.6 / 22
const stride = 4
export const CONTOUR_POINTS = 45
const ringX = Array.from({ length: CONTOUR_POINTS }, (_, i) => Math.cos(2 * Math.PI * i / (CONTOUR_POINTS - 1)))
const ringZ = Array.from({ length: CONTOUR_POINTS }, (_, i) => Math.sin(2 * Math.PI * i / (CONTOUR_POINTS - 1)))

// 16 smooth micro-gradient buckets: 6 slate ridge levels -> 3 slate-to-cyan transition levels -> 7 cyan funnel levels.
// Eliminates discrete brightness/color popping as gravity wells glide continuously across grid segments.
export const MESH_STYLES = Object.freeze([
  { color: '#9BB8D8', width: .62, alpha: .024 },
  { color: '#9BB8D8', width: .65, alpha: .040 },
  { color: '#9BB8D8', width: .68, alpha: .056 },
  { color: '#9BB8D8', width: .71, alpha: .072 },
  { color: '#9BB8D8', width: .73, alpha: .088 },
  { color: '#9BB8D8', width: .75, alpha: .104 },
  { color: '#84C1DC', width: .77, alpha: .120 },
  { color: '#6ACCE3', width: .79, alpha: .136 },
  { color: '#54D3E6', width: .80, alpha: .152 },
  { color: '#47D7E8', width: .82, alpha: .172 },
  { color: '#47D7E8', width: .84, alpha: .194 },
  { color: '#47D7E8', width: .86, alpha: .218 },
  { color: '#47D7E8', width: .88, alpha: .242 },
  { color: '#47D7E8', width: .90, alpha: .266 },
  { color: '#47D7E8', width: .92, alpha: .290 },
  { color: '#47D7E8', width: .94, alpha: .314 }
])
const BUCKET_COUNT = MESH_STYLES.length

function terrainMesh(halfLines) {
  let mesh = meshByHalfLines.get(halfLines)
  if (mesh) return mesh
  const divisions = halfLines * 2 * stride
  const width = divisions + 1
  const gridToActive = new Int32Array(width * width).fill(-1)
  const normCoords = []
  const edgeList = []

  // Only allocate vertices that actually lie on drawn grid lines inside the circular horizon (~2.9x fewer vertices).
  for (let row = 0; row < width; row++) {
    const onRowLine = row % stride === 0
    const nz = row * 2 / divisions - 1
    for (let col = 0; col < width; col++) {
      if (!onRowLine && col % stride !== 0) continue
      const nx = col * 2 / divisions - 1
      const rNorm = Math.hypot(nx, nz)
      if (rNorm > 1.03) continue
      const activeIdx = edgeList.length
      gridToActive[row * width + col] = activeIdx
      normCoords.push(nx, nz)
      edgeList.push((1 - Math.min(1, rNorm ** 2.15)) ** 1.3)
    }
  }

  const segVerts = []
  const segFades = []
  for (let row = 0; row < width; row++) {
    for (let col = 0; col < width; col++) {
      const cur = gridToActive[row * width + col]
      if (cur < 0) continue
      if (row % stride === 0 && col > 0) {
        const left = gridToActive[row * width + col - 1]
        if (left >= 0) {
          const fade = (edgeList[left] + edgeList[cur]) * .5
          if (fade >= .015) { segVerts.push(left, cur); segFades.push(fade) }
        }
      }
      if (col % stride === 0 && row > 0) {
        const up = gridToActive[(row - 1) * width + col]
        if (up >= 0) {
          const fade = (edgeList[up] + edgeList[cur]) * .5
          if (fade >= .015) { segVerts.push(up, cur); segFades.push(fade) }
        }
      }
    }
  }

  mesh = {
    halfLines,
    divisions,
    activeCount: edgeList.length,
    normCoords: new Float32Array(normCoords),
    segments: new Uint32Array(segVerts),
    segFades: new Float32Array(segFades)
  }
  meshByHalfLines.set(halfLines, mesh)
  return mesh
}

function terrainDirty(field, actualExtent, halfLines, wells) {
  if (actualExtent !== field.extent || halfLines !== field.halfLines || wells.length !== field.wells.size) return true
  for (let i = 0; i < wells.length; i++) {
    const well = wells[i]
    const old = field.wells.get(well.id)
    if (!old || old.radius !== well.radius || old.depth !== well.depth || old.inverseVariance !== well.inverseVariance) return true
    const du = well.u - old.u
    const dv = well.v - old.v
    // Update smoothly on every animated frame whenever any well shifts (no coarse stepping/teleporting).
    if (du * du + dv * dv > 1e-10) return true
  }
  return false
}

export function galaxyTerrain(scope, extent, wells, time, editing = false) {
  const halfLines = clamp(Math.round(extent / CELL_SIZE), 11, 20)
  const actualExtent = halfLines * CELL_SIZE
  const mesh = terrainMesh(halfLines)
  const { divisions, activeCount, normCoords, segments, segFades } = mesh
  let field = terrainByScope.get(scope)
  if (!field || field.halfLines !== halfLines) {
    field = {
      halfLines, divisions, activeCount, extent: 0, time: 0,
      wells: new Map(), wellList: [], offsets: new Map(),
      baseY: new Float32Array(activeCount),
      vertices: new Float32Array(activeCount * 3),
      screen: new Float32Array(activeCount * 2),
      buckets: Array.from({ length: BUCKET_COUNT }, () => new Uint32Array(segments.length)),
      counts: new Uint32Array(BUCKET_COUNT),
      contours: new Float32Array(0),
      contourScreen: new Float32Array(0),
      revision: 0
    }
    terrainByScope.set(scope, field)
  }

  field.wellList = wells
  if (!editing && !terrainDirty(field, actualExtent, halfLines, wells)) return field

  const extentChanged = actualExtent !== field.extent
  field.extent = actualExtent
  field.time = time
  field.revision++
  field.wells.clear()
  for (let i = 0; i < wells.length; i++) {
    const w = wells[i]
    field.wells.set(w.id, { u: w.u, v: w.v, radius: w.radius, depth: w.depth, inverseVariance: w.inverseVariance })
  }

  const vertices = field.vertices
  const baseY = field.baseY
  if (extentChanged) {
    const invCenterVar = 1 / (2 * .80 * .80)
    for (let v = 0; v < activeCount; v++) {
      const x = normCoords[v * 2] * actualExtent
      const z = normCoords[v * 2 + 1] * actualExtent
      vertices[v * 3] = x
      vertices[v * 3 + 2] = z
      baseY[v] = .82 + 1.36 * Math.exp(-(x * x + z * z) * invCenterVar)
    }
  }

  const wellCount = wells.length
  for (let v = 0; v < activeCount; v++) {
    const vx = vertices[v * 3]
    const vz = vertices[v * 3 + 2]
    let y = baseY[v]
    for (let w = 0; w < wellCount; w++) {
      const well = wells[w]
      const du = vx - well.u
      const dv = vz - well.v
      const arg = (du * du + dv * dv) * well.inverseVariance
      if (arg < 9) y += well.depth * Math.exp(-arg)
    }
    vertices[v * 3 + 1] = -y
  }

  const counts = field.counts
  const buckets = field.buckets
  counts.fill(0)
  const segCount = segFades.length
  for (let s = 0; s < segCount; s++) {
    const a = segments[s * 2]
    const b = segments[s * 2 + 1]
    const fade = segFades[s]
    const well = clamp((-(vertices[a * 3 + 1] + vertices[b * 3 + 1]) * .5 - .82) / 1.36, 0, 1)
    let bucket
    if (well > .14 && fade > .16) {
      if (well < .26) {
        // Smooth 3-step slate -> cyan color & alpha transition zone.
        const t = (well - .14) / .12
        bucket = t < .34 ? 6 : t < .67 ? 7 : 8
      } else {
        // 7 smooth cyan funnel intensity steps.
        const wIntensity = well * fade
        bucket = clamp(9 + Math.floor((wIntensity - .14) / .082), 9, 15)
      }
    } else {
      const score = (.068 + .165 * well) * fade
      bucket = clamp(Math.floor((score - .015) / .0135), 0, 5)
    }
    const idx = counts[bucket]
    buckets[bucket][idx] = a * 2
    buckets[bucket][idx + 1] = b * 2
    counts[bucket] = idx + 2
  }

  const count = 2 * (wellCount + 1) * CONTOUR_POINTS
  if (count * 3 !== field.contours.length) {
    field.contours = new Float32Array(count * 3)
    field.contourScreen = new Float32Array(count * 2)
  }
  field.offsets.clear()
  let vertex = 0
  const contours = field.contours
  function ring(u, v, radius) {
    for (let i = 0; i < CONTOUR_POINTS; i++, vertex++) {
      const x = u + ringX[i] * radius
      const z = v + ringZ[i] * radius
      contours[vertex * 3] = x
      contours[vertex * 3 + 1] = -gravityWellDepth(x, z, wells)
      contours[vertex * 3 + 2] = z
    }
  }
  ring(0, 0, .52)
  ring(0, 0, 1.00)
  for (let w = 0; w < wellCount; w++) {
    const well = wells[w]
    field.offsets.set(well.id, vertex * 2)
    ring(well.u, well.v, well.radius * .56)
    ring(well.u, well.v, well.radius * 1.02)
  }
  return field
}

export function terrainDepth(field, x, z) {
  return gravityWellDepth(x, z, field?.wellList || [])
}
