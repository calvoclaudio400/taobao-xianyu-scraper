import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';

const CANDIDATE_BROWSERS = [
  process.env.LOCAL_SCRAPER_CHROMIUM_PATH,
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean);

function resolveBrowserPath() {
  for (const p of CANDIDATE_BROWSERS) {
    try {
      if (existsSync(p)) return p;
    } catch {}
  }
  return null;
}

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
      if (Number.isFinite(num) && num > 0) out.push(num);
    }
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

async function run() {
  const browserPath = resolveBrowserPath();
  const launchOptions = {
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  };
  if (browserPath) launchOptions.executablePath = browserPath;

  const browser = await chromium.launch(launchOptions);
  const context = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1366, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();
  const result = {
    keyword: 'brave',
    searchUrl: 'https://s.taobao.com/search?q=brave',
    startedAt: new Date().toISOString(),
    listingCountFound: 0,
    listingCountVisited: 0,
    captchaOrBlockDetected: false,
    listings: [],
    comparison: null,
    notes: []
  };

  try {
    await page.goto(result.searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(7000);

    const pageText = cleanText(await page.textContent('body'));
    if (/验证码|captcha|登录|安全验证|异常流量/i.test(pageText)) {
      result.captchaOrBlockDetected = true;
      result.notes.push('Taobao anti-bot/login challenge detected on search page.');
    }

    // Gentle first-page scroll to load visible cards
    for (let i = 0; i < 4; i += 1) {
      await page.mouse.wheel(0, 550);
      await page.waitForTimeout(1800 + Math.floor(Math.random() * 1200));
    }

    const links = await page.evaluate(() => {
      const anchors = Array.from(document.querySelectorAll('a[href]'));
      const urls = anchors
        .map((a) => a.href)
        .filter((href) => /item\.taobao\.com\/item\.htm|detail\.tmall\.com\/item\.htm/i.test(href));
      return Array.from(new Set(urls)).slice(0, 12);
    });

    result.listingCountFound = links.length;

    for (const link of links) {
      const p = await context.newPage();
      const row = {
        url: link,
        title: null,
        rawPriceTexts: [],
        priceNumbers: [],
        minPrice: null,
        maxPrice: null,
        planHints: []
      };

      try {
        await p.goto(link, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await p.waitForTimeout(6000);

        const bodyText = cleanText(await p.textContent('body'));
        if (/验证码|captcha|登录|安全验证|异常流量/i.test(bodyText)) {
          result.captchaOrBlockDetected = true;
          row.planHints.push('blocked-or-login-required');
        }

        const data = await p.evaluate(() => {
          const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
          const titleNode = document.querySelector('h1, .tb-main-title, .ItemHeader--mainTitle, .tb-detail-hd h1');
          const title = titleNode ? text(titleNode) : document.title;

          const priceSelectors = [
            '.Price--priceText',
            '.tb-rmb-num',
            '.tm-price',
            '[class*="price"]',
            '[data-testid*="price"]'
          ];

          const priceTexts = [];
          for (const sel of priceSelectors) {
            for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 20)) {
              const t = text(n);
              if (t) priceTexts.push(t);
            }
          }

          const planSelectors = [
            '[class*="sku"] li',
            '[class*="Sku"] li',
            '[class*="prop"] li',
            '.J_TSaleProp li'
          ];

          const plans = [];
          for (const sel of planSelectors) {
            for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 30)) {
              const t = text(n);
              if (t) plans.push(t);
            }
          }

          return {
            title,
            priceTexts: Array.from(new Set(priceTexts)).slice(0, 30),
            plans: Array.from(new Set(plans)).slice(0, 20)
          };
        });

        row.title = cleanText(data.title);
        row.rawPriceTexts = data.priceTexts;
        row.priceNumbers = extractPriceNumbers(data.priceTexts);
        row.minPrice = row.priceNumbers.length ? row.priceNumbers[0] : null;
        row.maxPrice = row.priceNumbers.length ? row.priceNumbers[row.priceNumbers.length - 1] : null;
        row.planHints = data.plans;
      } catch (err) {
        row.planHints.push(`error:${err.message}`);
      } finally {
        await p.close();
      }

      result.listings.push(row);
      result.listingCountVisited += 1;
      await page.waitForTimeout(1200 + Math.floor(Math.random() * 1600));
    }

    const mins = result.listings.map((x) => x.minPrice).filter((x) => Number.isFinite(x));
    const maxs = result.listings.map((x) => x.maxPrice).filter((x) => Number.isFinite(x));

    result.comparison = {
      listingsWithPrices: mins.length,
      globalMinPrice: mins.length ? Math.min(...mins) : null,
      globalMaxPrice: maxs.length ? Math.max(...maxs) : null
    };

    if (!mins.length) {
      result.notes.push('Could not extract reliable prices from listing pages (likely anti-bot rendering/login gate).');
    }
  } finally {
    await context.close();
    await browser.close();
  }

  result.finishedAt = new Date().toISOString();

  const outDir = path.resolve('data', 'taobao-tests');
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `brave-firstpage-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

  console.log(JSON.stringify({ ok: true, outPath, summary: result.comparison, found: result.listingCountFound, visited: result.listingCountVisited, blocked: result.captchaOrBlockDetected }, null, 2));
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});