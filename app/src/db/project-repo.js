import { db, uid } from './database.js'
import { SOURCE_TABLES, projectBook, sourceManifest, PROJECTION_VERSION } from '../services/project/normalize.js'
import { projectGraph } from '../services/project/graph.js'
import { checkAbort, sourceChanged, rowHash } from '../services/project/text.js'

let epoch = 0, paused = false
const pending = new Map()
export function suspendProjection() { paused = true; epoch++; pending.clear() }
export function resumeProjection() { paused = false; epoch++ }
async function bundleInTransaction(workId) {
  const work = await db.works.get(workId), bundle = { work }
  for (const table of SOURCE_TABLES.filter((t) => !['works','links'].includes(t))) {
    const rows = await db.table(table).where('workId').equals(workId).toArray()
    bundle[table] = table === 'assets' ? rows.map(({blob, ...r}) => r) : rows
  }
  const ids = new Set([workId, ...Object.values(bundle).filter(Array.isArray).flat().map((r) => r.id)])
  bundle.links = (await db.links.toArray()).filter((r) => ids.has(r.entityId))
  return bundle
}
export const readSourceSnapshot = (workId) => db.transaction('r', SOURCE_TABLES.map((t) => db.table(t)), () => bundleInTransaction(workId))
export async function markProjectionDirty(workId) {
  if (!workId || paused) return
  await db.transaction('rw', db.aiindex, async () => {
    const row = await db.aiindex.get(workId)
    await db.aiindex.put({ ...row, workId, status: 'dirty', dirtyRevision: (row?.dirtyRevision || 0) + 1, updatedAt: Date.now() })
  })
}
export async function readProjection(workId) {
  return db.transaction('r', [db.aiindex, db.aidoc, db.aichunk, db.aientity, db.aiedge], async () => {
    const index = await db.aiindex.get(workId)
    if (!index?.generation) return null
    const key = [workId,index.generation]
    const docs = await db.aidoc.where('[workId+generation]').equals(key).toArray()
    const chunks = await db.aichunk.where('[workId+generation]').equals(key).toArray()
    const entities = await db.aientity.where('[workId+generation]').equals(key).toArray()
    const edges = await db.aiedge.where('[workId+generation]').equals(key).toArray()
    return { index, docs: docs.sort((a,b) => a.orderKey.localeCompare(b.orderKey)), chunks, entities, edges }
  })
}
export async function ensureProjection(workId, { force = false, signal } = {}) {
  if (paused) throw sourceChanged()
  if (pending.has(workId)) return pending.get(workId)
  const run = rebuild(workId, { force, signal, epochAtStart:epoch })
  pending.set(workId, run)
  try { return await run } finally { if (pending.get(workId) === run) pending.delete(workId) }
}
async function rebuild(workId, options) {
  const id='projection:'+workId, owner=uid()
  const leased=await db.transaction('rw',db.airuns,async()=>{
    const row=await db.airuns.get(id)
    if(row?.owner&&row.leaseUntil>Date.now())return false
    await db.airuns.put({id,workId,type:'projection',owner,leaseUntil:Date.now()+120000,status:'running'})
    return true
  })
  if(!leased)throw sourceChanged()
  const heartbeat=setInterval(()=>db.transaction('rw',db.airuns,async()=>{
    const row=await db.airuns.get(id)
    if(row?.owner===owner)await db.airuns.update(id,{leaseUntil:Date.now()+120000})
  }).catch(()=>{}),20000)
  try{return await buildProjection(workId,{...options,leaseId:id,leaseOwner:owner})}finally{
    clearInterval(heartbeat)
    await db.transaction('rw',db.airuns,async()=>{const row=await db.airuns.get(id);if(row?.owner===owner)await db.airuns.update(id,{owner:null,leaseUntil:0,status:'completed'})})
  }
}
async function buildProjection(workId, { force, signal, epochAtStart, leaseId, leaseOwner }) {
  const startedEpoch = epochAtStart, bundle = await readSourceSnapshot(workId), manifest = sourceManifest(bundle)
  checkAbort(signal)
  if(paused || epoch!==startedEpoch)throw sourceChanged()
  if (!bundle.work || bundle.work.deletedAt) {
    await clearProjection(workId)
    return { index: { workId, status: 'deleted', counts: {} }, docs: [], chunks: [], entities: [], edges: [] }
  }
  const old = await readProjection(workId)
  const decisions = await db.aidecisions.where('workId').equals(workId).toArray()
  const decisionsHash = rowHash({ decisions })
  if (!force && old?.index.sourceRevision === manifest.hash && old.index.projectionVersion === PROJECTION_VERSION && old.index.decisionsHash === decisionsHash) {
    await db.transaction('rw',[...SOURCE_TABLES.map((t)=>db.table(t)),db.aiindex,db.airuns],async()=>{
      checkAbort(signal)
      const lease=await db.airuns.get(leaseId)
      if(paused||epoch!==startedEpoch||lease?.owner!==leaseOwner||sourceManifest(await bundleInTransaction(workId)).hash!==manifest.hash)throw sourceChanged()
      if(old.index.status!=='ready')await db.aiindex.update(workId,{status:'ready'})
    })
    return { ...old, index: { ...old.index, status: 'ready' } }
  }
  const model = projectBook(bundle, old?.docs), graph = projectGraph(bundle, model.docs, decisions)
  const incremental = !force && old?.index.projectionVersion === PROJECTION_VERSION
  const generation = incremental ? old.index.generation : uid()
  const rows = (items) => items.map((r) => ({ ...r, generation, rowKey: generation + ':' + r.id }))
  const groups = [[db.aidoc,rows(model.docs)], [db.aichunk,rows(model.chunks)], [db.aientity,rows(graph.entities)], [db.aiedge,rows(graph.edges)]]
  const oldGroups = [old?.docs || [], old?.chunks || [], old?.entities || [], old?.edges || []]
  const changes = groups.map(([table, items], idx) => {
    const existing = new Map(oldGroups[idx].map((r) => [r.rowKey,r]))
    const ids = new Set(items.map((r) => r.rowKey))
    return [table, items.filter((r) => rowHash(r) !== rowHash(existing.get(r.rowKey))), oldGroups[idx].filter((r) => !ids.has(r.rowKey)).map((r) => r.rowKey)]
  })
  try {
    if (!incremental) for (const [table, items] of groups) for (let i=0;i<items.length;i+=150) {
      checkAbort(signal)
      if (paused || epoch !== startedEpoch) throw sourceChanged()
      await table.bulkPut(items.slice(i,i+150))
      await new Promise((r) => setTimeout(r,0))
    }
    const index = { workId, status: 'ready', generation, sourceRevision: manifest.hash, layoutHash: manifest.layoutHash,
      decisionsHash, projectionVersion: PROJECTION_VERSION, manifest: manifest.entries,
      counts: Object.fromEntries([...new Set(model.docs.map((d) => d.sourceType))].map((t) => [t, model.docs.filter((d) => d.sourceType===t).length])),
      docs: model.docs.length, chunks: model.chunks.length, issues: [...model.issues,...graph.issues], updatedAt: Date.now() }
    await db.transaction('rw', [...SOURCE_TABLES.map((t) => db.table(t)), db.aiindex, db.aidecisions, db.airuns, ...(incremental ? groups.map(([table]) => table) : [])], async () => {
      checkAbort(signal)
      const lease=await db.airuns.get(leaseId)
      if (paused || epoch !== startedEpoch || lease?.owner!==leaseOwner || lease.leaseUntil<=Date.now() || sourceManifest(await bundleInTransaction(workId)).hash !== manifest.hash || rowHash({decisions:await db.aidecisions.where('workId').equals(workId).toArray()}) !== decisionsHash) throw sourceChanged()
      if (incremental) for (const [table, puts, deletes] of changes) {
        if (deletes.length) await table.bulkDelete(deletes)
        if (puts.length) await table.bulkPut(puts)
      }
      await db.aiindex.put(index)
    })
    // Readers freeze the revision; obsolete generations are never mixed with current rows.
    if (!incremental && old?.index.generation) for (const [table] of groups) await table.where('[workId+generation]').equals([workId,old.index.generation]).delete().catch(()=>{})
    return { index, docs: rows(model.docs), chunks: rows(model.chunks), entities: rows(graph.entities), edges: rows(graph.edges) }
  } catch (error) {
    if (!incremental) for (const [table] of groups) await table.where('[workId+generation]').equals([workId,generation]).delete()
    throw error
  }
}
export async function clearProjection(workId) {
  await db.transaction('rw',[db.aiindex,db.aidoc,db.aichunk,db.aientity,db.aiedge,db.aikbblock],async () => {
    for (const table of [db.aidoc,db.aichunk,db.aientity,db.aiedge,db.aikbblock]) await table.where('workId').equals(workId).delete()
    await db.aiindex.delete(workId)
  })
}
