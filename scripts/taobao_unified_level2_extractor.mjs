import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const USER = process.env.USERNAME || 'Administrator';
const executablePath = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
const userDataDir = `C:/Users/${USER}/AppData/Local/BraveSoftware/Brave-Browser/User Data`;

const URLS = [
  'https://detail.tmall.com/item.htm?id=990894933632',
  'https://item.taobao.com/item.htm?id=904546931762',
  'https://detail.tmall.com/item.htm?id=1019375808193'
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

function uniq(arr) {
  return Array.from(new Set((arr || []).map(clean).filter(Boolean)));
}

function platformOf(url) {
  const h = new URL(url).hostname;
  if (h.includes('tmall.com')) return 'tmall';
  if (h.includes('item.taobao.com') || h.includes('taobao.com')) return 'taobao';
  if (h.includes('goofish.com') || h.includes('2.taobao.com')) return 'xianyu';
  return h;
}

function parseNumericPrices(lines = []) {
  const out = [];
  for (const line of lines) {
    const ms = String(line).match(/(\d+(?:\.\d+)?)/g) || [];
    for (const m of ms) {
      const n = Number(m);
      if (Number.isFinite(n) && n > 0 && n < 100000) out.push(n);
    }
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

function isBraveApiRelevant(text) {
  const t = String(text || '').toLowerCase();
  const include = ['brave', 'api', 'search', 'answers', 'spellcheck', 'autosuggest'];
  return include.some((k) => t.includes(k));
}

async function extractListing(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await sleep(9000);
  await page.mouse.wheel(0, 380);
  await sleep(1500);

  const bodyText = await page.evaluate(() => document.body?.innerText || '');
  const blocked = /验证码|captcha|安全验证|异常流量|请先登录|滑动验证/i.test(bodyText);

  const data = await page.evaluate(() => {
    const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

    let title = document.title || '';
    for (const sel of ['h1', '.tb-main-title', '.tb-detail-hd h1', '[class*=mainTitle]', '[class*=title]']) {
      const n = document.querySelector(sel);
      if (n && text(n).length > 3) { title = text(n); break; }
    }

    const priceTexts = [];
    for (const sel of ['.tb-rmb-num', '.tm-price', '.Price--priceText', '.J_Price', '[class*=priceText]', '[class*=price]']) {
      for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 200)) {
        const t = text(n);
        if (t && /\d/.test(t) && t.length < 120) priceTexts.push(t);
      }
    }

    const optionTexts = [];
    for (const sel of ['.J_TSaleProp li', '.J_TSaleProp a', '[class*=sku] li', '[class*=Sku] li', '[class*=prop] li', '[role=radio]', '[role=option]']) {
      for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 300)) {
        const t = text(n);
        if (t && t.length <= 180) optionTexts.push(t);
      }
    }

    // fallback: collect candidate lines from body that look like package descriptions
    const bodyLines = (document.body?.innerText || '')
      .split('\n')
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .filter((s) => /(brave|api|search|answers|spellcheck|autosuggest|key|额度|次|自动发|绑卡|充值)/i.test(s))
      .slice(0, 300);

    const salesTexts = [];
    for (const sel of ['[class*=sale]', '[class*=销量]', '[class*=Sales]', '.tm-ind-panel', '.tb-meta']) {
      for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 80)) {
        const t = text(n);
        if (t && /(销量|已售|已付款|人付款|sale)/i.test(t) && t.length < 120) salesTexts.push(t);
      }
    }

    return { title, priceTexts, optionTexts, bodyLines, salesTexts };
  });

  const mergedOptions = uniq([...(data.optionTexts || []), ...(data.bodyLines || [])]);
  const braveOptions = mergedOptions.filter((x) => isBraveApiRelevant(x)).slice(0, 40);
  const prices = uniq(data.priceTexts).slice(0, 80);
  const nums = parseNumericPrices(prices.concat(braveOptions));

  return {
    platform: platformOf(url),
    url,
    title: clean(data.title),
    blocked,
    salesHints: uniq(data.salesTexts).slice(0, 20),
    priceTexts: prices,
    priceNumbers: nums,
    minPrice: nums.length ? nums[0] : null,
    maxPrice: nums.length ? nums[nums.length - 1] : null,
    packageLines: braveOptions,
    zhEnPackageHint: braveOptions.filter((x) => /(zh|en|中文|英文)/i.test(x)).slice(0, 10)
  };
}

function recommend(listings) {
  const relevant = listings.filter((x) => !x.blocked);
  const byMin = relevant.filter((x) => Number.isFinite(x.minPrice)).sort((a, b) => a.minPrice - b.minPrice);
  const cheapest = byMin[0] || null;
  const trust = relevant.find((x) => x.platform === 'tmall' && Number.isFinite(x.minPrice)) || byMin[0] || null;

  return {
    cheapest,
    trust,
    note: 'Cheapest typically best for testing; Tmall pick typically better for trust/dispute handling.'
  };
}

async function main() {
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: false,
    locale: 'zh-CN',
    viewport: { width: 1366, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });

  const out = { keyword: 'brave', mode: 'unified-level2', ts: new Date().toISOString(), listings: [], recommendation: null };

  try {
    for (const url of URLS) {
      const page = await context.newPage();
      try {
        const row = await extractListing(page, url);
        out.listings.push(row);
      } catch (e) {
        out.listings.push({ url, platform: platformOf(url), error: e.message });
      } finally {
        await page.close();
      }
      await sleep(1400);
    }
  } finally {
    await context.close();
  }

  out.recommendation = recommend(out.listings);

  const outDir = path.resolve('data', 'taobao-brave-buyer');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `brave-unified-level2-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

  console.log(JSON.stringify({ ok: true, outPath, listings: out.listings.length }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message }, null, 2));
  process.exit(1);
});
