// 공용 유틸 — 순수 함수만 (브라우저·Node 공용, 외부 의존 0)

/** HTML 이스케이프 — 화면·보고서에 사용자 입력을 넣을 때 반드시 경유 */
export function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** 1234567 → "1,234,567" (음수 지원) */
export function won(n) {
  const v = Math.round(Number(n) || 0);
  return (v < 0 ? '-' : '') + Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ── 날짜 (모두 'YYYY-MM-DD' 문자열, 로컬 타임존 무관하게 UTC 정오 기준 계산) ──
export function ymd(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}
export function parseYmd(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], 12));
  return ymd(d) === s ? d : null; // 2월 30일 같은 잘못된 날짜 거부
}
export function isYmd(s) { return parseYmd(s) !== null; }
export function todayLocal(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
export function addDays(s, n) {
  const d = parseYmd(s);
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}
export function dow(s) { return parseYmd(s).getUTCDay(); } // 0=주일
/** 그 날짜가 속한 주의 주일(일요일) — 한국 교회 주간은 주일 시작 */
export function sundayOf(s) { return addDays(s, -dow(s)); }
/** 오늘 기준 '이번 주일'(오늘이 주일이면 오늘, 아니면 지난 주일) */
export function lastSunday(s) { return sundayOf(s); }
export function monthStart(s) { return s.slice(0, 8) + '01'; }
export function monthEnd(s) {
  const [y, m] = s.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0, 12));
  return ymd(d);
}
export function addMonths(s, n) {
  const [y, m] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1, 12));
  return ymd(t);
}
const DOW = ['주일', '월', '화', '수', '목', '금', '토'];
export function dowKo(s) { return DOW[dow(s)]; }
export function fmtDate(s) { return s ? `${s.replace(/-/g, '.')}(${dowKo(s)})` : ''; }

// ── SHA-256 (동기식, 감사로그 해시 체인용) ──
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
export function sha256Bytes(bytes) {
  const l = bytes.length;
  const withPad = ((l + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(withPad);
  m.set(bytes);
  m[l] = 0x80;
  const bits = l * 8;
  const dv = new DataView(m.buffer);
  dv.setUint32(withPad - 4, bits >>> 0);
  dv.setUint32(withPad - 8, Math.floor(bits / 2 ** 32));
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < withPad; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return [...H].map((x) => x.toString(16).padStart(8, '0')).join('');
}
export function sha256(str) { return sha256Bytes(new TextEncoder().encode(str)); }

/** 키 순서를 고정한 JSON — 해시 재현성 보장 */
export function stableJson(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
}

export function b64encode(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64decode(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** 주민등록번호 마스킹: 900101-1234567 → 900101-1****** */
export function maskRrn(r) {
  const d = String(r || '').replace(/[^0-9]/g, '');
  if (d.length < 7) return d ? d.slice(0, 2) + '****' : '';
  return `${d.slice(0, 6)}-${d[6]}******`;
}
export function fmtRrn(r) {
  const d = String(r || '').replace(/[^0-9]/g, '');
  return d.length === 13 ? `${d.slice(0, 6)}-${d.slice(6)}` : d;
}
