import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const USER = process.env.USERNAME || 'Administrator';
const executablePath = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
const userDataDir = `C:/Users/${USER}/AppData/Local/BraveSoftware/Brave-Browser/User Data`;

const TARGET_URLS = [
  'https://detail.tmall.com/item.htm?id=990894933632',
  'https://item.taobao.com/item.htm?id=904546931762'
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function uniq(arr) {
  return Array.from(new Set(arr.filter(Boolean).map(clean).filter(Boolean)));
}

async function extractListing(page) {
  const bodyText = await page.evaluate(() => document.body?.innerText || '');
  const challenge = /验证码|captcha|安全验证|异常流量|请先登录/i.test(bodyText);

  const data = await page.evaluate(() => {
    const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

    const titleSel = [
      'h1',
      '.tb-main-title',
      '.tb-detail-hd h1',
      '[class*=ItemHeader] [class*=mainTitle]',
      '[class*=title]'
    ];
    let title = document.title || '';
    for (const sel of titleSel) {
      const n = document.querySelector(sel);
      if (n && text(n).length > 3) { title = text(n); break; }
    }

    const priceTexts = [];
    const priceSel = [
      '.tb-rmb-num', '.tm-price', '[class*=Price] [class*=price]',
      '[class*=priceText]', '[class*=price]', '.J_Price', '.price'
    ];
    for (const sel of priceSel) {
      for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 120)) {
        const t = text(n);
        if (t && /\d/.test(t) && t.length < 80) priceTexts.push(t);
      }
    }

    const optionTexts = [];
    const optionSel = [
      '.J_TSaleProp li', '.J_TSaleProp a',
      '[class*=sku] li', '[class*=Sku] li', '[class*=sku] button',
      '[class*=prop] li', '[class*=Prop] li',
      '[data-property] li', '[data-sku] li',
      '[role=radio]', '[role=option]'
    ];
    for (const sel of optionSel) {
      for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 200)) {
        const t = text(n);
        if (t && t.length <= 120) optionTexts.push(t);
      }
    }

    const salesTexts = [];
    const salesSel = ['[class*=sale]', '[class*=销量]', '[class*=Sales]', '.tm-ind-panel', '.tb-meta'];
    for (const sel of salesSel) {
      for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 80)) {
        const t = text(n);
        if (t && /(销量|已售|已付款|人付款|sale)/i.test(t) && t.length < 120) salesTexts.push(t);
      }
    }

    return { title, priceTexts, optionTexts, salesTexts };
  });

  return {
    title: clean(data.title),
    prices: uniq(data.priceTexts).slice(0, 50),
    packageOptions: uniq(data.optionTexts).slice(0, 80),
    salesHints: uniq(data.salesTexts).slice(0, 30),
    challenge
  };
}

async function main() {
  const out = { keyword: 'brave', level: 'listing-detail', ts: new Date().toISOString(), listings: [] };

  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: false,
    locale: 'zh-CN',
    viewport: { width: 1366, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });

  try {
    for (const url of TARGET_URLS) {
      const page = await context.newPage();
      const row = { url };
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await sleep(9000);
        await page.mouse.wheel(0, 400);
        await sleep(2000);
        Object.assign(row, await extractListing(page));
      } catch (e) {
        row.error = e.message;
      } finally {
        await page.close();
      }
      out.listings.push(row);
      await sleep(1500);
    }
  } finally {
    await context.close();
  }

  const outDir = path.resolve('data', 'taobao-brave-buyer');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `brave-package-probe-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');
  console.log(JSON.stringify({ ok: true, outPath, listings: out.listings.length }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message }, null, 2));
  process.exit(1);
});
