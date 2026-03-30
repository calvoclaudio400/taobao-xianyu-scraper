import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';

const USER = process.env.USERNAME || 'Administrator';
const TARGET_BROWSER = String(process.env.TAOBAO_BROWSER || 'brave').toLowerCase();
const STRICT_BROWSER = String(process.env.TAOBAO_STRICT_BROWSER || '1') === '1';

const PROFILE_CANDIDATES = [
  {
    name: 'brave-default',
    browser: 'brave',
    executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    userDataDir: `C:/Users/${USER}/AppData/Local/BraveSoftware/Brave-Browser/User Data`
  },
  {
    name: 'brave-default-x86',
    browser: 'brave',
    executablePath: 'C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe',
    userDataDir: `C:/Users/${USER}/AppData/Local/BraveSoftware/Brave-Browser/User Data`
  },
  {
    name: 'edge-default-x86',
    browser: 'edge',
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    userDataDir: `C:/Users/${USER}/AppData/Local/Microsoft/Edge/User Data`
  },
  {
    name: 'chrome-default',
    browser: 'chrome',
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    userDataDir: `C:/Users/${USER}/AppData/Local/Google/Chrome/User Data`
  }
];

function cleanText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

async function safeBodyText(page) {
  try {
    await page.waitForLoadState('domcontentloaded', { timeout: 45000 });
  } catch {}

  try {
    await page.waitForSelector('body', { timeout: 15000 });
  } catch {}

  try {
    return cleanText(await page.evaluate(() => document?.body?.innerText || document?.documentElement?.innerText || ''));
  } catch {
    return '';
  }
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

async function openPersistentContext() {
  const errors = [];
  const targetMatches = PROFILE_CANDIDATES.filter((x) => x.browser === TARGET_BROWSER);
  const ordered = STRICT_BROWSER
    ? targetMatches
    : [...targetMatches, ...PROFILE_CANDIDATES.filter((x) => x.browser !== TARGET_BROWSER)];

  for (const candidate of ordered) {
    if (!existsSync(candidate.executablePath) || !existsSync(candidate.userDataDir)) {
      errors.push(`${candidate.name}: missing executable or profile dir`);
      continue;
    }

    try {
      const context = await chromium.launchPersistentContext(candidate.userDataDir, {
        executablePath: candidate.executablePath,
        headless: false,
        locale: 'zh-CN',
        viewport: { width: 1366, height: 900 },
        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
      });
      return { context, profile: candidate.name };
    } catch (err) {
      errors.push(`${candidate.name}: ${err.message}`);
    }
  }

  throw new Error(`Could not open persistent profile for browser='${TARGET_BROWSER}' (strict=${STRICT_BROWSER}). ${errors.join(' | ')}`);
}

async function run() {
  const startedAt = new Date().toISOString();
  const { context, profile } = await openPersistentContext();
  const page = context.pages()[0] || (await context.newPage());

  const result = {
    keyword: 'brave',
    searchUrl: 'https://s.taobao.com/search?q=brave',
    startedAt,
    profile,
    targetBrowser: TARGET_BROWSER,
    listingCountFound: 0,
    listingCountVisited: 0,
    captchaOrBlockDetected: false,
    loginStateLikely: 'unknown',
    listings: [],
    comparison: null,
    notes: []
  };

  try {
    await page.bringToFront();
    await page.goto(result.searchUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(8000);

    const bodyText = await safeBodyText(page);
    if (/你好|我的淘宝|已买到的宝贝|购物车/.test(bodyText)) {
      result.loginStateLikely = 'logged-in';
    } else if (/登录|请登录/.test(bodyText)) {
      result.loginStateLikely = 'not-logged-in';
    }

    if (/验证码|captcha|安全验证|异常流量|请先登录/i.test(bodyText)) {
      result.captchaOrBlockDetected = true;
      result.notes.push('Challenge/login gate seen on search page.');
    }

    for (let i = 0; i < 4; i += 1) {
      await page.mouse.wheel(0, 420 + Math.floor(Math.random() * 180));
      await page.waitForTimeout(1800 + Math.floor(Math.random() * 1200));
    }

    const links = await page.evaluate(() => {
      const candidates = [];
      const pushIf = (raw) => {
        const s = String(raw || '').trim();
        if (!s) return;
        const fixed = s.replace(/&amp;/g, '&').replace(/^\/\//, 'https://');
        if (/item\.taobao\.com\/item\.htm|detail\.tmall\.com\/item\.htm/i.test(fixed)) {
          candidates.push(fixed);
        }
      };

      for (const a of Array.from(document.querySelectorAll('a[href]'))) {
        pushIf(a.getAttribute('href'));
        pushIf(a.href);
        pushIf(a.getAttribute('data-href'));
      }

      const html = document.documentElement?.innerHTML || '';
      const re = /(https?:)?\/\/(?:item\.taobao\.com\/item\.htm\?[^"'\s<>]+|detail\.tmall\.com\/item\.htm\?[^"'\s<>]+)/gi;
      const matches = html.match(re) || [];
      for (const m of matches) pushIf(m);

      return Array.from(new Set(candidates)).slice(0, 12);
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
        planHints: [],
        blocked: false
      };

      try {
        await p.goto(link, { waitUntil: 'domcontentloaded', timeout: 90000 });
        await p.waitForTimeout(6000 + Math.floor(Math.random() * 2000));

        const body = await safeBodyText(p);
        if (/验证码|captcha|安全验证|异常流量|请先登录/i.test(body)) {
          row.blocked = true;
          result.captchaOrBlockDetected = true;
        }

        const data = await p.evaluate(() => {
          const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
          const titleNode = document.querySelector('h1, .tb-main-title, .ItemHeader--mainTitle, .tb-detail-hd h1');
          const title = titleNode ? text(titleNode) : document.title;

          const priceSelectors = [
            '.Price--priceText', '.tb-rmb-num', '.tm-price',
            '[class*="price"]', '[data-testid*="price"]'
          ];

          const priceTexts = [];
          for (const sel of priceSelectors) {
            for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 30)) {
              const t = text(n);
              if (t) priceTexts.push(t);
            }
          }

          const planSelectors = [
            '[class*="sku"] li', '[class*="Sku"] li', '[class*="prop"] li', '.J_TSaleProp li'
          ];

          const plans = [];
          for (const sel of planSelectors) {
            for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 40)) {
              const t = text(n);
              if (t) plans.push(t);
            }
          }

          return {
            title,
            priceTexts: Array.from(new Set(priceTexts)).slice(0, 40),
            plans: Array.from(new Set(plans)).slice(0, 25)
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
      await page.waitForTimeout(1200 + Math.floor(Math.random() * 1500));
    }

    const mins = result.listings.map((x) => x.minPrice).filter((x) => Number.isFinite(x));
    const maxs = result.listings.map((x) => x.maxPrice).filter((x) => Number.isFinite(x));

    result.comparison = {
      listingsWithPrices: mins.length,
      globalMinPrice: mins.length ? Math.min(...mins) : null,
      globalMaxPrice: maxs.length ? Math.max(...maxs) : null,
      blockedListings: result.listings.filter((x) => x.blocked).length
    };
  } finally {
    await context.close();
  }

  result.finishedAt = new Date().toISOString();
  const outDir = path.resolve('data', 'taobao-tests');
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `brave-firstpage-persistent-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

  console.log(JSON.stringify({ ok: true, outPath, profile: result.profile, summary: result.comparison, found: result.listingCountFound, visited: result.listingCountVisited, loginStateLikely: result.loginStateLikely, blocked: result.captchaOrBlockDetected }, null, 2));
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});