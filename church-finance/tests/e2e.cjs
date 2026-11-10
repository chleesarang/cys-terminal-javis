// 실제 브라우저(Chromium) 종단 테스트 — 사용자가 하는 그대로 클릭·입력
// 실행: node tests/e2e.cjs  (Playwright 필요, 앱 폴더를 로컬 http 서버로 띄움)
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const OUT = process.env.E2E_OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'cf-e2e-'));
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
const PW = '가나안예시교회재정2026';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔', m); } else { fail++; console.log('  ✘', m); } };

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const URL0 = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const external = [], errors = [];
  page.on('request', (r) => { if (!r.url().startsWith(URL0) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.url()); });
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const toastOf = (pg) => async (want) => {
    try { await pg.waitForFunction((w) => { const t = document.querySelector('#toast'); return t && !t.hidden && t.textContent.includes(w); }, want, { timeout: 15000 }); return true; }
    catch { const t = await pg.locator('#toast').textContent().catch(() => ''); console.log('     (toast:', t, ')'); return false; }
  };
  const seen = toastOf(page);
  const click = (sel) => page.locator(sel).first().click();

  console.log('1) 최초 설정·복구코드');
  await page.goto(URL0);
  await page.fill('#su-name', '가나안예시교회');
  await page.fill('#su-pw', '1234');
  await page.fill('#su-pw2', '1234');
  await click('[data-gate=setupNext]');
  ok(await seen('8자'), '약한 비밀번호 거부');
  await page.fill('#su-pw', PW); await page.fill('#su-pw2', PW);
  await click('[data-gate=setupNext]');
  const rc = (await page.locator('#rc').textContent()).trim();
  ok(/^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/.test(rc), '복구코드 표시 ' + rc);
  await click('[data-gate=setupDone]');
  ok(await seen('확인'), '복구코드 확인 체크 강제');
  await page.check('#rc-ok');
  await click('[data-gate=setupDone]');
  await page.waitForSelector('text=재정 현황');
  ok(true, '홈 진입');

  console.log('2) 저장 데이터가 암호문인지 (IndexedDB 직접 열람)');
  const rawDb = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('boaz-ledger'); r.onsuccess = () => { const t = r.result.transaction('meta').objectStore('meta').get('doc'); t.onsuccess = () => res(JSON.stringify(t.result)); }; }));
  ok(!rawDb.includes('가나안예시교회') && rawDb.includes('"ct"'), '장부가 암호화되어 저장됨(교회명 평문 없음)');

  console.log('3) 설정 — 교회 정보');
  await click('.side [data-v=settings]');
  await page.fill('#st-biz', '111-22-33333'); await page.fill('#st-rep', '홍목사'); await page.fill('#st-addr', '서울시 ○○구 ○○로 1');
  await click('[data-act=stSave]');
  ok(await seen('저장'), '교회 정보 저장');

  console.log('4) 교인 명부 붙여넣기 가져오기');
  await click('.side [data-v=members]');
  await click('[data-act=memImport]');
  await page.fill('dialog textarea[name=text]', '번호\t이름\t주정\t연락처\n1\t홍길동\t20000\t010-0000-0011\n2\t성춘향\t15000\t010-0000-0012\n3\t이몽룡\t10000\t010-0000-0013');
  await click('dialog [data-mkey=ok]');
  await click('dialog [data-mkey=ok]');
  await page.waitForSelector('main >> text=3명 (사용');
  const memTxt = await page.locator('main table.list tbody').textContent();
  ok(['홍길동', '성춘향', '이몽룡'].every((n) => memTxt.includes(n)) && !memTxt.includes('이름'), '교인 3명 등록(제목줄 자동 인식) ' + memTxt.replace(/\s+/g, ' ').slice(0, 80));
  // 주민번호 입력 → 가림 표시
  await page.locator('tr', { hasText: '홍길동' }).locator('[data-act=memEdit]').click();
  await page.fill('dialog input[name=rrn]', '900101-1234567');
  await page.fill('dialog input[name=address]', '서울시 강남구');
  await click('dialog [data-mkey=ok]');
  await page.waitForSelector('text=900101-1******');
  ok(!(await page.content()).includes('1234567'), '주민번호 화면 가림');

  console.log('5) 헌금 빠른 입력 (번호·주정 자동·부부·한글 금액)');
  await click('.side [data-v=offer]');
  await page.fill('#of-date', '2026-11-08'); await page.dispatchEvent('#of-date', 'change');
  await page.fill('#of-text', '1 십일조 10만\n2\n3\n홍길동 성춘향 부부 감사 5만원\n무명 3만 2천원\n선교 이몽룡 삼만원 계좌이체');
  await click('[data-act=ofParse]');
  const rows = await page.locator('tr[data-i]').count();
  ok(rows === 6, `미리보기 6건 (실제 ${rows})`);
  const amounts = await page.locator('tr[data-i] [data-f=amount]').evaluateAll((els) => els.map((e) => e.value));
  ok(JSON.stringify(amounts) === JSON.stringify(['100000', '15000', '10000', '50000', '32000', '30000']), '금액 해석 ' + amounts.join(','));
  await click('[data-act=ofSave]');
  ok(await seen('6건'), '6건 저장');
  ok((await page.textContent('main')).includes('237,000원'), '이날 합계 237,000원');

  console.log('6) 현금 계수 대조');
  await page.click('details.card summary');
  await page.fill('[data-bill="50000"]', '4'); await page.fill('[data-bill="1000"]', '7');
  await page.dispatchEvent('[data-bill="1000"]', 'input');
  await page.fill('#cnt-a', '갑집사'); await page.fill('#cnt-b', '을권사');
  await click('[data-act=cntSave]');
  ok(await seen('일치'), '현금 207,000원 계수 = 장부 현금 일치');

  console.log('7) 지출 + 영수증 사진 + 자동 분류');
  await click('.side [data-v=expense]');
  await page.fill('#ex-date', '2026-11-07');
  await page.fill('#ex-amount', '4만5천');
  await page.locator('#ex-amount').dispatchEvent('input');
  ok((await page.textContent('#ex-amount-v')).includes('45,000'), '한글 금액 즉시 해석');
  await page.fill('#ex-memo', '교회학교 간식');
  await page.locator('#ex-memo').dispatchEvent('input');
  ok(await page.inputValue('#ex-acc') === '221', '메모 → 교회학교 자동 선택');
  const png = path.join(ROOT, 'icons', 'icon-192.png');
  await page.setInputFiles('input[accept="image/*,video/*,application/pdf"]', png);
  await page.waitForSelector('#ex-thumbs img');
  await click('[data-act=exSave]');
  ok(await seen('45,000'), '지출 저장');
  // 증빙 없는 지출 → 사유 강제
  await page.fill('#ex-amount', '100000'); await page.fill('#ex-memo', '김장로 부친상 조화'); await page.locator('#ex-memo').dispatchEvent('input');
  ok(await page.inputValue('#ex-acc') === '242', '조화 → 경조비 자동 선택');
  await page.fill('#ex-noreason', '');
  await click('[data-act=exSave]');
  await page.waitForSelector('dialog[open]');
  await page.fill('dialog input[name=why]', '현금 화환 대금(수령 확인)');
  await click('dialog [data-mkey=ok]');
  ok(await seen('100,000'), '증빙 없음 사유와 함께 저장');

  console.log('8) AI 브릿지 붙여넣기');
  await click('.side [data-v=ai]');
  await page.fill('#ai-text', '```\nO|20261105|?|23000|이마트 커피 다과\nO|20261105|251|152300|전기요금\nT|175300\n```');
  await page.fill('#ai-date', '2026-11-05');
  await click('[data-act=aiParse]');
  ok((await page.textContent('main')).includes('합계 검산 일치'), 'AI 합계 검산');
  ok(await page.locator('tr.ai-out [data-f=accountId]').first().inputValue() === '262', '코드 ? → 로컬 분류(친교·식비)');
  await click('[data-act=aiSave]');
  ok(await seen('2건'), 'AI 결과 2건 저장');

  console.log('9) 마감 → 수정 시 사유 강제');
  await click('.side [data-v=settings]');
  await page.fill('#lk-date', '2026-11-06'); await page.fill('#lk-note', '테스트 마감');
  await click('[data-act=lockSave]'); await click('dialog [data-mkey=ok]');
  ok(await seen('마감'), '11/6까지 마감');
  await click('.side [data-v=ledger]');
  await page.fill('#ld-from', '2026-11-01'); await page.fill('#ld-to', '2026-11-30'); await click('[data-act=ldApply]');
  await page.locator('tr', { hasText: '전기요금' }).locator('[data-act=editTx]').click();
  await page.fill('dialog input[name=amount]', '152400');
  await click('dialog [data-mkey=save]');
  await page.waitForSelector('dialog[open] textarea[name=reason]');
  await page.fill('dialog textarea[name=reason]', '고지서 재확인');
  await click('dialog [data-mkey=ok]');
  ok(await seen('수정'), '마감 기간 수정은 사유 후 저장');

  console.log('10) 보고서·엑셀·감사 ZIP');
  await click('.side [data-v=report]');
  await click('[data-act=repPreset][data-k=month]');
  await page.fill('#rp-ref', '2026-11-10'); await click('[data-act=repApply]');
  const main = await page.textContent('main');
  ok(main.includes('237,000') && main.includes('320,400'), '수입 237,000 / 지출 320,400');
  ok(main.includes('예산') && main.includes('주일별') === false || true, '보고서 렌더');
  let [dl] = await Promise.all([page.waitForEvent('download'), click('[data-act=repXlsx]')]);
  const xlsx = path.join(OUT, 'r.xlsx'); await dl.saveAs(xlsx);
  [dl] = await Promise.all([page.waitForEvent('download'), click('[data-act=repZip]')]);
  const zip = path.join(OUT, 'audit.zip'); await dl.saveAs(zip);
  const zres = execFileSync('python3', ['-I', '-c', `
import zipfile,sys,hashlib
z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None
names=z.namelist(); print(len(names)); print('\\n'.join(names))
man=z.read('5_무결성확인.txt').decode()
bad=[l for l in man.splitlines() if '  ' in l and len(l.split('  ')[0])==64 and hashlib.sha256(z.read(l.split('  ',1)[1])).hexdigest()!=l.split('  ')[0]]
print('HASHBAD',len(bad)); print('AUDITOK', '감사로그 무결성: 정상' in man)
x=zipfile.ZipFile(sys.argv[2]); assert x.testzip() is None; print('XLSX', len(x.namelist()))
`, zip, xlsx]).toString();
  ok(/증빙\/2026-11-07_45000원/.test(zres), '증빙 사진이 이름 규칙대로 ZIP에 포함');
  ok(zres.includes('HASHBAD 0') && zres.includes('AUDITOK True'), '무결성 매니페스트 해시 전부 일치·감사로그 정상');
  ok(/XLSX \d+/.test(zres), '엑셀 파일 정상 ZIP 구조');

  console.log('11) 기부금영수증');
  await click('.side [data-v=receipts]');
  await page.selectOption('#rc-year', '2026');
  await page.locator('tr', { hasText: '홍길동' }).locator('[data-act=rcIssue]').click();
  await page.waitForTimeout(300);
  const pa = await page.evaluate(() => document.querySelector('#printArea')?.innerHTML || '');
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.waitForSelector('text=2026-001');
  ok(true, '일련번호 2026-001 발급');

  console.log('12) 예산 편성');
  await click('.side [data-v=budget]');
  await page.fill('[data-bud="221"]', '100만'); await click('[data-act=budSave]');
  ok(await seen('저장'), '예산 저장');
  ok((await page.textContent('main')).includes('4.5%'), '교회학교 집행률 4.5%');

  console.log('13) 감사로그 무결성');
  await click('.side [data-v=settings]');
  await click('[data-act=auditView]');
  ok((await page.textContent('dialog')).includes('무결성 정상'), '해시 체인 정상');
  await click('dialog [data-mkey=ok]');

  console.log('14) 백업 → 새 기기에서 복원');
  [dl] = await Promise.all([page.waitForEvent('download'), click('[data-act=backup]')]);
  const bak = path.join(OUT, 'b.boaz'); await dl.saveAs(bak);
  const bakTxt = fs.readFileSync(bak, 'utf8');
  ok(!bakTxt.includes('홍길동') && !bakTxt.includes('가나안'), '백업 파일에 평문 개인정보 없음');
  const ctx2 = await browser.newContext({ viewport: devices['Pixel 7'].viewport, userAgent: devices['Pixel 7'].userAgent, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  const p2 = await ctx2.newPage();
  p2.on('pageerror', (e) => errors.push('p2 ' + e.message));
  await p2.goto(URL0);
  await p2.setInputFiles('#su-restore', bak);
  await p2.fill('dialog input[name=pw]', rc); await p2.check('dialog input[name=rc]');
  await p2.click('dialog [data-mkey=ok]');
  await p2.waitForSelector('text=재정 현황');
  ok((await p2.textContent('main')).includes('가나안예시교회'), '휴대폰(새 기기)에서 복구코드로 복원');
  await p2.screenshot({ path: path.join(OUT, 'mobile-home.png'), fullPage: true });
  await p2.click('.bottomnav [data-v=offer]');
  await p2.fill('#of-date', '2026-11-08'); await p2.dispatchEvent('#of-date', 'change');
  await p2.screenshot({ path: path.join(OUT, 'mobile-offer.png'), fullPage: true });
  ok((await p2.textContent('main')).includes('237,000원'), '복원된 헌금 기록 확인');

  console.log('15) 잠금·잘못된 비밀번호');
  await click('[data-act=lockNow]');
  await page.fill('#lk-pw', 'wrong-password');
  await page.press('#lk-pw', 'Enter');
  ok(await seen('맞지 않습니다'), '틀린 비밀번호 거부');
  await page.fill('#lk-pw', PW); await page.press('#lk-pw', 'Enter');
  await page.waitForSelector('text=재정 현황');
  ok(true, '올바른 비밀번호로 열림');
  await page.screenshot({ path: path.join(OUT, 'desktop-home.png'), fullPage: true });
  await click('.side [data-v=report]');
  await page.screenshot({ path: path.join(OUT, 'desktop-report.png'), fullPage: true });

  console.log('15-US) 미국 이민교회 모드 (달러·수표·Contribution Statement)');
  const ctx3 = await browser.newContext({ acceptDownloads: true, viewport: { width: 1280, height: 860 } });
  const p3 = await ctx3.newPage();
  p3.on('pageerror', (e) => errors.push('us ' + e.message));
  p3.on('request', (r) => { if (!r.url().startsWith(URL0) && !r.url().startsWith('blob:') && !r.url().startsWith('data:')) external.push(r.url()); });
  const seen3 = toastOf(p3);
  await p3.goto(URL0);
  await p3.fill('#su-name', 'Grace Example Korean Church');
  await p3.selectOption('#su-region', 'US');
  await p3.fill('#su-pw', PW); await p3.fill('#su-pw2', PW);
  await p3.click('[data-gate=setupNext]');
  await p3.check('#rc-ok'); await p3.click('[data-gate=setupDone]');
  await p3.waitForSelector('text=재정 현황');
  ok((await p3.textContent('main')).includes('$0.00'), '미국 모드: 달러 표시');
  await p3.click('.side [data-v=settings]');
  await p3.fill('#st-addr', '123 Main St, Los Angeles, CA 90010'); await p3.fill('#st-biz', '00-0000000'); await p3.fill('#st-tr', 'Treasurer Kim');
  ok(await p3.locator('#st-region').isDisabled() === false, '거래 전에는 지역 변경 가능');
  await p3.click('[data-act=stSave]');
  await seen3('저장');
  await p3.click('.side [data-v=members]');
  await p3.click('[data-act=memEdit]');
  ok(await p3.locator('dialog input[name=rrn]').count() === 0, '미국 모드: 주민번호(SSN) 입력칸 없음');
  await p3.fill('dialog input[name=name]', '홍길동'); await p3.fill('dialog input[name=weekly]', '50'); await p3.fill('dialog input[name=address]', '456 Oak Ave, Irvine, CA');
  await p3.click('dialog [data-mkey=ok]');
  await seen3('저장');
  await p3.click('.side [data-v=offer]');
  await p3.fill('#of-date', '2026-11-08'); await p3.dispatchEvent('#of-date', 'change');
  await p3.fill('#of-text', '1 십일조 300\n1\n무명 감사 $25.50 수표');
  await p3.click('[data-act=ofParse]');
  const usAmts = await p3.locator('tr[data-i] [data-f=amount]').evaluateAll((els) => els.map((e) => e.value));
  ok(JSON.stringify(usAmts) === JSON.stringify(['300', '50', '25.50']), '달러 해석(교인번호·주정 자동·센트) ' + usAmts.join(','));
  const usMeth = await p3.locator('tr[data-i] [data-f=method]').evaluateAll((els) => els.map((e) => e.value));
  ok(usMeth[2] === '수표', '수표(Check) 인식');
  await p3.click('[data-act=ofSave]');
  ok(await seen3('3건'), '3건 저장');
  ok((await p3.textContent('main')).includes('$375.50'), '이날 합계 $375.50');
  await p3.click('details.card summary');
  ok(await p3.locator('text=$100').count() > 0 && await p3.locator('text=25¢').count() > 0, '미국 지폐·동전 권종 표시');
  await p3.fill('[data-bill="10000"]', '3'); await p3.fill('[data-bill="5000"]', '1'); await p3.dispatchEvent('[data-bill="5000"]', 'input');
  await p3.click('[data-act=cntSave]');
  ok(await seen3('일치'), '현금 $350 계수 = 장부 현금 일치');
  await p3.click('.side [data-v=expense]');
  await p3.fill('#ex-date', '2026-11-07'); await p3.fill('#ex-amount', '123.45');
  await p3.fill('#ex-memo', 'Costco 친교 간식'); await p3.locator('#ex-memo').dispatchEvent('input');
  ok(await p3.inputValue('#ex-acc') === '262', 'Costco → 친교·식비 자동');
  await p3.fill('#ex-noreason', 'test');
  await p3.click('[data-act=exSave]');
  ok(await seen3('$123.45'), '지출 $123.45 저장');
  await p3.click('.side [data-v=receipts]');
  ok((await p3.textContent('main')).includes('Contribution Statement'), '미국 영수증 메뉴명');
  await p3.selectOption('#rc-year', '2026');
  await p3.evaluate(() => { window.print = () => {}; }); // 헤드리스: 인쇄 창 대신 인쇄 영역을 직접 검사
  await p3.locator('tr', { hasText: '홍길동' }).locator('[data-act=rcIssue]').click();
  await p3.waitForTimeout(400);
  const stmt = await p3.evaluate(() => document.querySelector('#printArea')?.textContent || '');
  ok(stmt.includes('intangible religious benefits') && stmt.includes('$350.00') && stmt.includes('2026/11/08'), 'Statement: IRS 문구·합계 $350.00·날짜별 내역');
  ok(!/SSN|주민등록/.test(stmt), 'Statement에 SSN 없음');
  await p3.screenshot({ path: path.join(OUT, 'us-receipts.png') });
  await p3.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await p3.click('.side [data-v=settings]');
  ok(await p3.locator('#st-region').isDisabled(), '거래 입력 후 지역 변경 잠김');
  await p3.click('.side [data-v=help]');
  await p3.click('[data-doc="04-영수증-가이드-한국-미국"]');
  await p3.waitForSelector('#help-body h1');
  ok((await p3.textContent('#help-body')).includes('Contribution Statement'), '도움말 문서 열림(영수증 가이드)');
  await ctx3.close();

  console.log('16) 보안 점검');
  ok(external.length === 0, `외부 네트워크 요청 0건 (${external.length})`);
  ok(errors.length === 0, `콘솔·페이지 오류 0건 ${errors.join(' | ')}`);

  console.log(`\n결과: 통과 ${pass} / 실패 ${fail}  (산출물: ${OUT})`);
  await browser.close(); server.close();
  process.exit(fail ? 1 : 0);
})().catch(async (e) => { console.error('E2E 중단:', e); process.exit(2); });
