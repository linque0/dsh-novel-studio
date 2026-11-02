/* ⚠ 生成文件，请勿直接编辑。
 * 规范源：novel-studio/packages/novel-core/library.js
 * 同步：cd dsh-novel-studio && node scripts/sync-core.mjs
 */
/* 作品库（单一权威文件存储）。
 * 零外部依赖，纯 Node ESM，桌面版 Electron 主进程与 DSH 插件共用同一份实现。
 *
 * 目录结构：
 *   <library>/library.json            索引：layout/seq/works 摘要
 *   <library>/entities/<table>/<id>.json   实体文件（含 revision / tombstone）
 *   <library>/journal/<seq>.json      操作日志（两宿主的一致性来源）
 *   <library>/requests/<hash>.json    幂等结果
 *   <library>/.lock                   提交期短锁（跨进程）
 */
import { mkdir, readFile, writeFile, rename, readdir, stat, unlink, access } from 'node:fs/promises';
import { join, dirname, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const LAYOUT = 1;

/** 需要同步进库的表。其余（aikb/aidoc/aikbvec/airuns...）是可重建读模型，不进库。 */
export const SYNC_TABLES = [
  'works', 'volumes', 'chapters', 'outlines', 'characters', 'relations', 'lorelinks',
  'lorecats', 'lore', 'mubu', 'olnodes', 'snippets', 'annotations', 'assets', 'links',
  'appconfig', 'aipresets', 'aipresetstate',
];

const SECRET_PREFIX = 'ai.cred';
const LOCK_STALE_MS = 30000;
const LOCK_RETRY_MS = 25;
const LOCK_TIMEOUT_MS = 4000;

export class StoreError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'StoreError';
    this.code = code;
  }
}
const fail = (code, message) => {
  throw new StoreError(code, message);
};

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const temporary = path + '.stage-' + randomUUID();
  await writeFile(temporary, JSON.stringify(value), 'utf8');
  await rename(temporary, path);
}

const idKey = (id) => createHash('sha1').update(String(id)).digest('hex').slice(0, 24);
const requestKey = (requestId) => createHash('sha1').update(String(requestId)).digest('hex').slice(0, 32);

function assertTable(table) {
  if (!SYNC_TABLES.includes(table)) fail('INVALID_INPUT', '不支持的表：' + table);
}

function stripSecrets(table, row) {
  if (table !== 'appconfig') return row;
  return String(row?.key || '').startsWith(SECRET_PREFIX) ? null : row;
}

/** 跨进程短锁：提交、导入、迁移互斥。 */
async function acquireLock(dir) {
  const lockPath = join(dir, '.lock');
  const started = Date.now();
  for (;;) {
    try {
      await writeFile(lockPath, JSON.stringify({ pid: process.pid, at: Date.now() }), { flag: 'wx' });
      return async () => {
        try {
          await unlink(lockPath);
        } catch {
          /* 已被回收 */
        }
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      let held = 0;
      try {
        held = (await stat(lockPath)).mtimeMs;
      } catch {
        continue;
      }
      if (Date.now() - held > LOCK_STALE_MS) {
        try {
          await unlink(lockPath);
        } catch {
          /* 竞争释放 */
        }
        continue;
      }
      if (Date.now() - started > LOCK_TIMEOUT_MS) fail('BUSY', '作品库正被另一侧写入，请稍后重试');
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
    }
  }
}

export class Library {
  constructor(dir) {
    if (!dir) fail('INVALID_INPUT', '缺少作品库目录');
    this.dir = resolve(dir);
    this.indexPath = join(this.dir, 'library.json');
  }

  entityPath(table, id) {
    assertTable(table);
    return join(this.dir, 'entities', table, idKey(id) + '.json');
  }

  journalDir() {
    return join(this.dir, 'journal');
  }

  requestsDir() {
    return join(this.dir, 'requests');
  }

  async init() {
    await mkdir(join(this.dir, 'entities'), { recursive: true });
    await mkdir(this.journalDir(), { recursive: true });
    await mkdir(this.requestsDir(), { recursive: true });
    if (!(await exists(this.indexPath))) {
      await writeJsonAtomic(this.indexPath, { layout: LAYOUT, seq: 0, works: {}, updatedAt: new Date().toISOString() });
    }
    return this.index();
  }

  async index() {
    const value = await readJson(this.indexPath, null);
    if (!value) fail('NO_LIBRARY', '作品库尚未初始化：' + this.dir);
    return value;
  }

  async status() {
    const exists_ = await exists(this.indexPath);
    if (!exists_) return { ready: false, dir: this.dir, layout: LAYOUT };
    const index = await this.index();
    return {
      ready: true,
      dir: this.dir,
      layout: index.layout || LAYOUT,
      seq: index.seq || 0,
      works: Object.keys(index.works || {}).length,
    };
  }

  async works() {
    const index = await this.index();
    return Object.values(index.works || {}).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }

  async readEntity(table, id) {
    const file = await readJson(this.entityPath(table, id), null);
    if (!file || file.deleted) return null;
    return file;
  }

  async listEntities(table) {
    assertTable(table);
    const folder = join(this.dir, 'entities', table);
    let names = [];
    try {
      names = await readdir(folder);
    } catch {
      return [];
    }
    const rows = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const file = await readJson(join(folder, name), null);
      if (file && !file.deleted && file.row) rows.push(file);
    }
    return rows;
  }

  /** 批量提交：全成或全败；requestId 幂等；baseRevision 前置 CAS。 */
  async submit(ops, options = {}) {
    if (!Array.isArray(ops) || !ops.length) fail('INVALID_INPUT', 'ops 不能为空');
    const requestId = String(options.requestId || '');
    if (!requestId) fail('INVALID_INPUT', '提交必须携带 requestId（幂等键）');
    await this.init();
    const release = await acquireLock(this.dir);
    try {
      const cached = await readJson(join(this.requestsDir(), requestKey(requestId) + '.json'), null);
      if (cached) return { ok: true, replayed: true, seq: cached.seq, revisions: cached.revisions };

      const prepared = [];
      for (const raw of ops) {
        const table = String(raw?.table || '');
        assertTable(table);
        const id = String(raw?.id || '');
        if (!id) fail('INVALID_INPUT', 'op.id 不能为空');
        const kind = raw?.kind === 'delete' ? 'delete' : 'put';
        const current = await readJson(this.entityPath(table, id), null);
        const currentRevision = current && !current.deleted ? current.revision : 0;
        const base = Number(raw?.baseRevision);
        if (!Number.isSafeInteger(base) || base < 0) fail('REVISION_REQUIRED', '修改前请读取对象并提供 baseRevision');
        if (base !== currentRevision) {
          return {
            ok: false,
            conflict: { table, id, currentRevision, current: current && !current.deleted ? current.row : null },
          };
        }
        if (kind === 'put') {
          const row = stripSecrets(table, raw.row);
          if (row === null) continue;
          if (!row || typeof row !== 'object') fail('INVALID_INPUT', 'op.row 必须是对象');
        }
        prepared.push({ table, id, kind, row: raw?.row, nextRevision: currentRevision + 1 });
      }

      const index = await this.index();
      const seq = (index.seq || 0) + 1;
      const at = new Date().toISOString();
      const revisions = [];
      for (const item of prepared) {
        const file = item.kind === 'delete'
          ? { id: item.id, table: item.table, revision: item.nextRevision, updatedAt: at, deleted: true }
          : { id: item.id, table: item.table, revision: item.nextRevision, updatedAt: at, row: stripSecrets(item.table, item.row) };
        await writeJsonAtomic(this.entityPath(item.table, item.id), file);
        revisions.push({ table: item.table, id: item.id, revision: item.nextRevision, kind: item.kind });
        if (item.table === 'works') {
          if (item.kind === 'delete') delete index.works[item.id];
          else index.works[item.id] = { id: item.id, title: file.row?.title || '', updatedAt: at, revision: item.nextRevision };
        }
      }
      index.seq = seq;
      index.updatedAt = at;
      await writeJsonAtomic(this.indexPath, index);
      await writeJsonAtomic(join(this.journalDir(), String(seq).padStart(9, '0') + '.json'), {
        seq,
        at,
        requestId,
        actor: options.actor || null,
        ops: revisions.map((r, i) => ({ ...r, row: r.kind === 'delete' ? null : stripSecrets(r.table, prepared[i].row) })),
      });
      const result = { ok: true, replayed: false, seq, revisions };
      await writeJsonAtomic(join(this.requestsDir(), requestKey(requestId) + '.json'), { requestId, seq, revisions, at });
      return result;
    } finally {
      await release();
    }
  }

  /** 拉取 seq 之后的增量。 */
  async pull(afterSeq = 0) {
    await this.init();
    let names = [];
    try {
      names = await readdir(this.journalDir());
    } catch {
      return { seq: afterSeq, ops: [] };
    }
    const wanted = names
      .filter((name) => name.endsWith('.json'))
      .map((name) => Number(name.slice(0, -5)))
      .filter((seq) => Number.isSafeInteger(seq) && seq > afterSeq)
      .sort((a, b) => a - b);
    const ops = [];
    let seq = afterSeq;
    for (const entry of wanted) {
      const file = await readJson(join(this.journalDir(), String(entry).padStart(9, '0') + '.json'), null);
      if (!file) continue;
      seq = file.seq;
      ops.push(...(file.ops || []));
    }
    return { seq, ops };
  }

  /** 导出与桌面版 exportBackupJson 同形状的 dump（不含密钥）。 */
  async snapshot() {
    await this.init();
    const data = {};
    const revisions = {};
    for (const table of SYNC_TABLES) {
      const files = await this.listEntities(table);
      data[table] = files.map((file) => file.row);
      for (const file of files) revisions[table + ':' + file.id] = file.revision;
    }
    const index = await this.index();
    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      layout: index.layout || LAYOUT,
      seq: index.seq || 0,
      assets: [],
      data,
      revisions,
    };
  }

  /* —— 审稿记录（可复核的结构化意见，落库目录，不进同步集合）—— */

  reviewsDir() {
    return join(this.dir, 'reviews');
  }

  async writeReview(value) {
    await mkdir(this.reviewsDir(), { recursive: true });
    const record = { createdAt: new Date().toISOString(), ...value, id: value?.id || randomUUID() };
    await writeJsonAtomic(join(this.reviewsDir(), record.id + '.json'), record);
    return record;
  }

  async readReview(id) {
    return readJson(join(this.reviewsDir(), String(id) + '.json'), null);
  }

  async updateReview(id, patch) {
    const current = await this.readReview(id);
    if (!current) fail('NOT_FOUND', '审稿记录不存在：' + id);
    const next = { ...current, ...patch, id: current.id, updatedAt: new Date().toISOString() };
    await writeJsonAtomic(join(this.reviewsDir(), current.id + '.json'), next);
    return next;
  }

  /* —— 提案（Agent 的候选稿，不进 journal、不进同步集合，只落库目录）—— */

  proposalsDir() {
    return join(this.dir, 'proposals');
  }

  async writeProposal(value) {
    await mkdir(this.proposalsDir(), { recursive: true });
    const record = {
      status: 'proposed',
      createdAt: new Date().toISOString(),
      ...value,
      id: value?.id || randomUUID(),
    };
    await writeJsonAtomic(join(this.proposalsDir(), record.id + '.json'), record);
    return record;
  }

  async readProposal(id) {
    return readJson(join(this.proposalsDir(), String(id) + '.json'), null);
  }

  async updateProposal(id, patch) {
    const current = await this.readProposal(id);
    if (!current) fail('NOT_FOUND', '提案不存在：' + id);
    const next = { ...current, ...patch, id: current.id, updatedAt: new Date().toISOString() };
    await writeJsonAtomic(join(this.proposalsDir(), current.id + '.json'), next);
    return next;
  }

  async listProposals({ workId = null, status = null } = {}) {
    let names = [];
    try {
      names = await readdir(this.proposalsDir());
    } catch {
      return [];
    }
    const rows = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const row = await readJson(join(this.proposalsDir(), name), null);
      if (!row) continue;
      if (workId && row.workId !== workId) continue;
      if (status && row.status !== status) continue;
      rows.push(row);
    }
    return rows.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
  }

  /** 导入 dump（首次迁移 / 恢复）。默认只在库为空时允许，force 时覆盖。 */
  async importDump(dump, options = {}) {
    if (!dump || typeof dump !== 'object' || !dump.data) fail('INVALID_INPUT', '备份格式不正确');
    await this.init();
    const release = await acquireLock(this.dir);
    try {
      const index = await this.index();
      if ((index.seq || 0) > 0 && !options.force) fail('NOT_EMPTY', '作品库已有数据；如需覆盖请显式传入 force');
      const seq = (index.seq || 0) + 1;
      const at = new Date().toISOString();
      const revisions = [];
      for (const [table, rows] of Object.entries(dump.data)) {
        if (!SYNC_TABLES.includes(table) || !Array.isArray(rows)) continue;
        for (const row of rows) {
          const clean = stripSecrets(table, row);
          if (!clean || !clean.id) continue;
          await writeJsonAtomic(this.entityPath(table, clean.id), {
            id: clean.id, table, revision: 1, updatedAt: at, row: clean,
          });
          revisions.push({ table, id: clean.id, revision: 1, kind: 'put' });
          if (table === 'works') index.works[clean.id] = { id: clean.id, title: clean.title || '', updatedAt: at, revision: 1 };
        }
      }
      index.seq = seq;
      index.updatedAt = at;
      await writeJsonAtomic(this.indexPath, index);
      await writeJsonAtomic(join(this.journalDir(), String(seq).padStart(9, '0') + '.json'), {
        seq, at, requestId: 'import:' + randomUUID(), actor: { kind: 'human' }, ops: revisions.map((r) => ({ ...r, row: null })),
      });
      return { ok: true, seq, imported: revisions.length };
    } finally {
      await release();
    }
  }
}

export function openLibrary(dir) {
  return new Library(dir);
}
