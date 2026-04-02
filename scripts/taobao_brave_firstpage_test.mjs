import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { solveCaptcha } from './captcha-solver.mjs';
import { ProxyRotator } from './proxy-rotator.mjs';
import { getStealthContextOptions, applyStealth } from './stealth-config.mjs';

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

async function humanBrowsing(page) {
  const actions = rand(2, 4);
  
  for (let i = 0; i < actions; i++) {
    const action = Math.random();
    
    if (action < 0.3) {
      await humanMouseMove(page, rand(200, 1200), rand(200, 800));
      if (Math.random() < 0.5) {
        await page.mouse.click(rand(300, 1000), rand(300, 700));
      }
      await humanDelay(800, 2500);
    } else if (action < 0.6) {
      await humanScroll(page, rand(200, 500));
      await humanDelay(1000, 3000);
    } else {
      await page.mouse.wheel(0, -rand(100, 400));
      await humanDelay(1200, 3500);
    }
    
    if (Math.random() < 0.2) {
      await humanDelay(10000, 25000);
    }
  }
}

async function createBrowserContext(browser, proxyRotator, useStealth) {
  const proxy = proxyRotator?.hasProxies() ? proxyRotator.getPlaywrightProxy() : null;
  
  const contextOptions = useStealth 
    ? getStealthContextOptions(proxy)
    : {
        locale: 'zh-CN',
        viewport: { width: 1366, height: 900 },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        ...(proxy && { proxy })
      };
  
  const context = await browser.newContext(contextOptions);
  
  if (useStealth) {
    const page = await context.newPage();
    await applyStealth(page);
    return { context, page, proxy };
  }
  
  const page = await context.newPage();
  return { context, page, proxy };
}

async function run() {
  const keyword = process.argv[2] || 'brave';
  const useProxy = process.argv.includes('--proxy');
  const useStealth = process.argv.includes('--stealth');
  const maxRetries = parseInt(process.env.MAX_RETRIES) || 3;
  
  console.log(`🔍 Searching Taobao for: "${keyword}"`);
  console.log(`   Proxy: ${useProxy ? 'enabled' : 'disabled'}`);
  console.log(`   Stealth: ${useStealth ? 'enabled' : 'disabled'}`);
  
  const proxyRotator = useProxy ? new ProxyRotator() : null;
  if (useProxy && !proxyRotator.hasProxies()) {
    console.error('❌ No proxies configured. Set PROXY_LIST env var or create data/proxies.txt');
    process.exit(1);
  }
  
  const browserPath = resolveBrowserPath();
  const launchOptions = {
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  };
  if (browserPath) launchOptions.executablePath = browserPath;

  const result = {
    keyword,
    searchUrl: `https://s.taobao.com/search?q=${encodeURIComponent(keyword)}`,
    startedAt: new Date().toISOString(),
    config: { useProxy, useStealth },
    listingCountFound: 0,
    listingCountVisited: 0,
    captchaOrBlockDetected: false,
    listings: [],
    comparison: null,
    notes: [],
    proxyHealth: null
  };

  let attempt = 0;
  let success = false;
  
  while (attempt < maxRetries && !success) {
    attempt++;
    console.log(`\n🔄 Attempt ${attempt}/${maxRetries}`);
    
    const browser = await chromium.launch(launchOptions);
    
    try {
      const { context, page, proxy } = await createBrowserContext(browser, proxyRotator, useStealth);
      
      await page.goto(result.searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await humanDelay(4000, 9000);
      await humanBrowsing(page);

      const pageText = cleanText(await page.textContent('body'));
      
      if (/验证码|captcha|登录|安全验证|异常流量/i.test(pageText)) {
        result.captchaOrBlockDetected = true;
        result.notes.push(`Attempt ${attempt}: Anti-bot/login challenge detected.`);
        
        console.log('🔄 Attempting to solve captcha...');
        const solved = await solveCaptcha(page);
        
        if (solved) {
          await humanDelay(3000, 5000);
          result.notes.push(`Attempt ${attempt}: Captcha solved`);
        } else {
          result.notes.push(`Attempt ${attempt}: Captcha solve failed`);
          if (proxyRotator && proxy) {
            proxyRotator.markFailed(proxy.server, 'captcha-failed');
          }
          await context.close();
          await browser.close();
          continue; // Retry with new proxy
        }
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
      console.log(`📦 Found ${links.length} listings`);

      if (links.length === 0) {
        result.notes.push(`Attempt ${attempt}: No listings found`);
        if (proxyRotator && proxy) {
          proxyRotator.markFailed(proxy.server, 'no-listings');
        }
        await context.close();
        await browser.close();
        continue;
      }

      // Process listings
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
          await humanBrowsing(p);

          const bodyText = cleanText(await p.textContent('body'));
          if (/验证码|captcha|登录|安全验证|异常流量/i.test(bodyText)) {
            result.captchaOrBlockDetected = true;
            row.planHints.push('blocked-or-login-required');
            
            const solved = await solveCaptcha(p);
            if (solved) {
              await humanDelay(2000, 4000);
            }
          }

          await humanScroll(p, rand(300, 600));
          await humanDelay(2000, 4000);
          
          if (Math.random() < 0.4) {
            await page.mouse.wheel(0, -rand(150, 350));
            await humanDelay(1500, 3000);
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
              for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 20)) {
                const t = text(n);
                if (t) priceTexts.push(t);
              }
            }

            const planSelectors = [
              '[class*="sku"] li', '[class*="Sku"] li',
              '[class*="prop"] li', '.J_TSaleProp li'
            ];

            const plans = [];
            for (const sel of planSelectors) {
              for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 30)) {
                const t = text(n);
                if (t) plans.push(t);
              }
            }

            return { title, priceTexts: Array.from(new Set(priceTexts)).slice(0, 30), plans: Array.from(new Set(plans)).slice(0, 20) };
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

      if (mins.length) {
        success = true;
        if (proxyRotator && proxy) {
          proxyRotator.markSuccess(proxy.server);
        }
      } else {
        result.notes.push(`Attempt ${attempt}: Could not extract prices`);
        if (proxyRotator && proxy) {
          proxyRotator.markFailed(proxy.server, 'no-prices');
        }
      }

      await context.close();
      
    } catch (err) {
      result.notes.push(`Attempt ${attempt}: Error - ${err.message}`);
      console.error(`❌ Attempt ${attempt} error:`, err.message);
    } finally {
      await browser.close();
    }
  }

  result.finishedAt = new Date().toISOString();
  
  if (proxyRotator) {
    result.proxyHealth = proxyRotator.getHealthReport();
  }

  const outDir = path.resolve('data', 'taobao-tests');
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${keyword}-firstpage-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(result, null, 2));

  console.log('\n=== Results ===');
  console.log(`Success: ${success ? '✅' : '❌'}`);
  console.log(`Listings found: ${result.listingCountFound}`);
  console.log(`Listings visited: ${result.listingCountVisited}`);
  console.log(`Prices extracted: ${result.comparison?.listingsWithPrices || 0}`);
  console.log(`Output: ${outPath}`);
  
  if (result.proxyHealth) {
    console.log('\nProxy Health:');
    for (const h of result.proxyHealth) {
      console.log(`  ${h.url}: ${h.successRate} success rate`);
    }
  }

  console.log(JSON.stringify({ 
    ok: success, 
    outPath, 
    summary: result.comparison, 
    found: result.listingCountFound, 
    visited: result.listingCountVisited, 
    blocked: result.captchaOrBlockDetected 
  }, null, 2));
}

run().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: err.message }, null, 2));
  process.exit(1);
});
