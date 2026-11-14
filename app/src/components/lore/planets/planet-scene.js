import { Euler, Quaternion, Vector3 } from 'three'

export const TUNING = Object.freeze({
  idleDelay: 1500, spinPeriod: 120000, orbitPeriod: 240000, transition: 300,
  dragThreshold: 5, cameraDistance: 9, detailRadius: 1.83, maxNodeRadius: 3.1,
  relation: '#a4cfc0', bridge: '#d0a384', mesh: '#b9a9c8', ink: '#f4eaf1',
  workRadius: .92, workClearance: .54, orbitGap: .31, orbitInclination: .53,
  surfaceAngle: Math.PI / 3, surfaceTolerance: .045, samples: 24,
  surfaceWave: .04, spaceWave: .16, crossWave: .22,
  overviewCircle: [3, 18], detailCircle: [4, 26], maxLabels: 28, bodyScale: 1.9,
  satelliteReach: .66
})

export const clamp = (x, min, max) => Math.max(min, Math.min(x, max))
export const rotation = (x = 0, y = 0) => new Quaternion().setFromEuler(new Euler(x, y, 0, 'YXZ'))
const golden = Math.PI * (3 - Math.sqrt(5))
const tau = 2 * Math.PI
export const ease = t => 1 - (1 - t) ** 3

export function stablePhase(id) {
  let hash = 2166136261
  for (const char of String(id)) hash = Math.imul(hash ^ char.codePointAt(0), 16777619)
  return (hash >>> 0) / 4294967296 * tau
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
    body.entries.forEach((item, index) => {
      const y = 1 - 2 * (index + .5) / body.entries.length
      const r = Math.sqrt(1 - y * y)
      const angle = index * golden
      const ripple = 1 + .09 * Math.sin(angle * 2.1 + y * 4) + .055 * Math.cos(angle * .7 - y * 8)
      item.position = new Vector3(r * Math.cos(angle), y, r * Math.sin(angle)).multiplyScalar(ripple)
    })
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
    const result = { center, planets: bodies, bridges: [...bridges.values()], routes: [...routes.values()] }
    systems.set(id, result)
    return result
  }
  return { planets, byBody, bySet, byNode, bySatellite, system }
}

// A denser set earns more surface area. Logarithmic growth keeps very large
// sets in proportion without making equal-sized planets out of them.
export function planetRadius(entryCount) {
  return .32 + .138 * Math.log1p(Math.max(0, entryCount))
}

export function planetEnvelope(planet, positions = {}) {
  const reach = planet.entries.reduce((max, node) => {
    const radius = localPosition(node, positions).length() / TUNING.detailRadius
    return Math.max(max, radius + (node.satellites.length ? TUNING.satelliteReach : 0))
  }, planet.satellites?.length ? 1 + TUNING.satelliteReach : 1)
  return planet.radius * TUNING.bodyScale * reach
}

function buildWeave(entries) {
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

export function spacePlanets(bodies, positions, spacing = 100, settings = {}) {
  const planets = bodies.map(body => ({ ...body, shellRadius: planetEnvelope(body, positions) }))
  const byId = new Map(planets.map(body => [body.id, body]))
  const surfaceDensity = Math.max(0, ...planets.map(body =>
    body.entries.length / Math.max(.5, (body.radius * TUNING.bodyScale) ** 2)))
  const pressure = Math.max(planets.length / 16, surfaceDensity / 8)
  const gap = TUNING.orbitGap * clamp(.63 + pressure * .55, .72, 1.65) * spacingValue(spacing) / 100
  const creationTime = set => {
    if (set.createdAt == null || set.createdAt === '') return Infinity
    const time = typeof set.createdAt === 'number' ? set.createdAt : Date.parse(set.createdAt)
    return Number.isFinite(time) ? time : Infinity
  }
  const chronological = [...planets].sort((a, b) => creationTime(a) - creationTime(b) || String(a.id).localeCompare(String(b.id)))
  let edge = TUNING.workRadius + Math.max(.34, TUNING.workClearance * gap / TUNING.orbitGap)
  const terminal = body => body.parent && !body.entries.length
  const tracks = []
  for (let index = 0; index < chronological.length;) {
    const first = chronological[index]
    // A run of terminal entries can safely share a band. Reserve angular
    // slots for them so a long sibling list doesn't push every body outward.
    const leaf = terminal(first)
    const envelope = leaf ? planetRadius(0) * TUNING.bodyScale * (1 + TUNING.satelliteReach) : first.shellRadius
    const radius = edge + envelope + gap
    // Six terminal entries fit even on the innermost compact band.
    // Keep band membership stable when spacing changes.
    const capacity = leaf ? 6 : 1
    const band = []
    do {
      band.push(chronological[index++])
    } while (band.length < capacity && index < chronological.length && terminal(chronological[index]))
    tracks.push({ id: first.id, radius, envelope, band })
    edge = radius + envelope
  }
  const byTrack = new Map(tracks.map(track => [track.id, track]))
  // Previous saves kept one anchor and derived neighbouring radii from it.
  const legacyRadii = !settings.independent && Object.keys(settings.radii || {}).length
    ? legacyOrbitRadii(tracks, settings.radii, settings.pin) : null
  const groups = new Map()
  for (const [index, track] of tracks.entries()) {
    const target = byTrack.get(settings.joins?.[track.id]) || track
    const group = groups.get(target.id) || []
    group.push(...track.band)
    groups.set(target.id, group)
    const requested = settings.radii?.[target.id]
    const radius = legacyRadii?.[index] ?? (Number.isFinite(requested)
      ? Math.max(TUNING.workRadius + .34, requested) : target.radius)
    for (const planet of track.band) {
      const speed = settings.speeds?.[planet.id]
      planet.orbitId = target.id
      planet.orbitRadius = radius
      planet.defaultOrbitRadius = target.radius
      planet.orbitSpeed = tau / TUNING.orbitPeriod * (2.5 / radius) ** 1.25 * (speed?.orbit ?? 100) / 100
      planet.spinSpeed = tau / TUNING.spinPeriod * .75 / planet.radius * (speed?.spin ?? 100) / 100
      planet.spinPhase = stablePhase(planet.id)
    }
  }
  const placed = new Set()
  const bandPhases = new Map()
  for (const planet of [...chronological].sort((a, b) => weight(b) - weight(a))) {
    const neighbors = planet.bridges.map(bridge => ({
      planet: byId.get(bridge.a.id === planet.id ? bridge.b.id : bridge.a.id), weight: bridge.links.length
    })).filter(item => placed.has(item.planet))
    let bestCost = Infinity
    const bandPhase = bandPhases.get(planet.orbitId)
    const slots = bandPhase === undefined ? 72 : groups.get(planet.orbitId).length
    const seed = bandPhase ?? (placed.size ? stablePhase(planet.id) : 2.8)
    for (let i = 0; i < slots; i++) {
      const phase = seed + i * tau / slots
      if ([...placed].some(p => p.orbitId === planet.orbitId && Math.abs(p.orbitPhase - phase) < .001)) continue
      const cost = neighbors.reduce((sum, n) => sum + (1 - Math.cos(phase - n.planet.orbitPhase)) * n.weight, 0)
        + [...placed].reduce((sum, p) => {
          const cosine = Math.cos(phase - p.orbitPhase)
          const a = planet.orbitRadius, b = p.orbitRadius
          const separation = Math.sqrt(a * a + b * b - 2 * a * b * cosine)
          const clearance = planet.shellRadius + p.shellRadius + gap * 2
          return sum + .65 * (1 + cosine) ** 4 + Math.max(0, clearance - separation) ** 2 * 8
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

export function orbitPosition(planet, elapsed, phase = 0) {
  const angle = planet.orbitPhase + planet.orbitSpeed * elapsed + phase
  return orbitPoint(planet.orbitRadius, angle)
}

export function orbitPoint(radius, angle) {
  const vertical = Math.sin(angle) * radius
  return new Vector3(Math.cos(angle) * radius, vertical * Math.cos(TUNING.orbitInclination),
    vertical * Math.sin(TUNING.orbitInclination))
}

export function localPosition(node, positions) {
  const saved = positions[node.parent?.id ?? node.setId]?.[node.id]
  return Array.isArray(saved) && saved.length === 3 && saved.every(Number.isFinite)
    ? new Vector3().fromArray(saved).clampLength(0, TUNING.maxNodeRadius)
    : node.position.clone().multiplyScalar(TUNING.detailRadius)
}

export function makeCamera(width, height, zoom, extent = 4, horizontalStretch = 1, focus, offset) {
  const unit = Math.min(width * .45 / horizontalStretch, height * .46) / extent * zoom
  const distance = Math.max(TUNING.cameraDistance, extent * 2.15)
  const focusScale = focus ? unit * distance / (distance - focus.z) : 0
  const cx = width / 2 + ((offset?.x || 0) * unit - (focus?.x || 0) * focusScale) * horizontalStretch
  const cy = height / 2 - ((offset?.y || 0) * unit - (focus?.y || 0) * focusScale)
  const project = point => {
    const scale = unit * distance / (distance - point.z)
    return { x: cx + point.x * scale * horizontalStretch, y: cy - point.y * scale, z: point.z, scale }
  }
  const unproject = (x, y, z) => {
    const scale = unit * distance / (distance - z)
    return new Vector3((x - cx) / (scale * horizontalStretch), (cy - y) / scale, z)
  }
  return { project, unproject }
}

export function overviewExtent(planets, positions = {}) {
  return Math.max(2.4, ...planets.map(p => p.orbitRadius + planetEnvelope(p, positions) + .36))
}

export function fitOverviewZoom(planets, positions, view, width, height, extent, stretch) {
  const camera = makeCamera(width, height, 1, extent, stretch)
  let horizontal = 0, vertical = 0
  for (const planet of planets) {
    const envelope = planetEnvelope(planet, positions)
    for (let i = 0; i < 24; i++) {
      const angle = i / 24 * tau
      const y = Math.sin(angle) * planet.orbitRadius
      const point = new Vector3(Math.cos(angle) * planet.orbitRadius,
        y * Math.cos(TUNING.orbitInclination), y * Math.sin(TUNING.orbitInclination)).applyQuaternion(view)
      // Fit the whole orbit and its envelope so idle motion cannot pump the zoom.
      point.z += envelope
      const screen = camera.project(point)
      horizontal = Math.max(horizontal, Math.abs(screen.x - width / 2) + envelope * screen.scale * stretch)
      vertical = Math.max(vertical, Math.abs(screen.y - height / 2) + envelope * screen.scale)
    }
  }
  return clamp(Math.min((width / 2 - 36) / (horizontal || 1), (height / 2 - 36) / (vertical || 1)), .78, 1.32)
}

