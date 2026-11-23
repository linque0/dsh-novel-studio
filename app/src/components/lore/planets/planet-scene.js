/**
 * 关系星系 3D 场景与轨道物理数学库（零 DOM 依赖）：
 * 提供惯性相机步进（stepCamera）、分层星系拓扑（networkModel）、
 * 行星轨道排布与防碰撞（spacePlanets）、条目球面松弛分布（relaxSetEntries）及势阱深度计算。
 */
import { Euler, Quaternion, Vector3 } from 'three'

export const TUNING = Object.freeze({
  idleDelay: 1500, spinPeriod: 120000, orbitPeriod: 240000, transition: 300,
  dragThreshold: 5, cameraDistance: 11.6, detailRadius: 1.83, maxNodeRadius: 3.1,
  relation: '#96B6FF', bridge: '#5CE1F2', mesh: '#9BB8D8', ink: '#EAF3FF',
  workRadius: .92, workClearance: .54, orbitGap: .31,
  surfaceAngle: Math.PI / 3, surfaceTolerance: .045, samples: 24,
  surfaceWave: .04, spaceWave: .16, crossWave: .22,
  bodyScale: 1,
  satelliteReach: .66
})

export const clamp = (x, min, max) => Math.max(min, Math.min(x, max))
export const rotation = (x = 0, y = 0) => new Quaternion().setFromEuler(new Euler(x, y, 0, 'YXZ'))
export const cameraView = ({ yaw, pitch }) => new Quaternion().setFromEuler(new Euler(pitch, yaw, 0, 'XYZ'))
export const cameraPose = ({ yaw = -.28, pitch = .42, panX = 0, panY = 0, zoom = 1 } = {}) =>
  ({ yaw, pitch, panX, panY, zoom })
export const overviewView = () => cameraView(cameraPose())
export const GALAXY_CAMERA = Object.freeze({
  yawPerPixel: .0065, pitchPerPixel: .0055, pitchLimit: 1.15,
  follow: 65, release: 140, minZoom: .65, maxZoom: 6
})

export function stepCamera(pose, target, velocity, dt, immediate = false) {
  const { follow, release, pitchLimit } = GALAXY_CAMERA
  const followDecay = immediate ? 0 : Math.exp(-dt / follow)
  const releaseDecay = immediate ? 0 : Math.exp(-dt / release)
  let moving = false
  for (const key of ['yaw', 'pitch', 'panX', 'panY', 'zoom']) {
    const speed = immediate ? 0 : velocity[key] || 0
    const start = target[key]
    const end = start + speed * release * (1 - releaseDecay)
    target[key] = key === 'pitch' ? clamp(end, -pitchLimit, pitchLimit) : end
    if (key === 'yaw' || key === 'pitch') {
      velocity[key] = end === target[key] && Math.abs(speed * releaseDecay) > 1e-5 ? speed * releaseDecay : 0
    }
    // Integrate the exponentially decaying target and its follower over this frame.
    const change = end === target[key]
      ? speed * release * (1 - followDecay - release / (release - follow) * (releaseDecay - followDecay))
      : (target[key] - start) * (1 - followDecay)
    pose[key] = start + (pose[key] - start) * followDecay + change
    const tolerance = key === 'panX' || key === 'panY' ? .05 : .00005
    if (Math.abs(pose[key] - target[key]) < tolerance && !velocity[key]) pose[key] = target[key]
    moving ||= pose[key] !== target[key] || Boolean(velocity[key])
  }
  return moving
}
export const CENTER_ELEVATION = .18
const domainColors = ['#EAF3FF', '#5CE1F2', '#96B6FF', '#C4B5FD', '#7CD4E6']
const relaxedEntries = new WeakMap()
const golden = Math.PI * (3 - Math.sqrt(5))
const tau = 2 * Math.PI
export const ease = t => 1 - (1 - t) ** 3
export const PLANET_SIZE_MIN = 50
export const PLANET_SIZE_MAX = 200

export function planetSizeValue(value) {
  return Number.isFinite(value) ? clamp(Math.round(value), PLANET_SIZE_MIN, PLANET_SIZE_MAX) : 100
}

export function stablePhase(id) {
  let hash = 2166136261
  for (const char of String(id)) hash = Math.imul(hash ^ char.codePointAt(0), 16777619)
  return (hash >>> 0) / 4294967296 * tau
}

function entryDirections(count) {
  const ring = (size, point) => Array.from({ length: size }, (_, index) => {
    const angle = index * tau / size
    return point(Math.cos(angle), Math.sin(angle))
  })
  switch (count) {
    case 1: return [new Vector3(1, 0, 0)]
    case 2: return [new Vector3(1, 0, 0), new Vector3(-1, 0, 0)]
    case 3: return ring(3, (x, y) => new Vector3(x, y, 0))
    case 4: return [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]
      .map(([x, y, z]) => new Vector3(x, y, z).normalize())
    case 5:
    case 6:
    case 7: return [new Vector3(0, 1, 0), new Vector3(0, -1, 0),
      ...ring(count - 2, (x, z) => new Vector3(x, 0, z))]
    case 8: return [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1]
      .map(z => new Vector3(x, y, z).normalize())))
    default: return Array.from({ length: count }, (_, index) => {
      const y = 1 - 2 * (index + .5) / count
      const radius = Math.sqrt(1 - y * y)
      const angle = index * golden
      return new Vector3(radius * Math.cos(angle), y, radius * Math.sin(angle))
    })
  }
}

export function networkModel(sets, nodes, links, satellites = []) {
  const planets = sets.map(set => ({ ...set, entries: [], links: [], satellites: [] }))
  const bySet = new Map(planets.map(set => [set.id, set]))
  const byNode = new Map()
  for (const node of nodes) {
    const set = bySet.get(node.setId)
    if (!set || bySet.has(node.id) || byNode.has(node.id)) continue
    const item = { ...node, color: set.color, entries: [], links: [], satellites: [] }
    byNode.set(item.id, item)
  }
  const byBody = new Map([...bySet, ...byNode])
  for (const item of byNode.values()) {
    // Invalid, cross-set and cyclic parents fall back to the owning set.
    const visited = new Set([item.id])
    let ancestor = byNode.get(item.parentId)
    let valid = true
    while (ancestor) {
      if (ancestor.setId !== item.setId || visited.has(ancestor.id)) {
        valid = false
        break
      }
      visited.add(ancestor.id)
      ancestor = byNode.get(ancestor.parentId)
    }
    item.parent = valid && byNode.get(item.parentId) || bySet.get(item.setId)
    item.parent.entries.push(item)
  }
  function prepare(body) {
    body.total = body.entries.reduce((count, item) => count + 1 + prepare(item), 0)
    body.radius = planetRadius(body.total)
    const directions = entryDirections(body.entries.length)
    body.entries.forEach((item, index) => { item.position = directions[index] })
    body.weave = buildWeave(body.entries)
    return body.total
  }
  planets.forEach(prepare)
  const bySatellite = new Map()
  for (const link of satellites) {
    const owner = byBody.get(link.nodeId)
    if (!owner || !link.target?.id || !link.target.kind) continue
    const id = link.id ?? JSON.stringify([owner.id, link.target.kind, link.target.id])
    if (bySatellite.has(id)) continue
    const satellite = { ...link, id, owner }
    owner.satellites.push(satellite)
    bySatellite.set(id, satellite)
  }
  const seen = new Set()
  const relations = []
  for (const link of links) {
    const from = byBody.get(link.from)
    const to = byBody.get(link.to)
    if (!from || !to || from === to || seen.has(link.id)) continue
    seen.add(link.id)
    const phase = stablePhase(link.id)
    const relation = { ...link, from, to, phase, frequency: .65 + phase / tau * .85 }
    relations.push(relation)
    from.links.push(relation)
    to.links.push(relation)
  }

  let colorIndex = 0
  function styleBody(body, color) {
    body.color = color
    const weightOf = entry => entry.links.length * 3 + entry.satellites.length * 2 + entry.total
    const ranked = [...body.entries].sort((a, b) => weightOf(b) - weightOf(a))
    body.coreEntryId = ranked[0]?.id
    ranked.forEach((entry, index) => {
      entry.tier = index === 0 || (index === 1 && ranked.length >= 5 && weightOf(entry) >= 2)
        ? 1 : index < Math.ceil(ranked.length / 2) ? 2 : 3
      styleBody(entry, color)
    })
    body.triangles = constellationTriangles(body.entries, 7)
  }
  for (const planet of planets) styleBody(planet, planet.total ? domainColors[colorIndex++ % domainColors.length] : '#7E97B8')

  const systems = new Map()
  function system(id = '') {
    if (systems.has(id)) return systems.get(id)
    const center = byBody.get(id)
    const bodies = (center?.entries || planets).map(body => ({ ...body, bridges: [] }))
    const visible = new Map()
    if (center) visible.set(center.id, center)
    for (const body of bodies) {
      visible.set(body.id, body)
      for (const item of body.entries) visible.set(item.id, body)
    }
    const nearest = item => {
      for (let ancestor = item; ancestor; ancestor = ancestor.parent) {
        if (visible.has(ancestor.id)) return ancestor
      }
      return null
    }
    const bridges = new Map()
    const routes = new Map()
    for (const link of relations) {
      const from = nearest(link.from), to = nearest(link.to)
      if ((!from && !to) || from === to) continue
      const a = visible.get(from?.id), b = visible.get(to?.id)
      const cross = a !== b
      const bridgeId = cross && a && b ? JSON.stringify([a.id, b.id].sort()) : ''
      if (bridgeId) {
        if (!bridges.has(bridgeId)) {
          const bridge = { id: bridgeId, a, b, links: [] }
          bridges.set(bridgeId, bridge)
          if (a !== center) a.bridges.push(bridge)
          if (b !== center) b.bridges.push(bridge)
        }
        bridges.get(bridgeId).links.push(link)
      }
      const key = JSON.stringify([from?.id || '', to?.id || ''].sort())
      if (!routes.has(key)) routes.set(key, { ...link, from, to, cross, bridgeId, links: [] })
      routes.get(key).links.push(link)
    }
    for (const route of routes.values()) {
      if (route.bridgeId || !route.from || !route.to) continue
      if (route.links.length === 1 && route.from === route.links[0].from && route.to === route.links[0].to) continue
      route.bridgeId = JSON.stringify(['branch', route.from.id, route.to.id])
      bridges.set(route.bridgeId, { id: route.bridgeId, a: route.from, b: route.to, links: route.links, withinBody: true })
    }
    const rendered = new Map()
    if (center) rendered.set(center.id, center)
    for (const body of bodies) {
      rendered.set(body.id, body)
      for (const item of body.entries) rendered.set(item.id, item)
    }
    const rolledSatellites = new Map()
    const seenRolled = new Map()
    for (const sat of bySatellite.values()) {
      let cur = sat.owner
      let insideCenter = !center
      if (center) {
        let probe = cur
        while (probe) {
          if (probe.id === center.id) { insideCenter = true; break }
          probe = probe.parent
        }
      }
      if (!insideCenter) continue
      while (cur && !rendered.has(cur.id)) cur = cur.parent
      if (!cur) continue
      const anchor = rendered.get(cur.id)
      const dedupKey = `${anchor.id}::${sat.target.kind}:${sat.target.id}`
      if (seenRolled.has(dedupKey)) continue
      seenRolled.set(dedupKey, sat)
      if (!rolledSatellites.has(anchor.id)) rolledSatellites.set(anchor.id, [])
      rolledSatellites.get(anchor.id).push(sat)
    }
    const result = { center, planets: bodies, bridges: [...bridges.values()], routes: [...routes.values()], rolledSatellites }
    systems.set(id, result)
    return result
  }
  return { planets, byBody, bySet, byNode, bySatellite, system }
}

// Scale set radii proportionally around the central prism (matching Scheme B visual hierarchy).
export function planetRadius(entryCount) {
  if (entryCount <= 10) return [.27, .34, .40, .46, .50, .54, .58, .62, .66, .70, .74][Math.max(0, entryCount)]
  return Math.min(.82, .74 + Math.sqrt(entryCount - 10) * .02)
}

export function planetEnvelope(planet, positions = {}) {
  const reach = planet.entries.reduce((max, node) => {
    if (!node.satellites.length) return max
    const radius = Math.min(.85, localPosition(node, positions).length() / TUNING.detailRadius)
    // The satellite sub-orbit extends tangentially, with a .33R axis offset.
    return Math.max(max, Math.hypot(radius + .33, .44))
  }, 1)
  return planet.radius * TUNING.bodyScale * reach
}

function buildWeave(entries) {
  if (entries.length >= 5 && entries.length <= 7) {
    const [north, south, ...ring] = entries
    return ring.flatMap((entry, index) => [
      [north, entry], [south, entry], [entry, ring[(index + 1) % ring.length]]
    ])
  }
  const links = new Map()
  entries.forEach((node, index) => {
    const neighbors = entries.map((other, i) => ({ i, distance: node.position.distanceToSquared(other.position) }))
      .filter(({ i }) => i !== index).sort((a, b) => a.distance - b.distance).slice(0, 3)
    for (const { i } of neighbors) {
      const a = Math.min(index, i), b = Math.max(index, i)
      links.set(a + ':' + b, [entries[a], entries[b]])
    }
  })
  return [...links.values()]
}

export function spacingValue(value) {
  return Number.isFinite(value) ? clamp(value, 0, Number.MAX_SAFE_INTEGER) : 100
}

export function withOrbitSpacingReference(settings, spacing) {
  if (Number.isFinite(settings.spacingReference) || !Object.values(settings.radii || {}).some(Number.isFinite)) return settings
  return { ...settings, spacingReference: spacingValue(spacing) }
}

export function scaleOrbitRadius(radius, fromSpacing, toSpacing) {
  if (fromSpacing === toSpacing) return radius
  const factor = spacing => .55 + .45 * spacingValue(spacing) / 100
  const minimum = TUNING.workRadius + .34
  return minimum + (radius - minimum) * factor(toSpacing) / factor(fromSpacing)
}

export function spacePlanets(bodies, positions, spacing = 100, settings = {}, viewportAspect = 16 / 9) {
  const planets = bodies.map(body => ({ ...body, shellRadius: planetEnvelope(body, positions) }))
  const byId = new Map(planets.map(body => [body.id, body]))
  const reference = settings.spacingReference ?? spacing
  const gap = TUNING.orbitGap * spacingValue(reference) / 100
  const ranked = [...planets].sort(compareBodiesBySize)
  const hasManualOrbits = Boolean(
    settings.independent
    || Object.keys(settings.radii || {}).length
    || Object.keys(settings.joins || {}).length
    || settings.pin
  )
  if (ranked.every(body => !body.parent) && (!hasManualOrbits || settings.topology)) {
    return spaceOverview(planets, ranked, spacing, reference, settings, viewportAspect)
  }

  // Drill-down sub-systems (and legacy manual layouts) also order strictly by body size & count
  // and adaptively share concentric rings instead of forcing one track per body by creation time.
  const branches = ranked.filter(body => body.entries.length > 0)
  const leaves = ranked.filter(body => !body.entries.length)
  const leafEnvelope = planetRadius(0) * TUNING.bodyScale * (1 + TUNING.satelliteReach)
  const effectiveShell = body => (body.parent && !body.entries.length)
    ? Math.max(body.shellRadius, leafEnvelope * .78) : body.shellRadius

  const tracks = []
  const ringElevations = [.36, .28, .42, .24]
  let prevRadius = 0
  let prevMaxShell = 0

  const appendSubRings = (group, isLeafGroup) => {
    if (!group.length) return
    const startR = tracks.length
      ? Math.max(prevRadius + .68, prevRadius + (prevMaxShell + Math.max(...group.map(effectiveShell))) * .56 + gap + .24)
      : Math.max(TUNING.workRadius + TUNING.workClearance + Math.max(...group.map(effectiveShell)) + gap + .28, 2.25)
    const packed = packCoOrbitalRings(group, {
      startRadius: startR,
      pad: isLeafGroup ? .32 : .44,
      ringGapMin: isLeafGroup ? .64 : .74,
      ringGapPad: gap + .24,
      shellOf: effectiveShell,
      preferTwoRingsRange: !isLeafGroup && group.length >= 4 && group.length <= 6,
      maxPerRing: isLeafGroup ? 8 : 5
    })
    for (const ring of packed) {
      const elevation = ringElevations[tracks.length % ringElevations.length]
      tracks.push({ id: ring.lead.id, radius: ring.radius, envelope: ring.maxShell, elevation, band: ring.members })
      prevRadius = ring.radius
      prevMaxShell = ring.maxShell
    }
  }
  appendSubRings(branches, false)
  appendSubRings(leaves, true)

  const byTrack = new Map(tracks.map(track => [track.id, track]))
  const defaultTrackOf = new Map()
  for (const track of tracks) {
    for (const body of track.band) defaultTrackOf.set(body.id, track)
  }
  // Previous saves kept one anchor and derived neighbouring radii from it.
  const legacyRadii = !settings.independent && Object.keys(settings.radii || {}).length
    ? legacyOrbitRadii(tracks, settings.radii, settings.pin) : null
  const legacyByTrackId = legacyRadii ? new Map(tracks.map((track, idx) => [track.id, legacyRadii[idx]])) : null

  const groups = new Map()
  for (const planet of planets) {
    const defTrack = defaultTrackOf.get(planet.id)
    const targetBody = resolveTrackTarget(planet, defTrack?.id || planet.id, settings, byId)
    const targetTrack = byTrack.get(targetBody.id) || defaultTrackOf.get(targetBody.id) || defTrack
    const requested = settings.radii?.[targetBody.id]
    const baseRadius = legacyByTrackId?.get(targetTrack?.id) ?? (Number.isFinite(requested)
      ? Math.max(TUNING.workRadius + .34, requested) : (targetTrack?.radius ?? 2.35))
    const radius = scaleOrbitRadius(baseRadius, reference, spacing)
    const speed = settings.speeds?.[planet.id]
    planet.orbitId = targetBody.id
    planet.orbitAspect = 1
    planet.orbitAspectZ = 1
    planet.orbitRadius = radius
    planet.defaultOrbitRadius = scaleOrbitRadius(defTrack?.radius ?? baseRadius, reference, spacing)
    planet.orbitSpeed = tau / TUNING.orbitPeriod * (2.5 / radius) ** 1.25 * (speed?.orbit ?? 100) / 100
    planet.spinSpeed = tau / TUNING.spinPeriod * .75 / planet.radius * (speed?.spin ?? 100) / 100
    planet.spinPhase = stablePhase(planet.id)
    planet.elevationB = targetTrack?.elevation ?? .30
    const group = groups.get(planet.orbitId) || []
    group.push(planet)
    groups.set(planet.orbitId, group)
  }

  const placed = new Set()
  const bandPhases = new Map()
  for (const planet of ranked) {
    const savedPhase = settings.phases?.[planet.id]
    if (Number.isFinite(savedPhase)) {
      planet.orbitPhase = ((savedPhase % tau) + tau) % tau
      if (!bandPhases.has(planet.orbitId)) bandPhases.set(planet.orbitId, planet.orbitPhase)
      placed.add(planet)
      continue
    }
    const neighbors = planet.bridges.map(bridge => ({
      planet: byId.get(bridge.a.id === planet.id ? bridge.b.id : bridge.a.id), weight: bridge.links.length
    })).filter(item => placed.has(item.planet))
    let bestCost = Infinity
    const bandPhase = bandPhases.get(planet.orbitId)
    const slots = bandPhase === undefined ? 96 : Math.max(1, groups.get(planet.orbitId).length)
    const seed = bandPhase ?? (placed.size ? (2.55 + placed.size * golden) % tau : 2.55)
    for (let i = 0; i < slots; i++) {
      const phase = seed + i * tau / slots
      if ([...placed].some(p => p.orbitId === planet.orbitId && Math.abs(Math.atan2(Math.sin(p.orbitPhase - phase), Math.cos(p.orbitPhase - phase))) < .001)) continue
      const cost = neighbors.reduce((sum, n) => sum + (1 - Math.cos(phase - n.planet.orbitPhase)) * n.weight * 0.85, 0)
        + [...placed].reduce((sum, p) => {
          const cosine = Math.cos(phase - p.orbitPhase)
          const a = planet.orbitRadius, b = p.orbitRadius
          const separation = Math.sqrt(a * a + b * b - 2 * a * b * cosine)
          const clearance = planet.shellRadius + p.shellRadius + TUNING.orbitGap * 2.2
          const angularRepel = 1.05 / (0.24 + (1 - cosine))
          return sum + .65 * (1 + cosine) ** 4 + angularRepel + Math.max(0, clearance - separation) ** 2 * 10
        }, 0)
      if (cost >= bestCost) continue
      bestCost = cost
      planet.orbitPhase = phase
    }
    if (bandPhase === undefined) bandPhases.set(planet.orbitId, planet.orbitPhase)
    placed.add(planet)
  }
  return planets
}

function legacyOrbitRadii(tracks, manual, pin) {
  const clearance = .05
  const floor = []
  let edge = TUNING.workRadius + .34
  for (const track of tracks) {
    const radius = edge + track.envelope
    floor.push(radius)
    edge = radius + track.envelope + clearance
  }
  const gap = index => tracks[index - 1].envelope + tracks[index].envelope + clearance
  const radii = tracks.map((track, index) => {
    const value = manual?.[track.id]
    return Math.max(floor[index], Number.isFinite(value) ? value : track.radius)
  })
  const anchor = tracks.findIndex(track => track.id === pin)
  if (anchor < 0) {
    for (let index = 1; index < radii.length; index++) {
      radii[index] = Math.max(radii[index], radii[index - 1] + gap(index))
    }
    return radii
  }
  for (let index = anchor - 1; index >= 0; index--) {
    radii[index] = Math.max(floor[index], Math.min(radii[index], radii[index + 1] - gap(index + 1)))
  }
  for (let index = anchor + 1; index < radii.length; index++) {
    radii[index] = Math.max(radii[index], radii[index - 1] + gap(index))
  }
  return radii
}

function weight(planet) {
  return planet.bridges.reduce((sum, bridge) => sum + bridge.links.length, 0)
}

function compareBodiesBySize(a, b) {
  const aHas = (a.total || a.entries?.length || 0) > 0 ? 1 : 0
  const bHas = (b.total || b.entries?.length || 0) > 0 ? 1 : 0
  if (bHas !== aHas) return bHas - aHas
  const shellDiff = (b.shellRadius || b.radius || 0) - (a.shellRadius || a.radius || 0)
  if (Math.abs(shellDiff) > 1e-4) return shellDiff
  const totalDiff = (b.total || 0) - (a.total || 0)
  if (totalDiff) return totalDiff
  const entryDiff = (b.entries?.length || 0) - (a.entries?.length || 0)
  if (entryDiff) return entryDiff
  const linkDiff = (weight(b) + (b.links?.length || 0)) - (weight(a) + (a.links?.length || 0))
  if (linkDiff) return linkDiff
  return String(a.id).localeCompare(String(b.id))
}

function resolveTrackTarget(body, defaultOrbitId, settings, byId) {
  const joined = byId.get(settings.joins?.[body.id])
  if (joined) return joined
  if (Number.isFinite(settings.radii?.[body.id])) return body
  const ringLead = byId.get(defaultOrbitId)
  if (ringLead && ringLead !== body) {
    const leadJoined = byId.get(settings.joins?.[ringLead.id])
    if (leadJoined) return leadJoined
    return ringLead
  }
  return body
}

function packCoOrbitalRings(bodies, {
  startRadius = 2.98,
  pad = .58,
  ringGapMin = .78,
  ringGapPad = .32,
  ringShellFactor = .42,
  fillBudget = tau * .78,
  shellOf = body => body.shellRadius,
  preferTwoRingsRange = false,
  maxPerRing = 6
} = {}) {
  if (!bodies.length) return []
  const angularFootprint = (body, radius) => 2 * Math.asin(Math.min(.92, (shellOf(body) + pad) / Math.max(.8, radius)))
  const fitsRing = (members, radius) => {
    const sum = members.reduce((acc, body) => acc + angularFootprint(body, radius), 0)
    return sum <= fillBudget
  }
  const nextRingRadius = (prevR, prevShell, nextShell) =>
    Math.max(prevR + ringGapMin, prevR + (prevShell + nextShell) * ringShellFactor + ringGapPad)

  // Balanced 2-ring split for 4..6 active domains: larger core domains inside, smaller domains outside.
  if (preferTwoRingsRange && bodies.length >= 4 && bodies.length <= 6) {
    const innerCount = Math.floor(bodies.length / 2)
    const inner = bodies.slice(0, innerCount)
    const outer = bodies.slice(innerCount)
    const innerShell = Math.max(...inner.map(shellOf))
    const outerShell = Math.max(...outer.map(shellOf))
    const r0 = startRadius
    const r1 = nextRingRadius(r0, innerShell, outerShell)
    if (fitsRing(inner, r0) && fitsRing(outer, r1)) {
      return [
        { lead: inner[0], radius: r0, maxShell: innerShell, members: inner },
        { lead: outer[0], radius: r1, maxShell: outerShell, members: outer }
      ]
    }
  }

  const rings = []
  let cursor = 0
  let prevR = 0
  let prevShell = 0
  while (cursor < bodies.length) {
    const first = bodies[cursor]
    const firstShell = shellOf(first)
    const radius = rings.length ? nextRingRadius(prevR, prevShell, firstShell) : startRadius
    const cap = typeof maxPerRing === 'function' ? maxPerRing(rings.length) : maxPerRing
    const members = [first]
    let usedAngle = angularFootprint(first, radius)
    let maxShell = firstShell
    cursor++
    while (cursor < bodies.length && members.length < cap) {
      const candidate = bodies[cursor]
      const need = angularFootprint(candidate, radius)
      if (usedAngle + need > fillBudget) break
      members.push(candidate)
      usedAngle += need
      maxShell = Math.max(maxShell, shellOf(candidate))
      cursor++
    }
    rings.push({ lead: members[0], radius, maxShell, members })
    prevR = radius
    prevShell = maxShell
  }
  return rings
}

function cyclicOrderings(items) {
  if (items.length <= 2) return [items]
  if (items.length <= 4) {
    const [head, ...rest] = items
    const perms = []
    const walk = (prefix, left) => {
      if (!left.length) { perms.push([head, ...prefix]); return }
      for (let i = 0; i < left.length; i++) {
        walk([...prefix, left[i]], [...left.slice(0, i), ...left.slice(i + 1)])
      }
    }
    walk([], rest)
    return perms
  }
  const reversed = [items[0], ...items.slice(1).reverse()]
  return [items, reversed]
}

function spaceOverview(planets, ranked, spacing, reference, settings) {
  const occupied = ranked.filter(body => body.total > 0)
  const empty = ranked.filter(body => !body.total)
  // Saved circular tracks keep their geometry until the layout is reset.
  const manual = settings.independent || Object.keys(settings.radii || {}).length || Object.keys(settings.joins || {}).length
  const elliptical = !manual || settings.ellipse
  const aspectX = elliptical ? 1.06 : 1
  const aspectZ = elliptical ? .96 : 1
  const view = overviewView()

  const placement = placeOverviewSets(occupied, empty, view, aspectX, aspectZ)
  const defaultOrbitOf = new Map()
  const defaultElevationOf = new Map()
  for (const { body, orbitId, radius, phase, elevation } of placement) {
    defaultOrbitOf.set(body.id, orbitId)
    defaultElevationOf.set(body.id, elevation)
    body.orbitId = orbitId
    body.elevationB = elevation
    body.orbitAspect = aspectX
    body.orbitAspectZ = aspectZ
    body.orbitRadius = radius
    body.orbitPhase = phase
  }

  const byId = new Map(planets.map(body => [body.id, body]))
  const defaults = new Map(planets.map(body => [body.id, body.orbitRadius]))
  for (const body of planets) {
    const defaultOrbitId = defaultOrbitOf.get(body.id) || body.id
    const target = resolveTrackTarget(body, defaultOrbitId, settings, byId)
    const requested = settings.radii?.[target.id]
    const base = defaults.get(target.id)
    const defaultRadius = Math.max(TUNING.workRadius + .34, scaleOrbitRadius(base, 100, spacing))
    const radius = Number.isFinite(requested) ? scaleOrbitRadius(requested, reference, spacing) : defaultRadius
    const speed = settings.speeds?.[body.id]
    body.orbitId = target.id
    body.elevationB = defaultElevationOf.get(target.id) ?? body.elevationB
    body.orbitAspect = aspectX
    body.orbitAspectZ = aspectZ
    body.defaultOrbitRadius = defaultRadius
    body.orbitRadius = radius
    body.orbitPhase = settings.phases?.[body.id] ?? body.orbitPhase
    body.orbitSpeed = tau / TUNING.orbitPeriod * (2.5 / radius) ** 1.25 * (speed?.orbit ?? 100) / 100
    body.spinSpeed = tau / TUNING.spinPeriod * .75 / body.radius * (speed?.spin ?? 100) / 100
    body.spinPhase = stablePhase(body.id)
  }
  return planets
}

function placeOverviewSets(occupied, empty, view, aspectX, aspectZ) {
  const rings = []
  const occupiedElevations = [.42, .34, .46, .30]
  const emptyElevations = [.26, .32]

  if (occupied.length) {
    const maxLeadShell = Math.max(...occupied.slice(0, Math.min(3, occupied.length)).map(b => b.shellRadius))
    const occStartR = Math.max(2.98, .52 + maxLeadShell + 1.55)
    const occRings = packCoOrbitalRings(occupied, {
      startRadius: occStartR,
      pad: .58,
      ringGapMin: .78,
      ringGapPad: .32,
      ringShellFactor: .42,
      preferTwoRingsRange: true,
      maxPerRing: ringIdx => ringIdx === 0 ? 4 : 6
    })
    occRings.forEach((ring, idx) => {
      rings.push({
        ...ring,
        elevation: occupied.length <= 3 ? .38 : occupiedElevations[idx % occupiedElevations.length],
        isEmpty: false
      })
    })
  }

  if (empty.length) {
    const lastOcc = rings[rings.length - 1]
    const emptyShell = Math.max(...empty.map(b => b.shellRadius))
    const emptyStartR = lastOcc
      ? Math.max(lastOcc.radius + .78, lastOcc.radius + (lastOcc.maxShell + emptyShell) * .62 + .36)
      : 3.08
    const empRings = packCoOrbitalRings(empty, {
      startRadius: emptyStartR,
      pad: lastOcc ? .48 : .46,
      ringGapMin: .66,
      ringGapPad: .30,
      ringShellFactor: .42,
      maxPerRing: 8
    })
    empRings.forEach((ring, idx) => {
      rings.push({
        ...ring,
        elevation: lastOcc ? emptyElevations[idx % emptyElevations.length] : .30,
        isEmpty: true
      })
    })
  }

  const maxRadius = rings.length ? Math.max(...rings.map(r => r.radius)) : 4.2
  const distance = cameraDistance(Math.max(5.0, maxRadius + .6) * aspectX)
  const screenAt = (point, radius) => {
    const rotated = point.clone().applyQuaternion(view)
    const scale = distance / Math.max(2.2, distance - rotated.z)
    return { x: rotated.x * scale, y: rotated.y * scale, radius: radius * scale }
  }
  const center = screenAt(new Vector3(0, CENTER_ELEVATION, 0), .64)
  const linkWeightBetween = (a, b) => {
    let total = 0
    for (const bridge of a.bridges || []) {
      if (bridge.a.id === b.id || bridge.b.id === b.id) total += bridge.links.length
    }
    return total
  }

  const placedAll = []
  for (const [ringIdx, ring] of rings.entries()) {
    const members = ring.members
    const orderCandidates = cyclicOrderings(members)
    const screenGap = ring.isEmpty ? .54 : .68
    const worldGap = ring.isEmpty ? .72 : .78
    const centerGap = ring.isEmpty ? .58 : .68

    let ringItems
    if (ring.isEmpty && placedAll.length) {
      // On a shared outer empty ring, let each empty set claim the widest open angular window on the ring
      // while staying strictly co-orbital (same orbitId, radius, elevation and orbitSpeed).
      ringItems = []
      for (const [idx, body] of members.entries()) {
        const startAngle = -Math.PI * .5 + idx * golden * 1.7
        let bestItem = null
        for (let slot = 0; slot < 72; slot++) {
          const phase = ((startAngle + tau * slot / 72) % tau + tau) % tau
          const world = orbitPoint(ring.radius, phase, ring.elevation, aspectX, aspectZ)
          const screen = screenAt(world, Math.max(body.shellRadius, body.radius))
          let score = Math.max(0, center.radius + screen.radius + centerGap - Math.hypot(screen.x - center.x, screen.y - center.y)) * 36
          const spineDx = (screen.x - center.x) / .90
          score += .14 * Math.exp(-(spineDx * spineDx))
          for (const other of [...placedAll, ...ringItems]) {
            const wOverlap = Math.max(0, body.shellRadius + other.body.shellRadius + worldGap - Math.hypot(world.x - other.world.x, world.z - other.world.z))
            const sOverlap = Math.max(0, screen.radius + other.screen.radius + screenGap - Math.hypot(screen.x - other.screen.x, screen.y - other.screen.y))
            const dTheta = Math.atan2(Math.sin(phase - other.phase), Math.cos(phase - other.phase))
            const sameRing = other.orbitId === ring.lead.id
            const stagger = (sameRing ? .34 : .16) / (.14 + dTheta * dTheta)
            score += wOverlap * 42 + sOverlap * 34 + stagger
          }
          if (!bestItem || score < bestItem.score) {
            bestItem = { body, orbitId: ring.lead.id, radius: ring.radius, elevation: ring.elevation, phase, world, screen, score }
          }
        }
        ringItems.push(bestItem)
      }
    } else {
      let bestSolution = null
      for (const ordered of orderCandidates) {
        // Size-weighted angular sector allocation around the shared ring.
        const weights = ordered.map(b => Math.max(b.shellRadius, b.radius) + .45)
        const totalWeight = weights.reduce((s, w) => s + w, 0) || 1
        const relAngles = []
        let acc = 0
        for (let i = 0; i < ordered.length; i++) {
          relAngles.push((acc + weights[i] * .5) / totalWeight * tau)
          acc += weights[i]
        }
        const baseAngle = relAngles[0] || 0
        for (let i = 0; i < relAngles.length; i++) relAngles[i] -= baseAngle

        const seedOffset = -Math.PI * .78 + ringIdx * .58
        for (let slot = 0; slot < 72; slot++) {
          const offset = seedOffset + tau * slot / 72
          let score = 0
          const candidateItems = []
          for (let i = 0; i < ordered.length; i++) {
            const body = ordered[i]
            const phase = ((offset + relAngles[i]) % tau + tau) % tau
            const world = orbitPoint(ring.radius, phase, ring.elevation, aspectX, aspectZ)
            const screen = screenAt(world, Math.max(body.shellRadius, body.radius))
            candidateItems.push({ body, orbitId: ring.lead.id, radius: ring.radius, elevation: ring.elevation, phase, world, screen })

            const centerScreenOverlap = Math.max(0, center.radius + screen.radius + centerGap - Math.hypot(screen.x - center.x, screen.y - center.y))
            const centerWorldOverlap = Math.max(0, .52 + body.shellRadius + 1.40 - Math.hypot(world.x, world.z))
            // Gently discourage sitting directly on the vertical spine of the center prism & title.
            const spineDx = (screen.x - center.x) / .90
            const spinePenalty = (ring.isEmpty ? .16 : .38) * Math.exp(-(spineDx * spineDx))
            score += centerScreenOverlap * 34 + centerWorldOverlap * 34 + spinePenalty

            for (const other of placedAll) {
              const wOverlap = Math.max(0, body.shellRadius + other.body.shellRadius + worldGap - Math.hypot(world.x - other.world.x, world.z - other.world.z))
              const sOverlap = Math.max(0, screen.radius + other.screen.radius + screenGap - Math.hypot(screen.x - other.screen.x, screen.y - other.screen.y))
              const dTheta = Math.atan2(Math.sin(phase - other.phase), Math.cos(phase - other.phase))
              const stagger = .18 / (.12 + dTheta * dTheta)
              const affinity = linkWeightBetween(body, other.body) * .26 * (1 - Math.cos(dTheta))
              score += wOverlap * 38 + sOverlap * 32 + stagger + affinity
            }
          }
          // Check intra-ring clearance as well (handles extreme satellite envelopes).
          for (let i = 0; i < candidateItems.length; i++) {
            for (let j = i + 1; j < candidateItems.length; j++) {
              const a = candidateItems[i], b = candidateItems[j]
              const wOverlap = Math.max(0, a.body.shellRadius + b.body.shellRadius + worldGap - Math.hypot(a.world.x - b.world.x, a.world.z - b.world.z))
              const sOverlap = Math.max(0, a.screen.radius + b.screen.radius + screenGap - Math.hypot(a.screen.x - b.screen.x, a.screen.y - b.screen.y))
              score += wOverlap * 38 + sOverlap * 32
            }
          }
          if (!bestSolution || score < bestSolution.score) bestSolution = { score, items: candidateItems }
        }
      }
      ringItems = bestSolution.items
    }
    // Gentle phase-only polish along the shared ring (strictly preserves co-orbital radius).
    for (let step = 0; step < 24 && ringItems.length; step++) {
      let moved = false
      for (const a of ringItems) {
        let torque = 0
        const cDx = a.screen.x - center.x, cDy = a.screen.y - center.y
        const cDist = Math.hypot(cDx, cDy) || .01
        const cNeed = center.radius + a.screen.radius + centerGap
        if (cDist < cNeed) {
          const tangentX = -Math.sin(a.phase) * aspectX
          const dir = (cDx * tangentX >= 0 ? 1 : -1)
          torque += dir * (cNeed - cDist) * .10
        }
        const compareList = [...placedAll, ...ringItems]
        for (const b of compareList) {
          if (a === b) continue
          const wDist = Math.hypot(a.world.x - b.world.x, a.world.z - b.world.z)
          const wNeed = a.body.shellRadius + b.body.shellRadius + worldGap
          const sDist = Math.hypot(a.screen.x - b.screen.x, a.screen.y - b.screen.y)
          const sNeed = a.screen.radius + b.screen.radius + screenGap
          const deficit = Math.max(wNeed - wDist, sNeed - sDist)
          if (deficit <= 0) continue
          const dTheta = Math.atan2(Math.sin(a.phase - b.phase), Math.cos(a.phase - b.phase))
          torque += (dTheta >= 0 ? 1 : -1) * Math.min(.18, deficit * .14)
        }
        if (Math.abs(torque) > 1e-4) {
          a.phase = ((a.phase + clamp(torque, -.18, .18)) % tau + tau) % tau
          a.world = orbitPoint(ring.radius, a.phase, ring.elevation, aspectX, aspectZ)
          a.screen = screenAt(a.world, Math.max(a.body.shellRadius, a.body.radius))
          moved = true
        }
      }
      if (!moved) break
    }
    placedAll.push(...ringItems)
  }

  return placedAll
}

export function orbitPosition(planet, elapsed, phase = 0) {
  const angle = planet.orbitPhase + planet.orbitSpeed * elapsed + phase
  return orbitPoint(planet.orbitRadius, angle, planet.elevationB, planet.orbitAspect || 1, planet.orbitAspectZ || 1)
}

export function orbitPoint(radius, angle, elevation = 0, aspectX = 1, aspectZ = 1) {
  return new Vector3(Math.cos(angle) * radius * aspectX, elevation, Math.sin(angle) * radius * aspectZ)
}

export function localPosition(node, positions) {
  const saved = positions[node.parent?.id ?? node.setId]?.[node.id]
  return Array.isArray(saved) && saved.length === 3 && saved.every(Number.isFinite)
    ? new Vector3().fromArray(saved).clampLength(0, TUNING.maxNodeRadius)
    : node.position.clone().multiplyScalar(TUNING.detailRadius)
}

export function relaxSetEntries(planet, saved, scale) {
  const { entries } = planet
  const cached = relaxedEntries.get(entries)
  if (cached?.saved === saved && cached?.scale === scale) return cached.points

  // Solve the spiral in the default screen-facing plane, then return to the
  // same body-local coordinate system used by saved positions and dragging.
  const view = overviewView().multiply(rotation(.24, stablePhase(planet.id)))
  const inverse = view.clone().invert()
  const ranked = [...entries.keys()].sort((a, b) => entries[a].tier - entries[b].tier
    || entries[b].links.length - entries[a].links.length || a - b)
  const cores = ranked.filter(i => entries[i].tier === 1).length
  const anchors = []
  const points = []
  const fixed = []
  const minSep = Math.min(.29, 1.48 / Math.sqrt(entries.length)) * scale ** -.18
  for (const [rank, i] of ranked.entries()) {
    const node = entries[i]
    const fraction = (rank - cores + .5) / Math.max(1, entries.length - cores)
    const radius = rank < cores ? Math.min(.36, .22 + rank * .08) : Math.sqrt(.38 ** 2 + fraction * (.80 ** 2 - .38 ** 2))
    const angle = rank * golden
    const height = .14 * Math.sin(rank * 2.13)
    anchors[i] = new Vector3(radius * Math.cos(angle), radius * Math.sin(angle), height)
    fixed[i] = Array.isArray(saved?.[node.id])
    points[i] = fixed[i]
      ? localPosition(node, { [planet.id]: saved }).clampLength(0, TUNING.detailRadius * .80).applyQuaternion(view).divideScalar(TUNING.detailRadius)
      : anchors[i].clone()
  }

  // Dense spirals already separate nearby neighbours by construction. A grid
  // keeps relaxation linear in practice even for very large imported sets.
  for (let step = 0; step < 16 && points.length > 1; step++) {
    const grid = new Map()
    for (const [i, point] of points.entries()) {
      const key = Math.floor(point.x / minSep) * 4096 + Math.floor(point.y / minSep)
      if (!grid.has(key)) grid.set(key, [])
      grid.get(key).push(i)
    }
    for (const [i, point] of points.entries()) {
      if (fixed[i]) continue
      let fx = (anchors[i].x - point.x) * .16
      let fy = (anchors[i].y - point.y) * .16
      const col = Math.floor(point.x / minSep), row = Math.floor(point.y / minSep)
      for (let x = col - 1; x <= col + 1; x++) {
        for (let y = row - 1; y <= row + 1; y++) {
          for (const j of grid.get(x * 4096 + y) || []) {
            if (i === j) continue
            const dx = point.x - points[j].x, dy = point.y - points[j].y
            const distance = Math.hypot(dx, dy)
            if (distance < 1e-6 || distance >= minSep) continue
            const push = (minSep - distance) * .32 / distance
            fx += dx * push
            fy += dy * push
          }
        }
      }
      point.x += fx
      point.y += fy
      const radius = Math.hypot(point.x, point.y)
      if (!radius) continue
      const core = entries[i].tier === 1
      const factor = clamp(radius, core ? .22 : .36, core ? .40 : .80) / radius
      point.x *= factor
      point.y *= factor
    }
  }
  for (const point of points) point.clampLength(0, .80).applyQuaternion(inverse).multiplyScalar(TUNING.detailRadius)
  relaxedEntries.set(entries, { saved, scale, points })
  return points
}

function cameraDistance(extent) {
  // Deep systems are scaled into the same 9.2-unit frustum before fitting.
  return Math.max(TUNING.cameraDistance, extent * 1.75)
}

export function makeCamera(width, height, zoom, extent = 4, pose = {}, view = new Quaternion(), framingX = 0, framingY = 0) {
  const unit = Math.min(width * .84, height * .90) * .128 * zoom
  const distance = cameraDistance(extent)
  const scaleAt = z => unit * distance / Math.max(2.2, distance - z)
  const cx = width / 2 + (pose.panX || 0) + framingX
  const cy = height * .51 + (pose.panY || 0) + framingY
  const orientation = view.clone()
  const inverse = orientation.clone().invert()
  const project = point => {
    const scale = scaleAt(point.z)
    const normalizedDepth = point.z * TUNING.cameraDistance / distance
    return { x: cx + point.x * scale, y: cy - point.y * scale, z: point.z, scale,
      depthNorm: clamp((normalizedDepth + 4.2) / 8.4, 0, 1) }
  }
  const unproject = (x, y, z) => {
    const scale = scaleAt(z)
    return new Vector3((x - cx) / scale, (cy - y) / scale, z)
  }
  const projectWorld = point => project(point.clone().applyQuaternion(orientation))
  const axisX = new Vector3(1, 0, 0).applyQuaternion(orientation)
  const axisY = new Vector3(0, 1, 0).applyQuaternion(orientation)
  const axisZ = new Vector3(0, 0, 1).applyQuaternion(orientation)
  const projectWorldBuffer = (vertices, screen) => {
    for (let i = 0, j = 0; i < vertices.length; i += 3, j += 2) {
      const x = vertices[i], y = vertices[i + 1], z = vertices[i + 2]
      const scale = scaleAt(axisX.z * x + axisY.z * y + axisZ.z * z)
      screen[j] = cx + (axisX.x * x + axisY.x * y + axisZ.x * z) * scale
      screen[j + 1] = cy - (axisX.y * x + axisY.y * y + axisZ.y * z) * scale
    }
  }
  const unprojectWorld = (x, y, z) => unproject(x, y, z).applyQuaternion(inverse)
  const worldRay = (x, y, z) => {
    const origin = unprojectWorld(x, y, z)
    return { origin, direction: unprojectWorld(x, y, z - 1).sub(origin).normalize() }
  }
  return { project, unproject, projectWorld, projectWorldBuffer, unprojectWorld, worldRay,
    cx, cy, framingX, framingY, orientation, inverse, distance }
}

export const centeredPan = (camera, point, zoomRatio) => ({
  panX: (camera.cx - point.x - camera.framingX) * zoomRatio,
  panY: (camera.cy - point.y - camera.framingY) * zoomRatio
})

export function orbitDragPoint(camera, x, y, depth, elevation) {
  const { origin, direction } = camera.worldRay(x, y, depth)
  const incidence = Math.abs(direction.y)
  // Fade to the starting camera-depth plane as the orbit plane becomes edge-on.
  if (incidence <= .10) return origin
  return origin.addScaledVector(direction, (elevation - origin.y) / direction.y * clamp((incidence - .10) / .18, 0, 1))
}

export function overviewExtent(planets, positions = {}) {
  return Math.max(2.4, ...planets.map(p => p.orbitRadius * Math.max(p.orbitAspect || 1, p.orbitAspectZ || 1) + (p.shellRadius ?? planetEnvelope(p, positions)) + .36))
}

export function fitOverviewFrame(planets, positions, view, width, height, extent) {
  const camera = makeCamera(width, height, 1, extent)
  if (!planets.length) return { fit: 1, x: 0, y: 0 }
  const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity }
  const include = (x, y, rx, ry = rx) => {
    bounds.left = Math.min(bounds.left, x - rx)
    bounds.right = Math.max(bounds.right, x + rx)
    bounds.top = Math.min(bounds.top, y - ry)
    bounds.bottom = Math.max(bounds.bottom, y + ry)
  }
  const center = camera.project(new Vector3(0, CENTER_ELEVATION, 0).applyQuaternion(view))
  include(center.x - camera.cx, center.y - camera.cy, center.scale * .64, center.scale * .72)
  const wellCenter = camera.project(new Vector3(0, -1.62, 0).applyQuaternion(view))
  include(wellCenter.x - camera.cx, wellCenter.y - camera.cy, wellCenter.scale * .56, wellCenter.scale * .18)
  for (const planet of planets) {
    const envelope = Math.min(planet.shellRadius ?? planetEnvelope(planet, positions), Math.max(planet.radius * 1.12, .32))
    const screen = camera.project(orbitPosition(planet, 0).applyQuaternion(view))
    const rx = envelope * screen.scale + Math.max(screen.scale * .26, 14)
    const ry = envelope * screen.scale + Math.max(screen.scale * .20, 12)
    include(screen.x - camera.cx, screen.y - camera.cy, rx, ry)
  }
  const spanX = Math.max(1, bounds.right - bounds.left)
  const spanY = Math.max(1, bounds.bottom - bounds.top)
  const fit = clamp(Math.min((width * .85) / spanX, (height * .80) / spanY), .68, 1.85)
  return {
    fit,
    x: -(bounds.left + bounds.right) * fit * .5,
    y: -(bounds.top + bounds.bottom) * fit * .5 + 4
  }
}

export function orbitPlaneToWorld(u, v, depth = 0) {
  return new Vector3(u, -depth, v)
}

export function worldToOrbitUV(vec) {
  return { u: vec.x, v: vec.z }
}

export function gravityWellDepth(u, v, wells = []) {
  let dip = 1.36 * Math.exp(-(u * u + v * v) / (2 * .80 * .80))
  for (const w of wells) {
    const du = u - w.u, dv = v - w.v
    const d2 = du * du + dv * dv
    dip += w.depth * Math.exp(-d2 * w.inverseVariance)
  }
  return .82 + dip
}

export function constellationTriangles(entries, maxTriangles = 18) {
  if (!entries || entries.length < 3) return []
  const pool = entries.slice(0, 26)
  const seen = new Set(), out = []
  for (let i = 0; i < pool.length && out.length < maxTriangles; i++) {
    const a = pool[i]
    const nearest = pool
      .map((b, j) => ({ j, d: a.position.distanceToSquared(b.position) }))
      .filter(x => x.j !== i)
      .sort((x, y) => x.d - y.d)
      .slice(0, 3)
    for (let m = 0; m < nearest.length; m++) {
      for (let n = m + 1; n < nearest.length; n++) {
        const tri = [i, nearest[m].j, nearest[n].j].sort((x, y) => x - y)
        const key = tri.join(':')
        if (seen.has(key)) continue
        seen.add(key)
        out.push([pool[tri[0]], pool[tri[1]], pool[tri[2]]])
        if (out.length >= maxTriangles) break
      }
      if (out.length >= maxTriangles) break
    }
  }
  return out
}

