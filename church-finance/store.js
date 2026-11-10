// 기기 안 저장소(IndexedDB) — 저장되는 것은 전부 암호문. 평문은 메모리에만 존재.
//   meta:  'keyring' (감싼 키), 'doc' (암호화 장부), 'info' (마지막 백업일 등 비민감 정보)
//   files: 영수증·사진·영상 (각각 AES-GCM 암호화)
import { encryptJson, decryptJson, encryptBytes, decryptBytes } from './core/crypto.js';

const DB = 'cheongjigi-ledger';
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('meta'); r.result.createObjectStore('files'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    Promise.resolve(fn(s)).then((v) => { out = v; });
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error || new Error('저장 실패(저장 공간 부족일 수 있습니다)'));
  });
}
const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const getMeta = (k) => tx('meta', 'readonly', (s) => req(s.get(k)));
export const putMeta = (k, v) => tx('meta', 'readwrite', (s) => { s.put(v, k); });

export async function loadDoc(key) {
  const box = await getMeta('doc');
  return box ? decryptJson(key, box) : null;
}
export async function saveDoc(key, doc) {
  await putMeta('doc', await encryptJson(key, doc));
}

export async function putFile(key, id, bytes) {
  const box = await encryptBytes(key, bytes);
  await tx('files', 'readwrite', (s) => { s.put(box, id); });
}
export async function getFileBytes(key, id) {
  const box = await tx('files', 'readonly', (s) => req(s.get(id)));
  return box ? decryptBytes(key, box) : null;
}
export const getFileBox = (id) => tx('files', 'readonly', (s) => req(s.get(id)));
export const putFileBox = (id, box) => tx('files', 'readwrite', (s) => { s.put(box, id); });
export const listFileIds = () => tx('files', 'readonly', (s) => req(s.getAllKeys()));

export async function wipeAll() {
  const d = await db();
  d.close();
  dbp = null;
  await new Promise((res, rej) => { const r = indexedDB.deleteDatabase(DB); r.onsuccess = res; r.onerror = () => rej(r.error); r.onblocked = res; });
}

/** 브라우저가 저장 공간을 임의로 비우지 않도록 요청 */
export async function persist() {
  try { return navigator.storage?.persist ? await navigator.storage.persist() : false; } catch { return false; }
}
export async function usage() {
  try { return navigator.storage?.estimate ? await navigator.storage.estimate() : null; } catch { return null; }
}
