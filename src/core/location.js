/* ⚠ 生成文件，请勿直接编辑。
 * 规范源：novel-studio/packages/novel-core/location.js
 * 同步：cd dsh-novel-studio && node scripts/sync-core.mjs
 */
/* 作品库位置：指针文件、目录浏览与移动式迁移。
 * 零外部依赖，纯 Node ESM，桌面版 Electron 主进程与 DSH 插件共用同一份实现。
 *
 * 指针文件（两版共用，谁写谁生效）：
 *   <基目录>/novel-studio/library.json   {"path":"<库目录>","layout":1}
 * 迁移是"移动"：复制 → 校验 → 换指针 → 删原目录；任一步失败都不留半成品、
 * 不写指针，原库保持在原位。
 */
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { StoreError } from './library.js';

const IS_WIN = process.platform === 'win32';
/* 复制/校验统一忽略：提交期短锁可能残留，带过去会挡住新库的写入。 */
const LOCK_NAME = '.lock';

const fail = (code, message) => {
  throw new StoreError(code, message);
};

/* 指针基目录：两版因此共享同一个指针文件。
 * NOVEL_STUDIO_POINTER_DIR 只给单测覆盖用，线上不设就保持原行为。 */
function baseDir() {
  const override = String(process.env.NOVEL_STUDIO_POINTER_DIR || '').trim();
  if (override) return resolve(override);
  return IS_WIN
    ? process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local')
    : join(homedir(), '.local', 'share');
}

const flat = (value) => {
  const full = resolve(String(value));
  return IS_WIN ? full.toLowerCase() : full;
};

/** 大小写不敏感比较（Windows 上 "D:\库" 与 "d:\库" 是同一个位置）。 */
function samePath(a, b) {
  return flat(a) === flat(b);
}

/** child 是否严格位于 parent 内部（用于拒绝互相嵌套的迁移）。 */
function isInside(child, parent) {
  const inside = flat(child);
  const outer = flat(parent);
  if (inside === outer) return false;
  return inside.startsWith(outer.endsWith(sep) ? outer : outer + sep);
}

export function pointerPath() {
  return join(baseDir(), 'novel-studio', 'library.json');
}

export function defaultLibraryDir() {
  return join(dirname(pointerPath()), 'library');
}

/** 读不到 / 非法一律回 ''（'' = 用默认目录），调用方不必分辨失败原因。 */
export function readPointer() {
  try {
    const raw = JSON.parse(readFileSync(pointerPath(), 'utf8'));
    const pointed = typeof raw?.path === 'string' ? raw.path.trim() : '';
    if (!pointed || pointed.includes('\0') || !isAbsolute(pointed)) return '';
    return resolve(pointed);
  } catch {
    return '';
  }
}

/** 写指针；失败抛错（迁移要靠这个错误回滚，不能像旧实现那样静默吞掉）。 */
export function writePointer(dir) {
  const wanted = String(dir || '').trim();
  if (!wanted || wanted.includes('\0') || !isAbsolute(wanted)) {
    fail('BAD_PATH', '作品库路径必须是绝对路径：' + wanted);
  }
  const file = pointerPath();
  const temporary = file + '.stage-' + randomUUID();
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(temporary, JSON.stringify({ path: resolve(wanted), layout: 1, at: new Date().toISOString() }, null, 2), 'utf8');
    renameSync(temporary, file);
  } catch (error) {
    try {
      rmSync(temporary, { force: true });
    } catch {
      /* 残片清理失败不掩盖原始错误 */
    }
    fail('POINTER_FAILED', '指针文件写入失败：' + (error?.message || error));
  }
  return resolve(wanted);
}

/** 给设置面板用的位置摘要；current 为空时按指针 → 默认目录推断。 */
export function describeLocation({ current, fallback = false } = {}) {
  const fallbackDir = defaultLibraryDir();
  const wanted = String(current || '').trim() || readPointer() || fallbackDir;
  const resolved = resolve(wanted);
  return {
    current: resolved,
    default: fallbackDir,
    pointer: pointerPath(),
    isCustom: !samePath(resolved, fallbackDir),
    fallback: fallback === true,
  };
}

const exists = async (path) => {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
};

async function isDirectory(path) {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isEmptyDir(path) {
  try {
    return (await readdir(path)).length === 0;
  } catch {
    return false;
  }
}

/** 在 dir（不存在时取最近的已存在祖先）里试写一个临时文件再删。 */
async function writable(dir) {
  let probeDir = resolve(dir);
  for (;;) {
    if (await isDirectory(probeDir)) break;
    const up = dirname(probeDir);
    if (samePath(up, probeDir)) return false;
    probeDir = up;
  }
  const probe = join(probeDir, '.ns-write-' + randomUUID());
  try {
    await writeFile(probe, '', 'utf8');
    await rm(probe, { force: true });
    return true;
  } catch {
    try {
      await rm(probe, { force: true });
    } catch {
      /* 探针残留不影响后续操作 */
    }
    return false;
  }
}

/** 空/不存在的起点回落到确定存在的目录：默认库的父目录 → 家目录。 */
async function fallbackDir() {
  for (const candidate of [dirname(defaultLibraryDir()), homedir()]) {
    if (await isDirectory(candidate)) return resolve(candidate);
  }
  return resolve(dirname(defaultLibraryDir()));
}

/** 逐级点选用的目录清单：只给目录，绝对路径，按名字排序。 */
export async function browseDirectory(dir) {
  const wanted = String(dir || '').trim();
  let target = '';
  if (wanted && !wanted.includes('\0') && !wanted.split(/[\\/]+/).includes('..') && isAbsolute(wanted)) {
    const absolute = resolve(wanted);
    if (await isDirectory(absolute)) target = absolute;
  }
  if (!target) target = await fallbackDir();

  let entries = [];
  try {
    const names = await readdir(target, { withFileTypes: true });
    entries = names
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, path: join(target, entry.name) }))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  } catch {
    entries = [];
  }

  const parent = dirname(target);
  const isLibrary = await exists(join(target, 'library.json'));
  let reason = '';
  if (!(await writable(target))) reason = 'TARGET_NOT_WRITABLE';
  else if (isLibrary) reason = 'TARGET_IS_LIBRARY';
  else if (!(await isEmptyDir(target))) reason = 'TARGET_NOT_EMPTY';

  return {
    dir: target,
    parent: samePath(parent, target) ? null : parent,
    entries,
    isLibrary,
    isValidTarget: reason === '',
    reason,
  };
}

/** 递归统计文件数与字节数（不计短锁）。 */
async function measure(dir) {
  let files = 0;
  let bytes = 0;
  let names = [];
  try {
    names = await readdir(dir, { withFileTypes: true });
  } catch {
    return { files, bytes };
  }
  for (const entry of names) {
    if (entry.name === LOCK_NAME) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await measure(full);
      files += sub.files;
      bytes += sub.bytes;
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      bytes += (await stat(full)).size;
      files += 1;
    } catch {
      /* 复制瞬间被改名的文件不计入，一致性以列表对比为准 */
    }
  }
  return { files, bytes };
}

/** 迁移参数校验：全是只读判断，任何一个不过都还没碰过磁盘。 */
function checkPath(raw, label) {
  const text = String(raw || '').trim();
  if (!text || text.includes('\0')) fail('BAD_PATH', label + '无效（为空或含非法字符）');
  if (!isAbsolute(text)) fail('BAD_PATH', label + '必须是绝对路径：' + text);
  if (text.split(/[\\/]+/).includes('..')) fail('BAD_PATH', label + '不能包含 .. 上跳：' + text);
  return resolve(text);
}

/** 递归复制；短锁不带走。 */
async function copyTree(from, to) {
  try {
    await cp(from, to, {
      recursive: true,
      force: true,
      filter: (src) => !String(src).split(/[\\/]+/).includes(LOCK_NAME),
    });
  } catch (error) {
    fail('MOVE_FAILED', '复制作品库失败：' + (error?.message || error));
  }
}

/** 移动式迁移：复制 → 校验 → 换指针 → 删原目录。 */
export async function relocateLibrary(from, to, options = {}) {
  const source = checkPath(from, '源目录');
  const target = checkPath(to, '目标目录');

  if (samePath(source, target)) fail('SAME_DIR', '目标目录与当前作品库是同一个目录：' + target);
  if (isInside(target, source)) fail('NESTED', '目标目录不能位于当前作品库内部：' + target);
  if (isInside(source, target)) fail('NESTED', '目标目录不能是当前作品库的上级目录：' + target);
  if (!(await exists(join(source, 'library.json')))) fail('BAD_PATH', '源目录不是作品库：' + source);

  if (await exists(target)) {
    if (!(await isDirectory(target))) fail('TARGET_NOT_EMPTY', '目标路径已存在且不是目录：' + target);
    if (await exists(join(target, 'library.json'))) fail('TARGET_IS_LIBRARY', '目标目录本身就是一个作品库：' + target);
    if (!(await isEmptyDir(target))) fail('TARGET_NOT_EMPTY', '目标目录非空，请换一个空目录：' + target);
  }
  if (!(await writable(target))) fail('TARGET_NOT_WRITABLE', '目标目录不可写：' + target);

  /* 原目录先整体改名当回收站（同一父目录，同卷 rename 是原子的）。
   * 把"删真数据"推到指针写成功之后：删原目录失败只可能发生在迁移已成立之后，
   * 因此不必把新库也拆掉——那种回滚只会用一个成功的结果换一次数据丢失风险。 */
  const trash = join(dirname(source), '.' + 'trash-' + randomUUID().slice(0, 8));
  let moved = false;
  let stats = { files: 0, bytes: 0 };
  try {
    await mkdir(target, { recursive: true });
    await copyTree(source, target);

    try {
      const index = JSON.parse(await readFile(join(target, 'library.json'), 'utf8'));
      if (!index || typeof index !== 'object') fail('VERIFY_FAILED', '复制后的 library.json 结构不正确：' + target);
    } catch (error) {
      if (error instanceof StoreError) throw error;
      fail('VERIFY_FAILED', '复制后的 library.json 无法解析：' + target);
    }

    const sourceStats = await measure(source);
    stats = await measure(target);
    if (stats.files !== sourceStats.files) {
      fail('VERIFY_FAILED', `复制不完整：源 ${sourceStats.files} 个文件，目标 ${stats.files} 个文件`);
    }
    const gap = (await measure(join(target, 'entities'))).files - (await measure(join(source, 'entities'))).files;
    if (gap !== 0) fail('VERIFY_FAILED', '实体文件数量不一致（差 ' + gap + '）：' + target);

    try {
      await rename(source, trash);
    } catch (error) {
      fail('MOVE_FAILED', '原目录无法暂时移开（可能被占用）：' + (error?.message || error));
    }
    moved = true;
    writePointer(target);
  } catch (error) {
    if (moved) {
      try {
        await rename(trash, source);
      } catch {
        /* 放不回去就保持现状留给人工处理，至少新副本已删 */
      }
    }
    try {
      await rm(target, { recursive: true, force: true });
    } catch {
      /* 半成品删不掉也不会覆盖任何已有数据 */
    }
    throw error;
  }

  /* 数据已在 target、指针已指向 target：原目录只剩回收站清理，失败不影响结果。 */
  try {
    await rm(trash, { recursive: true, force: true });
  } catch {
    /* 残留目录可手工删除，报错反而会让调用方以为迁移失败 */
  }
  return { ok: true, from: source, to: target, files: stats.files, bytes: stats.bytes };
}
