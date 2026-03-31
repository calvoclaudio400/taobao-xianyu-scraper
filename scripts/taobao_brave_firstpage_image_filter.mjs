import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const USER = process.env.USERNAME || 'Administrator';
const executablePath = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
const userDataDir = `C:/Users/${USER}/AppData/Local/BraveSoftware/Brave-Browser/User Data`;

const SEARCH_URL = 'https://s.taobao.com/search?q=brave';
const MAX_OPEN = 12;

const includeWords = ['brave', 'api', 'search', '搜索'];
const excludeWords = ['souls', 'bleach', '动漫', '插件', '模型', '刀', '游戏', 'wordpress'];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const uniq = (arr) => Array.from(new Set(arr.filter(Boolean).map(clean))).filter(Boolean);

function scoreText(t) {
  const s = String(t || '').toLowerCase();
  let score = 0;
  for (const w of includeWords) if (s.includes(w)) score += 2;
  for (const w of excludeWords) if (s.includes(w)) score -= 3;
  return score;
}

function parsePriceNumbers(values = []) {
  const out = [];
  for (const v of values) {
    const ms = String(v || '').match(/(\d+(?:\.\d+)?)/g) || [];
    for (const m of ms) {
      const n = Number(m);
      if (Number.isFinite(n) && n > 0 && n < 100000) out.push(n);
    }
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

async function extractSearchCards(page) {
  await page.waitForTimeout(6000);
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, 420 + Math.floor(Math.random() * 220));
    await page.waitForTimeout(1200 + Math.floor(Math.random() * 900));
  }

  return await page.evaluate(() => {
    const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const cards = [];

    const anchors = Array.from(document.querySelectorAll('a[href]'));
    for (const a of anchors) {
      const hrefRaw = a.getAttribute('href') || a.href || '';
      const href = String(hrefRaw).replace(/&amp;/g, '&').replace(/^\/\//, 'https://');
      if (!/item\.taobao\.com\/item\.htm|detail\.tmall\.com\/item\.htm/i.test(href)) continue;

      const card = a.closest('[class*=item], [class*=Item], [class*=card], li, .ctx-box, .item') || a.parentElement || a;
      const cardText = text(card);
      const anchorText = text(a);
      const imgs = Array.from((card || document).querySelectorAll('img')).slice(0, 5).map(img => ({
        alt: text(img),
        title: img.getAttribute('title') || '',
        src: img.getAttribute('src') || img.getAttribute('data-src') || ''
      }));

      cards.push({
        url: href,
        cardText,
        anchorText,
        imgSignals: imgs
      });
    }

    // keep first occurrence by URL
    const seen = new Set();
    return cards.filter((c) => {
      if (!c.url || seen.has(c.url)) return false;
      seen.add(c.url);
      return true;
    });
  });
}

async function extractDetail(page) {
  await page.waitForLoadState('domcontentloaded', { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(7000);

  const body = await page.evaluate(() => document.body?.innerText || '');
  const challenge = /验证码|captcha|安全验证|异常流量|请先登录/i.test(body);

  const data = await page.evaluate(() => {
    const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

    let title = document.title || '';
    for (const sel of ['h1', '.tb-main-title', '.tb-detail-hd h1', '[class*=mainTitle]', '[class*=title]']) {
      const n = document.querySelector(sel);
      if (n && text(n).length > 3) { title = text(n); break; }
    }

    const prices = [];
    for (const sel of ['.tb-rmb-num', '.tm-price', '[class*=priceText]', '[class*=price]', '.J_Price', '.price']) {
      for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 120)) {
        const t = text(n);
        if (t && /\d/.test(t) && t.length < 80) prices.push(t);
      }
    }

    const options = [];
    for (const sel of ['.J_TSaleProp li', '.J_TSaleProp a', '[class*=sku] li', '[class*=Sku] li', '[class*=prop] li', '[role=radio]', '[role=option]']) {
      for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 200)) {
        const t = text(n);
        if (t && t.length < 120) options.push(t);
      }
    }

    const sales = [];
    for (const sel of ['[class*=sale]', '[class*=销量]', '[class*=Sales]', '.tm-ind-panel', '.tb-meta']) {
      for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 80)) {
        const t = text(n);
        if (t && /(销量|已售|已付款|人付款|sale)/i.test(t) && t.length < 120) sales.push(t);
      }
    }

    return { title, prices, options, sales };
  });

  const nums = parsePriceNumbers(data.prices);

  return {
    detailTitle: clean(data.title),
    detailPriceTexts: uniq(data.prices).slice(0, 40),
    priceNumbers: nums,
    minPrice: nums.length ? nums[0] : null,
    maxPrice: nums.length ? nums[nums.length - 1] : null,
    packageOptions: uniq(data.options).slice(0, 80),
    salesHints: uniq(data.sales).slice(0, 20),
    challenge
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

  const out = {
    keyword: 'brave',
    mode: 'first-page + image-aware filter + second-level detail',
    startedAt: new Date().toISOString(),
    searchUrl: SEARCH_URL,
    listings: [],
    notes: []
  };

  try {
    const page = context.pages()[0] || await context.newPage();
    await page.bringToFront();
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 120000 });

    const rawCards = await extractSearchCards(page);
    out.notes.push(`raw cards with item URLs: ${rawCards.length}`);

    const scored = rawCards.map((c) => {
      const joinedImgs = (c.imgSignals || []).map(i => `${i.alt} ${i.title} ${i.src}`).join(' | ');
      const signalText = `${c.cardText} ${c.anchorText} ${joinedImgs}`;
      return { ...c, signalText, score: scoreText(signalText) };
    });

    // image-aware assist: prefer cards with brave/api/search signals, but don't hard-drop all
    scored.sort((a, b) => b.score - a.score);

    const filtered = scored.slice(0, 24);

    // prioritize likely high-sales by searching for paid/sales markers
    filtered.sort((a, b) => {
      const as = /(\d+\+?\s*(人付款|已付款|已售|销量))/i.test(a.cardText) ? 1 : 0;
      const bs = /(\d+\+?\s*(人付款|已付款|已售|销量))/i.test(b.cardText) ? 1 : 0;
      return (bs - as) || (b.score - a.score);
    });

    const pick = filtered.slice(0, MAX_OPEN);
    out.notes.push(`image/text filtered listings: ${pick.length}`);

    for (const row of pick) {
      const p = await context.newPage();
      const item = {
        url: row.url,
        score: row.score,
        searchCardText: clean(row.cardText).slice(0, 500),
        imageSignals: (row.imgSignals || []).map(i => clean(`${i.alt} ${i.title}`)).filter(Boolean)
      };

      try {
        await p.goto(row.url, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await sleep(7000 + Math.floor(Math.random() * 2000));
        Object.assign(item, await extractDetail(p));
      } catch (e) {
        item.error = e.message;
      } finally {
        await p.close();
      }

      const level2Text = `${item.detailTitle || ''} ${(item.detailPriceTexts || []).join(' ')} ${(item.packageOptions || []).join(' ')} ${item.searchCardText || ''}`.toLowerCase();
      const includeHit = includeWords.some(w => level2Text.includes(w));
      const excludeHit = excludeWords.some(w => level2Text.includes(w));

      if (includeHit && !excludeHit) {
        out.listings.push(item);
      }

      await sleep(1200 + Math.floor(Math.random() * 1200));
    }
  } finally {
    await context.close();
  }

  out.finishedAt = new Date().toISOString();
  const outDir = path.resolve('data', 'taobao-brave-buyer');
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `brave-image-filter-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf8');

  console.log(JSON.stringify({ ok: true, outPath, count: out.listings.length, notes: out.notes }, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ ok: false, error: e.message }, null, 2));
  process.exit(1);
});
