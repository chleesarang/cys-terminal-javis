// 화면 공용 도구 — 상태, 자동 이스케이프 템플릿, 모달, 토스트, 저장, 파일
import { esc, uid, todayLocal } from './core/util.js';
import { saveDoc, putFile, getFileBytes } from './store.js';
import { sha256Hex } from './core/crypto.js';

export const S = {
  doc: null, key: null, keyring: null,
  view: 'home', ui: {}, urls: new Map(), lastActive: Date.now(),
  render: () => {},
};

// ── 자동 이스케이프 템플릿: h`...${값}...` — 값은 기본 이스케이프, raw()/h``만 그대로 ──
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(String(s ?? ''));
const val = (v) => (v == null || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(val).join('') : esc(v));
export function h(strings, ...vals) {
  let o = '';
  strings.forEach((s, i) => { o += s; if (i < vals.length) o += val(vals[i]); });
  return new Raw(o);
}

export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const today = () => todayLocal();

export function toast(msg, err = false) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg;
  t.className = err ? 'err' : '';
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, err ? 5000 : 2600);
}

/** 모달: 버튼을 누르면 {key, values} 로 끝난다 (values = name 붙은 입력값들) */
export function modal({ title, body, actions = [{ key: 'ok', label: '확인', cls: 'primary' }], wide = false, onOpen }) {
  return new Promise((resolve) => {
    let d = $('#dlg');
    if (!d) { d = document.createElement('dialog'); d.id = 'dlg'; document.body.appendChild(d); }
    d.innerHTML = h`<form method="dialog" class="mform"><div class="dh">${title}</div><div class="db">${body}</div><div class="df">${actions.map((a) => h`<button type="button" class="btn ${a.cls || ''}" data-mkey="${a.key}">${a.label}</button>`)}</div></form>`.s;
    d.classList.toggle('wide', wide);
    const finish = (key) => {
      const values = {};
      for (const el of $$('[name]', d)) values[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'file' ? el.files : el.value;
      const a = actions.find((x) => x.key === key);
      if (a?.validate) { const msg = a.validate(values); if (msg) { toast(msg, true); return; } }
      d.close();
      resolve({ key, values });
    };
    d.onclick = (e) => { const b = e.target.closest('[data-mkey]'); if (b) finish(b.dataset.mkey); };
    d.oncancel = (e) => { e.preventDefault(); finish('cancel'); };
    d.showModal();
    onOpen?.(d);
    const first = $('input:not([type=hidden]),textarea,select', d);
    if (first) setTimeout(() => first.focus(), 30);
  });
}
export async function confirmBox(msg, { ok = '확인', danger = false } = {}) {
  const r = await modal({ title: '확인', body: h`<p>${msg}</p>`, actions: [{ key: 'cancel', label: '취소' }, { key: 'ok', label: ok, cls: danger ? 'danger' : 'primary' }] });
  return r.key === 'ok';
}
export async function askReason(msg, label = '사유') {
  const r = await modal({
    title: label + ' 입력',
    body: h`<p>${msg}</p><textarea name="reason" placeholder="예: 계수 오류 정정 (재정부 확인)"></textarea>`,
    actions: [{ key: 'cancel', label: '취소' }, { key: 'ok', label: '확인', cls: 'primary', validate: (v) => (v.reason.trim() ? '' : label + '를 입력하세요') }],
  });
  return r.key === 'ok' ? r.values.reason.trim() : null;
}

// ── 저장 ──
let saving = Promise.resolve();
export function commit() {
  saving = saving.then(() => saveDoc(S.key, S.doc)).catch((e) => toast('저장 실패: ' + e.message, true));
  return saving;
}

// ── 파일(영수증·사진·영상) ──
export async function compressImage(file) {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.type === 'image/svg+xml') return { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type || 'application/octet-stream', name: file.name };
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const sc = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
    return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'image/jpeg', name: file.name.replace(/\.\w+$/, '') + '.jpg' };
  } catch {
    return { bytes: new Uint8Array(await file.arrayBuffer()), mime: file.type, name: file.name };
  }
}
/** 첨부 저장 → 거래에 넣을 메타데이터 */
export async function storeAttachment(f) {
  const id = uid();
  await putFile(S.key, id, f.bytes);
  return { id, mime: f.mime, name: f.name, size: f.bytes.length, sha256: await sha256Hex(f.bytes) };
}
export async function fileUrl(att) {
  if (S.urls.has(att.id)) return S.urls.get(att.id);
  const bytes = await getFileBytes(S.key, att.id);
  if (!bytes) return '';
  const u = URL.createObjectURL(new Blob([bytes], { type: att.mime }));
  S.urls.set(att.id, u);
  return u;
}
export function revokeAll() { for (const u of S.urls.values()) URL.revokeObjectURL(u); S.urls.clear(); }

/** 화면에 그려진 data-att 썸네일을 비동기로 채운다 */
export async function hydrateThumbs(root = document) {
  for (const el of $$('[data-att]', root)) {
    if (el.dataset.done) continue;
    el.dataset.done = '1';
    const att = JSON.parse(el.dataset.att);
    const u = await fileUrl(att);
    if (att.mime.startsWith('image/')) { const img = document.createElement('img'); img.src = u; img.alt = '영수증'; img.dataset.view = el.dataset.att; el.replaceWith(img); }
    else if (att.mime.startsWith('video/')) { const v = document.createElement('video'); v.src = u; v.muted = true; v.dataset.view = el.dataset.att; el.replaceWith(v); }
    else { el.textContent = (att.name || 'file').slice(-12); el.dataset.view = el.dataset.att; }
  }
}
export function thumbs(atts = []) {
  return h`<span class="thumbs">${atts.map((a) => h`<span class="file" data-att="${JSON.stringify(a)}">…</span>`)}</span>`;
}

export function download(name, data, mime = 'application/octet-stream') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
}
export async function shareOrDownload(name, data, mime) {
  const file = new File([data], name, { type: mime });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return 'shared'; } catch (e) { if (e.name === 'AbortError') return 'aborted'; }
  }
  download(name, file);
  return 'downloaded';
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove();
  }
  toast('복사했습니다. AI 앱에 붙여넣으세요.');
}
export function printHtml(html) {
  const pa = $('#printArea');
  pa.innerHTML = html;
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); pa.innerHTML = ''; window.removeEventListener('afterprint', done); };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
}
