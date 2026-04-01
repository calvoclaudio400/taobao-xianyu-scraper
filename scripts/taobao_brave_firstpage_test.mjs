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

function rand(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function humanDelay(minMs, maxMs) {
  await new Promise(r => setTimeout(r, rand(minMs, maxMs)));
}

async function humanMouseMove(page, x, y) {
  const steps = rand(8, 15);
  const current = await page.evaluate(() => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 }));
  
  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    const eased = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;
    const nx = current.x + (x - current.x) * eased;
    const ny = current.y + (y - current.y) * eased;
    await page.mouse.move(nx, ny);
    await humanDelay(5, 15);
  }
}

async function humanScroll(page, distance) {
  const chunks = rand(3, 6);
  const chunkSize = distance / chunks;
  
  for (let i = 0; i < chunks; i++) {
    await page.mouse.wheel(0, chunkSize + rand(-50, 50));
    await humanDelay(150, 400);
  }
  
  if (Math.random() < 0.3) {
    await page.mouse.wheel(0, -rand(50, 150));
    await humanDelay(200, 500);
  }
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
    await humanDelay(4000, 9000);

    await humanMouseMove(page, rand(300, 800), rand(200, 400));
    await humanDelay(800, 1500);

    const pageText = cleanText(await page.textContent('body'));
    if (/验证码|captcha|登录|安全验证|异常流量/i.test(pageText)) {
      result.captchaOrBlockDetected = true;
      result.notes.push('Taobao anti-bot/login challenge detected on search page.');
    }

    await humanDelay(2000, 5000);

    const scrolls = rand(4, 7);
    for (let i = 0; i < scrolls; i++) {
      await humanScroll(page, rand(220, 780));
      await humanDelay(1200, 4500);
      
      if (i % rand(3, 7) === 0) {
        await humanMouseMove(page, rand(200, 1000), rand(300, 700));
        await humanDelay(1500, 4000);
      }
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
        await humanDelay(8000, 22000);

        await humanMouseMove(p, rand(400, 900), rand(300, 600));
        await humanDelay(1500, 3500);

        const bodyText = cleanText(await p.textContent('body'));
        if (/验证码|captcha|登录|安全验证|异常流量/i.test(bodyText)) {
          result.captchaOrBlockDetected = true;
          row.planHints.push('blocked-or-login-required');
        }

        await humanScroll(p, rand(300, 600));
        await humanDelay(2000, 4000);

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
      await humanDelay(3000, 9000);
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