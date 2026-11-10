// 관리 화면 — 보고서 · 교인 · 기부금영수증 · 예산 · AI 도우미 · 설정
import { S, h, raw, $, $$, toast, modal, askReason, confirmBox, commit, printHtml, download, shareOrDownload, copyText, today, hydrateThumbs, storeAttachment, revokeAll } from './ui.js';
import { won, fmtDate, maskRrn, todayLocal, b64encode, b64decode, esc as esc2, sha256Bytes as sha256Hex2 } from './core/util.js';
import { parseTable, parseKoreanAmount } from './core/parse.js';
import { liveTxs, upsertMember, nextMemberNo, upsertAccount, setBudget, setOpening, lockPeriod, lockedThrough, verifyAudit, fyOf, fyRange, funds, addBankCheck, mergeDocs, addTx } from './core/ledger.js';
import { summarize, periodRange, donorTotals, issueReceipt, receiptYearTotal, openingOf } from './core/reports.js';
import { financeReportHtml, voucherHtml, receiptHtml } from './core/render.js';
import { setupPrompt, oneShotPrompt, parseBridge, QUICK_PROMPTS } from './core/bridge.js';
import { makeZip, makeXlsx, toCsv } from './core/zip.js';
import { nextAccountId } from './core/accounts.js';
import { rewrapPassword, checkPassword, unlockKeyring, decryptJson, decryptBytes } from './core/crypto.js';
import { putMeta, getMeta, getFileBox, getFileBytes, putFile, listFileIds, wipeAll, usage, persist } from './store.js';
import { accOptions, methodOptions, membersDatalist, resolveDonor } from './views-input.js';
import { APP, SUPPORT } from './config.js';

const accName = (id) => S.doc.accounts.find((a) => a.id === id)?.name || '미분류';
const accOf = (id) => S.doc.accounts.find((a) => a.id === id);

// ═════════ 보고서 ═════════
const PRESETS = [['week', '주간'], ['month', '월간'], ['prevmonth', '지난달'], ['quarter', '분기'], ['half', '반기'], ['fy', '연간 결산'], ['ytd', '연 누계'], ['custom', '기간 지정']];
const TITLES = { week: '주간 재정 보고', month: '월간 재정 보고', prevmonth: '월간 재정 보고', quarter: '분기 재정 보고', half: '반기 재정 보고', fy: '연간 결산 보고', ytd: '재정 누계 보고', custom: '재정 보고' };
function repState() { return (S.ui.rep ||= { preset: 'month', ref: today(), from: '', to: '' }); }
function repRange() {
  const r = repState();
  if (r.preset === 'custom') return { from: r.from || today(), to: r.to || today(), label: '' };
  return periodRange(r.preset, r.ref, S.doc.settings.fyStartMonth);
}
export function vReport() {
  const r = repState();
  const p = repRange();
  const s = summarize(S.doc, p.from, p.to);
  const title = `${TITLES[r.preset]}${p.label ? ' (' + p.label + ')' : ''}`;
  S.ui.lastReport = { s, title };
  return h`<h2 class="page">보고서 · 결산</h2>
  <div class="card">
    <div class="chips">${PRESETS.map(([k, l]) => h`<button class="chip" aria-pressed="${k === r.preset}" data-act="repPreset" data-k="${k}">${l}</button>`)}</div>
    <div class="row" style="margin-top:10px">
      ${r.preset === 'custom' ? h`<label class="f"><span>시작</span><input type="date" id="rp-from" value="${p.from}"></label><label class="f"><span>끝</span><input type="date" id="rp-to" value="${p.to}"></label>`
        : h`<label class="f"><span>기준일</span><input type="date" id="rp-ref" value="${r.ref}"></label>`}
      <button class="btn" data-act="repApply">적용</button>
    </div>
    <p class="small muted">${fmtDate(p.from)} ~ ${fmtDate(p.to)} · 계산은 기기 안에서 즉시(AI·인터넷 불필요)</p>
  </div>
  <div class="grid">
    <div class="stat"><div class="k">전기 이월</div><div class="v">${won(s.totals.opening)}</div></div>
    <div class="stat"><div class="k">수입</div><div class="v ok">${won(s.totals.in)}</div></div>
    <div class="stat"><div class="k">지출</div><div class="v bad">${won(s.totals.out)}</div></div>
    <div class="stat hl"><div class="k">차기 이월(잔액)</div><div class="v">${won(s.totals.closing)}</div></div>
  </div>
  <div class="row" style="margin:12px 0">
    <button class="btn primary" data-act="repPrint">🖨 인쇄 · PDF 저장</button>
    <button class="btn" data-act="repXlsx">📗 엑셀</button>
    <button class="btn" data-act="repCsv">CSV</button>
    <button class="btn gold" data-act="repZip">🗂 감사 자료 묶음(ZIP)</button>
    <button class="btn" data-act="repVouchers">🧾 지출결의서 일괄 인쇄</button>
    <button class="btn" data-act="bankCheck">🏦 통장 잔액 대조</button>
  </div>
  ${s.flags.length ? h`<details class="card"><summary>⚠ 자동 감사 점검 ${s.flags.length}건</summary><ul>${s.flags.map((f) => h`<li class="${f.level === 'warn' ? 'warn' : 'muted'}">${f.msg}${f.txId ? h` <button class="btn sm" data-act="editTx" data-id="${f.txId}">확인</button>` : ''}</li>`)}</ul></details>` : h`<p class="ok">✔ 자동 감사 점검: 지적 사항 없음</p>`}
  <div class="preview-doc">${raw(financeReportHtml(S.doc, s, { title }))}</div>`;
}

function txRows(list) {
  return [['일자', '구분', '관', '항', '회계', '헌금자', '성명2', '지급처', '메모', '금액', '방법', '증빙수', '증빙없음사유', '입력', 'ID'],
    ...list.map((t) => { const a = accOf(t.accountId); return [t.date, t.kind === 'in' ? '수입' : '지출', a?.gwan || '미분류', a?.name || '미분류', a?.fund || '일반회계', t.donor || '', t.donor2 || '', t.payee || '', t.memo || '', t.amount, t.method || '', t.attachments?.length || 0, t.noReceiptReason || '', t.source || '', t.id]; })];
}
function reportSheets(s) {
  return [
    { name: '거래내역', rows: txRows(s.txs) },
    { name: '항목별', rows: [['구분', '관', '항', '회계', '이번기간', '연예산', '연누계', '집행률%'], ...s.rows.filter((r) => r.period || r.budget || r.ytd).map((r) => [r.kind === 'in' ? '수입' : '지출', r.gwan, r.name, r.fund, r.period, r.budget, r.ytd, r.rate ?? ''])] },
    { name: '회계별', rows: [['회계', '전기이월', '수입', '지출', '차기이월'], ...Object.entries(s.byFund).map(([f, v]) => [f, v.opening, v.in, v.out, v.closing])] },
    { name: '주일별헌금', rows: [['주일', ...s.weekly.cols.map((c) => c.name), '계'], ...s.weekly.weeks.map((w) => [w.week, ...s.weekly.cols.map((c) => w.cells[c.id] || 0), w.total])] },
  ];
}
const stamp = () => todayLocal();
async function auditZip() {
  const { s, title } = S.ui.lastReport;
  toast('감사 자료를 만드는 중…');
  const files = [];
  const css = await fetch('styles.css').then((r) => r.text()).catch(() => '');
  const vouchers = [];
  for (const t of s.txs.filter((x) => x.kind === 'out')) {
    const imgs = [];
    for (const a of t.attachments || []) {
      const bytes = await getFileBytes(S.key, a.id);
      if (!bytes) continue;
      const ext = (a.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
      const name = `증빙/${t.date}_${t.amount}원_${accName(t.accountId).replace(/[\\/:*?"<>|·\s]/g, '')}_${t.id.slice(0, 8)}_${a.id.slice(0, 4)}.${ext}`;
      files.push({ name, data: bytes });
      if (a.mime.startsWith('image/')) imgs.push(name);
    }
    vouchers.push(voucherHtml(S.doc, t, imgs));
  }
  const page = (body, ttl) => `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${ttl}</title><style>${css}\nbody{background:#fff;color:#111}#printArea{display:block}.doc{margin:0 auto 24px;max-width:900px}</style></head><body>${body}</body></html>`;
  files.push({ name: '1_재정보고서.html', data: page(financeReportHtml(S.doc, s, { title }), title) });
  files.push({ name: '2_지출결의서.html', data: page(vouchers.join('<div class="page-break"></div>'), '지출결의서') });
  files.push({ name: '3_거래내역.xlsx', data: makeXlsx(reportSheets(s)) });
  files.push({ name: '3_거래내역.csv', data: toCsv(txRows(s.txs)) });
  const v = verifyAudit(S.doc);
  files.push({ name: '4_감사로그.csv', data: toCsv([['시각', '기기', '순번', '동작', '내용', '사유', '해시', '이전해시'], ...S.doc.audit.map((e) => [e.ts, e.dev.slice(0, 8), e.seq, e.act, e.summary, e.reason, e.hash, e.prev])]) });
  const manifest = files.map((f) => `${sha256Bytes(f.data)}  ${f.name}`).join('\n');
  files.push({ name: '5_무결성확인.txt', data: `${S.doc.settings.churchName} 감사 자료\n기간: ${s.from} ~ ${s.to}\n생성: ${new Date().toISOString()} (${APP.name} ${APP.version})\n감사로그 무결성: ${v.ok ? '정상' : '문제 ' + v.problems.length + '건'} (기록 ${v.count}건, 해시 체인 검증)\n\n아래 SHA-256 값으로 파일이 바뀌지 않았음을 확인할 수 있습니다.\n${manifest}\n` });
  const zip = makeZip(files);
  await shareOrDownload(`감사자료_${S.doc.settings.churchName}_${s.from}_${s.to}.zip`, zip, 'application/zip');
  toast(`감사 자료 ${files.length}개 파일을 묶었습니다`);
}
function sha256Bytes(d) { return sha256Hex2(typeof d === 'string' ? new TextEncoder().encode(d) : d); }

// ═════════ 교인 명부 ═════════
export function vMembers() {
  const q = (S.ui.memQ || '').trim();
  const list = S.doc.members.filter((m) => !q || `${m.no} ${m.name} ${m.phone || ''}`.includes(q)).sort((a, b) => a.no - b.no);
  return h`<h2 class="page">교인 명부</h2>
  <div class="card"><div class="row">
    <label class="f grow"><span>찾기</span><input type="search" id="mem-q" value="${q}" placeholder="번호·이름·연락처" data-live="memSearch"></label>
    <button class="btn primary" data-act="memEdit">+ 교인 추가</button>
    <button class="btn" data-act="memImport">📋 엑셀 붙여넣기·CSV 가져오기</button>
    <button class="btn" data-act="memTemplate">양식 내려받기</button>
    <button class="btn" data-act="memExport">명부 엑셀</button>
  </div>
  <p class="small muted">주민등록번호는 <b>기부금영수증을 원하는 분만</b> 입력하세요. 기기 안에서 암호화되고 화면에는 가려져 보입니다. 중지된 교인은 지우지 말고 상태를 ‘중지’로 두세요(번호 재사용 방지).</p></div>
  <div class="card"><h3>${S.doc.members.length}명 (사용 ${S.doc.members.filter((m) => m.status !== '중지').length} · 주정 합계 ${won(S.doc.members.filter((m) => m.status !== '중지').reduce((s, m) => s + (m.weekly || 0), 0))}원)</h3>
  <div class="tbl-wrap"><table class="list"><thead><tr><th>번호</th><th>이름</th><th class="n">주정(매주)</th><th>연락처</th><th>주민번호</th><th>가족</th><th>상태</th><th></th></tr></thead><tbody>
  ${list.map((m) => h`<tr><td>${m.no}</td><td>${m.name}</td><td class="n">${m.weekly ? won(m.weekly) : ''}</td><td>${m.phone || ''}</td><td>${m.rrn ? maskRrn(m.rrn) : ''}</td><td>${m.familyId || ''}</td><td>${m.status || '사용'}</td><td><button class="btn sm" data-act="memEdit" data-id="${m.id}">✎</button></td></tr>`)}
  </tbody></table></div></div>`;
}
async function memEdit(id) {
  const m = S.doc.members.find((x) => x.id === id) || { no: nextMemberNo(S.doc), status: '사용' };
  const r = await modal({
    title: id ? `교인 ${m.no} 수정` : '교인 추가',
    body: h`<div class="row"><label class="f"><span>번호</span><input type="number" name="no" value="${m.no}"></label><label class="f grow"><span>이름</span><input type="text" name="name" value="${m.name || ''}"></label><label class="f"><span>주정(매주 금액)</span><input type="text" inputmode="numeric" name="weekly" value="${m.weekly || ''}"></label></div>
    <div class="row"><label class="f grow"><span>연락처</span><input type="tel" name="phone" value="${m.phone || ''}"></label><label class="f grow"><span>가족 ID (부부·가족 묶음)</span><input type="text" name="familyId" value="${m.familyId || ''}" placeholder="예: F01"></label><label class="f"><span>상태</span><select name="status"><option ${m.status !== '중지' ? 'selected' : ''}>사용</option><option ${m.status === '중지' ? 'selected' : ''}>중지</option></select></label></div>
    <label class="f"><span>주소 (기부금영수증용)</span><input type="text" name="address" value="${m.address || ''}"></label>
    <label class="f"><span>주민등록번호 (영수증 희망자만 · 암호화) ${m.rrn ? '— 현재 ' + maskRrn(m.rrn) + ', 바꿀 때만 입력' : ''}</span><input type="text" name="rrn" inputmode="numeric" autocomplete="off" placeholder="000000-0000000"></label>
    <label class="f"><span>메모</span><input type="text" name="note" value="${m.note || ''}"></label>`,
    actions: [{ key: 'cancel', label: '취소' }, { key: 'ok', label: '저장', cls: 'primary', validate: (v) => (!v.name.trim() ? '이름을 입력하세요' : v.rrn && v.rrn.replace(/\D/g, '').length !== 13 ? '주민등록번호는 13자리' : '') }],
  });
  if (r.key !== 'ok') return;
  const v = { ...r.values, id: id || undefined };
  if (!v.rrn) delete v.rrn;
  upsertMember(S.doc, v);
  await commit(); toast('저장했습니다'); S.render();
}
const COLS = [['', '사용 안 함'], ['no', '번호'], ['name', '이름'], ['weekly', '주정'], ['phone', '연락처'], ['rrn', '주민번호'], ['address', '주소'], ['familyId', '가족'], ['note', '메모']];
function guessCol(hd) {
  const t = String(hd).replace(/\s/g, '');
  if (/번호|no/i.test(t) && !/주민|전화|연락/.test(t)) return 'no';
  if (/이름|성명/.test(t)) return 'name';
  if (/주정|매주|금액/.test(t)) return 'weekly';
  if (/연락|전화|휴대/.test(t)) return 'phone';
  if (/주민/.test(t)) return 'rrn';
  if (/주소/.test(t)) return 'address';
  if (/가족/.test(t)) return 'familyId';
  if (/메모|비고/.test(t)) return 'note';
  return '';
}
async function memImport() {
  const r1 = await modal({
    title: '교인 여러 명 가져오기', wide: true,
    body: h`<p class="small">엑셀에서 표를 드래그해 복사(Ctrl+C)한 뒤 아래에 붙여넣거나(Ctrl+V), CSV 파일을 고르세요. 첫 줄이 제목이면 자동으로 알아봅니다.</p>
      <textarea name="text" placeholder="1	김철수	20000	010-0000-0011&#10;2	이영희	15000	010-0000-0012"></textarea>
      <label class="btn sm" style="margin-top:6px">CSV 파일 고르기<input type="file" name="file" accept=".csv,text/csv,text/plain" class="hidden"></label>`,
    actions: [{ key: 'cancel', label: '취소' }, { key: 'ok', label: '다음 ▶', cls: 'primary' }],
  });
  if (r1.key !== 'ok') return;
  let text = r1.values.text;
  if (r1.values.file?.length) text = await r1.values.file[0].text();
  const rows = parseTable(text);
  if (!rows.length) return toast('붙여넣은 내용이 없습니다', true);
  const header = rows[0].some((c) => guessCol(c) && !/^\d+$/.test(c));
  const ncol = Math.max(...rows.map((r) => r.length));
  const guess = header ? rows[0].map(guessCol) : ['no', 'name', 'weekly', 'phone', 'address'].slice(0, ncol);
  const data = header ? rows.slice(1) : rows;
  const r2 = await modal({
    title: `열 맞추기 — ${data.length}명`, wide: true,
    body: h`<div class="tbl-wrap"><table class="list"><thead><tr>${Array.from({ length: ncol }, (_, i) => h`<th><select name="c${i}">${COLS.map(([k, l]) => h`<option value="${k}" ${guess[i] === k ? 'selected' : ''}>${l}</option>`)}</select></th>`)}</tr></thead>
      <tbody>${data.slice(0, 8).map((r) => h`<tr>${Array.from({ length: ncol }, (_, i) => h`<td>${r[i] || ''}</td>`)}</tr>`)}</tbody></table></div>${data.length > 8 ? h`<p class="small muted">…외 ${data.length - 8}명</p>` : ''}
      <label class="row small"><input type="checkbox" name="renumber"> 번호를 새로 매기기 (현재 마지막 번호 다음부터)</label>`,
    actions: [{ key: 'cancel', label: '취소' }, { key: 'ok', label: '가져오기', cls: 'primary' }],
  });
  if (r2.key !== 'ok') return;
  const map = Array.from({ length: ncol }, (_, i) => r2.values['c' + i]);
  let ok = 0; const errs = [];
  for (const [ri, r] of data.entries()) {
    const m = {};
    map.forEach((k, i) => { if (k && r[i] !== undefined && r[i] !== '') m[k] = r[i]; });
    if (r2.values.renumber) delete m.no;
    if (!m.name) continue;
    const ex = m.no ? S.doc.members.find((x) => x.no === +m.no) : null;
    try { upsertMember(S.doc, { ...m, id: ex && ex.name === m.name ? ex.id : undefined }); ok++; } catch (e) { errs.push(`${ri + 1}행 ${m.name}: ${e.message}`); }
  }
  await commit();
  toast(`${ok}명 가져왔습니다${errs.length ? ` · 오류 ${errs.length}건` : ''}`, !!errs.length);
  if (errs.length) await modal({ title: '가져오지 못한 행', body: h`<ul>${errs.slice(0, 50).map((e) => h`<li>${e}</li>`)}</ul>` });
  S.render();
}

// ═════════ 기부금영수증 ═════════
export function vReceipts() {
  const y = S.ui.rcYear || (new Date().getMonth() < 2 ? new Date().getFullYear() - 1 : new Date().getFullYear());
  const list = donorTotals(S.doc, y);
  const issued = S.doc.receipts.filter((r) => r.year === y);
  const active = (key) => issued.find((r) => r.donorKey === key && !r.voided);
  const total = receiptYearTotal(S.doc, y);
  const st = S.doc.settings;
  return h`<h2 class="page">기부금영수증</h2>
  <div class="card"><div class="row"><label class="f"><span>귀속 연도 (1~12월)</span><select id="rc-year" data-change="rcYear">${[0, 1, 2, 3].map((k) => new Date().getFullYear() - k).map((v) => h`<option ${v === y ? 'selected' : ''}>${v}</option>`)}</select></label>
  <button class="btn primary" data-act="rcAll">전체 발급·인쇄 (${list.length}명)</button><button class="btn" data-act="rcLedger">발급명세 대장(엑셀)</button></div>
  ${!st.bizNo || !st.address || !st.rep ? h`<p class="hint">⚠ 설정에서 <b>고유번호·소재지·대표자</b>를 먼저 입력하세요(영수증에 인쇄됨). <a href="#" data-act="nav" data-v="settings">설정</a></p>` : ''}
  <p class="small muted">일련번호는 연도별로 중복 없이 매겨지고, 재발급하면 이전 번호는 무효 처리되어 대장에 남습니다. 발급명세는 5년 보관 대상입니다. 이자·잡수입 등 헌금이 아닌 항목은 자동 제외됩니다.${total >= 3e8 ? h` <b class="bad">연 발급 합계가 3억 원 이상입니다 — 홈택스 전자기부금영수증 발급 의무 대상인지 확인하세요.</b>` : ''}</p></div>
  <div class="card"><div class="tbl-wrap"><table class="list"><thead><tr><th>번호</th><th>이름</th><th class="n">${y}년 합계</th><th>주민번호</th><th>발급</th><th></th></tr></thead><tbody>
  ${list.map((d) => { const a = active(d.key); return h`<tr><td>${d.member?.no || '-'}</td><td>${d.name}</td><td class="n">${won(d.total)}</td><td>${d.member?.rrn ? '✔' : h`<span class="warn small">없음</span>`}</td><td>${a ? h`<span class="badge">${a.serial}</span>` : ''}</td>
    <td><button class="btn sm" data-act="rcIssue" data-key="${d.key}">${a ? '재발급' : '발급'}·인쇄</button>${a ? h` <button class="btn sm" data-act="rcPrint" data-id="${a.id}">다시 인쇄</button>` : ''}</td></tr>`; })}
  </tbody></table></div>${list.length ? '' : h`<p class="muted">${y}년에 이름이 있는 헌금 기록이 없습니다.</p>`}</div>`;
}
function printReceipts(rs) {
  printHtml(rs.map((r) => receiptHtml(S.doc, r, S.doc.members.find((m) => m.id === r.memberId))).join('<div class="page-break"></div>'));
}

// ═════════ 예산 ═════════
export function vBudget() {
  const d = S.doc, sm = d.settings.fyStartMonth;
  const fy = S.ui.budFy || fyOf(today(), sm);
  const prev = d.budgets[fy - 1]?.items || {};
  const b = d.budgets[fy] || { status: '없음', items: {} };
  const R = fyRange(fy, sm), PR = fyRange(fy - 1, sm);
  const act = {}, pact = {};
  for (const t of liveTxs(d)) {
    if (t.date >= R.from && t.date <= R.to) act[t.accountId] = (act[t.accountId] || 0) + t.amount;
    if (t.date >= PR.from && t.date <= PR.to) pact[t.accountId] = (pact[t.accountId] || 0) + t.amount;
  }
  const lockedB = b.status === '확정';
  const section = (kind) => {
    const list = d.accounts.filter((a) => a.kind === kind && (a.active !== false || b.items[a.id]));
    const tot = list.reduce((s, a) => s + (b.items[a.id] || 0), 0);
    return h`<h3>${kind === 'in' ? '수입' : '지출'} 예산 — 합계 ${won(tot)}원</h3><div class="tbl-wrap"><table class="list"><thead><tr><th>관</th><th>항</th><th class="n">작년 예산</th><th class="n">작년 결산</th><th class="n">올해 예산</th><th class="n">증감</th><th class="n">올해 집행</th><th>집행률</th></tr></thead><tbody>
    ${list.map((a) => { const bv = b.items[a.id] || 0, av = act[a.id] || 0; return h`<tr><td>${a.gwan}</td><td>${a.name}</td><td class="n">${won(prev[a.id] || 0)}</td><td class="n">${won(pact[a.id] || 0)}</td>
      <td><input type="text" inputmode="numeric" class="n" data-bud="${a.id}" value="${bv || ''}" ${lockedB ? 'disabled' : ''}></td><td class="n">${won(bv - (prev[a.id] || 0))}</td><td class="n">${won(av)}</td><td>${bv ? h`<progress max="100" value="${Math.min(100, (av / bv) * 100)}"></progress><span class="small">${Math.round((av / bv) * 1000) / 10}%</span>` : ''}</td></tr>`; })}
    </tbody></table></div>`;
  };
  const inT = d.accounts.filter((a) => a.kind === 'in').reduce((s, a) => s + (b.items[a.id] || 0), 0);
  const outT = d.accounts.filter((a) => a.kind === 'out').reduce((s, a) => s + (b.items[a.id] || 0), 0);
  const opening = funds(d).reduce((s, f) => s + openingOf(d, fy, f), 0);
  return h`<h2 class="page">예산 편성</h2>
  <div class="card"><div class="row">
    <label class="f"><span>회계연도</span><select id="bud-fy" data-change="budFy">${[1, 0, -1, -2].map((k) => fy + k).map((v) => h`<option value="${v}" ${v === fy ? 'selected' : ''}>${v}년도</option>`)}</select></label>
    <span class="badge">${b.status}</span><span class="small muted">${fmtDate(R.from)} ~ ${fmtDate(R.to)}</span></div>
    <div class="row" style="margin-top:10px">
      <button class="btn" data-act="budCopy" ${lockedB ? 'disabled' : ''}>작년 예산 복사</button>
      <button class="btn" data-act="budFromActual" ${lockedB ? 'disabled' : ''}>작년 결산 금액으로</button>
      <button class="btn" data-act="budScale" ${lockedB ? 'disabled' : ''}>비율 조정 %</button>
      <button class="btn primary" data-act="budSave" ${lockedB ? 'disabled' : ''}>저장</button>
      ${lockedB ? h`<button class="btn" data-act="budUnlock">확정 해제</button>` : h`<button class="btn gold" data-act="budConfirm">확정</button>`}
      <button class="btn" data-act="budPrint">🖨 예산서 인쇄</button>
    </div>
    <p class="small ${inT + opening - outT === 0 ? 'ok' : 'warn'}">수입 예산 ${won(inT)} + 전기이월 ${won(opening)} − 지출 예산 ${won(outT)} = ${won(inT + opening - outT)}원 ${inT + opening - outT === 0 ? '(균형)' : '(예비비로 맞추면 균형)'}</p>
  </div>
  <div class="card">${section('in')}</div><div class="card">${section('out')}</div>
  <div class="card"><h3>전기 이월금 (회계별)</h3><p class="small muted">비워 두면 전년도 장부의 기말 잔액이 자동으로 넘어옵니다. 앱을 처음 쓰는 해에만 통장 잔액 기준으로 입력하세요.</p>
  <div class="row">${funds(d).map((f) => h`<label class="f"><span>${f} (자동 ${won(openingOf({ ...d, openings: { ...d.openings, [fy]: undefined } }, fy, f))})</span><input type="text" inputmode="numeric" data-open="${f}" value="${d.openings[fy]?.funds?.[f] ?? ''}"></label>`)}</div>
  <button class="btn" data-act="openSave">이월금 저장</button></div>`;
}
function readBudgetInputs() { const items = {}; for (const el of $$('[data-bud]')) items[el.dataset.bud] = parseKoreanAmount(el.value || '0') || 0; return items; }
function budgetHtml(fy) {
  const d = S.doc, b = d.budgets[fy] || { items: {}, status: '없음' };
  const tbl = (kind) => { const l = d.accounts.filter((a) => a.kind === kind && b.items[a.id]); return `<table class="t"><thead><tr><th>관</th><th>항</th><th>예산액</th></tr></thead><tbody>${l.map((a) => `<tr><td>${esc2(a.gwan)}</td><td>${esc2(a.name)}</td><td class="n">${won(b.items[a.id])}</td></tr>`).join('')}<tr class="sum"><td></td><td>합계</td><td class="n">${won(l.reduce((s, a) => s + b.items[a.id], 0))}</td></tr></tbody></table>`; };
  return `<article class="doc"><div class="doc-head"><div class="doc-church">${esc2(d.settings.churchName)}</div><h1>${fy}년도 예산서</h1><div class="doc-sub">${esc2(b.status)}</div></div><h2>수입</h2>${tbl('in')}<h2>지출</h2>${tbl('out')}</article>`;
}

// ═════════ AI 도우미 ═════════
export function vAi() {
  const a = (S.ui.ai ||= { text: '', res: null });
  const res = a.res;
  return h`<h2 class="page">AI 도우미 — 사진·영수증·녹음을 무료 AI로</h2>
  <div class="card"><h3>① 처음 한 번: 지침 저장 (이후 매번 토큰 절약)</h3>
    <p>아래 <b>지침</b>을 복사해 무료 AI 앱 중 하나에 저장해 두세요. 이후에는 사진과 함께 <b>“${QUICK_PROMPTS.receipt}”</b> 한 단어만 보내면 됩니다.</p>
    <ul class="small">
      <li><b>Gemini (무료 추천)</b>: Gem 만들기 → 지침에 붙여넣기. 녹음 파일(m4a)도 무료로 받습니다.</li>
      <li><b>Claude (무료)</b>: 프로젝트 만들기 → 프로젝트 지침에 붙여넣기.</li>
      <li><b>ChatGPT (무료)</b>: 프로젝트 만들기 → 지침에 붙여넣기. 무료는 사진 업로드가 하루 몇 장으로 제한됩니다.</li>
    </ul>
    <div class="row"><button class="btn primary" data-act="aiCopySetup">📋 지침 복사</button>
    <button class="btn" data-act="aiCopyOne" data-k="receipt">지침 없이: 영수증용 전체 복사</button><button class="btn" data-act="aiCopyOne" data-k="offering">헌금 명단용</button><button class="btn" data-act="aiCopyOne" data-k="text">글 정리용</button></div>
    <p class="hint small">🔒 개인정보: AI에는 가능하면 이름 대신 <b>교인번호</b>가 보이게 찍거나, 영수증처럼 이름이 없는 자료 위주로 보내세요. 장부·명부 자체는 절대 AI로 보내지 않습니다(이 앱은 인터넷으로 아무것도 보내지 않습니다).</p>
  </div>
  <div class="card"><h3>② 사진·녹음 보내기</h3>
    <ul class="small"><li>영수증 여러 장은 <b>한 장에 같이</b> 찍어 보내면 업로드 횟수가 줄어듭니다.</li>
    <li>헌금 봉투·계수표 사진도 됩니다 (“${QUICK_PROMPTS.offering}”).</li>
    <li>녹음은 휴대폰 기본 기능(갤럭시 음성 녹음의 텍스트 변환, 아이폰 음성 메모 전사)으로 글로 바꿔 <a href="#" data-act="nav" data-v="offer">헌금 입력</a>에 바로 붙여넣는 것이 가장 쌉니다(AI 0원).</li></ul></div>
  <div class="card"><h3>③ AI 답변 붙여넣기</h3>
    <textarea id="ai-text" placeholder="I|20261108|102|#12|100000&#10;O|20261107|262|23000|이마트 다과&#10;T|123000">${a.text}</textarea>
    <div class="row" style="margin-top:8px"><label class="f"><span>날짜가 ?일 때</span><input type="date" id="ai-date" value="${a.date || today()}"></label><button class="btn primary" data-act="aiParse">확인 ▶</button></div>
    ${res ? h`${res.errors.length ? h`<ul class="warn">${res.errors.map((e) => h`<li>${e}</li>`)}</ul>` : ''}${res.totalOk ? h`<p class="ok">✔ 합계 검산 일치 (${won(res.sum)}원)</p>` : ''}
      ${membersDatalist()}
      ${res.offerings.length ? h`<h3>헌금 ${res.offerings.length}건</h3><div class="tbl-wrap"><table class="list"><thead><tr><th>날짜</th><th>종류</th><th>헌금자</th><th class="n">금액</th><th>방법</th></tr></thead><tbody>${res.offerings.map((it, i) => h`<tr class="ai-in ${it.warnings.length ? 'warnrow' : ''}" data-i="${i}"><td><input type="date" data-f="date" value="${it.date || ''}"></td><td><select data-f="accountId">${accOptions('in', it.accountId)}</select></td><td><input type="text" list="members-dl" data-f="donor" value="${it.donor}${it.donor2 ? ' & ' + it.donor2 : ''}">${it.warnings.length ? h`<div class="small warn">${it.warnings.join(' · ')}</div>` : ''}</td><td><input type="text" data-f="amount" value="${it.amount || ''}"></td><td><select data-f="method">${methodOptions('현금')}</select></td></tr>`)}</tbody></table></div>` : ''}
      ${res.expenses.length ? h`<h3>지출 ${res.expenses.length}건</h3><div class="tbl-wrap"><table class="list"><thead><tr><th>날짜</th><th>내용</th><th>예산 항목</th><th class="n">금액</th><th>결제</th></tr></thead><tbody>${res.expenses.map((it, i) => h`<tr class="ai-out ${it.warnings.length ? 'warnrow' : ''}" data-i="${i}"><td><input type="date" data-f="date" value="${it.date || ''}"></td><td><input type="text" data-f="memo" value="${it.memo}"></td><td><select data-f="accountId">${accOptions('out', it.accountId, { blank: true })}</select><div class="small muted">${it.reason}</div></td><td><input type="text" data-f="amount" value="${it.amount || ''}"></td><td><select data-f="method">${methodOptions('카드')}</select></td></tr>`)}</tbody></table></div>
        <label class="btn sm">📷 영수증 사진 첨부(모든 지출 건에 같은 사진)<input type="file" id="ai-files" accept="image/*,application/pdf" multiple class="hidden"></label>` : ''}
      ${res.offerings.length || res.expenses.length ? h`<div class="row" style="margin-top:10px"><button class="btn gold" data-act="aiSave">✔ 모두 저장</button></div>` : ''}` : ''}
  </div>`;
}

// ═════════ 설정 ═════════
export function vSettings() {
  const st = S.doc.settings;
  const info = S.ui.info || {};
  const lt = lockedThrough(S.doc);
  return h`<h2 class="page">설정</h2>
  <div class="card"><h3>교회 정보</h3>
    <div class="row"><label class="f grow"><span>교회 이름</span><input type="text" id="st-name" value="${st.churchName}"></label><label class="f grow"><span>고유번호(사업자번호)</span><input type="text" id="st-biz" value="${st.bizNo}"></label><label class="f grow"><span>대표자(담임목사)</span><input type="text" id="st-rep" value="${st.rep}"></label></div>
    <div class="row"><label class="f grow"><span>소재지</span><input type="text" id="st-addr" value="${st.address}"></label><label class="f"><span>회계 담당</span><input type="text" id="st-tr" value="${st.treasurer}"></label></div>
    <div class="row"><label class="f"><span>회계연도 시작월</span><select id="st-fy">${Array.from({ length: 12 }, (_, i) => i + 1).map((m) => h`<option value="${m}" ${m === st.fyStartMonth ? 'selected' : ''}>${m}월</option>`)}</select></label>
    <label class="f"><span>증빙 필요 기준(원 이상)</span><input type="number" id="st-th" value="${st.receiptThreshold || 0}"></label>
    <label class="f"><span>자동 잠금(분)</span><input type="number" id="st-lock" min="1" max="120" value="${st.autoLockMin || 10}"></label>
    <label class="f"><span>글자 크기</span><select id="st-size"><option value="">보통</option><option value="large" ${st.fontSize === 'large' ? 'selected' : ''}>크게</option></select></label></div>
    <button class="btn primary" data-act="stSave">저장</button></div>
  <div class="card"><h3>예산 항목(계정과목)</h3><p class="small muted">교회 예산서와 똑같이 맞추세요. ‘별칭’은 헌금 입력 때 알아들을 말, ‘키워드’는 지출 메모 자동 분류 단서입니다. 쓰던 항목은 지우지 말고 ‘사용 안 함’으로.</p>
    <div class="tbl-wrap"><table class="list"><thead><tr><th>코드</th><th>구분</th><th>관</th><th>항</th><th>회계</th><th>사용</th><th></th></tr></thead><tbody>
    ${S.doc.accounts.map((a) => h`<tr><td>${a.id}</td><td><span class="badge ${a.kind}">${a.kind === 'in' ? '수입' : '지출'}</span></td><td>${a.gwan}</td><td>${a.name}</td><td>${a.fund}</td><td>${a.active === false ? '✕' : '○'}</td><td><button class="btn sm" data-act="accEdit" data-id="${a.id}">✎</button></td></tr>`)}
    </tbody></table></div><div class="row"><button class="btn" data-act="accEdit" data-kind="in">+ 수입 항목</button><button class="btn" data-act="accEdit" data-kind="out">+ 지출 항목</button></div></div>
  <div class="card"><h3>기간 마감</h3><p>현재 마감: <b>${lt ? fmtDate(lt) + '까지' : '없음'}</b>. 결산(제직회 보고)이 끝난 기간을 잠그면, 이후 수정은 사유가 감사로그에 남습니다.</p>
    <div class="row"><label class="f"><span>마감일</span><input type="date" id="lk-date" value="${lt || ''}"></label><label class="f grow"><span>메모</span><input type="text" id="lk-note" placeholder="예: 10월 제직회 보고 완료"></label><button class="btn primary" data-act="lockSave">마감</button></div></div>
  <div class="card"><h3>백업 · 다른 기기로 옮기기</h3>
    <p>백업 파일은 <b>암호화</b>되어 있어 비밀번호(또는 복구코드) 없이는 열 수 없습니다. 구글드라이브·네이버MYBOX·카카오톡 ‘나에게 보내기’ 등에 안심하고 보관하세요. PC↔휴대폰은 백업 파일을 옮겨 ‘불러오기’하면 합쳐집니다.</p>
    <p class="small muted">마지막 백업: ${info.lastBackup ? info.lastBackup.slice(0, 16).replace('T', ' ') : '없음'}</p>
    <div class="row"><button class="btn gold" data-act="backup">💾 백업 파일 만들기</button><label class="btn">📂 백업 불러오기(합치기)<input type="file" accept=".cjbak,application/json" class="hidden" data-change="restoreMerge"></label></div></div>
  <div class="card"><h3>보안</h3>
    <div class="row"><button class="btn" data-act="pwChange">비밀번호 변경</button><button class="btn" data-act="lockNow">🔒 지금 잠그기</button><button class="btn" data-act="auditView">감사로그·무결성 검사</button></div>
    <p class="small muted" id="st-usage">저장 공간 확인 중…</p></div>
  ${SUPPORT.org ? h`<div class="card"><h3>앱 정보 · 후원</h3><p>${APP.name} ${APP.version} — ${SUPPORT.org}</p><p class="small">${SUPPORT.message}</p>${SUPPORT.account ? h`<p><b>${SUPPORT.account}</b></p>` : ''}${SUPPORT.url ? h`<p><a href="${SUPPORT.url}" target="_blank" rel="noopener">${SUPPORT.url}</a></p>` : ''}${SUPPORT.contact ? h`<p class="small">문의: ${SUPPORT.contact}</p>` : ''}</div>` : h`<div class="card"><h3>앱 정보</h3><p>${APP.name} ${APP.version}</p></div>`}
  <div class="card"><h3 class="bad">위험 구역</h3><button class="btn danger" data-act="wipe">이 기기의 모든 데이터 삭제</button></div>`;
}

async function accEdit(id, kind) {
  const a = S.doc.accounts.find((x) => x.id === id) || { id: nextAccountId(S.doc.accounts, kind), kind, gwan: '', name: '', fund: '일반회계', aliases: [], keywords: [], active: true, receipt: kind === 'in' };
  const r = await modal({
    title: id ? `항목 ${a.id} 수정` : '항목 추가',
    body: h`<div class="row"><label class="f"><span>코드</span><input type="text" name="id" value="${a.id}" ${id ? 'disabled' : ''}></label><label class="f grow"><span>관 (큰 분류)</span><input type="text" name="gwan" value="${a.gwan}"></label><label class="f grow"><span>항 (항목 이름)</span><input type="text" name="name" value="${a.name}"></label></div>
      <div class="row"><label class="f grow"><span>회계</span><input type="text" name="fund" value="${a.fund}" list="fund-dl"><datalist id="fund-dl">${funds(S.doc).map((f) => h`<option value="${f}">`)}</datalist></label>
      <label class="row small"><input type="checkbox" name="active" ${a.active !== false ? 'checked' : ''}> 사용</label>${a.kind === 'in' ? h`<label class="row small"><input type="checkbox" name="receipt" ${a.receipt !== false ? 'checked' : ''}> 기부금영수증 대상</label>` : ''}</div>
      ${a.kind === 'in' ? h`<label class="f"><span>별칭 (쉼표로) — 입력할 때 알아들을 말</span><input type="text" name="aliases" value="${(a.aliases || []).join(', ')}"></label>`
        : h`<label class="f"><span>키워드 (쉼표로) — 메모에 이 말이 있으면 자동 선택</span><input type="text" name="keywords" value="${(a.keywords || []).join(', ')}"></label>`}`,
    actions: [{ key: 'cancel', label: '취소' }, { key: 'ok', label: '저장', cls: 'primary', validate: (v) => (!v.gwan.trim() || !v.name.trim() ? '관과 항을 입력하세요' : '') }],
  });
  if (r.key !== 'ok') return;
  const v = r.values;
  const split = (s) => String(s || '').split(/[,，]/).map((x) => x.trim()).filter(Boolean);
  upsertAccount(S.doc, { ...a, id: id || v.id.trim(), gwan: v.gwan.trim(), name: v.name.trim(), fund: v.fund.trim() || '일반회계', active: v.active, ...(a.kind === 'in' ? { aliases: split(v.aliases), receipt: v.receipt } : { keywords: split(v.keywords) }) });
  await commit(); toast('저장했습니다'); S.render();
}

// 백업: 감싼 키 + 암호화 장부 + 암호화 파일 (재암호화 불필요)
async function makeBackup() {
  toast('백업 파일을 만드는 중…');
  const docBox = await getMeta('doc');
  const ids = await listFileIds();
  const files = [];
  for (const id of ids) { const b = await getFileBox(id); if (b) files.push({ id, iv: b.iv, ct: b64encode(b.ct) }); }
  const data = JSON.stringify({ format: 'cheongjigi-backup', v: 1, createdAt: new Date().toISOString(), keyring: S.keyring, doc: docBox, files });
  const name = `청지기장부_백업_${todayLocal()}.cjbak`;
  const how = await shareOrDownload(name, new TextEncoder().encode(data), 'application/json');
  if (how === 'aborted') return;
  S.ui.info = { ...(S.ui.info || {}), lastBackup: new Date().toISOString() };
  await putMeta('info', S.ui.info);
  toast(`백업 완료 (${(data.length / 1048576).toFixed(1)}MB, 증빙 ${files.length}개)`);
  S.render();
}
/** 백업 파일 해석: {key, doc, files} (비밀번호 또는 복구코드 필요) */
export async function openBackup(file) {
  let b;
  try { b = JSON.parse(await file.text()); } catch { throw new Error('백업 파일을 읽을 수 없습니다'); }
  if (b.format !== 'cheongjigi-backup') throw new Error('청지기 장부 백업 파일이 아닙니다');
  const r = await modal({ title: '백업 파일 열기', body: h`<p>이 백업을 만들 때의 <b>비밀번호</b> 또는 <b>복구코드</b>를 입력하세요.</p><input type="password" name="pw" autocomplete="current-password"><label class="row small"><input type="checkbox" name="rc"> 복구코드로 열기</label>`, actions: [{ key: 'cancel', label: '취소' }, { key: 'ok', label: '열기', cls: 'primary' }] });
  if (r.key !== 'ok') return null;
  const key = await unlockKeyring(b.keyring, r.values.pw, r.values.rc ? 'rc' : 'pw');
  const doc = await decryptJson(key, b.doc);
  return { key, doc, files: b.files, keyring: b.keyring };
}
async function restoreMerge(el) {
  const f = el.files[0];
  el.value = '';
  if (!f) return;
  const b = await openBackup(f);
  if (!b) return;
  const stats = mergeDocs(S.doc, b.doc);
  const have = new Set(await listFileIds());
  let nf = 0;
  for (const x of b.files) {
    if (have.has(x.id)) continue;
    const bytes = await decryptBytes(b.key, { iv: x.iv, ct: b64decode(x.ct) });
    await putFile(S.key, x.id, bytes);
    nf++;
  }
  await commit();
  toast(`합치기 완료: 거래 +${stats.txs.added} (갱신 ${stats.txs.updated}), 교인 +${stats.members.added}, 증빙 +${nf}`);
  S.render();
}

async function auditView() {
  const v = verifyAudit(S.doc);
  const last = [...S.doc.audit].reverse().slice(0, 200);
  await modal({
    title: '감사로그', wide: true,
    body: h`<p class="${v.ok ? 'ok' : 'bad'}">${v.ok ? `✔ 무결성 정상 — 기록 ${v.count}건의 해시 체인이 모두 맞습니다.` : `✕ 문제 ${v.problems.length}건: ${v.problems.slice(0, 5).map((p) => p.problem).join(', ')}`}</p>
    <div class="tbl-wrap"><table class="list"><thead><tr><th>시각</th><th>동작</th><th>내용</th><th>사유</th></tr></thead><tbody>${last.map((e) => h`<tr><td class="small">${e.ts.slice(0, 16).replace('T', ' ')}</td><td>${e.act}</td><td class="small">${e.summary}</td><td class="small">${e.reason || ''}</td></tr>`)}</tbody></table></div>`,
    actions: [{ key: 'csv', label: 'CSV 내려받기' }, { key: 'ok', label: '닫기', cls: 'primary' }],
  }).then((r) => { if (r.key === 'csv') download(`감사로그_${todayLocal()}.csv`, toCsv([['시각', '기기', '순번', '동작', '내용', '사유', '해시', '이전해시'], ...S.doc.audit.map((e) => [e.ts, e.dev, e.seq, e.act, e.summary, e.reason, e.hash, e.prev])]), 'text/csv'); });
}

// ═════════ 동작 ═════════
export const actions = {
  repPreset(b) { const r = repState(); r.preset = b.dataset.k; if (r.preset === 'custom') { const p = periodRange('month', today()); r.from ||= p.from; r.to ||= p.to; } S.render(); },
  repApply() { const r = repState(); if (r.preset === 'custom') { r.from = $('#rp-from').value; r.to = $('#rp-to').value; if (r.from > r.to) return toast('시작일이 끝보다 늦습니다', true); } else r.ref = $('#rp-ref').value || today(); S.render(); },
  repPrint() { const { s, title } = S.ui.lastReport; printHtml(financeReportHtml(S.doc, s, { title })); },
  repXlsx() { const { s, title } = S.ui.lastReport; download(`${title}_${s.from}_${s.to}.xlsx`, makeXlsx(reportSheets(s)), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); },
  repCsv() { const { s, title } = S.ui.lastReport; download(`${title}_${s.from}_${s.to}.csv`, toCsv(txRows(s.txs)), 'text/csv'); },
  repZip: auditZip,
  async repVouchers() {
    const { s } = S.ui.lastReport;
    const outs = s.txs.filter((t) => t.kind === 'out');
    if (!outs.length) return toast('이 기간에 지출이 없습니다', true);
    const { fileUrl } = await import('./ui.js');
    const parts = [];
    for (const t of outs) { const imgs = []; for (const a of t.attachments || []) if (a.mime.startsWith('image/')) imgs.push(await fileUrl(a)); parts.push(voucherHtml(S.doc, t, imgs)); }
    printHtml(parts.join('<div class="page-break"></div>'));
  },
  async bankCheck() {
    const r = await modal({ title: '통장 잔액 대조', body: h`<p class="small">통장(인터넷뱅킹)에 보이는 잔액을 입력하면 같은 날짜의 장부 잔액과 비교해 보고서에 표시합니다.</p><div class="row"><label class="f"><span>날짜</span><input type="date" name="date" value="${today()}"></label><label class="f"><span>회계</span><select name="fund">${funds(S.doc).map((f) => h`<option>${f}</option>`)}</select></label></div><div class="row"><label class="f grow"><span>은행·계좌</span><input type="text" name="bank" placeholder="예: 농협 주계좌"></label><label class="f grow"><span>통장 잔액</span><input type="text" inputmode="numeric" name="amount"></label></div>`, actions: [{ key: 'cancel', label: '취소' }, { key: 'ok', label: '저장', cls: 'primary', validate: (v) => (parseKoreanAmount(v.amount) == null ? '잔액을 입력하세요' : '') }] });
    if (r.key !== 'ok') return;
    addBankCheck(S.doc, { ...r.values, amount: parseKoreanAmount(r.values.amount) });
    await commit(); toast('저장했습니다 — 보고서의 ‘통장 잔액 대조’에 표시됩니다'); S.render();
  },
  memSearch(el) { S.ui.memQ = el.value; clearTimeout(S.ui._mq); S.ui._mq = setTimeout(() => { S.render(); const i = $('#mem-q'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); },
  memEdit(b) { return memEdit(b.dataset.id); },
  memImport,
  memTemplate() { download('교인명부_양식.csv', toCsv([['번호', '이름', '주정', '연락처', '주소', '가족', '주민번호', '메모'], [1, '홍길동', 20000, '010-0000-0000', '○○시 ○○구', 'F01', '', '']]), 'text/csv'); },
  memExport() { download(`교인명부_${todayLocal()}.xlsx`, makeXlsx([{ name: '교인명부', rows: [['번호', '이름', '주정', '연락처', '주소', '가족', '상태', '주민번호(가림)', '메모'], ...S.doc.members.sort((a, b) => a.no - b.no).map((m) => [m.no, m.name, m.weekly || 0, m.phone || '', m.address || '', m.familyId || '', m.status || '사용', m.rrn ? maskRrn(m.rrn) : '', m.note || ''])] }]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); },
  rcYear(el) { S.ui.rcYear = +el.value; S.render(); },
  async rcIssue(b) { const y = S.ui.rcYear || +$('#rc-year').value; const r = issueReceipt(S.doc, y, b.dataset.key); await commit(); printReceipts([r]); S.render(); },
  rcPrint(b) { printReceipts([S.doc.receipts.find((r) => r.id === b.dataset.id)]); },
  async rcAll() {
    const y = S.ui.rcYear || +$('#rc-year').value;
    const list = donorTotals(S.doc, y);
    if (!list.length) return toast('발급할 대상이 없습니다', true);
    if (!(await confirmBox(`${y}년 ${list.length}명의 영수증을 발급(이미 발급된 분은 재발급)하고 인쇄할까요?`))) return;
    const rs = list.map((d) => issueReceipt(S.doc, y, d.key));
    await commit(); printReceipts(rs); S.render();
  },
  rcLedger() {
    const y = S.ui.rcYear || +$('#rc-year').value;
    download(`기부금영수증_발급명세_${y}.xlsx`, makeXlsx([{ name: `발급명세${y}`, rows: [['일련번호', '성명', '주민번호(가림)', '주소', '기부금액', '발급일', '상태', '재발급 전 번호'], ...S.doc.receipts.filter((r) => r.year === y).map((r) => { const m = S.doc.members.find((x) => x.id === r.memberId); return [r.serial, r.name, m?.rrn ? maskRrn(m.rrn) : '', m?.address || '', r.amount, r.issuedAt, r.voided ? '무효(재발급)' : '유효', (r.reissueOf || []).join(',')]; })] }]), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  },
  budFy(el) { S.ui.budFy = +el.value; S.render(); },
  budCopy() { const fy = S.ui.budFy || fyOf(today(), S.doc.settings.fyStartMonth); const p = S.doc.budgets[fy - 1]?.items; if (!p) return toast('작년 예산이 없습니다', true); for (const el of $$('[data-bud]')) el.value = p[el.dataset.bud] || ''; toast('작년 예산을 채웠습니다. 확인 후 저장하세요'); },
  budFromActual() {
    const fy = S.ui.budFy || fyOf(today(), S.doc.settings.fyStartMonth); const R = fyRange(fy - 1, S.doc.settings.fyStartMonth); const act = {};
    for (const t of liveTxs(S.doc)) if (t.date >= R.from && t.date <= R.to) act[t.accountId] = (act[t.accountId] || 0) + t.amount;
    for (const el of $$('[data-bud]')) el.value = act[el.dataset.bud] || '';
    toast('작년 결산 금액을 채웠습니다. 확인 후 저장하세요');
  },
  async budScale() {
    const r = await modal({ title: '비율 조정', body: h`<p>입력된 모든 예산을 몇 % 늘리거나 줄일까요? (예: 5, -3) 천 원 단위로 반올림합니다.</p><input type="number" name="p" value="5">`, actions: [{ key: 'cancel', label: '취소' }, { key: 'ok', label: '적용', cls: 'primary' }] });
    if (r.key !== 'ok') return;
    const k = 1 + (+r.values.p || 0) / 100;
    for (const el of $$('[data-bud]')) { const v = parseKoreanAmount(el.value || '0') || 0; if (v) el.value = Math.round((v * k) / 1000) * 1000; }
    toast('조정했습니다. 확인 후 저장하세요');
  },
  async budSave() { const fy = S.ui.budFy || fyOf(today(), S.doc.settings.fyStartMonth); setBudget(S.doc, fy, readBudgetInputs()); await commit(); toast('예산을 저장했습니다'); S.render(); },
  async budConfirm() { const fy = S.ui.budFy || fyOf(today(), S.doc.settings.fyStartMonth); if (!(await confirmBox(`${fy}년도 예산을 확정할까요? (공동의회·제직회 통과 후)`))) return; setBudget(S.doc, fy, readBudgetInputs(), { status: '확정' }); await commit(); toast('확정했습니다'); S.render(); },
  async budUnlock() { const fy = S.ui.budFy || fyOf(today(), S.doc.settings.fyStartMonth); const reason = await askReason('확정 해제 사유(추경 등)'); if (reason == null) return; setBudget(S.doc, fy, {}, { status: '작성중', memo: { _unlock: reason } }); await commit(); S.render(); },
  budPrint() { printHtml(budgetHtml(S.ui.budFy || fyOf(today(), S.doc.settings.fyStartMonth))); },
  async openSave() { const fy = S.ui.budFy || fyOf(today(), S.doc.settings.fyStartMonth); for (const el of $$('[data-open]')) if (el.value.trim() !== '') setOpening(S.doc, fy, el.dataset.open, parseKoreanAmount(el.value) || 0); else if (S.doc.openings[fy]?.funds) delete S.doc.openings[fy].funds[el.dataset.open]; await commit(); toast('이월금을 저장했습니다'); S.render(); },
  aiCopySetup() { copyText(setupPrompt(S.doc)); },
  aiCopyOne(b) { copyText(oneShotPrompt(S.doc, b.dataset.k)); },
  aiParse() { const a = S.ui.ai; a.text = $('#ai-text').value; a.date = $('#ai-date').value; a.res = parseBridge(a.text, S.doc, { date: a.date }); if (!a.res.lines) toast('“I|…” 또는 “O|…” 형식의 줄이 없습니다', true); S.render(); },
  async aiSave() {
    const a = S.ui.ai; const res = a.res;
    const files = $('#ai-files')?.files || [];
    const atts = [];
    const { compressImage } = await import('./ui.js');
    for (const f of files) atts.push(await storeAttachment(await compressImage(f)));
    let n = 0;
    for (const tr of $$('tr.ai-in')) {
      const g = (f) => $(`[data-f="${f}"]`, tr).value;
      const [p1, p2] = g('donor').split('&').map((s) => s.trim());
      const d1 = resolveDonor(p1), d2 = p2 ? resolveDonor(p2) : { memberId: null, donor: '' };
      addTx(S.doc, { date: g('date') || a.date, kind: 'in', accountId: g('accountId'), amount: parseKoreanAmount(g('amount')), memberId: d1.memberId, donor: d1.donor, memberId2: d2.memberId, donor2: p2 ? d2.donor : '', method: g('method'), source: 'AI' }, { reason: '' });
      n++;
    }
    for (const tr of $$('tr.ai-out')) {
      const g = (f) => $(`[data-f="${f}"]`, tr).value;
      addTx(S.doc, { date: g('date') || a.date, kind: 'out', accountId: g('accountId'), amount: parseKoreanAmount(g('amount')), memo: g('memo'), method: g('method'), attachments: atts, source: 'AI' });
      n++;
    }
    await commit(); S.ui.ai = { text: '', res: null }; toast(`${n}건 저장했습니다`); S.render();
  },
  async stSave() {
    const st = S.doc.settings;
    Object.assign(st, { churchName: $('#st-name').value.trim() || st.churchName, bizNo: $('#st-biz').value.trim(), rep: $('#st-rep').value.trim(), address: $('#st-addr').value.trim(), treasurer: $('#st-tr').value.trim(), fyStartMonth: +$('#st-fy').value, receiptThreshold: +$('#st-th').value || 0, autoLockMin: Math.max(1, +$('#st-lock').value || 10), fontSize: $('#st-size').value, updatedAt: new Date().toISOString() });
    document.documentElement.dataset.size = st.fontSize || '';
    const { appendAudit } = await import('./core/ledger.js');
    appendAudit(S.doc, 'settings', '', '교회 정보·설정 변경');
    await commit(); toast('저장했습니다'); S.render();
  },
  accEdit(b) { return accEdit(b.dataset.id, b.dataset.kind); },
  async lockSave() {
    const d = $('#lk-date').value;
    if (!d) return toast('마감일을 고르세요', true);
    if (d < lockedThrough(S.doc)) return toast('이미 그 이후까지 마감되어 있습니다', true);
    if (!(await confirmBox(`${fmtDate(d)}까지의 장부를 마감할까요? 이후 수정에는 사유가 필요합니다.`))) return;
    lockPeriod(S.doc, d, $('#lk-note').value.trim()); await commit(); toast('마감했습니다'); S.render();
  },
  backup: makeBackup,
  restoreMerge,
  async pwChange() {
    const r = await modal({ title: '비밀번호 변경', body: h`<label class="f"><span>현재 비밀번호 (또는 복구코드)</span><input type="password" name="cur" autocomplete="current-password"></label><label class="row small"><input type="checkbox" name="rc"> 복구코드로 확인</label><label class="f"><span>새 비밀번호 (8자 이상)</span><input type="password" name="n1" autocomplete="new-password"></label><label class="f"><span>새 비밀번호 확인</span><input type="password" name="n2" autocomplete="new-password"></label>`, actions: [{ key: 'cancel', label: '취소' }, { key: 'ok', label: '변경', cls: 'primary', validate: (v) => checkPassword(v.n1) || (v.n1 !== v.n2 ? '새 비밀번호가 서로 다릅니다' : '') }] });
    if (r.key !== 'ok') return;
    S.keyring = await rewrapPassword(S.keyring, r.values.cur, r.values.n1, r.values.rc ? 'rc' : 'pw');
    await putMeta('keyring', S.keyring);
    toast('비밀번호를 바꿨습니다. 예전 백업 파일은 예전 비밀번호(또는 복구코드)로 열립니다.');
  },
  auditView,
  async wipe() {
    const r = await modal({ title: '모든 데이터 삭제', body: h`<p class="bad">이 기기의 장부·명부·증빙이 <b>영구 삭제</b>됩니다. 백업 파일이 있는지 먼저 확인하세요.</p><p>계속하려면 교회 이름 <b>${S.doc.settings.churchName}</b>을(를) 입력하세요.</p><input type="text" name="c">`, actions: [{ key: 'cancel', label: '취소' }, { key: 'ok', label: '영구 삭제', cls: 'danger', validate: (v) => (v.c.trim() === S.doc.settings.churchName ? '' : '교회 이름이 다릅니다') }] });
    if (r.key !== 'ok') return;
    revokeAll(); await wipeAll(); location.reload();
  },
};

export async function settingsAfterRender() {
  const el = $('#st-usage');
  if (!el) return;
  const u = await usage();
  const p = await persist();
  el.textContent = `${u ? `사용 중 ${(u.usage / 1048576).toFixed(1)}MB` : ''}${p ? ' · 브라우저 자동 정리 방지 켜짐' : ' · 브라우저가 공간 부족 시 정리할 수 있으니 백업을 자주 하세요'}`;
}

export const views = { report: vReport, members: vMembers, receipts: vReceipts, budget: vBudget, ai: vAi, settings: vSettings };
