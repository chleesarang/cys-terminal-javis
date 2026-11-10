// 매뉴얼용 화면 자동 촬영 — 가상의 예시 교회 데이터로 docs/img/*.jpg 생성
// 실행: node tests/shots.cjs   (앱이 바뀌면 다시 실행해 매뉴얼 그림 갱신)
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const IMG = path.join(ROOT, 'docs', 'img');
fs.mkdirSync(IMG, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]).replace(/^\/$/, '/index.html'));
  if (!p.startsWith(ROOT) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
const PW = 'example-church-2026';

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const URL0 = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const phone = { ...devices['Pixel 7'], deviceScaleFactor: 1.5 };
  const ctx = await browser.newContext({ ...phone });
  const page = await ctx.newPage();
  const shot = async (name, opt = {}) => { await page.waitForTimeout(250); await page.screenshot({ path: path.join(IMG, name + '.jpg'), type: 'jpeg', quality: 78, ...opt }); console.log('  📸', name); };
  const into = async (sel) => { await page.waitForTimeout(300); await page.evaluate((q) => { const el = q.startsWith('text=') ? [...document.querySelectorAll('h3,p,summary')].find((e) => e.textContent.includes(q.slice(5))) : document.querySelector(q); el?.scrollIntoView({ block: 'center' }); }, sel); };
  const hideToast = () => page.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.hidden = true; });
  const tap = (sel) => page.locator(sel).first().click();
  const go = async (v) => { if (await page.locator(`.bottomnav [data-v=${v}]`).count()) await tap(`.bottomnav [data-v=${v}]`); else { await tap('.bottomnav [data-v=more]'); await tap(`main [data-v=${v}]`); } await hideToast(); };

  await page.goto(URL0);
  await page.fill('#su-name', '가나안예시교회');
  await page.fill('#su-pw', PW); await page.fill('#su-pw2', PW);
  await shot('01-처음설정');
  await tap('[data-gate=setupNext]');
  await shot('02-복구코드');
  await page.check('#rc-ok'); await tap('[data-gate=setupDone]');
  await page.waitForSelector('text=재정 현황');
  // 교회 정보
  await go('settings');
  await page.fill('#st-biz', '000-00-00000'); await page.fill('#st-rep', '담임목사'); await page.fill('#st-addr', '○○시 ○○구 ○○로 00'); await page.fill('#st-tr', '회계집사');
  await tap('[data-act=stSave]');
  // 교인 가져오기
  await go('members');
  await tap('[data-act=memImport]');
  await page.fill('dialog textarea[name=text]', '번호\t이름\t주정\t연락처\n1\t홍길동\t20000\t010-0000-0001\n2\t성춘향\t15000\t010-0000-0002\n3\t이몽룡\t10000\t010-0000-0003\n4\t임꺽정\t30000\t010-0000-0004\n5\t심청\t10000\t010-0000-0005');
  await shot('03-교인-붙여넣기');
  await tap('dialog [data-mkey=ok]');
  await shot('04-교인-열맞추기');
  await tap('dialog [data-mkey=ok]');
  await page.waitForSelector('main >> text=5명 (사용');
  await hideToast();
  await shot('05-교인명부');
  // 예산·이월
  await go('more'); await tap('main [data-v=budget]');
  await page.fill('[data-bud="101"]', '1000만'); await page.fill('[data-bud="102"]', '3000만'); await page.fill('[data-bud="221"]', '300만'); await page.fill('[data-bud="262"]', '200만'); await page.fill('[data-bud="251"]', '400만');
  await tap('[data-act=budSave]');
  await page.fill('[data-open="일반회계"]', '5,000,000'); await tap('[data-act=openSave]');
  await hideToast();
  await shot('06-예산편성', { fullPage: false });
  // 헌금
  await go('offer');
  await page.fill('#of-date', '2026-11-08'); await page.dispatchEvent('#of-date', 'change');
  await page.fill('#of-text', '1 십일조 50만\n2\n3\n4\n홍길동 성춘향 부부 감사 10만\n무명 32만 4천원\n선교 심청 삼만원 계좌이체');
  await shot('07-헌금-입력');
  await tap('[data-act=ofParse]');
  await into('text=미리보기 — 확인 후 저장');
  await shot('08-헌금-미리보기');
  await tap('[data-act=ofSave]');
  await hideToast();
  await page.click('details.card summary');
  await page.fill('[data-bill="50000"]', '18'); await page.fill('[data-bill="10000"]', '7'); await page.fill('[data-bill="5000"]', '1'); await page.fill('[data-bill="1000"]', '4');
  await page.dispatchEvent('[data-bill="1000"]', 'input');
  await page.fill('#cnt-a', '계수집사1'); await page.fill('#cnt-b', '계수권사2');
  await tap('[data-act=cntSave]');
  await hideToast();
  await into('#cnt-cmp');
  await shot('09-현금계수');
  // 지출
  await go('expense');
  await page.fill('#ex-date', '2026-11-07'); await page.fill('#ex-amount', '4만5천'); await page.locator('#ex-amount').dispatchEvent('input');
  await page.fill('#ex-memo', '교회학교 간식'); await page.locator('#ex-memo').dispatchEvent('input');
  await page.setInputFiles('input[accept="image/*,video/*,application/pdf"]', path.join(ROOT, 'docs', 'img', 'sample-receipt.png'));
  await page.waitForSelector('#ex-thumbs img');
  await shot('10-지출-영수증');
  await tap('[data-act=exSave]');
  for (const [a, m] of [['152300', '전기요금 계좌이체'], ['23000', '목양실 커피 다과'], ['70000', '승합차 주유']]) {
    await page.fill('#ex-amount', a); await page.fill('#ex-memo', m); await page.locator('#ex-memo').dispatchEvent('input');
    await page.fill('#ex-noreason', '자동이체 내역으로 대체');
    await tap('[data-act=exSave]'); await page.waitForTimeout(200);
  }
  await hideToast();
  // AI
  await go('more'); await tap('main [data-v=ai]');
  await page.fill('#ai-text', 'O|20261105|?|38500|H마트 친교 식자재\nO|20261105|204|80000|주보 인쇄\nT|118500');
  await page.fill('#ai-date', '2026-11-05');
  await tap('[data-act=aiParse]');
  await into('text=합계 검산 일치');
  await shot('11-AI-붙여넣기');
  await tap('[data-act=aiSave]');
  await hideToast();
  // 홈
  await go('home');
  await shot('12-홈');
  // 도움말
  await go('more'); await tap('main [data-v=help]');
  await shot('13-도움말');
  // 백업
  await go('more'); await tap('main [data-v=settings]');
  await into('text=백업 · 다른 기기로 옮기기');
  await shot('14-백업');
  await ctx.close();

  // ── PC: 보고서·영수증 ──
  const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const p2 = await ctx2.newPage();
  // 같은 데이터: 백업 없이 새로 만들되 핵심만 빠르게
  await p2.goto(URL0);
  await p2.fill('#su-name', '가나안예시교회'); await p2.fill('#su-pw', PW); await p2.fill('#su-pw2', PW);
  await p2.click('[data-gate=setupNext]'); await p2.check('#rc-ok'); await p2.click('[data-gate=setupDone]');
  await p2.waitForSelector('text=재정 현황');
  await p2.click('.side [data-v=settings]');
  await p2.fill('#st-biz', '000-00-00000'); await p2.fill('#st-rep', '담임목사'); await p2.fill('#st-addr', '○○시 ○○구 ○○로 00'); await p2.click('[data-act=stSave]');
  await p2.click('.side [data-v=members]'); await p2.click('[data-act=memEdit]');
  await p2.fill('dialog input[name=name]', '홍길동'); await p2.fill('dialog input[name=weekly]', '20000'); await p2.fill('dialog input[name=address]', '○○시 ○○구'); await p2.fill('dialog input[name=rrn]', '000101-3000000');
  await p2.click('dialog [data-mkey=ok]');
  await p2.click('.side [data-v=offer]');
  await p2.fill('#of-date', '2026-11-08'); await p2.dispatchEvent('#of-date', 'change');
  await p2.fill('#of-text', '1 십일조 50만\n1\n무명 32만 4천원\n감사 성춘향 10만');
  await p2.click('[data-act=ofParse]'); await p2.click('[data-act=ofSave]');
  await p2.fill('#of-date', '2026-11-01'); await p2.dispatchEvent('#of-date', 'change');
  await p2.fill('#of-text', '1 십일조 50만\n1\n무명 28만원\n선교 이몽룡 5만');
  await p2.click('[data-act=ofParse]'); await p2.click('[data-act=ofSave]');
  await p2.click('.side [data-v=expense]');
  for (const [a, m] of [['45000', '교회학교 간식'], ['152300', '전기요금'], ['80000', '주보 인쇄']]) {
    await p2.fill('#ex-date', '2026-11-05'); await p2.fill('#ex-amount', a); await p2.fill('#ex-memo', m); await p2.locator('#ex-memo').dispatchEvent('input');
    await p2.fill('#ex-noreason', '자동이체'); await p2.click('[data-act=exSave]'); await p2.waitForTimeout(150);
  }
  await p2.click('.side [data-v=report]');
  await p2.fill('#rp-ref', '2026-11-10'); await p2.click('[data-act=repApply]');
  await p2.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.hidden = true; });
  await p2.screenshot({ path: path.join(IMG, '15-보고서.jpg'), type: 'jpeg', quality: 78, fullPage: true }); console.log('  📸 15-보고서');
  await p2.click('.side [data-v=receipts]');
  await p2.selectOption('#rc-year', '2026');
  await p2.evaluate(() => { window.print = () => {}; });
  await p2.locator('tr', { hasText: '홍길동' }).locator('[data-act=rcIssue]').click();
  await p2.waitForTimeout(400);
  await p2.emulateMedia({ media: 'print' });
  await p2.screenshot({ path: path.join(IMG, '16-기부금영수증-한국.jpg'), type: 'jpeg', quality: 80, fullPage: true }); console.log('  📸 16-기부금영수증-한국');
  await p2.emulateMedia({ media: 'screen' });
  await p2.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await ctx2.close();

  // ── 미국 이민교회 ──
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 });
  const p3 = await ctx3.newPage();
  await p3.goto(URL0);
  await p3.fill('#su-name', 'Grace Example Korean Church'); await p3.selectOption('#su-region', 'US');
  await p3.fill('#su-pw', PW); await p3.fill('#su-pw2', PW);
  await p3.click('[data-gate=setupNext]'); await p3.check('#rc-ok'); await p3.click('[data-gate=setupDone]');
  await p3.waitForSelector('text=재정 현황');
  await p3.click('.side [data-v=settings]');
  await p3.fill('#st-addr', '123 Example Ave, Los Angeles, CA 90000'); await p3.fill('#st-biz', '00-0000000'); await p3.fill('#st-tr', 'Treasurer'); await p3.click('[data-act=stSave]');
  await p3.click('.side [data-v=members]'); await p3.click('[data-act=memEdit]');
  await p3.fill('dialog input[name=name]', '홍길동'); await p3.fill('dialog input[name=weekly]', '50'); await p3.fill('dialog input[name=address]', '456 Sample St, Irvine, CA 92600');
  await p3.click('dialog [data-mkey=ok]');
  await p3.click('.side [data-v=offer]');
  for (const [d, t] of [['2026-03-01', '1 십일조 300 수표\n1'], ['2026-06-07', '1 감사 $150 zelle\n1'], ['2026-11-08', '1 선교 75.50\n1']]) {
    await p3.fill('#of-date', d); await p3.dispatchEvent('#of-date', 'change');
    await p3.fill('#of-text', t); await p3.click('[data-act=ofParse]'); await p3.click('[data-act=ofSave]'); await p3.waitForTimeout(150);
  }
  await p3.evaluate(() => { const t = document.querySelector('#toast'); if (t) t.hidden = true; });
  await p3.screenshot({ path: path.join(IMG, '17-미국-헌금입력.jpg'), type: 'jpeg', quality: 78 }); console.log('  📸 17-미국-헌금입력');
  await p3.click('.side [data-v=receipts]');
  await p3.selectOption('#rc-year', '2026');
  await p3.evaluate(() => { window.print = () => {}; });
  await p3.locator('tr', { hasText: '홍길동' }).locator('[data-act=rcIssue]').click();
  await p3.waitForTimeout(400);
  await p3.emulateMedia({ media: 'print' });
  await p3.screenshot({ path: path.join(IMG, '18-Contribution-Statement-미국.jpg'), type: 'jpeg', quality: 80, fullPage: true }); console.log('  📸 18-Contribution-Statement-미국');
  await ctx3.close();
  await browser.close(); server.close();
})().catch((e) => { console.error('촬영 중단:', e); process.exit(2); });
