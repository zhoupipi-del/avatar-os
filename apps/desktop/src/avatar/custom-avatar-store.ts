/**
 * custom-avatar-store —— 用户在 ⚙ 里导入的模型存在哪
 *
 * Tauri：应用本地数据目录 avatars/custom.vrm（换机器 / 覆盖安装都在；不改程序目录，不需要重新打包）。
 * 浏览器预览：IndexedDB。
 * 文件名、导入时间等元数据放 localStorage。
 */
import { BaseDirectory, exists, mkdir, readFile, remove, writeFile } from "@tauri-apps/plugin-fs";
import { isTauri } from "../platform/is-tauri";

const DIR = "avatars";
const FILE = `${DIR}/custom.vrm`;
const META_KEY = "avataros:custom-avatar:v1";
const IDB_NAME = "avataros-custom-avatar";
const IDB_STORE = "files";
/** 超过这个大小会让她的电脑加载很慢，直接拒绝 */
export const MAX_MODEL_BYTES = 120 * 1024 * 1024;

export interface CustomAvatarMeta {
  readonly fileName: string;
  readonly bytes: number;
  readonly importedAt: number;
}

export function readCustomAvatarMeta(): CustomAvatarMeta | null {
  try {
    const raw = localStorage.getItem(META_KEY);
    return raw ? (JSON.parse(raw) as CustomAvatarMeta) : null;
  } catch {
    return null;
  }
}

function writeMeta(meta: CustomAvatarMeta | null): void {
  try {
    if (meta) localStorage.setItem(META_KEY, JSON.stringify(meta));
    else localStorage.removeItem(META_KEY);
  } catch {
    // 忽略
  }
}

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbOp<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await idb();
  return new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(IDB_STORE, mode).objectStore(IDB_STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export async function saveCustomAvatar(bytes: Uint8Array, fileName: string): Promise<void> {
  if (isTauri()) {
    await mkdir(DIR, { baseDir: BaseDirectory.AppLocalData, recursive: true });
    await writeFile(FILE, bytes, { baseDir: BaseDirectory.AppLocalData });
  } else {
    await idbOp("readwrite", (s) => s.put(bytes, "custom.vrm"));
  }
  writeMeta({ fileName, bytes: bytes.byteLength, importedAt: Date.now() });
}

/** 读取已导入的模型；没有或读不到返回 null（此时用默认形象） */
export async function loadCustomAvatar(): Promise<Uint8Array | null> {
  if (!readCustomAvatarMeta()) return null;
  try {
    if (isTauri()) {
      if (!(await exists(FILE, { baseDir: BaseDirectory.AppLocalData }))) return null;
      return await readFile(FILE, { baseDir: BaseDirectory.AppLocalData });
    }
    const v = await idbOp<Uint8Array | undefined>("readonly", (s) => s.get("custom.vrm"));
    return v ?? null;
  } catch {
    return null;
  }
}

export async function clearCustomAvatar(): Promise<void> {
  writeMeta(null);
  try {
    if (isTauri()) {
      if (await exists(FILE, { baseDir: BaseDirectory.AppLocalData })) {
        await remove(FILE, { baseDir: BaseDirectory.AppLocalData });
      }
    } else {
      await idbOp("readwrite", (s) => s.delete("custom.vrm"));
    }
  } catch {
    // 元数据已清，下次启动即用默认形象
  }
}
