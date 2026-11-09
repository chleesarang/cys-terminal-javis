// 암호화 — WebCrypto(브라우저 내장)만 사용. 외부 라이브러리 0.
// 구조: 무작위 데이터키(DEK, AES-256-GCM)로 장부·사진을 암호화하고,
//       DEK는 ① 비밀번호 ② 복구코드 각각에서 PBKDF2로 만든 키로 '감싸서' 보관.
//   → 재정 담당자가 바뀌거나 비밀번호를 잊어도 복구코드(담임목사·재정부장 보관)로 연다.
//   → 비밀번호 변경은 DEK를 다시 감싸기만 하면 되므로 데이터 재암호화 불필요.
import { b64encode, b64decode } from './util.js';

const te = new TextEncoder();
const td = new TextDecoder();
export const KDF_ITER = 600000; // OWASP 2023 권고(PBKDF2-HMAC-SHA256)
const subtle = () => globalThis.crypto.subtle;

async function kek(secret, salt, iter) {
  const base = await subtle().importKey('raw', te.encode(String(secret).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return subtle().deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function wrap(raw, secret, iter = KDF_ITER) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await kek(secret, salt, iter);
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, k, raw));
  return { salt: b64encode(salt), iv: b64encode(iv), ct: b64encode(ct), iter };
}
async function unwrapRaw(w, secret) {
  const k = await kek(secret, b64decode(w.salt), w.iter);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: b64decode(w.iv) }, k, b64decode(w.ct)));
}
const importDek = (raw) => subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);

const RC_ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 헷갈리는 0/O/1/I/L 제외
export function genRecoveryCode() {
  const b = crypto.getRandomValues(new Uint8Array(20));
  const s = [...b].map((x) => RC_ALPHA[x % RC_ALPHA.length]).join('');
  return s.match(/.{4}/g).join('-');
}
export const normRc = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export function checkPassword(pw) {
  const p = String(pw || '');
  if (p.length < 8) return '비밀번호는 8자 이상';
  if (/^(.)\1+$/.test(p) || /^(?:0123|1234|2345|3456|4567|5678|6789|abcd|qwer|password)/i.test(p)) return '너무 쉬운 비밀번호';
  return '';
}

export async function createKeyring(password, recoveryCode, iter = KDF_ITER) {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const keyring = { v: 1, pw: await wrap(raw, password, iter), rc: await wrap(raw, normRc(recoveryCode), iter) };
  return { keyring, key: await importDek(raw) };
}
/** 비밀번호 또는 복구코드로 열기. 틀리면 예외 */
export async function unlockKeyring(keyring, secret, via = 'pw') {
  try {
    const raw = await unwrapRaw(via === 'pw' ? keyring.pw : keyring.rc, via === 'pw' ? secret : normRc(secret));
    return await importDek(raw);
  } catch {
    throw new Error(via === 'pw' ? '비밀번호가 맞지 않습니다' : '복구코드가 맞지 않습니다');
  }
}
/** 비밀번호 변경(현재 비밀번호 또는 복구코드 필요) */
export async function rewrapPassword(keyring, current, newPw, via = 'pw', iter = KDF_ITER) {
  const raw = await unwrapRaw(via === 'pw' ? keyring.pw : keyring.rc, via === 'pw' ? current : normRc(current)).catch(() => { throw new Error('현재 비밀번호(복구코드)가 맞지 않습니다'); });
  return { ...keyring, pw: await wrap(raw, newPw, iter) };
}

export async function encryptJson(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj))));
  return { iv: b64encode(iv), ct: b64encode(ct) };
}
export async function decryptJson(key, box) {
  const pt = await subtle().decrypt({ name: 'AES-GCM', iv: b64decode(box.iv) }, key, b64decode(box.ct));
  return JSON.parse(td.decode(pt));
}
export async function encryptBytes(key, bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await subtle().encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return { iv: b64encode(iv), ct };
}
export async function decryptBytes(key, box) {
  const ct = box.ct instanceof Uint8Array ? box.ct : b64decode(box.ct);
  return new Uint8Array(await subtle().decrypt({ name: 'AES-GCM', iv: b64decode(box.iv) }, key, ct));
}
export async function sha256Hex(bytes) {
  const h = new Uint8Array(await subtle().digest('SHA-256', bytes));
  return [...h].map((x) => x.toString(16).padStart(2, '0')).join('');
}
