import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';

const USER = process.env.USERNAME || 'Administrator';
const PLATFORM = String(process.env.TAOBAO_PLATFORM || 'taobao').toLowerCase();
const KEYWORD = String(process.env.TAOBAO_KEYWORD || 'brave');
const MAX_LISTINGS = parseInt(process.env.TAOBAO_MAX_LISTINGS || '0', 10) || Infinity;
const STOP_ON_CHALLENGE = String(process.env.TAOBAO_STOP_ON_CHALLENGE || '1') === '1';
const WORKDIR = process.cwd();

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
  }
];

const SEARCH_URLS = {
  taobao: `https://s.taobao.com/search?q=${encodeURIComponent(KEYWORD)}`,
  xianyu: `https://s.2.taobao.com/list/list.htm?q=${encodeURIComponent(KEYWORD)}`,
  goofish: `https://www.goofish.com/search?keyword=${encodeURIComponent(KEYWORD)}`
};

const CHALLENGE_PATTERNS = [
  /验证码|captcha|安全验证|异常流量|请先登录/i,
  /访问受限|系统异常|稍后再试|滑动验证|拼图验证/i,
  /登录.*查看|查看完整页面|upgrade.*browser/i,
  /系统检测|操作频繁|被拦截/i
];

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
      if (Number.isFinite(num) && num > 0 && num < 1000000) out.push(num);
    }
  }
  return Array.from(new Set(out)).sort((a, b) => a - b);
}

function humanDelay(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}

async function safeBodyText(page, timeout = 45000) {
  try {
    await page.waitForLoadState('domcontentloaded', { timeout });
  } catch {}
  try {
    await page.waitForSelector('body', { timeout: 15000 });
  } catch {}
  try {
    return cleanText(
      await page.evaluate(() => document?.body?.innerText || document?.documentElement?.innerText || '')
    );
  } catch {
    return '';
  }
}

function detectChallenge(text) {
  return CHALLENGE_PATTERNS.some((p) => p.test(text));
}

function extractLinks(page, platform) {
  return page.evaluate((plat) => {
    const norm = (s) =>
      String(s || '')
        .replace(/^\/\//, 'https://')
        .replace(/&amp;/g, '&')
        .replace(/&act=detail.*$/, '');

    const candidates = new Set();

    if (plat === 'taobao') {
      for (const a of Array.from(document.querySelectorAll('a[href]'))) {
        const h = norm(a.getAttribute('href') || '') || norm(a.href || '');
        if (/item\.taobao\.com\/item\.htm|detail\.tmall\.com\/item\.htm/i.test(h)) {
          candidates.add(h);
        }
      }
      const re = /https?:\/\/(?:item\.taobao\.com\/item\.htm\?[^"'\s<>]+|detail\.tmall\.com\/item\.htm\?[^"'\s<>]+)/gi;
      const html = document.documentElement?.innerHTML || '';
      for (const m of (html.match(re) || [])) candidates.add(norm(m));
    } else {
      for (const a of Array.from(document.querySelectorAll('a[href]'))) {
        const h = norm(a.getAttribute('href') || '') || norm(a.href || '');
        const isGoofishItem =
          /goofish\.com\/item\?|m\.goofish\.com\/item\?|2\.taobao\.com\/item\.htm/i.test(h) ||
          (/goofish\.com\/item\//i.test(h)) ||
          (/item\.id=\d|item\.htm\?id=/i.test(h));
        if (isGoofishItem) candidates.add(h);
      }
      const re =
        /https?:\/\/(?:www\.goofish\.com\/item\?[^"'\s<>]+|m\.goofish\.com\/item\?[^"'\s<>]+|2\.taobao\.com\/item\.htm\?[^"'\s<>]+)/gi;
      const html = document.documentElement?.innerHTML || '';
      for (const m of (html.match(re) || [])) candidates.add(norm(m));
    }

    return Array.from(candidates);
  }, platform);
}

function extractListingData(page, platform) {
  return page.evaluate((plat) => {
    const text = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
    const title =
      text(document.querySelector('h1, .tb-main-title, .tm-title, .ItemHeader--mainTitle, .tb-detail-hd h1, [class*="title"]')) ||
      document.title;

    const priceTexts = [];

    if (plat === 'taobao') {
      const selectors = [
        '.Price--priceText',
        '.tb-rmb-num',
        '.tm-price',
        '[class*="price"]',
        '[class*="Price"]',
        '[data-price]',
        '[data-testid*="price"]',
        '.J_TPrice',
        '#J_StrPrice',
        '.current-price',
        '[class*="current"]'
      ];
      for (const sel of selectors) {
        for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 30)) {
          const t = text(n);
          if (t && /\d/.test(t)) priceTexts.push(t);
        }
      }
      const scriptPrice = document.querySelector('script:not([src])');
      if (scriptPrice) {
        const inner = scriptPrice.innerHTML;
        const m = inner.match(/(?:price|priceVal|currentPrice)["\s]*:\s*["']?([\d.]+)/gi);
        if (m) m.forEach((x) => priceTexts.push(x));
      }
    } else {
      const selectors = [
        '[class*="price"]',
        '[class*="Price"]',
        '[class*="rmb"]',
        '[class*="yuan"]',
        '[class*="current"]',
        '[data-price]',
        '.price',
        '.goofish-price',
        '[class*="amount"]',
        '[class*="Amount"]'
      ];
      for (const sel of selectors) {
        for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 30)) {
          const t = text(n);
          if (t && /\d/.test(t)) priceTexts.push(t);
        }
      }
    }

    const planTexts = [];

    if (plat === 'taobao') {
      const skuSelectors = [
        '[class*="sku"] li',
        '[class*="Sku"] li',
        '[class*="prop"] li',
        '.J_TSaleProp li',
        '[class*="saleProp"] li',
        '[class*="quantity"]',
        '[class*="stock"]',
        '#J_SKU .sku-list li',
        '[class*="spec"] li',
        '[class*="Spec"] li'
      ];
      for (const sel of skuSelectors) {
        for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 40)) {
          const t = text(n);
          if (t && t.length > 1) planTexts.push(t);
        }
      }
    } else {
      const skuSelectors = [
        '[class*="sku"] li',
        '[class*="Sku"]',
        '[class*="prop"]',
        '[class*="spec"]',
        '[class*="Spec"]',
        '[class*="attr"]',
        '[class*="Attr"]',
        '[class*="option"]',
        '[class*="Option"]'
      ];
      for (const sel of skuSelectors) {
        for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 40)) {
          const t = text(n);
          if (t && t.length > 1) planTexts.push(t);
        }
      }
    }

    return {
      title,
      priceTexts: Array.from(new Set(priceTexts)).slice(0, 40),
      plans: Array.from(new Set(planTexts)).slice(0, 30)
    };
  }, platform);
}

async function humanScroll(page, rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await page.mouse.wheel(0, 350 + Math.floor(Math.random() * 220));
    await page.waitForTimeout(humanDelay(1400, 2200));
  }
}

async function humanHover(page, x, y) {
  await page.mouse.move(x + Math.floor(Math.random() * 20 - 10), y + Math.floor(Math.random() * 20 - 10));
}

async function stealth(page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    window.navigator.chrome = { runtime: {} };
    Object.defineProperty(navigator, 'plugins', {
      get: () => [{ name: 'Chrome PDF Plugin' }, { name: 'Chrome PDF Viewer' }]
    });
    Object.defineProperty(navigator, 'languages', {
      get: () => ['zh-CN', 'zh', 'en-US', 'en']
    });
  });
}

async function openPersistentContext() {
  for (const candidate of PROFILE_CANDIDATES) {
    if (!existsSync(candidate.executablePath) || !existsSync(candidate.userDataDir)) continue;
    try {
      const context = await chromium.launchPersistentContext(candidate.userDataDir, {
        executablePath: candidate.executablePath,
        headless: false,
        locale: 'zh-CN',
        viewport: { width: 1366, height: 900 },
        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage']
      });
      return { context, profile: candidate.name };
    } catch {}
  }
  throw new Error('No browser profile found');
}

async function visitListing(context, url, platform, attempt = 1) {
  const MAX_RETRIES = 2;
  const p = await context.newPage();
  await stealth(p);

  const row = {
    url,
    title: null,
    rawPriceTexts: [],
    priceNumbers: [],
    minPrice: null,
    maxPrice: null,
    planHints: [],
    blocked: false,
    challenge: null,
    error: null
  };

  try {
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await p.waitForTimeout(humanDelay(5000, 8000));

    const body = await safeBodyText(p);
    if (detectChallenge(body)) {
      row.blocked = true;
      row.challenge = body.slice(0, 200);
      return row;
    }

    const data = extractListingData(p, platform);
    row.title = cleanText(data.title);
    row.rawPriceTexts = data.priceTexts;
    row.priceNumbers = extractPriceNumbers(data.priceTexts);
    row.minPrice = row.priceNumbers.length ? row.priceNumbers[0] : null;
    row.maxPrice = row.priceNumbers.length ? row.priceNumbers[row.priceNumbers.length - 1] : null;
    row.planHints = data.plans;

    if (!row.priceNumbers.length && detectChallenge(await safeBodyText(p, 30000))) {
      row.blocked = true;
      row.challenge = 'challenge-after-load';
    }
  } catch (err) {
    row.error = err.message.slice(0, 200);
    if (attempt < MAX_RETRIES) {
      await p.close();
      await context.newPage();
      return visitListing(context, url, platform, attempt + 1);
    }
  } finally {
    await p.close();
  }

  return row;
}

async function launchNonPersistent() {
  const errors = [];
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
  ].filter(Boolean);

  const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36';

  for (const exePath of candidates) {
    if (!existsSync(exePath)) { errors.push(`${exePath}: not found`); continue; }
    try {
      const browser = await chromium.launch({ executablePath: exePath, headless: false,
        args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-dev-shm-usage'] });
      const ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1366, height: 900 }, userAgent: ua });
      return { context: ctx, page: await ctx.newPage(), profile: exePath.split('/').pop(), browser };
    } catch (e) { errors.push(`${exePath}: ${e.message}`); }
  }
  throw new Error('Non-persistent launch failed: ' + errors.join(' | '));
}

async function run() {
  const platform = ['taobao', 'xianyu', 'goofish'].includes(PLATFORM) ? PLATFORM : 'taobao';
  const searchUrl = SEARCH_URLS[platform];
  const startedAt = new Date().toISOString();

  let context, page, profile, browser;
  let persistent = true;

  try {
    ({ context, profile } = await openPersistentContext());
    page = context.pages()[0] || (await context.newPage());
  } catch (err) {
    console.error('Persistent context failed, falling back to non-persistent:', err.message);
    ({ context, page, profile, browser } = await launchNonPersistent());
    persistent = false;
  }

  await stealth(page);

  const result = {
    platform,
    keyword: KEYWORD,
    searchUrl,
    startedAt,
    profile,
    mode: persistent ? 'persistent' : 'non-persistent',
    maxListings: MAX_LISTINGS === Infinity ? 'all' : MAX_LISTINGS,
    stoppedEarly: false,
    stopReason: null,
    loginState: 'unknown',
    captchaOrBlockDetected: false,
    listingsFound: 0,
    listingsVisited: 0,
    listings: [],
    comparison: null,
    notes: []
  };

  let challengeMet = false;

  const closeAll = async () => {
    try { if (context) await context.close(); } catch {}
    try { if (browser) await browser.close(); } catch {}
  };

  try {
    try { await page.bringToFront(); } catch {}
    try {
      await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });
    } catch (navErr) {
      result.notes.push('nav-error: ' + navErr.message.slice(0, 200));
    }
    await page.waitForTimeout(humanDelay(6000, 10000));

    const bodyText = await safeBodyText(page);
    if (detectChallenge(bodyText)) {
      result.captchaOrBlockDetected = true;
      result.stoppedEarly = true;
      result.stopReason = 'challenge-on-search-page';
      challengeMet = true;
    }

    if (/你好|我的淘宝|已买到的宝贝|购物车/.test(bodyText)) result.loginState = 'logged-in';
    else if (/登录|请登录/.test(bodyText)) result.loginState = 'not-logged-in';

    if (!challengeMet) {
      try { await humanScroll(page, 4); } catch {}
    }

    let links = [];
    try {
      links = extractLinks(page, platform);
    } catch (linkErr) {
      result.notes.push('extract-links-error: ' + linkErr.message);
    }

    if (!links.length) {
      try {
        const rawLinks = await page.evaluate(() =>
          Array.from(document.querySelectorAll('a[href]')).map(a => a.href || a.getAttribute('href') || '').filter(Boolean).slice(0, 20)
        );
        result.notes.push('debug-raw-links: ' + JSON.stringify(rawLinks.slice(0, 5)));
        const debugLinks = await page.evaluate((plat) => {
          const re = plat === 'taobao'
            ? /item\.taobao\.com\/item\.htm|detail\.tmall\.com\/item\.htm/i
            : /goofish\.com\/item\?|m\.goofish\.com\/item\?|2\.taobao\.com\/item\.htm/i;
          return Array.from(document.querySelectorAll('a[href]'))
            .map(a => a.href)
            .filter(h => re.test(h))
            .slice(0, 5);
        }, platform);
        result.notes.push('debug-filtered: ' + JSON.stringify(debugLinks));
        if (debugLinks.length) links = debugLinks;
      } catch (e) {
        result.notes.push('debug-fail: ' + e.message);
      }
    }
    if (MAX_LISTINGS !== Infinity) links = links.slice(0, MAX_LISTINGS);

    result.listingsFound = links.length;

    outer: for (let i = 0; i < links.length; i++) {
      if (challengeMet && STOP_ON_CHALLENGE) break;

      const link = links[i];
      let row;
      try {
        row = await visitListing(context, link, platform);
      } catch (visitErr) {
        row = { url: link, blocked: false, challenge: null, error: visitErr.message.slice(0, 200), planHints: [], priceNumbers: [], minPrice: null, maxPrice: null };
      }

      result.listings.push(row);
      result.listingsVisited += 1;

      if (row.blocked) result.captchaOrBlockDetected = true;

      if (row.blocked && STOP_ON_CHALLENGE) {
        challengeMet = true;
        result.stoppedEarly = true;
        result.stopReason = `challenge-on-listing-${i + 1}`;
        break outer;
      }

      if (i < links.length - 1) {
        try { await page.waitForTimeout(humanDelay(1500, 3000)); } catch {}
      }
    }

    const withPrices = result.listings.filter((x) => x.priceNumbers?.length);
    const mins = withPrices.map((x) => x.minPrice).filter((x) => Number.isFinite(x));
    const maxs = withPrices.map((x) => x.maxPrice).filter((x) => Number.isFinite(x));
    const withPlans = result.listings.filter((x) => x.planHints?.length);

    result.comparison = {
      platform,
      totalFound: result.listingsFound,
      totalVisited: result.listingsVisited,
      withPrices: withPrices.length,
      withSkuOptions: withPlans.length,
      globalMinPrice: mins.length ? Math.min(...mins) : null,
      globalMaxPrice: maxs.length ? Math.max(...maxs) : null,
      priceRange: mins.length && maxs.length ? { min: Math.min(...mins), max: Math.max(...maxs) } : null,
      blockedCount: result.listings.filter((x) => x.blocked).length,
      errorCount: result.listings.filter((x) => x.error).length
    };
  } finally {
    await closeAll();
  }

  result.finishedAt = new Date().toISOString();

  const outDir = path.resolve(WORKDIR, 'data', 'taobao-tests');
  mkdirSync(outDir, { recursive: true });
  const ts = Date.now();
  const outPath = path.join(outDir, `${platform}-hardened-${ts}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');

  const summary = {
    ok: true,
    outPath,
    platform,
    mode: result.mode,
    profile,
    stoppedEarly: result.stoppedEarly,
    stopReason: result.stopReason,
    listingsFound: result.listingsFound,
    listingsVisited: result.listingsVisited,
    loginState: result.loginState,
    captchaOrBlockDetected: result.captchaOrBlockDetected,
    notes: result.notes,
    comparison: result.comparison
  };

  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});
