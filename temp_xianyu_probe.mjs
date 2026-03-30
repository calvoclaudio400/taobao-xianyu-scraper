import { chromium } from 'playwright-core';
import { existsSync } from 'fs';

const user = process.env.USERNAME || 'Administrator';
const braveExe = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
const braveProfile = `C:/Users/${user}/AppData/Local/BraveSoftware/Brave-Browser/User Data`;
if (!existsSync(braveExe) || !existsSync(braveProfile)) throw new Error('Brave missing');

const urls = [
  'https://www.goofish.com/search?keyword=brave',
  'https://2.taobao.com/search.htm?q=brave',
  'https://s.2.taobao.com/list/list.htm?q=brave',
  'https://m.goofish.com/search?keyword=brave'
];

const context = await chromium.launchPersistentContext(braveProfile, {
  executablePath: braveExe,
  headless: false,
  locale: 'zh-CN',
  viewport: { width: 1366, height: 900 },
  args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
});

const out = [];
for (const url of urls) {
  const page = context.pages()[0] || await context.newPage();
  let ok = true;
  let err = null;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(7000);
    for (let i=0;i<4;i++){ await page.mouse.wheel(0,500); await page.waitForTimeout(1500); }

    const res = await page.evaluate(() => {
      const norm=(s)=>String(s||'').replace(/^\/\//,'https://').replace(/&amp;/g,'&');
      const hrefs = Array.from(document.querySelectorAll('a[href]')).map(a => norm(a.getAttribute('href')||a.href||''));
      const unique = Array.from(new Set(hrefs.filter(Boolean)));
      const byPat = {
        taobao2: unique.filter(u=>/2\.taobao\.com\/item\.htm/i.test(u)).length,
        goofishItem: unique.filter(u=>/goofish\.com\/(item|trade|search)/i.test(u)).length,
        mGoofishItem: unique.filter(u=>/m\.goofish\.com\/(item|trade|search)/i.test(u)).length,
        taobaoItem: unique.filter(u=>/item\.taobao\.com\/item\.htm|detail\.tmall\.com\/item\.htm/i.test(u)).length,
      };
      return {
        title: document.title,
        host: location.host,
        totalLinks: unique.length,
        byPat,
        sample: unique.slice(0,25),
        body: (document.body?.innerText||'').slice(0,1200)
      };
    });
    out.push({ url, ok, ...res });
  } catch (e) {
    ok = false; err = e.message;
    out.push({ url, ok, err });
  }
}

await context.close();
console.log(JSON.stringify(out, null, 2));
