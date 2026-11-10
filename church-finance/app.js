// 앱 진입점 — 최초 설정 · 잠금 · 화면 전환 · 이벤트 연결 · 자동 잠금
import { S, h, $, toast, modal, commit, hydrateThumbs, revokeAll } from './ui.js';
import { createDoc, appendAudit } from './core/ledger.js';
import { createKeyring, unlockKeyring, genRecoveryCode, checkPassword, rewrapPassword, decryptBytes } from './core/crypto.js';
import { getMeta, putMeta, loadDoc, saveDoc, putFile, persist } from './store.js';
import { b64decode } from './core/util.js';
import * as IN from './views-input.js';
import * as MG from './views-manage.js';
import * as HP from './views-help.js';
import { APP } from './config.js';
import { setRegion, REGIONS, regionOf } from './core/region.js';

const VIEWS = { ...IN.views, ...MG.views, ...HP.views };
const ACT = { ...IN.actions, ...MG.actions, ...HP.actions };
const NAV = [
  ['home', '🏠', '홈'], ['offer', '🙏', '헌금'], ['expense', '🧾', '지출'], ['ledger', '📒', '장부'], ['report', '📊', '보고서'],
  ['members', '👥', '교인'], ['receipts', '📄', '영수증'], ['help', '📘', '도움말'], ['budget', '📐', '예산'], ['ai', '🤖', 'AI 도우미'], ['settings', '⚙️', '설정'],
];
const BOTTOM = ['home', 'offer', 'expense', 'report', 'more'];

// ═════════ 화면 그리기 ═════════
function render() {
  const root = $('#app');
  if (!S.doc) return;
  if (S.view === 'more') return renderMore();
  const view = VIEWS[S.view] || VIEWS.home;
  let body;
  try { body = view(); } catch (e) { console.error(e); body = h`<div class="card bad">화면 오류: ${e.message}</div>`; }
  root.innerHTML = h`<header class="topbar"><div class="brand"><img src="icons/icon-192.png" alt=""><span>${APP.name} <small>V${APP.version}</small></span></div><span class="church">${S.doc.settings.churchName}</span><span class="sp"></span><button data-act="lockNow" title="잠그기">🔒 잠금</button></header>
  <div class="shell"><nav class="side" aria-label="메뉴">${NAV.map(([k, i, l]) => h`<button data-act="nav" data-v="${k}" ${S.view === k ? 'aria-current="page"' : ''}><span>${i}</span>${l}</button>`)}</nav>
  <main id="main">${body}</main></div>
  <nav class="bottomnav" aria-label="빠른 메뉴">${BOTTOM.map((k) => { const n = NAV.find((x) => x[0] === k) || ['more', '☰', '더보기']; return h`<button data-act="nav" data-v="${n[0]}" ${S.view === k || (k === 'more' && !BOTTOM.includes(S.view)) ? 'aria-current="page"' : ''}><span class="i">${n[1]}</span>${n[2]}</button>`; })}</nav>`.s;
  hydrateThumbs(root);
  if (S.view === 'settings') MG.settingsAfterRender();
  if (S.view === 'expense') { const m = $('#ex-memo'); if (m?.value) IN.actions.exMemo(); const a = $('#ex-amount'); if (a?.value) IN.actions.exAmount(a); }
}
function renderMore() {
  $('#app').innerHTML = h`<header class="topbar"><div class="brand"><img src="icons/icon-192.png" alt=""><span>${APP.name}</span></div><span class="sp"></span><button data-act="lockNow">🔒 잠금</button></header>
  <main id="main"><h2 class="page">전체 메뉴</h2><div class="grid">${NAV.map(([k, i, l]) => h`<button class="btn" data-act="nav" data-v="${k}">${i} ${l}</button>`)}</div></main>
  <nav class="bottomnav">${BOTTOM.map((k) => { const n = NAV.find((x) => x[0] === k) || ['more', '☰', '더보기']; return h`<button data-act="nav" data-v="${n[0]}" ${k === 'more' ? 'aria-current="page"' : ''}><span class="i">${n[1]}</span>${n[2]}</button>`; })}</nav>`.s;
}
S.render = render;

function go(v) { S.view = v; render(); window.scrollTo(0, 0); }

// ═════════ 최초 설정 ═════════
function renderSetup(step = 1, data = {}) {
  const root = $('#app');
  if (step === 1) {
    root.innerHTML = h`<div class="gate"><div class="logo"><img src="icons/icon-192.png" alt=""><h1>${APP.name}</h1><p class="muted">${APP.tagline}</p></div>
    <div class="card"><h3>처음 설정</h3>
      <label class="f"><span>교회(기관) 이름</span><input type="text" id="su-name" autocomplete="organization"></label>
      <label class="f"><span>지역 · 영수증 방식 (첫 입력 후에는 바꿀 수 없음)</span><select id="su-region">${Object.values(REGIONS).map((r) => h`<option value="${r.code}">${r.label}</option>`)}</select></label>
      <label class="f"><span>회계연도 시작</span><select id="su-fy">${Array.from({ length: 12 }, (_, i) => i + 1).map((m) => h`<option value="${m}" ${m === 1 ? 'selected' : ''}>${m}월</option>`)}</select></label>
      <label class="f"><span>비밀번호 (8자 이상 · 이 기기의 장부를 여는 열쇠)</span><input type="password" id="su-pw" autocomplete="new-password"></label>
      <label class="f"><span>비밀번호 확인</span><input type="password" id="su-pw2" autocomplete="new-password"></label>
      <div class="row" style="margin-top:12px"><button class="btn primary grow" data-gate="setupNext">다음 ▶</button></div>
    </div>
    <div class="card"><h3>이미 쓰던 장부가 있나요?</h3><p class="small muted">다른 기기(PC·휴대폰)에서 만든 백업 파일로 시작합니다.</p><label class="btn">📂 백업 파일로 시작<input type="file" accept=".boaz,application/json" class="hidden" id="su-restore"></label></div>
    <p class="small muted">🔒 모든 자료는 이 기기 안에만 암호화되어 저장됩니다. 서버·회원가입·인터넷이 필요 없고, 배포사도 교회 자료를 볼 수 없습니다.</p></div>`.s;
    $('#su-restore').addEventListener('change', (e) => run(() => restoreFresh(e.target.files[0])));
    return;
  }
  root.innerHTML = h`<div class="gate"><div class="card"><h3>복구코드 — 꼭 적어 두세요</h3>
    <p>비밀번호를 잊거나 재정 담당자가 바뀌면 이 코드로만 장부를 열 수 있습니다. <b>종이에 적어 담임목사·재정부장이 따로 보관</b>하세요. 다시 보여 드리지 않습니다.</p>
    <div class="rc" id="rc">${data.rc}</div>
    <div class="row" style="margin-top:10px"><button class="btn" data-gate="printRc">🖨 인쇄</button></div>
    <label class="row" style="margin-top:12px"><input type="checkbox" id="rc-ok"> 복구코드를 안전한 곳에 적어 두었습니다</label>
    <div class="row" style="margin-top:12px"><button class="btn gold grow" data-gate="setupDone">시작하기</button></div></div></div>`.s;
}

async function setupNext() {
  const name = $('#su-name').value.trim(), pw = $('#su-pw').value, pw2 = $('#su-pw2').value;
  if (!name) return toast('교회 이름을 입력하세요', true);
  const bad = checkPassword(pw);
  if (bad) return toast(bad, true);
  if (pw !== pw2) return toast('비밀번호 확인이 다릅니다', true);
  S._setup = { name, pw, fy: +$('#su-fy').value, region: $('#su-region').value, rc: genRecoveryCode() };
  renderSetup(2, S._setup);
}
async function setupDone() {
  if (!$('#rc-ok').checked) return toast('복구코드를 적어 두었는지 확인해 주세요', true);
  const s = S._setup;
  toast('암호 열쇠를 만드는 중…');
  const { keyring, key } = await createKeyring(s.pw, s.rc);
  const doc = createDoc({ churchName: s.name, fyStartMonth: s.fy, region: s.region });
  appendAudit(doc, 'init', '', `장부 생성: ${s.name}`);
  await putMeta('keyring', keyring);
  await saveDoc(key, doc);
  S._setup = null;
  Object.assign(S, { keyring, key, doc, view: 'home' });
  S.ui.info = (await getMeta('info')) || {};
  await persist();
  startSession();
  toast('준비 완료! 교인 명부부터 등록해 보세요.');
}

async function restoreFresh(file) {
  if (!file) return;
  const b = await MG.openBackup(file);
  if (!b) return;
  await putMeta('keyring', b.keyring);
  for (const x of b.files) await putFile(b.key, x.id, await decryptBytes(b.key, { iv: x.iv, ct: b64decode(x.ct) }));
  await saveDoc(b.key, b.doc);
  Object.assign(S, { keyring: b.keyring, key: b.key, doc: b.doc, view: 'home' });
  S.ui.info = (await getMeta('info')) || {};
  await persist();
  startSession();
  toast(`복원 완료 — 거래 ${b.doc.txs.length}건, 증빙 ${b.files.length}개`);
}

// ═════════ 잠금 ═════════
function renderLock(msg = '') {
  $('#app').innerHTML = h`<div class="gate"><div class="logo"><img src="icons/icon-192.png" alt=""><h1>${APP.name}</h1></div>
  <div class="card"><h3>🔒 잠겨 있습니다</h3>${msg ? h`<p class="muted small">${msg}</p>` : ''}
    <form id="lock-form"><label class="f"><span>비밀번호</span><input type="password" id="lk-pw" autocomplete="current-password" autofocus></label>
    <div class="row" style="margin-top:12px"><button class="btn primary grow" type="submit">열기</button></div></form>
    <p class="small" style="margin-top:12px"><a href="#" data-gate="rcOpen">비밀번호를 잊었어요 → 복구코드로 열기</a></p></div></div>`.s;
  $('#lock-form').addEventListener('submit', (e) => { e.preventDefault(); run(() => unlock($('#lk-pw').value, 'pw')); });
  setTimeout(() => $('#lk-pw')?.focus(), 50);
}
async function unlock(secret, via) {
  const keyring = await getMeta('keyring');
  const key = await unlockKeyring(keyring, secret, via);
  const doc = await loadDoc(key);
  Object.assign(S, { keyring, key, doc, view: 'home' });
  S.ui = { info: (await getMeta('info')) || {} };
  if (via === 'rc') {
    const r = await modal({ title: '새 비밀번호 정하기', body: h`<p>복구코드로 열었습니다. 새 비밀번호를 정하세요.</p><label class="f"><span>새 비밀번호</span><input type="password" name="n1" autocomplete="new-password"></label><label class="f"><span>확인</span><input type="password" name="n2" autocomplete="new-password"></label>`, actions: [{ key: 'ok', label: '저장', cls: 'primary', validate: (v) => checkPassword(v.n1) || (v.n1 !== v.n2 ? '서로 다릅니다' : '') }] });
    S.keyring = await rewrapPassword(keyring, secret, r.values.n1, 'rc');
    await putMeta('keyring', S.keyring);
    appendAudit(S.doc, 'security', '', '복구코드로 열고 비밀번호 재설정');
    await commit();
  }
  startSession();
}
async function rcOpen() {
  const r = await modal({ title: '복구코드로 열기', body: h`<p>설정 때 적어 둔 복구코드(예: ABCD-EFGH-…)를 입력하세요.</p><input type="text" name="rc" autocomplete="off" autocapitalize="characters">`, actions: [{ key: 'cancel', label: '취소' }, { key: 'ok', label: '열기', cls: 'primary' }] });
  if (r.key === 'ok') await unlock(r.values.rc, 'rc');
}
function lockNow(msg) {
  if (!S.key) return;
  revokeAll();
  Object.assign(S, { doc: null, key: null, ui: {} });
  renderLock(typeof msg === 'string' ? msg : '');
}

function startSession() {
  setRegion(S.doc.settings.region || 'KR');
  const t = $('#toast'); if (t) t.hidden = true;
  document.documentElement.dataset.size = S.doc.settings.fontSize || '';
  S.lastActive = Date.now();
  render();
}

// ═════════ 이벤트 (위임) ═════════
async function run(fn) {
  try { await fn(); } catch (e) { console.warn(e); toast(e.message || String(e), true); }
}
const GATE = { setupNext, setupDone, rcOpen, printRc: () => window.print() };
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-gate]');
  if (g) { e.preventDefault(); return run(() => GATE[g.dataset.gate]()); }
  const v = e.target.closest('[data-view]');
  if (v && S.doc) return run(() => ACT.view(v));
  const b = e.target.closest('[data-act]');
  if (!b || !S.doc && b.dataset.act !== 'lockNow') return;
  e.preventDefault();
  const a = b.dataset.act;
  if (a === 'nav') return go(b.dataset.v);
  if (a === 'lockNow') return lockNow('');
  if (ACT[a]) run(() => ACT[a](b, e));
});
document.addEventListener('change', (e) => {
  const el = e.target.closest('[data-change]');
  if (el && S.doc && ACT[el.dataset.change]) run(() => ACT[el.dataset.change](el, e));
});
document.addEventListener('input', (e) => {
  const el = e.target.closest('[data-live]');
  if (el && S.doc && ACT[el.dataset.live]) run(() => ACT[el.dataset.live](el, e));
});
// 입력 중 Ctrl/Cmd+Enter → 미리보기
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    if (e.target.id === 'of-text') run(() => ACT.ofParse());
    if (e.target.id === 'ex-text') run(() => ACT.exParse());
    if (e.target.id === 'ai-text') run(() => ACT.aiParse());
  }
});

// ═════════ 자동 잠금 ═════════
for (const ev of ['pointerdown', 'keydown', 'touchstart']) document.addEventListener(ev, () => { S.lastActive = Date.now(); }, { passive: true });
setInterval(() => {
  if (S.key && S.doc && Date.now() - S.lastActive > (S.doc.settings.autoLockMin || 10) * 60000) lockNow('오래 사용하지 않아 자동으로 잠겼습니다.');
}, 15000);
window.addEventListener('pagehide', () => { if (S.key && S.doc) saveDoc(S.key, S.doc); });

// ═════════ 시작 ═════════
(async () => {
  if (!window.isSecureContext || !crypto?.subtle) {
    $('#app').innerHTML = '<div class="gate"><div class="card bad">이 브라우저(또는 주소)에서는 암호화 기능을 쓸 수 없습니다. https 주소로 열어 주세요.</div></div>';
    return;
  }
  const kr = await getMeta('keyring').catch(() => null);
  if (kr) renderLock(); else renderSetup(1);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
