import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const USER = process.env.USERNAME || 'Administrator';
const executablePath = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
const userDataDir = `C:/Users/${USER}/AppData/Local/BraveSoftware/Brave-Browser/User Data`;

const URLS = [
  'https://detail.tmall.com/item.htm?id=990894933632',
  'https://item.taobao.com/item.htm?id=904546931762',
  'https://detail.tmall.com/item.htm?id=1019375808193',
  'https://item.taobao.com/item.htm?id=1020628995577',
  'https://item.taobao.com/item.htm?id=959779694662'
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const uniq = (arr) => Array.from(new Set((arr || []).map(clean))).filter(Boolean);

function parseFirstPrice(text) {
  const m = String(text || '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function parsePackageMeta(optionText) {
  const t = String(optionText || '');
  const count = (t.match(/(\d{3,})\s*次/) || [])[1] || null;
  const duration = /单月|月/.test(t) ? 'monthly' : (/年/.test(t) ? 'yearly' : 'unspecified');
  const keys = (t.match(/(\d+)\s*个\s*key/i) || [])[1] || (t.includes('一个key') ? '1' : (t.includes('两个key') ? '2' : null));
  return { count: count ? Number(count) : null, duration, keys: keys ? Number(keys) : null };
}

async function extractBaseInfo(page) {
  return await page.evaluate(() => {
    const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    let title = document.title || '';
    for (const sel of ['h1', '.tb-main-title', '.tb-detail-hd h1', '[class*=mainTitle]', '[class*=title]']) {
      const n = document.querySelector(sel);
      if (n && txt(n).length > 3) { title = txt(n); break; }
    }

    const salesPool = [];
    for (const sel of ['[class*=sale]', '[class*=销量]', '[class*=Sales]', '.tm-ind-panel', '.tb-meta']) {
      for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 120)) {
        const t = txt(n);
        if (t && /(销量|已售|已付款|人付款|sale)/i.test(t) && t.length < 120) salesPool.push(t);
      }
    }

    const basePricePool = [];
    for (const sel of ['.tb-rmb-num', '.tm-price', '.Price--priceText', '.J_Price', '[class*=priceText]', '[class*=price]']) {
      for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 120)) {
        const t = txt(n);
        if (t && /\d/.test(t) && t.length < 80) basePricePool.push(t);
      }
    }

    return {
      title,
      salesHints: Array.from(new Set(salesPool)).slice(0, 12),
      basePriceTexts: Array.from(new Set(basePricePool)).slice(0, 20)
    };
  });
}

async function extractPackageRows(page) {
  const candidateSelectors = [
    '.J_TSaleProp li', '.J_TSaleProp a',
    '[class*=sku] li', '[class*=Sku] li',
    '[class*=prop] li', '[class*=Prop] li',
    '[role=radio]', '[role=option]'
  ];

  const rows = [];

  for (const sel of candidateSelectors) {
    const count = await page.locator(sel).count();
    if (!count) continue;

    for (let i = 0; i < Math.min(count, 24); i++) {
      const loc = page.locator(sel).nth(i);
      const optionText = clean(await loc.textContent().catch(() => ''));
      if (!optionText || optionText.length < 2) continue;

      // click package option
      await loc.click({ timeout: 4000 }).catch(() => {});
      await sleep(900);

      const priceCandidates = await page.evaluate(() => {
        const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
        const out = [];
        for (const sel of ['.tb-rmb-num', '.tm-price', '.Price--priceText', '.J_Price', '[class*=priceText]', '[class*=price]']) {
          for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 120)) {
            const t = txt(n);
            if (t && /\d/.test(t) && t.length < 80) out.push(t);
          }
        }
        return Array.from(new Set(out)).slice(0, 15);
      });

      const maybePrice = parseFirstPrice(priceCandidates[0] || '');
      rows.push({ optionText, priceText: priceCandidates[0] || null, price: maybePrice });
    }

    if (rows.length) break; // first selector family that works
  }

  // dedupe by option text
  const seen = new Set();
  return rows.filter(r => {
    const k = r.optionText;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function main() {
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: false,
    locale: 'zh-CN',
    viewport: { width: 1366, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });

  const out = { keyword: 'brave', mode: 'package-matrix', ts: new Date().toISOString(), listings: [] };

  try {
    for (const url of URLS) {
      const page = await context.newPage();
      const row = { url };
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await sleep(8500);

        const base = await extractBaseInfo(page);
        const packages = await extractPackageRows(page);

        row.title = clean(base.title);
        row.salesHints = uniq(base.salesHints);
        row.basePriceTexts = uniq(base.basePriceTexts);
        row.packageMatrix = packages.map((p) => ({
          option: p.optionText,
          priceText: p.priceText,
          price: p.price,
          ...parsePackageMeta(p.optionText)
        }));
      } catch (e) {
        row.error = e.message;
      } finally {
        await page.close();
      }

      out.listings.push(row);
      await sleep(1400);
    }
  } finally {
    await context.close();
  }

  const outDir = path.resolve('data', 'taobao-brave-buyer');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `brave-package-matrix-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

  console.log(JSON.stringify({ ok: true, outPath, listings: out.listings.length }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message }, null, 2));
  process.exit(1);
});
