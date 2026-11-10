// 입력 화면 — 홈 · 헌금 · 지출 · 장부
import { S, h, raw, $, $$, toast, modal, askReason, commit, compressImage, storeAttachment, thumbs, hydrateThumbs, printHtml, today, fileUrl } from './ui.js';
import { won, fmtDate, lastSunday, addDays, esc } from './core/util.js';
import { parseOfferings, parseExpenses, parseKoreanAmount, classifyExpense } from './core/parse.js';
import { addTx, updateTx, deleteTx, isLocked, lockedThrough, liveTxs, METHODS, upsertBatch, cashTotal, BILLS, fyOf, fyRange } from './core/ledger.js';
import { summarize, periodRange } from './core/reports.js';
import { voucherHtml, countSheetHtml } from './core/render.js';
import { accountLabel } from './core/accounts.js';

const acc = (id) => S.doc.accounts.find((a) => a.id === id);
const accName = (id) => acc(id)?.name || '미분류';
const inAccs = () => S.doc.accounts.filter((a) => a.kind === 'in' && a.active !== false);
const outAccs = () => S.doc.accounts.filter((a) => a.kind === 'out' && a.active !== false);
const memberById = (id) => S.doc.members.find((m) => m.id === id);
const history = () => liveTxs(S.doc).filter((t) => t.kind === 'out' && t.accountId).map((t) => ({ memo: t.memo, accountId: t.accountId }));
export const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const iosStandalone = /iP(hone|ad|od)/.test(navigator.userAgent) && (navigator.standalone || matchMedia('(display-mode: standalone)').matches);

export function accOptions(kind, sel, { blank = false } = {}) {
  const list = S.doc.accounts.filter((a) => a.kind === kind && (a.active !== false || a.id === sel));
  const groups = {};
  for (const a of list) (groups[a.gwan] ||= []).push(a);
  return h`${blank ? h`<option value="" ${!sel ? 'selected' : ''}>— 미분류 —</option>` : ''}${Object.entries(groups).map(([g, l]) => h`<optgroup label="${g}">${l.map((a) => h`<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${a.name}${a.fund !== '일반회계' ? ' [' + a.fund + ']' : ''}</option>`)}</optgroup>`)}`;
}
export const methodOptions = (sel) => h`${METHODS.map((m) => h`<option ${m === sel ? 'selected' : ''}>${m}</option>`)}`;
export const membersDatalist = () => h`<datalist id="members-dl">${S.doc.members.filter((m) => m.status !== '중지').map((m) => h`<option value="${m.name} #${m.no}"></option>`)}</datalist>`;
/** "김철수 #12" / "#12" / "12" / "김철수" → {memberId, donor} */
export function resolveDonor(text) {
  const t = String(text || '').trim();
  if (!t) return { memberId: null, donor: '무명' };
  const no = /#\s*(\d{1,4})/.exec(t) || /^(\d{1,4})$/.exec(t);
  if (no) { const m = S.doc.members.find((x) => +x.no === +no[1]); if (m) return { memberId: m.id, donor: m.name }; }
  const hits = S.doc.members.filter((x) => x.name === t);
  if (hits.length === 1) return { memberId: hits[0].id, donor: hits[0].name };
  return { memberId: null, donor: t.replace(/#\s*\d+/, '').trim() || '무명' };
}
const donorLabel = (t) => (t.memberId && memberById(t.memberId) ? `${memberById(t.memberId).name} #${memberById(t.memberId).no}` : t.donor || '');

/** 마감된 날짜면 사유를 한 번 묻는다. 취소하면 null */
async function lockReason(dates) {
  const locked = dates.filter((d) => isLocked(S.doc, d));
  if (!locked.length) return '';
  return askReason(`${lockedThrough(S.doc)}까지 마감된 기간입니다. 그래도 기록하려면 사유를 남기세요(감사 기록).`);
}

// ═════════ 홈 ═════════
export function vHome() {
  const d = S.doc, t = today();
  const w = periodRange('week', t), m = periodRange('month', t);
  const sw = summarize(d, w.from, w.to), sm = summarize(d, m.from, m.to);
  const fy = fyOf(t, d.settings.fyStartMonth);
  const sy = summarize(d, fyRange(fy, d.settings.fyStartMonth).from, t);
  const recent = [...liveTxs(d)].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)).slice(0, 8);
  const rem = [];
  const lb = S.ui.info?.lastBackup;
  if (!lb) rem.push(h`아직 <b>백업</b>을 한 번도 하지 않았습니다. <a href="#" data-act="nav" data-v="settings">설정 › 백업</a>`);
  else if ((Date.now() - new Date(lb)) / 864e5 > 14) rem.push(h`마지막 백업이 ${Math.floor((Date.now() - new Date(lb)) / 864e5)}일 전입니다. <a href="#" data-act="nav" data-v="settings">지금 백업</a>`);
  const pmEnd = addDays(m.from, -1);
  if (liveTxs(d).some((x) => x.date <= pmEnd) && lockedThrough(d) < pmEnd) rem.push(h`지난달(${pmEnd.slice(0, 7)}) 결산이 끝났다면 <b>기간 마감</b>으로 잠가 두세요. <a href="#" data-act="nav" data-v="settings">마감하기</a>`);
  const fyFrom = fyRange(fy, d.settings.fyStartMonth).from;
  if (!Object.keys(d.openings || {}).length && !liveTxs(d).some((x) => x.date < fyFrom)) rem.push(h`처음 쓰는 해라면 <b>전기 이월금(현재 통장 잔액)</b>을 넣어야 잔액이 맞습니다. <a href="#" data-act="nav" data-v="budget">예산 › 전기 이월금</a>`);
  if (!d.budgets[fy]) rem.push(h`${fy}년도 <b>예산</b>이 없습니다. <a href="#" data-act="nav" data-v="budget">예산 편성</a>`);
  if (!d.members.length) rem.push(h`<b>교인 명부</b>를 등록하면 번호만으로 이름 오타 없이 입력되고 주정헌금이 자동으로 채워집니다. <a href="#" data-act="nav" data-v="members">교인 명부</a>`);
  return h`<h2 class="page">${d.settings.churchName} 재정 현황</h2>
  <div class="grid">
    <div class="stat hl"><div class="k">이번 주 헌금</div><div class="v">${won(sw.totals.in)}원</div><div class="s">${fmtDate(w.from)} ~ · ${sw.txs.filter((x) => x.kind === 'in').length}건</div></div>
    <div class="stat"><div class="k">${+m.from.slice(5, 7)}월 수입</div><div class="v">${won(sm.totals.in)}원</div><div class="s">지출 ${won(sm.totals.out)}원</div></div>
    ${Object.entries(sy.byFund).filter(([f, v]) => f === '일반회계' || v.closing || v.in).map(([f, v]) => h`<div class="stat"><div class="k">${f} 잔액</div><div class="v ${v.closing < 0 ? 'bad' : ''}">${won(v.closing)}원</div><div class="s">${fy}년도 이월 ${won(v.opening)}원 포함</div></div>`)}
    <div class="stat"><div class="k">감사 점검(이번 달)</div><div class="v ${sm.flags.some((f) => f.level === 'warn') ? 'warn' : 'ok'}">${sm.flags.length}건</div><div class="s"><a href="#" data-act="nav" data-v="report">보고서에서 보기</a></div></div>
  </div>
  <div class="row" style="margin:14px 0">
    <button class="btn primary" data-act="nav" data-v="offer">✚ 헌금 입력</button>
    <button class="btn primary" data-act="nav" data-v="expense">✚ 지출·영수증</button>
    <button class="btn" data-act="nav" data-v="report">📊 보고서</button>
    <button class="btn" data-act="nav" data-v="ai">🤖 AI 사진 입력</button>
  </div>
  ${rem.length ? h`<div class="card"><h3>할 일</h3><ul>${rem.map((r) => h`<li>${r}</li>`)}</ul></div>` : ''}
  <div class="card"><h3>최근 입력</h3>${recent.length ? txTable(recent, { compact: true }) : h`<p class="muted">아직 입력이 없습니다. 위의 <b>헌금 입력</b>부터 시작하세요.</p>`}</div>`;
}

export function txTable(list, { compact = false } = {}) {
  return h`<div class="tbl-wrap"><table class="list"><thead><tr><th>날짜</th><th>구분</th><th>항목</th><th>이름·내용</th><th class="n">금액</th>${compact ? '' : h`<th>방법</th><th>증빙</th>`}<th></th></tr></thead><tbody>
  ${list.map((t) => h`<tr><td>${t.date.slice(5).replace('-', '/')}${isLocked(S.doc, t.date) ? h` <span class="badge lock" title="마감">🔒</span>` : ''}</td><td><span class="badge ${t.kind}">${t.kind === 'in' ? '수입' : '지출'}</span></td><td>${accName(t.accountId)}</td>
  <td>${t.kind === 'in' ? donorLabel(t) + (t.donor2 ? ' · ' + t.donor2 : '') : (t.payee ? t.payee + ' ' : '') + (t.memo || '')}</td><td class="n">${won(t.amount)}</td>
  ${compact ? '' : h`<td>${t.method}</td><td>${t.attachments?.length ? thumbs(t.attachments) : t.kind === 'out' ? h`<span class="${t.noReceiptReason ? 'muted' : 'warn'} small">${t.noReceiptReason ? '사유' : '없음'}</span>` : ''}</td>`}
  <td><button class="btn sm" data-act="editTx" data-id="${t.id}" aria-label="수정">✎</button></td></tr>`)}</tbody></table></div>`;
}

// ═════════ 헌금 입력 ═════════
function offerState() {
  return (S.ui.offer ||= { date: lastSunday(today()), acc: '101', text: '', items: [] });
}
export function vOffer() {
  const o = offerState();
  const day = liveTxs(S.doc).filter((t) => t.kind === 'in' && t.date === o.date);
  const byType = {};
  for (const t of day) byType[accName(t.accountId)] = (byType[accName(t.accountId)] || 0) + t.amount;
  const batch = S.doc.batches.find((b) => b.date === o.date) || { cash: {}, counters: ['', ''] };
  const cashBook = day.filter((t) => t.method === '현금').reduce((s, t) => s + t.amount, 0);
  const micOk = SR && !iosStandalone;
  return h`<h2 class="page">헌금 입력</h2>
  <div class="card">
    <div class="row">
      <label class="f"><span>날짜</span><input type="date" id="of-date" value="${o.date}" data-change="ofDate"></label>
      <button class="btn sm" data-act="ofSunday">이번 주일</button><button class="btn sm" data-act="ofToday">오늘</button>
      ${isLocked(S.doc, o.date) ? h`<span class="badge lock">🔒 마감된 날짜</span>` : ''}
    </div>
    <p class="small muted" style="margin:10px 0 4px">기본 헌금 종류 (문장에 종류를 말하지 않으면 이것으로)</p>
    ${(() => {
      const use = {}; for (const t of liveTxs(S.doc)) if (t.kind === 'in') use[t.accountId] = (use[t.accountId] || 0) + 1;
      const all = inAccs().filter((a) => a.receipt !== false || use[a.id]);
      const top = [...all].sort((a, b) => (use[b.id] || 0) - (use[a.id] || 0) || (+a.id - +b.id)).slice(0, 6);
      if (!top.some((a) => a.id === o.acc) && acc(o.acc)) top.push(acc(o.acc));
      const rest = inAccs().filter((a) => !top.includes(a));
      return h`<div class="chips">${top.map((a) => h`<button class="chip" aria-pressed="${a.id === o.acc}" data-act="ofAcc" data-id="${a.id}">${a.name}</button>`)}${rest.length ? h`<select class="chip" data-change="ofAccSel" aria-label="다른 헌금 종류"><option value="">다른 종류…</option>${rest.map((a) => h`<option value="${a.id}">${a.name}</option>`)}</select>` : ''}</div>`;
    })()}
    <label class="f" style="margin-top:12px"><span>한 줄에 한 건 — 타이핑·받아쓰기·붙여넣기 모두 가능</span>
    <textarea id="of-text" placeholder="12 십일조 10만&#10;김철수 감사 5만원&#10;3   ← 주일헌금: 번호만 쓰면 주정 금액 자동&#10;김철수 이영희 부부 감사 10만&#10;무명 32만 4천원">${o.text}</textarea></label>
    <div class="row" style="margin-top:8px">
      <button class="btn primary" data-act="ofParse">미리보기 ▶</button>
      ${micOk ? h`<button class="btn" data-act="dictate" data-target="of-text">🎤 말하기</button>` : ''}
      <button class="btn sm" data-act="ofClear">지우기</button>
    </div>
    <p class="hint" style="margin-top:10px">📱 <b>휴대폰</b>: 입력칸을 누르고 키보드의 🎤(마이크)를 눌러 “십일조 김철수 십만 원”처럼 말하세요(삼성 키보드는 한국어를 기기 안에서 처리).<br>🎙 <b>녹음해 둔 파일</b>: 갤럭시 ‘음성 녹음 → 텍스트 변환’, 아이폰 ‘음성 메모 → 전사’로 글로 바꿔 복사해 붙여넣으면 됩니다(AI 비용 0).<br>🔢 교인 명부가 있으면 <b>번호</b>만 써도 이름 오타가 없습니다.</p>
  </div>
  ${o.items.length ? h`<div class="card"><h3>미리보기 — 확인 후 저장</h3>${membersDatalist()}
    <div class="tbl-wrap"><table class="list"><thead><tr><th>종류</th><th>헌금자 (이름 또는 #번호)</th><th>성명2(부부)</th><th class="n">금액</th><th>방법</th><th></th></tr></thead><tbody>
    ${o.items.map((it, i) => h`<tr class="${it.warnings.length ? 'warnrow' : ''}" data-i="${i}">
      <td><select data-f="accountId">${accOptions('in', it.accountId)}</select></td>
      <td><input type="text" data-f="donor" list="members-dl" value="${it.memberId ? donorLabel(it) : it.donor}">${it.auto ? h`<div class="small muted">주정 자동</div>` : ''}${it.warnings.length ? h`<div class="small warn">⚠ ${it.warnings.join(' · ')}</div>` : ''}</td>
      <td><input type="text" data-f="donor2" list="members-dl" value="${it.memberId2 ? donorLabel({ memberId: it.memberId2 }) : it.donor2}"></td>
      <td><input type="text" inputmode="numeric" data-f="amount" value="${it.amount ?? ''}" class="n"></td>
      <td><select data-f="method">${methodOptions(it.method || '현금')}</select></td>
      <td><button class="btn sm danger" data-act="ofDel" data-i="${i}" aria-label="빼기">✕</button></td></tr>`)}
    </tbody><tfoot><tr><td colspan="3">합계 ${o.items.length}건</td><td class="n">${won(o.items.reduce((s, x) => s + (x.amount || 0), 0))}</td><td colspan="2"></td></tr></tfoot></table></div>
    <div class="row" style="margin-top:10px"><button class="btn gold" data-act="ofSave">✔ ${o.items.length}건 저장</button><span class="small muted">금액은 “10만”처럼 써도 됩니다</span></div></div>` : ''}
  <div class="card"><h3>${fmtDate(o.date)} 헌금 기록 · ${day.length}건 · ${won(day.reduce((s, t) => s + t.amount, 0))}원</h3>
    ${Object.keys(byType).length ? h`<p class="small">${Object.entries(byType).map(([k, v]) => h`<span class="badge">${k} ${won(v)}</span> `)}</p>` : ''}
    ${day.length ? txTable(day) : h`<p class="muted">이 날짜의 헌금이 없습니다.</p>`}
  </div>
  <details class="card" ${S.ui.countOpen ? 'open' : ''}><summary>💵 현금 계수표 (2인 확인) — 장부와 자동 대조</summary>
    <div class="tbl-wrap"><table class="list"><thead><tr><th>권종</th><th>매수</th><th class="n">금액</th></tr></thead><tbody>
    ${BILLS.map((b) => h`<tr><td>${won(b)}원</td><td><input type="number" min="0" inputmode="numeric" data-bill="${b}" value="${batch.cash?.[b] || ''}" data-live="countSum"></td><td class="n" data-billsum="${b}">${won(b * (batch.cash?.[b] || 0))}</td></tr>`)}
    </tbody><tfoot><tr><td>현금 합계</td><td></td><td class="n" id="cnt-total">${won(cashTotal(batch.cash))}</td></tr></tfoot></table></div>
    <div class="row"><label class="f grow"><span>계수자 1</span><input type="text" id="cnt-a" value="${batch.counters?.[0] || ''}"></label><label class="f grow"><span>계수자 2</span><input type="text" id="cnt-b" value="${batch.counters?.[1] || ''}"></label></div>
    <p id="cnt-cmp" class="${cashTotal(batch.cash) === cashBook ? 'ok' : 'warn'}">장부의 현금 헌금 ${won(cashBook)}원 — ${cashTotal(batch.cash) === cashBook ? '일치' : '차이 ' + won(cashTotal(batch.cash) - cashBook) + '원'}</p>
    <div class="row"><button class="btn primary" data-act="cntSave">계수 저장</button><button class="btn" data-act="cntPrint">🖨 헌금 집계표 2부 인쇄</button></div>
  </details>`;
}

function readRows(sel) {
  return $$(sel).map((tr) => { const o = { i: +tr.dataset.i }; for (const el of $$('[data-f]', tr)) o[el.dataset.f] = el.value; return o; });
}

// ═════════ 지출 입력 ═════════
function expState() {
  return (S.ui.exp ||= { date: today(), files: [], text: '', items: [], acc: '', accAuto: true });
}
export function vExpense() {
  const e = expState();
  const recent = liveTxs(S.doc).filter((t) => t.kind === 'out').sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 15);
  return h`<h2 class="page">지출 · 영수증</h2>
  <div class="card">
    <div class="row">
      <label class="f"><span>지출일</span><input type="date" id="ex-date" value="${e.date}"></label>
      <label class="f grow"><span>금액</span><input type="text" id="ex-amount" inputmode="numeric" placeholder="23000 또는 2만3천" data-live="exAmount" value="${e.amount || ''}"><small id="ex-amount-v" class="muted"></small></label>
      <label class="f"><span>결제</span><select id="ex-method">${methodOptions(e.method || '카드')}</select></label>
    </div>
    <label class="f" style="margin-top:8px"><span>간단 메모 — 이것만 쓰면 예산 항목이 자동 선택됩니다</span><input type="text" id="ex-memo" placeholder="예: 교회학교 간식 / 봉고차 주유 / 전기요금" data-live="exMemo" value="${e.memo || ''}"></label>
    <div class="row" style="margin-top:8px">
      <label class="f grow"><span>예산 항목 <span id="ex-why" class="small muted"></span></span><select id="ex-acc" data-change="exAccManual">${accOptions('out', e.acc, { blank: true })}</select></label>
      <label class="f grow"><span>지급처 (선택)</span><input type="text" id="ex-payee" placeholder="예: ○○마트" value="${e.payee || ''}"></label>
    </div>
    <p class="small muted" style="margin:12px 0 4px">증빙 (영수증 사진 · 영상 · PDF) — 기기 안에 암호화 보관, 감사 자료로 그대로 출력</p>
    <div class="row">
      <label class="btn">📷 사진 촬영<input type="file" accept="image/*" capture="environment" class="hidden" data-change="exFiles"></label>
      <label class="btn">🎥 영상 촬영<input type="file" accept="video/*" capture="environment" class="hidden" data-change="exFiles"></label>
      <label class="btn">📎 파일 선택<input type="file" accept="image/*,video/*,application/pdf" multiple class="hidden" data-change="exFiles"></label>
    </div>
    <div class="thumbs" id="ex-thumbs" style="margin-top:8px">${e.files.map((f, i) => h`<span class="file" title="${f.name}">${f.mime.startsWith('image/') ? h`<img src="${f.url}" alt="">` : f.mime.startsWith('video/') ? '🎥' : '📄'}<button class="btn sm danger" data-act="exRmFile" data-i="${i}" aria-label="삭제">✕</button></span>`)}</div>
    ${e.files.length ? '' : h`<label class="f" style="margin-top:8px"><span>증빙이 없으면 사유</span><input type="text" id="ex-noreason" placeholder="예: 경조비 현금 전달(수령 확인)" value="${e.noReason || ''}"></label>`}
    <div class="row" style="margin-top:12px"><button class="btn gold" data-act="exSave">✔ 지출 저장</button></div>
  </div>
  <details class="card"><summary>여러 건 한 번에 (붙여넣기·받아쓰기)</summary>
    <textarea id="ex-text" placeholder="11/8 목양실 커피 23,000 카드&#10;교회학교 간식 4만5천&#10;전기요금 152,300 계좌이체">${e.text}</textarea>
    <div class="row" style="margin-top:8px"><button class="btn primary" data-act="exParse">미리보기 ▶</button>${SR && !iosStandalone ? h`<button class="btn" data-act="dictate" data-target="ex-text">🎤 말하기</button>` : ''}</div>
    ${e.items.length ? h`<div class="tbl-wrap" style="margin-top:10px"><table class="list"><thead><tr><th>날짜</th><th>내용</th><th>예산 항목</th><th class="n">금액</th><th>결제</th><th></th></tr></thead><tbody>
      ${e.items.map((it, i) => h`<tr class="ex-row ${it.warnings.length ? 'warnrow' : ''}" data-i="${i}"><td><input type="date" data-f="date" value="${it.date || e.date}"></td><td><input type="text" data-f="memo" value="${it.memo}">${it.warnings.length ? h`<div class="small warn">⚠ ${it.warnings.join(' · ')}</div>` : ''}</td>
      <td><select data-f="accountId">${accOptions('out', it.accountId, { blank: true })}</select><div class="small muted">${it.reason || ''}</div></td><td><input type="text" inputmode="numeric" data-f="amount" value="${it.amount ?? ''}"></td><td><select data-f="method">${methodOptions(it.method || '카드')}</select></td>
      <td><button class="btn sm danger" data-act="exDel" data-i="${i}">✕</button></td></tr>`)}</tbody></table></div>
      <p class="small muted">영수증 사진은 저장 후 <b>장부</b>에서 각 건에 붙일 수 있습니다.</p>
      <button class="btn gold" data-act="exSaveMany">✔ ${e.items.length}건 저장</button>` : ''}
  </details>
  <div class="card"><h3>최근 지출</h3>${recent.length ? txTable(recent) : h`<p class="muted">아직 지출이 없습니다.</p>`}</div>`;
}

function exSuggest() {
  const memo = $('#ex-memo')?.value || '';
  const e = expState();
  if (!e.accAuto) return;
  const c = classifyExpense(memo, S.doc.accounts, history());
  const sel = $('#ex-acc');
  if (sel) sel.value = c.accountId || '';
  const why = $('#ex-why');
  if (why) why.textContent = c.accountId ? `자동: ${accountLabel(acc(c.accountId))} (${c.reason}${c.confidence === 'low' ? ', 확인 필요' : ''})` : memo ? '자동 분류 단서 없음 — 직접 고르세요' : '';
}

function snapshotExpForm() {
  const e = expState();
  e.date = $('#ex-date')?.value || e.date;
  e.amount = $('#ex-amount')?.value || '';
  e.memo = $('#ex-memo')?.value || '';
  e.payee = $('#ex-payee')?.value || '';
  e.method = $('#ex-method')?.value || '카드';
  e.acc = $('#ex-acc')?.value || '';
  e.noReason = $('#ex-noreason')?.value || e.noReason || '';
}

// ═════════ 장부 (조회·수정) ═════════
function ledState() {
  const m = periodRange('month', today());
  return (S.ui.led ||= { from: m.from, to: m.to, kind: '', acc: '', q: '' });
}
export function vLedger() {
  const L = ledState();
  const q = L.q.trim();
  const list = liveTxs(S.doc).filter((t) => t.date >= L.from && t.date <= L.to && (!L.kind || t.kind === L.kind) && (!L.acc || t.accountId === L.acc)
    && (!q || [t.donor, t.donor2, t.memo, t.payee, accName(t.accountId), String(t.amount)].join(' ').includes(q))).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const sIn = list.filter((t) => t.kind === 'in').reduce((s, t) => s + t.amount, 0), sOut = list.filter((t) => t.kind === 'out').reduce((s, t) => s + t.amount, 0);
  return h`<h2 class="page">장부 — 조회·수정</h2>
  <div class="card"><div class="row">
    <label class="f"><span>시작</span><input type="date" id="ld-from" value="${L.from}"></label>
    <label class="f"><span>끝</span><input type="date" id="ld-to" value="${L.to}"></label>
    <label class="f"><span>구분</span><select id="ld-kind"><option value="">전체</option><option value="in" ${L.kind === 'in' ? 'selected' : ''}>수입</option><option value="out" ${L.kind === 'out' ? 'selected' : ''}>지출</option></select></label>
    <label class="f"><span>항목</span><select id="ld-acc"><option value="">전체</option>${accOptions('in', L.acc)}${accOptions('out', L.acc)}</select></label>
    <label class="f grow"><span>검색</span><input type="search" id="ld-q" placeholder="이름·메모·금액" value="${L.q}"></label>
    <button class="btn primary" data-act="ldApply">조회</button>
  </div></div>
  <div class="card"><h3>${list.length}건 · 수입 ${won(sIn)}원 · 지출 ${won(sOut)}원</h3>${list.length ? txTable(list.slice(0, 500)) : h`<p class="muted">조건에 맞는 기록이 없습니다.</p>`}${list.length > 500 ? h`<p class="small muted">앞의 500건만 표시합니다. 기간을 좁히세요.</p>` : ''}</div>`;
}

async function editTx(id) {
  const t = S.doc.txs.find((x) => x.id === id);
  if (!t) return;
  const locked = isLocked(S.doc, t.date);
  const newFiles = [];
  const body = h`${locked ? h`<p class="hint">🔒 마감된 기간입니다. 수정하면 사유가 감사로그에 남습니다.</p>` : ''}
    <div class="row"><label class="f"><span>날짜</span><input type="date" name="date" value="${t.date}"></label>
    <label class="f grow"><span>항목</span><select name="accountId">${accOptions(t.kind, t.accountId, { blank: t.kind === 'out' })}</select></label>
    <label class="f"><span>금액</span><input type="text" inputmode="numeric" name="amount" value="${t.amount}"></label></div>
    ${t.kind === 'in' ? h`${membersDatalist()}<div class="row"><label class="f grow"><span>헌금자</span><input type="text" name="donor" list="members-dl" value="${donorLabel(t)}"></label><label class="f grow"><span>성명2(부부)</span><input type="text" name="donor2" list="members-dl" value="${t.memberId2 ? donorLabel({ memberId: t.memberId2 }) : t.donor2 || ''}"></label></div>`
      : h`<div class="row"><label class="f grow"><span>지급처</span><input type="text" name="payee" value="${t.payee || ''}"></label></div>`}
    <div class="row"><label class="f grow"><span>메모</span><input type="text" name="memo" value="${t.memo || ''}"></label><label class="f"><span>방법</span><select name="method">${methodOptions(t.method)}</select></label></div>
    ${t.kind === 'out' ? h`<p class="small muted">증빙</p><div class="thumbs" id="ed-thumbs">${thumbs(t.attachments)}</div>
      <label class="btn sm" style="margin-top:6px">📎 증빙 추가<input type="file" accept="image/*,video/*,application/pdf" multiple class="hidden" id="ed-files"></label> <span id="ed-new" class="small"></span>
      <label class="f"><span>증빙 없음 사유</span><input type="text" name="noReceiptReason" value="${t.noReceiptReason || ''}"></label>` : ''}
    <label class="f"><span>수정 사유 ${locked ? '(필수)' : '(선택)'}</span><input type="text" name="reason" placeholder="예: 금액 오기 정정"></label>
    <p class="small muted">입력: ${t.source || '직접'} · 등록 ${t.createdAt?.slice(0, 16).replace('T', ' ')} · 수정 ${t.updatedAt?.slice(0, 16).replace('T', ' ')}</p>`;
  const r = await modal({
    title: `${t.kind === 'in' ? '수입' : '지출'} 수정`, body, wide: true,
    actions: [{ key: 'del', label: '삭제', cls: 'danger' }, ...(t.kind === 'out' ? [{ key: 'voucher', label: '🖨 지출결의서' }] : []), { key: 'cancel', label: '닫기' }, { key: 'save', label: '저장', cls: 'primary' }],
    onOpen: (d) => {
      hydrateThumbs(d);
      $('#ed-files', d)?.addEventListener('change', async (ev) => {
        for (const f of ev.target.files) newFiles.push(await compressImage(f));
        $('#ed-new', d).textContent = `새 증빙 ${newFiles.length}개 (저장 시 추가)`;
      });
    },
  });
  if (r.key === 'voucher') return printVoucher(t);
  if (r.key === 'del') {
    const reason = await askReason('삭제 사유를 남기세요. 기록은 감사로그에 보존됩니다.', '삭제 사유');
    if (reason == null) return;
    deleteTx(S.doc, t.id, { reason });
    await commit(); toast('삭제했습니다'); return S.render();
  }
  if (r.key !== 'save') return;
  const v = r.values;
  const amount = parseKoreanAmount(v.amount);
  const patch = { date: v.date, accountId: v.accountId || '', amount, memo: v.memo, method: v.method };
  if (t.kind === 'in') { Object.assign(patch, resolveDonor(v.donor)); const d2 = v.donor2 ? resolveDonor(v.donor2) : { memberId: null, donor: '' }; patch.memberId2 = d2.memberId; patch.donor2 = v.donor2 ? d2.donor : ''; }
  else { patch.payee = v.payee; patch.noReceiptReason = v.noReceiptReason; }
  if (newFiles.length) patch.attachments = [...(t.attachments || []), ...(await Promise.all(newFiles.map(storeAttachment)))];
  let reason = v.reason.trim();
  if ((isLocked(S.doc, t.date) || isLocked(S.doc, v.date)) && !reason) { reason = await askReason('마감된 기간 수정 사유'); if (reason == null) return; }
  updateTx(S.doc, t.id, patch, { reason });
  await commit(); toast('수정했습니다'); S.render();
}

export async function printVoucher(t) {
  const imgs = [];
  for (const a of t.attachments || []) if (a.mime.startsWith('image/')) imgs.push(await fileUrl(a));
  printHtml(voucherHtml(S.doc, t, imgs));
}

async function viewAttachment(att) {
  const u = await fileUrl(att);
  const body = att.mime.startsWith('image/') ? h`<img class="full" src="${u}" alt="영수증">` : att.mime.startsWith('video/') ? h`<video class="full" src="${u}" controls></video>` : h`<p><a href="${u}" download="${att.name}">${att.name} 내려받기</a></p>`;
  await modal({ title: att.name || '증빙', body: h`${body}<p class="small muted">SHA-256 ${att.sha256 || ''}</p>`, wide: true, actions: [{ key: 'ok', label: '닫기' }] });
}

// ═════════ 받아쓰기 (PC 크롬 등 지원 브라우저 한정, 선택) ═════════
let rec = null;
async function dictate(btn) {
  const ta = document.getElementById(btn.dataset.target);
  if (rec) { rec.stop(); return; }
  if (!S.doc.settings.speechConsent) {
    const r = await modal({ title: '브라우저 음성 입력', body: h`<p>브라우저 음성 인식은 소리를 <b>브라우저 회사 서버(예: 구글)</b>로 보내 글자로 바꿀 수 있습니다. 헌금자 이름이 서버를 거치는 것이 싫다면, 대신 <b>휴대폰 키보드의 🎤</b>나 <b>Windows+H 받아쓰기</b>를 쓰세요.</p>`, actions: [{ key: 'cancel', label: '취소' }, { key: 'ok', label: '이해했고 사용', cls: 'primary' }] });
    if (r.key !== 'ok') return;
    S.doc.settings.speechConsent = true; commit();
  }
  rec = new SR();
  rec.lang = 'ko-KR'; rec.continuous = true; rec.interimResults = false;
  rec.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) {
      ta.value += (ta.value && !ta.value.endsWith('\n') ? '\n' : '') + e.results[i][0].transcript.trim();
    }
  };
  rec.onerror = (e) => toast('음성 인식 오류: ' + e.error, true);
  rec.onend = () => { rec = null; btn.textContent = '🎤 말하기'; };
  rec.start();
  btn.textContent = '■ 멈추기';
  toast('말씀하세요. 한 건 말하고 잠깐 쉬면 줄이 바뀝니다.');
}

// ═════════ 동작 ═════════
export const actions = {
  ofSunday() { offerState().date = lastSunday(today()); S.render(); },
  ofToday() { offerState().date = today(); S.render(); },
  ofDate(el) { offerState().date = el.value || today(); offerState().items = []; S.render(); },
  ofAcc(b) { const o = offerState(); o.text = $('#of-text').value; o.acc = b.dataset.id; S.render(); },
  ofAccSel(el) { if (!el.value) return; const o = offerState(); o.text = $('#of-text').value; o.acc = el.value; S.render(); },
  ofClear() { const o = offerState(); o.text = ''; o.items = []; S.render(); },
  ofParse() {
    const o = offerState();
    o.text = $('#of-text').value;
    o.items = parseOfferings(o.text, { accounts: S.doc.accounts, members: S.doc.members, defaultAccountId: o.acc, date: o.date });
    if (!o.items.length) toast('읽을 수 있는 항목이 없습니다. 예: “12 십일조 10만”', true);
    S.render();
  },
  ofDel(b) { const o = offerState(); syncOfferRows(); o.items.splice(+b.dataset.i, 1); S.render(); },
  async ofSave() {
    const o = offerState();
    syncOfferRows();
    const bad = o.items.filter((x) => !x.amount || x.amount <= 0 || !x.accountId);
    if (bad.length) return toast(`금액·종류가 빠진 줄이 ${bad.length}개 있습니다`, true);
    const reason = await lockReason(o.items.map((x) => x.date || o.date));
    if (reason == null) return;
    let n = 0;
    for (const it of o.items) {
      addTx(S.doc, { date: it.date || o.date, kind: 'in', accountId: it.accountId, amount: it.amount, memberId: it.memberId, donor: it.donor, memberId2: it.memberId2, donor2: it.donor2, method: it.method || '현금', memo: it.memo || '', source: it.source || '빠른입력' }, { reason });
      n++;
    }
    await commit();
    o.items = []; o.text = '';
    toast(`${n}건 저장했습니다`);
    S.render();
  },
  countSum() {
    let total = 0;
    for (const el of $$('[data-bill]')) { const b = +el.dataset.bill, c = parseInt(el.value, 10) || 0; total += b * c; $(`[data-billsum="${b}"]`).textContent = won(b * c); }
    $('#cnt-total').textContent = won(total);
    S.ui.countOpen = true;
  },
  async cntSave() {
    const o = offerState();
    const cash = {}; for (const el of $$('[data-bill]')) if (+el.value) cash[el.dataset.bill] = +el.value;
    const ex = S.doc.batches.find((b) => b.date === o.date);
    const b = upsertBatch(S.doc, { id: ex?.id, date: o.date, cash, counters: [$('#cnt-a').value, $('#cnt-b').value] });
    await commit(); S.ui.countOpen = true;
    const book = liveTxs(S.doc).filter((t) => t.kind === 'in' && t.date === o.date && t.method === '현금').reduce((s, t) => s + t.amount, 0);
    toast(b.cashTotal === book ? '계수 저장 — 장부와 일치합니다' : `계수 저장 — 장부와 ${won(b.cashTotal - book)}원 차이`, b.cashTotal !== book);
    S.render();
  },
  cntPrint() {
    const o = offerState();
    const b = S.doc.batches.find((x) => x.date === o.date) || { date: o.date, cash: {}, cashTotal: 0, counters: [] };
    printHtml(countSheetHtml(S.doc, b, liveTxs(S.doc).filter((t) => t.kind === 'in' && t.date === o.date)));
  },
  dictate,
  exAmount(el) { const v = parseKoreanAmount(el.value); $('#ex-amount-v').textContent = el.value ? (v ? `= ${won(v)}원` : '금액을 읽을 수 없음') : ''; },
  exMemo() { exSuggest(); },
  exAccManual(el) { expState().accAuto = !el.value; },
  async exFiles(el) {
    snapshotExpForm();
    const e = expState();
    for (const f of el.files) {
      if (f.size > 60 * 1024 * 1024) { toast(`${f.name}: 60MB 초과 — 짧게 다시 촬영하세요`, true); continue; }
      const c = await compressImage(f);
      c.url = URL.createObjectURL(new Blob([c.bytes], { type: c.mime }));
      e.files.push(c);
    }
    S.render();
  },
  exRmFile(b) { snapshotExpForm(); const e = expState(); const [f] = e.files.splice(+b.dataset.i, 1); if (f?.url) URL.revokeObjectURL(f.url); S.render(); },
  async exSave() {
    snapshotExpForm();
    const e = expState();
    const amount = parseKoreanAmount(e.amount);
    if (!amount) return toast('금액을 입력하세요', true);
    if (!e.memo.trim()) return toast('간단 메모를 입력하세요 (예: 교회학교 간식)', true);
    if (!e.files.length && !e.noReason.trim()) {
      const r = await modal({ title: '증빙 없음', body: h`<p>영수증 사진이 없습니다. 감사 때 필요하니 사유를 남겨 주세요.</p><input type="text" name="why" placeholder="예: 경조비 현금 전달">`, actions: [{ key: 'cancel', label: '사진 찍으러 가기' }, { key: 'ok', label: '사유 남기고 저장', cls: 'primary', validate: (v) => (v.why.trim() ? '' : '사유를 입력하세요') }] });
      if (r.key !== 'ok') return;
      e.noReason = r.values.why.trim();
    }
    const reason = await lockReason([e.date]);
    if (reason == null) return;
    const atts = [];
    for (const f of e.files) atts.push(await storeAttachment(f));
    addTx(S.doc, { date: e.date, kind: 'out', accountId: e.acc || '', amount, memo: e.memo.trim(), payee: e.payee.trim(), method: e.method, attachments: atts, noReceiptReason: e.files.length ? '' : e.noReason.trim(), source: atts.length ? '영수증' : '직접' }, { reason });
    await commit();
    for (const f of e.files) if (f.url) URL.revokeObjectURL(f.url);
    S.ui.exp = { date: e.date, files: [], text: e.text, items: e.items, acc: '', accAuto: true, method: e.method };
    toast(`지출 ${won(amount)}원 저장 — ${accName(e.acc)}`);
    S.render();
  },
  exParse() {
    snapshotExpForm();
    const e = expState();
    e.text = $('#ex-text').value;
    e.items = parseExpenses(e.text, { accounts: S.doc.accounts, history: history(), date: e.date });
    if (!e.items.length) toast('읽을 수 있는 줄이 없습니다', true);
    S.render();
    $('details.card')?.setAttribute('open', '');
  },
  exDel(b) { snapshotExpForm(); syncExpRows(); expState().items.splice(+b.dataset.i, 1); S.render(); $('details.card')?.setAttribute('open', ''); },
  async exSaveMany() {
    snapshotExpForm();
    syncExpRows();
    const e = expState();
    if (e.items.some((x) => !x.amount)) return toast('금액이 빠진 줄이 있습니다', true);
    const reason = await lockReason(e.items.map((x) => x.date || e.date));
    if (reason == null) return;
    for (const it of e.items) addTx(S.doc, { date: it.date || e.date, kind: 'out', accountId: it.accountId || '', amount: it.amount, memo: it.memo, method: it.method, source: it.source || '빠른입력' }, { reason });
    await commit();
    toast(`${e.items.length}건 저장했습니다`);
    e.items = []; e.text = '';
    S.render();
  },
  ldApply() {
    const L = ledState();
    Object.assign(L, { from: $('#ld-from').value, to: $('#ld-to').value, kind: $('#ld-kind').value, acc: $('#ld-acc').value, q: $('#ld-q').value });
    S.render();
  },
  editTx(b) { return editTx(b.dataset.id); },
  view(el) { return viewAttachment(JSON.parse(el.dataset.view)); },
};

function syncOfferRows() {
  const o = offerState();
  for (const r of readRows('tr[data-i]')) {
    const it = o.items[r.i];
    if (!it || r.accountId === undefined) continue;
    it.accountId = r.accountId;
    const d1 = resolveDonor(r.donor); it.memberId = d1.memberId; it.donor = d1.donor;
    if (r.donor2?.trim()) { const d2 = resolveDonor(r.donor2); it.memberId2 = d2.memberId; it.donor2 = d2.donor; } else { it.memberId2 = null; it.donor2 = ''; }
    it.amount = parseKoreanAmount(r.amount);
    it.method = r.method;
  }
}
function syncExpRows() {
  const e = expState();
  for (const r of readRows('tr.ex-row')) {
    const it = e.items[r.i];
    if (!it) continue;
    Object.assign(it, { date: r.date, memo: r.memo, accountId: r.accountId, amount: parseKoreanAmount(r.amount), method: r.method });
  }
}

export const views = { home: vHome, offer: vOffer, expense: vExpense, ledger: vLedger };
export { esc };
