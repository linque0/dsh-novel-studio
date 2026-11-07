import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLibrary } from '../src/core/library.js'
import { projectBook } from '../app/src/services/project/normalize.js'
import { projectGraph } from '../app/src/services/project/graph.js'

test('plugin library snapshot/import retains free-tree metadata and projects ID references', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ns-lore-roundtrip-'))
  try {
    const source = openLibrary(join(dir, 'source')), copy = openLibrary(join(dir, 'copy'))
    await source.init(); await copy.init()
    const work = { id: 'w', title: '验收作品' }
    const nodes = [
      { id: 'r', workId: 'w', parentId: null, text: '设定根', sortOrder: 0, heading: 1 },
      { id: 'a', workId: 'w', parentId: 'r', text: '前往工会', html: '<span class="dl-link" data-dl-target="mubu:b" data-dl-title="旧工会">工会</span>', heading: 2, tags: ['地点'], kind: 'place', custom: { note: '保留' }, sortOrder: 0 },
      { id: 'b', workId: 'w', parentId: null, text: '工会修订', heading: 0, sortOrder: 1000 }
    ]
    const result = await source.submit([{ table: 'works', id: 'w', kind: 'put', baseRevision: 0, row: work }, ...nodes.map(row => ({ table: 'mubu', id: row.id, kind: 'put', baseRevision: 0, row }))], { requestId: 'lore-roundtrip' })
    assert.equal(result.ok, true)
    const snapshot = await source.snapshot(); const imported = await copy.importDump(snapshot)
    assert.equal(imported.ok, true)
    const restored = await copy.snapshot()
    assert.deepEqual(restored.data.mubu.find(n => n.id === 'a'), snapshot.data.mubu.find(n => n.id === 'a'))
    assert.equal(restored.data.mubu.find(n => n.id === 'b').parentId, null)
    const bundle = { work, mubu: restored.data.mubu }
    const projected = projectBook(bundle)
    const graph = projectGraph(bundle, projected.docs)
    assert.ok(projected.docs.some(d => d.sourceId === 'a' && d.headingPath.includes('设定根')))
    assert.ok(graph.edges.some(e => e.kind === 'doublelink' || e.type === 'doublelink'))
    assert.equal(restored.data.mubu.find(n => n.id === 'a').heading, 2)
  } finally { await rm(dir, { recursive: true, force: true }) }
})
