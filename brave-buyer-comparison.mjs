/**
 * Brave Keyword — First Page Buyer Comparison v2
 * Targets: Taobao search page 1 for "brave"
 * Uses: Brave persistent profile (logged-in, confirmed working)
 * Goal: Extract listing URLs from search page + sales indicators + deep prices/variants
 */
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';

const USER = process.env.USERNAME || 'Administrator';
const BRAVE_EXE = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
const BRAVE_PROFILE = `C:/Users/${USER}/AppData/Local/BraveSoftware/Brave-Browser/User Data`;
const KEYWORD = 'brave';
const SEARCH_URL = `https://s.taobao.com/search?q=${encodeURIComponent(KEYWORD)}`;
const OUT_DIR = path.resolve('data', 'taobao-brave-buyer');

function cleanText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

function extractPriceNumbers(values = []) {
  const out = [];
  for (const v of values) {
    const text = cleanText(v);
    const m = text.match(/(?:¥|￥|RMB\s*)?\s*(\d+(?:\.\d+)?)/gi) || [];
    for (const token of m) {
      const numMatch = token.match(/(\d+(?:\.\d+)?)/);
      if (!numMatch) continue;
      const num = Number(numMatch[1]);
      if (Number.isFinite(num) && num > 0 && num < 100000) out.push(num);
    }
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

async function safeBodyText(page, timeout = 45000) {
  try { await page.waitForLoadState('domcontentloaded', { timeout }); } catch {}
  try { await page.waitForSelector('body', { timeout: 15000 }); } catch {}
  try {
    return cleanText(
      await page.evaluate(() => document?.body?.innerText || document?.documentElement?.innerText || '')
    );
  } catch { return ''; }
}

async function run() {
  const startedAt = new Date().toISOString();
  mkdirSync(OUT_DIR, { recursive: true });

  if (!existsSync(BRAVE_EXE) || !existsSync(BRAVE_PROFILE)) {
    console.error(JSON.stringify({ ok: false, error: 'Brave executable or profile not found' }));
    process.exit(1);
  }

  const context = await chromium.launchPersistentContext(BRAVE_PROFILE, {
    executablePath: BRAVE_EXE,
    headless: false,
    locale: 'zh-CN',
    viewport: { width: 1366, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage']
  });

  const page = context.pages()[0] || (await context.newPage());

  const result = {
    keyword: KEYWORD,
    searchUrl: SEARCH_URL,
    startedAt,
    profile: 'brave-default (persistent, logged-in)',
    captchaOrBlock: false,
    loginState: 'unknown',
    searchPageItems: [],
    listings: [],
    comparison: null,
    notes: []
  };

  try {
    await page.bringToFront();
    await page.goto(SEARCH_URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(8000);

    const bodyText = await safeBodyText(page);
    if (/你好|我的淘宝|已买到的宝贝|购物车/.test(bodyText)) result.loginState = 'logged-in';
    else if (/登录|请登录/.test(bodyText)) result.loginState = 'not-logged-in';

    if (/验证码|captcha|安全验证|异常流量|请先登录|滑动验证|拼图验证/i.test(bodyText)) {
      result.captchaOrBlock = true;
      result.notes.push('Challenge/login gate detected on search page');
    }

    // Scroll to load all cards — more rounds + hold at bottom
    for (let i = 0; i < 8; i++) {
      await page.mouse.wheel(0, 380 + Math.floor(Math.random() * 200));
      await page.waitForTimeout(2000 + Math.floor(Math.random() * 1500));
    }
    // Hold at bottom for lazy load
    await page.waitForTimeout(5000);

    // Extract listing URLs + nearby text (title, price, sales) from search page
    const searchItems = await page.evaluate(() => {
      const norm = (s) => String(s || '').replace(/^\/\//, 'https://').replace(/&amp;/g, '&').replace(/&act=detail.*$/, '');
      const seen = new Set();
      const items = [];

      const anchors = Array.from(document.querySelectorAll('a[href]'));
      for (const a of anchors) {
        const href = norm(a.getAttribute('href') || '') || norm(a.href || '');
        if (!/item\.taobao\.com\/item\.htm|detail\.tmall\.com\/item\.htm/i.test(href)) continue;
        const key = href.split('?')[0];
        if (seen.has(key)) continue;
        seen.add(key);

        let salesText = '', priceText = '', titleText = '';
        let el = a;
        for (let depth = 0; depth < 8 && el; depth++) {
          el = el.parentElement;
          if (!el) break;
          if (!salesText) {
            const saleEl = el.querySelector('[class*="sale"], [class*="Sale"], [class*="sold"], [class*="amount"], [class*="realSales"], [class*="deal"], [class*="soldCount"]');
            if (saleEl) salesText = (saleEl.textContent || '').replace(/\s+/g, ' ').trim();
          }
          if (!priceText) {
            const priceEl = el.querySelector('[class*="price"]:not([class*="priceType"]):not([class*="price-tag"])');
            if (priceEl) priceText = (priceEl.textContent || '').replace(/\s+/g, ' ').trim();
          }
          if (!titleText) {
            const titleEl = el.querySelector('[class*="title"], [class*="name"], [class*="productTitle"], [class*="product-name"]');
            if (titleEl) titleText = (titleEl.textContent || '').replace(/\s+/g, ' ').trim();
          }
        }
        if (!titleText && a.textContent) {
          titleText = (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 100);
        }
        items.push({ url: href, salesText, priceText, titleText });
      }

      // HTML source regex for dynamically injected URLs
      if (items.length < 4) {
        const html = document.documentElement?.innerHTML || '';
        const re = /(?:https?:)?\/\/(?:item\.taobao\.com\/item\.htm\?[^"'\s<>]{10,}|detail\.tmall\.com\/item\.htm\?[^"'\s<>]{10,})/gi;
        let m;
        while ((m = re.exec(html)) !== null) {
          const href = norm(m[0]);
          const key = href.split('?')[0];
          if (seen.has(key)) continue;
          seen.add(key);
          items.push({ url: href, salesText: '', priceText: '', titleText: '' });
        }
      }

      return items.slice(0, 12);
    });

    result.searchPageItems = searchItems;
    result.notes.push(`Search page URLs extracted: ${searchItems.length}`);

    // Visit each listing
    for (const item of searchItems) {
      const p = await context.newPage();
      const row = {
        url: item.url,
        searchPageTitle: item.titleText,
        searchPageSales: item.salesText,
        searchPagePrice: item.priceText,
        detailTitle: null,
        detailPriceTexts: [],
        priceNumbers: [],
        minPrice: null,
        maxPrice: null,
        variants: [],
        blocked: false,
        error: null
      };

      try {
        await p.goto(item.url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await p.waitForTimeout(8000 + Math.floor(Math.random() * 4000));

        const detailBody = await safeBodyText(p);

        if (/验证码|captcha|安全验证|异常流量|请先登录|滑动验证/i.test(detailBody)) {
          row.blocked = true;
          result.captchaOrBlock = true;
        } else {
          const data = await p.evaluate(() => {
            const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();

            const titleSelectors = [
              'h1', '.tb-main-title', '.tm-title', '.ItemHeader--mainTitle',
              '.tb-detail-hd h1', "[class*='title'][class*='main']"
            ];
            let title = '';
            for (const sel of titleSelectors) {
              const el = document.querySelector(sel);
              if (el) { title = text(el); break; }
            }
            if (!title) title = document.title;

            const priceTexts = [];
            const priceSel = [
              '.Price--priceText', '.tb-rmb-num', '.tm-price',
              '#J_StrPrice .tb-rmb-num', '#J_StrPrice',
              '[class*="price"][class*="num"]', '.J_TPrice',
              '.current-price', '[class*="current"][class*="price"]',
              '[data-price]', '[class*="price"]'
            ];
            for (const sel of priceSel) {
              for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 30)) {
                const t = text(n);
                if (t && /\d/.test(t) && t.length < 30) priceTexts.push(t);
              }
            }

            const variantTexts = [];
            const variantSel = [
              '[class*="sku"] li', '[class*="Sku"] li', '[class*="prop"] li',
              '.J_TSaleProp li', '[class*="saleProp"] li', '[class*="spec"] li',
              '[class*="Spec"] li', '#J_SKU .sku-list li', '[class*="quantity"] li',
              '[class*="stock"]'
            ];
            for (const sel of variantSel) {
              for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 40)) {
                const t = text(n);
                if (t && t.length > 1 && t.length < 100) variantTexts.push(t);
              }
            }

            return {
              title,
              priceTexts: Array.from(new Set(priceTexts)).slice(0, 40),
              variants: Array.from(new Set(variantTexts)).slice(0, 30)
            };
          });

          row.detailTitle = cleanText(data.title);
          row.detailPriceTexts = data.priceTexts;
          row.priceNumbers = extractPriceNumbers(data.priceTexts);
          row.minPrice = row.priceNumbers.length ? row.priceNumbers[0] : null;
          row.maxPrice = row.priceNumbers.length ? row.priceNumbers[row.priceNumbers.length - 1] : null;
          row.variants = data.variants;
        }
      } catch (err) {
        row.error = err.message.slice(0, 150);
      } finally {
        await p.close();
      }

      result.listings.push(row);
      await page.waitForTimeout(1500 + Math.floor(Math.random() * 1500));
    }

    // Build comparison — default structure so it's always safe to access
    const comparison = {
      totalUrlsFound: result.searchPageItems.length,
      totalVisited: result.listings.length,
      withPrices: 0,
      withVariants: 0,
      blockedCount: 0,
      globalMinPrice: null,
      globalMaxPrice: null,
      priceRange: null
    };

    try {
      const withPrices = result.listings.filter(l => l.priceNumbers.length > 0);
      const withVariants = result.listings.filter(l => l.variants.length > 0);
      const blockedCount = result.listings.filter(l => l.blocked).length;
      const mins = withPrices.map(l => l.minPrice).filter(p => Number.isFinite(p));
      const maxs = withPrices.map(l => l.maxPrice).filter(p => Number.isFinite(p));

      comparison.withPrices = withPrices.length;
      comparison.withVariants = withVariants.length;
      comparison.blockedCount = blockedCount;
      comparison.globalMinPrice = mins.length ? Math.min(...mins) : null;
      comparison.globalMaxPrice = maxs.length ? Math.max(...maxs) : null;
      comparison.priceRange = mins.length ? `¥${Math.min(...mins)}–¥${Math.max(...maxs)}` : null;

      if (!withPrices.length) {
        result.notes.push('No prices from detail pages — trying search-page prices as fallback');
        // Pull prices from search page card data
        const searchPrices = result.searchPageItems
          .map(it => {
            const raw = it.priceText || '';
            const m = raw.match(/¥(\d+(?:\.\d+)?)/);
            return m ? Number(m[1]) : null;
          })
          .filter(n => Number.isFinite(n) && n > 0 && n < 100000);

        if (searchPrices.length) {
          comparison.priceRange = `¥${Math.min(...searchPrices)}–¥${Math.max(...searchPrices)} (from search page cards)`;
          comparison.globalMinPrice = Math.min(...searchPrices);
          comparison.globalMaxPrice = Math.max(...searchPrices);
          result.notes.push(`Search-page prices extracted: ${searchPrices.length} items`);
        }
      }
    } catch (err) {
      result.notes.push('comparison-error: ' + err.message.slice(0, 100));
    }

    result.comparison = comparison;
  } finally {
    await context.close();
  }

  result.finishedAt = new Date().toISOString();
  const outPath = path.join(OUT_DIR, `brave-buyer-v2-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

  console.log('\n========== BRAVE — TAOBAO FIRST PAGE BUYER SUMMARY ==========\n');
  console.log(`Keyword : ${KEYWORD}`);
  console.log(`URL     : ${SEARCH_URL}`);
  console.log(`Login   : ${result.loginState}`);
  console.log(`Blocked : ${result.captchaOrBlock ? 'YES' : 'No'}`);
  console.log(`URLs on search page  : ${result.searchPageItems.length}`);
  console.log(`Listings visited     : ${result.listings.length}`);
  console.log(`With prices (detail) : ${result.comparison.withPrices}`);
  console.log(`With variants        : ${result.comparison.withVariants}`);
  console.log(`Blocked listings     : ${result.comparison.blockedCount}`);
  console.log(`Price range          : ${result.comparison.priceRange || 'n/a'}`);
  console.log(`Notes: ${result.notes.join(' | ') || 'none'}\n`);

  // Show search page captured data
  if (result.searchPageItems.length > 0) {
    console.log('--- SEARCH PAGE CARDS (title/sales/price from search results) ---\n');
    for (let i = 0; i < result.searchPageItems.length; i++) {
      const it = result.searchPageItems[i];
      console.log(`[${i + 1}] ${it.titleText || '(no title)'}`);
      if (it.salesText) console.log(`     Sales: ${it.salesText}`);
      if (it.priceText) console.log(`     Raw price text: ${it.priceText}`);
      console.log(`     URL: ${it.url.split('?')[0]}`);
      console.log('');
    }
  }

  // Show detail page listings
  const detailPrices = result.listings.filter(l => l.priceNumbers.length > 0);
  if (detailPrices.length > 0) {
    console.log('--- DETAIL PAGE LISTINGS (sorted by min price) ---\n');
    const sorted = detailPrices.slice().sort((a, b) => a.minPrice - b.minPrice);
    for (let i = 0; i < sorted.length; i++) {
      const l = sorted[i];
      const title = l.detailTitle || l.searchPageTitle || '(no title)';
      const sales = l.searchPageSales || '';
      const price = l.minPrice === l.maxPrice ? `¥${l.minPrice}` : `¥${l.minPrice}–¥${l.maxPrice}`;
      console.log(`[${i + 1}] ${price} | ${title.slice(0, 90)}`);
      if (sales) console.log(`     Sales: ${sales}`);
      if (l.variants.length) {
        console.log(`     Variants: ${l.variants.slice(0, 6).join(' | ')}${l.variants.length > 6 ? ' ...' : ''}`);
      }
      console.log(`     ${l.url.split('?')[0]}`);
      console.log('');
    }
  }

  console.log('--- DATA FILE: ' + outPath + ' ---\n');
  return result;
}

run().catch(err => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});
