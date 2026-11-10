// 인쇄용 문서(HTML) — 제직회 보고서·지출결의서·기부금영수증·헌금 집계표
// 모든 사용자 입력은 esc()를 거친다(XSS 차단).
import { esc, won, money, fmtDate, todayLocal, maskRrn, fmtRrn, currencyInfo } from './util.js';
import { regionOf } from './region.js';

const D = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구'];
/** 150000 → "일십오만" (지출결의서·영수증의 한글 금액) */
export function koreanAmountText(n) {
  n = Math.round(Math.abs(n));
  if (n === 0) return '영';
  const units = ['', '만', '억', '조'];
  let out = '', g = 0;
  while (n > 0) {
    const part = n % 10000;
    if (part) {
      let s = '';
      const th = Math.floor(part / 1000), h = Math.floor(part / 100) % 10, t = Math.floor(part / 10) % 10, o = part % 10;
      if (th) s += D[th] + '천'; if (h) s += D[h] + '백'; if (t) s += D[t] + '십'; if (o) s += D[o];
      out = s + units[g] + out;
    }
    n = Math.floor(n / 10000); g++;
  }
  return out;
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function words999(n) {
  const h = Math.floor(n / 100), r = n % 100;
  const rest = r < 20 ? ONES[r] : TENS[Math.floor(r / 10)] + (r % 10 ? '-' + ONES[r % 10] : '');
  return [h ? ONES[h] + ' Hundred' : '', rest].filter(Boolean).join(' ');
}
/** 센트 → 수표식 영문 금액: 123456 → "One Thousand Two Hundred Thirty-Four and 56/100 Dollars" */
export function usdWords(cents) {
  cents = Math.round(Math.abs(cents));
  let d = Math.floor(cents / 100);
  const c = cents % 100;
  const scales = ['', 'Thousand', 'Million', 'Billion'];
  const parts = [];
  for (let i = 0; d > 0; i++, d = Math.floor(d / 1000)) { const g = d % 1000; if (g) parts.unshift(words999(g) + (scales[i] ? ' ' + scales[i] : '')); }
  return `${parts.join(' ') || 'Zero'} and ${String(c).padStart(2, '0')}/100 Dollars`;
}
const unitNote = () => (currencyInfo().code === 'USD' ? '단위: 달러($)' : '단위: 원');

const head = (doc, title, sub) => `<div class="doc-head"><div class="doc-church">${esc(doc.settings.churchName)}</div><h1>${esc(title)}</h1>${sub ? `<div class="doc-sub">${sub}</div>` : ''}</div>`;
const sign = (labels) => `<table class="sign"><tr>${labels.map((l) => `<th>${esc(l)}</th>`).join('')}</tr><tr>${labels.map(() => '<td></td>').join('')}</tr></table>`;

/** 제직회 재정 보고서 (주간·월간·분기·연간·임의 기간 공통) */
export function financeReportHtml(doc, s, { title = '재정 보고서', showWeekly = true, showFlags = true } = {}) {
  const funds = Object.entries(s.byFund).filter(([f, v]) => f === '일반회계' || v.opening || v.in || v.out);
  const fundTable = `<table class="t"><thead><tr><th>회계</th><th>전기이월</th><th>수입</th><th>지출</th><th>차기이월(잔액)</th></tr></thead><tbody>${funds.map(([f, v]) => `<tr><td>${esc(f)}</td><td class="n">${won(v.opening)}</td><td class="n">${won(v.in)}</td><td class="n">${won(v.out)}</td><td class="n b">${won(v.closing)}</td></tr>`).join('')}<tr class="sum"><td>합계</td><td class="n">${won(s.totals.opening)}</td><td class="n">${won(s.totals.in)}</td><td class="n">${won(s.totals.out)}</td><td class="n b">${won(s.totals.closing)}</td></tr></tbody></table>`;
  const accTable = (kind) => {
    const rows = s.rows.filter((r) => r.kind === kind && (r.period || r.budget || r.ytd));
    if (!rows.length) return '<p class="muted">내역 없음</p>';
    const byGwan = {};
    for (const r of rows) (byGwan[r.gwan] ||= []).push(r);
    let body = '';
    for (const [g, list] of Object.entries(byGwan)) {
      list.forEach((r, i) => {
        body += `<tr><td>${i === 0 ? esc(g) : ''}</td><td>${esc(r.name)}${r.fund !== '일반회계' ? ` <span class="tag">${esc(r.fund)}</span>` : ''}</td><td class="n">${won(r.period)}</td><td class="n">${r.budget ? won(r.budget) : '-'}</td><td class="n">${won(r.ytd)}</td><td class="n">${r.rate == null ? '-' : r.rate + '%'}</td></tr>`;
      });
      const sub = list.reduce((a, r) => ({ p: a.p + r.period, b: a.b + r.budget, y: a.y + r.ytd }), { p: 0, b: 0, y: 0 });
      if (list.length > 1) body += `<tr class="sub"><td></td><td>${esc(g)} 소계</td><td class="n">${won(sub.p)}</td><td class="n">${sub.b ? won(sub.b) : '-'}</td><td class="n">${won(sub.y)}</td><td class="n">${sub.b ? Math.round((sub.y / sub.b) * 1000) / 10 + '%' : '-'}</td></tr>`;
    }
    const tot = rows.reduce((a, r) => ({ p: a.p + r.period, b: a.b + r.budget, y: a.y + r.ytd }), { p: 0, b: 0, y: 0 });
    return `<table class="t"><thead><tr><th>관</th><th>항</th><th>이번 기간</th><th>연 예산</th><th>연 누계</th><th>집행률</th></tr></thead><tbody>${body}<tr class="sum"><td></td><td>합계</td><td class="n">${won(tot.p)}</td><td class="n">${tot.b ? won(tot.b) : '-'}</td><td class="n">${won(tot.y)}</td><td class="n">${tot.b ? Math.round((tot.y / tot.b) * 1000) / 10 + '%' : '-'}</td></tr></tbody></table>`;
  };
  let weekly = '';
  if (showWeekly && s.weekly.weeks.length > 1 && s.weekly.weeks.length <= 6) {
    weekly = `<h2>주일별 헌금</h2><table class="t small"><thead><tr><th>주일</th>${s.weekly.cols.map((c) => `<th>${esc(c.name)}</th>`).join('')}<th>계</th></tr></thead><tbody>${s.weekly.weeks.map((w) => `<tr><td>${esc(w.week.slice(5).replace('-', '/'))}</td>${s.weekly.cols.map((c) => `<td class="n">${w.cells[c.id] ? won(w.cells[c.id]) : ''}</td>`).join('')}<td class="n b">${won(w.total)}</td></tr>`).join('')}</tbody></table>`;
  }
  const monthly = s.monthly.length > 1 ? `<h2>월별 흐름</h2><table class="t small"><thead><tr><th>월</th><th>수입</th><th>지출</th><th>차액</th></tr></thead><tbody>${s.monthly.map((m) => `<tr><td>${esc(m.month)}</td><td class="n">${won(m.in)}</td><td class="n">${won(m.out)}</td><td class="n ${m.net < 0 ? 'bad' : ''}">${won(m.net)}</td></tr>`).join('')}</tbody></table>` : '';
  const outList = s.txs.filter((t) => t.kind === 'out');
  const accName = (id) => doc.accounts.find((a) => a.id === id)?.name || '미분류';
  const detail = outList.length && outList.length <= 60 ? `<h2>지출 명세</h2><table class="t small"><thead><tr><th>일자</th><th>항목</th><th>내용</th><th>금액</th><th>증빙</th></tr></thead><tbody>${outList.map((t) => `<tr><td>${esc(t.date.slice(5).replace('-', '/'))}</td><td>${esc(accName(t.accountId))}</td><td>${esc(t.payee ? t.payee + ' ' : '')}${esc(t.memo)}</td><td class="n">${won(t.amount)}</td><td>${t.attachments?.length ? '○' : t.noReceiptReason ? '사유' : '✕'}</td></tr>`).join('')}</tbody></table>` : '';
  const bank = s.bank.length ? `<h2>통장 잔액 대조</h2><table class="t small"><thead><tr><th>일자</th><th>회계</th><th>은행</th><th>통장</th><th>장부</th><th>차이</th></tr></thead><tbody>${s.bank.map((b) => `<tr><td>${esc(b.date)}</td><td>${esc(b.fund)}</td><td>${esc(b.bank)}</td><td class="n">${won(b.amount)}</td><td class="n">${won(b.book)}</td><td class="n ${b.diff ? 'bad' : ''}">${won(b.diff)}</td></tr>`).join('')}</tbody></table>` : '';
  const flags = showFlags && s.flags.length ? `<h2>감사 점검 사항 (${s.flags.length})</h2><ul class="flags">${s.flags.slice(0, 40).map((f) => `<li class="${f.level}">${esc(f.msg)}</li>`).join('')}</ul>` : '';
  return `<article class="doc">${head(doc, title, `${fmtDate(s.from)} ~ ${fmtDate(s.to)} · ${s.fy}년도 예산(${esc(s.budgetStatus)}) · ${unitNote()} · 작성 ${fmtDate(todayLocal())}`)}
<h2>요약</h2>${fundTable}<h2>수입</h2>${accTable('in')}<h2>지출</h2>${accTable('out')}${weekly}${monthly}${detail}${bank}${flags}
${sign(['회계', '재정부장', '감사', '담임목사'])}</article>`;
}

/** 지출결의서 — 영수증 사진 포함 */
export function voucherHtml(doc, t, images = []) {
  const a = doc.accounts.find((x) => x.id === t.accountId);
  return `<article class="doc voucher">${head(doc, '지 출 결 의 서')}
${sign(['담당', '회계', '재정부장', '담임목사'])}
<table class="t form"><tr><th>결의일</th><td>${fmtDate(t.createdAt?.slice(0, 10) || t.date)}</td><th>지출일</th><td>${fmtDate(t.date)}</td></tr>
<tr><th>관</th><td>${esc(a?.gwan || '미분류')}</td><th>항</th><td>${esc(a?.name || '미분류')}</td></tr>
<tr><th>금액</th><td colspan="3">${currencyInfo().code === 'USD' ? `<b>${money(t.amount)}</b> (${usdWords(t.amount)})` : `<b>일금 ${koreanAmountText(t.amount)}원정</b> (₩${won(t.amount)})`}</td></tr>
<tr><th>지급처</th><td>${esc(t.payee || '')}</td><th>결제</th><td>${esc(t.method || '')}</td></tr>
<tr><th>내용</th><td colspan="3">${esc(t.memo)}</td></tr>
<tr><th>증빙</th><td colspan="3">${images.length ? `영수증 ${images.length}매 첨부` : t.noReceiptReason ? '증빙 없음 — 사유: ' + esc(t.noReceiptReason) : '증빙 없음'}</td></tr>
<tr><th>영수인</th><td colspan="3" class="tall"></td></tr></table>
${images.map((src) => `<div class="voucher-img"><img src="${esc(src)}" alt="영수증"></div>`).join('')}</article>`;
}

/** 지역별 영수증: 한국 = 국세청 기부금영수증, 미국 = IRS 기준 Contribution Statement */
export function receiptHtml(doc, r, member, opt = {}) {
  return regionOf(doc).code === 'US' ? usStatementHtml(doc, r, member) : krReceiptHtml(doc, r, member, opt);
}

/** 미국: 연간 헌금 확인서(Contribution Statement) — 한영 병기, 헌금별 날짜·금액, 재화·용역 제공 여부 문구 */
export function usStatementHtml(doc, r, member) {
  const st = doc.settings;
  const gifts = r.gifts || [];
  const d = r.issuedAt;
  const mon = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const enDate = (x) => `${mon[+x.slice(5, 7) - 1]} ${+x.slice(8, 10)}, ${x.slice(0, 4)}`;
  return `<article class="doc receipt us">
<div class="r-top"><span>Statement No. ${esc(r.serial)}</span><span>Tax Year ${esc(r.year)}</span></div>
<h1 class="r-title us">Contribution Statement</h1><p class="r-sub">${esc(r.year)}년 헌금 영수증 (연간 헌금 확인서)</p>
<table class="t form"><tr><th>Church / 교회</th><td>${esc(st.churchName)}</td><th>EIN</th><td>${esc(st.bizNo)}</td></tr>
<tr><th>Address / 주소</th><td colspan="3">${esc(st.address)}</td></tr></table>
<table class="t form"><tr><th>Donor / 헌금자</th><td>${esc(r.name)}${r.joint?.length ? ' &amp; ' + esc(r.joint.join(', ')) : ''}</td></tr>
<tr><th>Address / 주소</th><td>${esc(member?.address || '')}</td></tr></table>
<table class="t small"><thead><tr><th>Date / 날짜</th><th>Fund / 항목</th><th>Method / 방법</th><th>Amount / 금액</th></tr></thead><tbody>
${gifts.map((g) => `<tr><td>${esc(g.date.replace(/-/g, '/'))}</td><td>${esc(g.account)}</td><td>${esc(regionOf(doc).methodLabels[g.method] || g.method || '')}</td><td class="n">${money(g.amount)}</td></tr>`).join('')}
<tr class="sum"><td colspan="3">Total contributions / 합계</td><td class="n">${money(r.amount)}</td></tr></tbody></table>
<p class="r-law"><b>No goods or services were provided in exchange for these contributions other than intangible religious benefits.</b><br>위 헌금에 대하여 무형의 종교적 혜택 외에 어떠한 재화나 용역도 제공되지 않았습니다.</p>
<p class="small">Please retain this statement for your tax records. / 세금 신고 자료로 보관하십시오.</p>
<p class="r-date">Date issued / 발행일: ${esc(enDate(d))}</p>
<p class="r-sign">${esc(st.churchName)} &nbsp; Authorized signature / 서명: ____________________ ${st.treasurer ? '(' + esc(st.treasurer) + ')' : ''}</p>
<p class="muted small no-print">※ IRS Publication 1771 기준 문구입니다. 주 법·특수 상황(현물 기부, 대가가 있는 헌금 등)은 세무 전문가와 확인하세요.</p></article>`;
}

/** 한국: 기부금영수증 — 소득세법 시행규칙 별지 제45호의2서식 구조. 최신 서식은 국세청 고시와 대조 후 사용 */
export function krReceiptHtml(doc, r, member, { showRrn = true } = {}) {
  const st = doc.settings;
  const rrn = member?.rrn ? (showRrn ? fmtRrn(member.rrn) : maskRrn(member.rrn)) : '';
  const months = Object.entries(r.months || {}).sort();
  return `<article class="doc receipt">
<div class="r-top"><span>일련번호 ${esc(r.serial)}</span><span class="muted">소득세법 시행규칙 [별지 제45호의2서식]</span></div>
<h1 class="r-title">기 부 금 영 수 증</h1>
<h3>① 기부자</h3><table class="t form"><tr><th>성명</th><td>${esc(r.name)}</td><th>주민등록번호</th><td>${esc(rrn)}</td></tr><tr><th>주소</th><td colspan="3">${esc(member?.address || '')}</td></tr></table>
<h3>② 기부금 단체</h3><table class="t form"><tr><th>단체명</th><td>${esc(st.churchName)}</td><th>고유번호</th><td>${esc(st.bizNo)}</td></tr><tr><th>소재지</th><td colspan="3">${esc(st.address)}</td></tr><tr><th>대표자</th><td colspan="3">${esc(st.rep)}</td></tr></table>
<h3>③ 기부내용</h3><table class="t"><thead><tr><th>코드</th><th>구분</th><th>연월</th><th>내용</th><th>금액</th></tr></thead><tbody>
${months.map(([m, v]) => `<tr><td>41</td><td>금전</td><td>${esc(m.replace('-', '.'))}</td><td>종교단체 기부금</td><td class="n">${won(v)}</td></tr>`).join('')}
<tr class="sum"><td colspan="4">합계</td><td class="n">${won(r.amount)}</td></tr></tbody></table>
<p class="r-law">「소득세법」 제34조, 「조세특례제한법」 제58조·제76조·제88조의4 및 「법인세법」 제24조에 따른 기부금을 위와 같이 기부받았음을 증명합니다.</p>
<p class="r-date">${esc(r.issuedAt.slice(0, 4))}년 ${+r.issuedAt.slice(5, 7)}월 ${+r.issuedAt.slice(8, 10)}일</p>
<p class="r-sign">기부금 수령인 ${esc(st.churchName)} &nbsp; 대표 ${esc(st.rep)} (서명 또는 인)</p>
<p class="muted small no-print">※ 최신 서식·코드는 국세청 고시와 대조하세요. 발급명세는 5년간 보관해야 합니다(소득세법 제160조의3).</p></article>`;
}

/** 헌금 집계표(계수표) — 2부 출력해 계수자·회계가 각각 보관 */
export function countSheetHtml(doc, batch, txs) {
  const acc = (id) => doc.accounts.find((a) => a.id === id)?.name || '?';
  const byAcc = {};
  for (const t of txs) { const k = acc(t.accountId); (byAcc[k] ||= { cash: 0, bank: 0, n: 0 }); byAcc[k][t.method === '현금' ? 'cash' : 'bank'] += t.amount; byAcc[k].n++; }
  const cashBook = txs.filter((t) => t.method === '현금').reduce((s, t) => s + t.amount, 0);
  const bills = regionOf(doc).bills;
  const one = (copy) => `<article class="doc count">${head(doc, '헌금 집계표', `${fmtDate(batch.date)} · ${copy}`)}
<table class="t"><thead><tr><th>헌금 종류</th><th>건수</th><th>현금</th><th>계좌 등</th><th>계</th></tr></thead><tbody>${Object.entries(byAcc).map(([k, v]) => `<tr><td>${esc(k)}</td><td class="n">${v.n}</td><td class="n">${won(v.cash)}</td><td class="n">${won(v.bank)}</td><td class="n b">${won(v.cash + v.bank)}</td></tr>`).join('')}
<tr class="sum"><td>합계</td><td class="n">${txs.length}</td><td class="n">${won(cashBook)}</td><td class="n">${won(txs.reduce((s, t) => s + (t.method === '현금' ? 0 : t.amount), 0))}</td><td class="n b">${won(txs.reduce((s, t) => s + t.amount, 0))}</td></tr></tbody></table>
<h3>현금 계수</h3><table class="t small"><thead><tr><th>권종</th>${bills.map(([, l]) => `<th>${esc(l)}</th>`).join('')}<th>계</th></tr></thead><tbody><tr><td>매수</td>${bills.map(([b]) => `<td class="n">${esc(batch.cash?.[b] || '')}</td>`).join('')}<td class="n b">${money(batch.cashTotal)}</td></tr></tbody></table>
<p class="${batch.cashTotal === cashBook ? 'ok' : 'bad'}">계수 ${money(batch.cashTotal)} / 장부 현금 ${money(cashBook)} → ${batch.cashTotal === cashBook ? '일치' : '차이 ' + money(batch.cashTotal - cashBook)}</p>
${sign(['계수자 ' + (batch.counters?.[0] || ''), '계수자 ' + (batch.counters?.[1] || ''), '회계'])}</article>`;
  return one('계수자 보관용') + '<div class="page-break"></div>' + one('회계 보관용');
}
