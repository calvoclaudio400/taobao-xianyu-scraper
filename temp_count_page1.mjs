import { chromium } from 'playwright-core';
import { existsSync } from 'fs';

const user = process.env.USERNAME || 'Administrator';
const braveExe = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
const braveProfile = `C:/Users/${user}/AppData/Local/BraveSoftware/Brave-Browser/User Data`;

if (!existsSync(braveExe) || !existsSync(braveProfile)) {
  console.log(JSON.stringify({ ok:false, error:'Brave executable/profile not found' }));
  process.exit(1);
}

const context = await chromium.launchPersistentContext(braveProfile, {
  executablePath: braveExe,
  headless: false,
  locale: 'zh-CN',
  viewport: { width: 1366, height: 900 },
  args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
});

async function countFor(url, type) {
  const page = context.pages()[0] || await context.newPage();
  await page.goto(url, { waitUntil:'domcontentloaded', timeout:90000 });
  await page.waitForTimeout(7000);
  for (let i=0;i<4;i++){ await page.mouse.wheel(0,450); await page.waitForTimeout(1400); }

  const data = await page.evaluate((t) => {
    const all = Array.from(document.querySelectorAll('a[href]')).map(a => a.href || a.getAttribute('href') || '');
    const norm = (s) => String(s||'').replace(/^\/\//,'https://').replace(/&amp;/g,'&');
    let re;
    if (t==='taobao') re = /item\.taobao\.com\/item\.htm|detail\.tmall\.com\/item\.htm/i;
    else re = /2\.taobao\.com\/item\.htm|goofish\.com\/item\?|m\.goofish\.com\/item\?/i;
    const urls = Array.from(new Set(all.map(norm).filter(u => re.test(u))));
    const body = (document.body?.innerText || '').slice(0,5000);
    return { count: urls.length, sample: urls.slice(0,5), bodyHint: body };
  }, type);
  return data;
}

const taobao = await countFor('https://s.taobao.com/search?q=brave','taobao');
const xianyu = await countFor('https://s.2.taobao.com/list/list.htm?q=brave','xianyu');

await context.close();
console.log(JSON.stringify({ ok:true, taobaoCount: taobao.count, xianyuCount: xianyu.count, taobaoSample: taobao.sample, xianyuSample: xianyu.sample }, null, 2));
