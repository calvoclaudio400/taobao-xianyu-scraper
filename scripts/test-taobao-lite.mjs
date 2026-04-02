// Lite Taobao test - just checks if homepage loads and what blocks appear
import { chromium } from 'playwright-core';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import path from 'path';
import { ProxyRotator } from './proxy-rotator.mjs';
import { getStealthContextOptions, applyStealth } from './stealth-config.mjs';
import { detectCaptchaType } from './captcha-solver.mjs';

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

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function testTaobaoHomepage(useProxy = false, useStealth = false) {
  const config = [];
  if (useProxy) config.push('proxy');
  if (useStealth) config.push('stealth');
  const configName = config.length ? config.join('+') : 'none';
  
  console.log(`\n🧪 Testing Taobao homepage (${configName})...`);
  
  const proxyRotator = useProxy ? new ProxyRotator() : null;
  const proxy = proxyRotator?.getPlaywrightProxy();
  
  if (useProxy && !proxy) {
    console.log('⚠️ No proxies configured, skipping proxy test');
    return null;
  }
  
  const browserPath = resolveBrowserPath();
  const browser = await chromium.launch({
    headless: true,
    executablePath: browserPath,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ]
  });
  
  const contextOptions = useStealth 
    ? getStealthContextOptions(proxy)
    : { 
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
        viewport: { width: 1366, height: 768 },
        ...(proxy && { proxy })
      };
  
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  
  if (useStealth) {
    await applyStealth(page);
  }
  
  const result = {
    config: configName,
    timestamp: new Date().toISOString(),
    url: 'https://www.taobao.com',
    success: false,
    captchaDetected: false,
    captchaType: null,
    loginRequired: false,
    pageTitle: null,
    screenshotPath: null,
    error: null
  };
  
  try {
    // Navigate with longer timeout
    await page.goto(result.url, { waitUntil: 'networkidle', timeout: 60000 });
    await sleep(3000);
    
    result.pageTitle = await page.title();
    
    // Check for blocks
    const pageText = await page.textContent('body');
    
    if (/登录|login|请登录/i.test(pageText)) {
      result.loginRequired = true;
    }
    
    // Check for captcha
    const captchaInfo = await detectCaptchaType(page);
    if (captchaInfo) {
      result.captchaDetected = true;
      result.captchaType = captchaInfo.type;
    }
    
    // Check for other anti-bot indicators
    const antiBotIndicators = [];
    if (pageText.includes('验证码')) antiBotIndicators.push('verification-code');
    if (pageText.includes('访问被拒绝')) antiBotIndicators.push('access-denied');
    if (pageText.includes('异常流量')) antiBotIndicators.push('abnormal-traffic');
    if (pageText.includes('安全验证')) antiBotIndicators.push('security-check');
    
    result.antiBotIndicators = antiBotIndicators;
    result.success = !result.loginRequired && !result.captchaDetected && antiBotIndicators.length === 0;
    
    // Take screenshot
    const outDir = path.resolve('data', 'taobao-tests');
    mkdirSync(outDir, { recursive: true });
    result.screenshotPath = path.join(outDir, `taobao-home-${configName}-${Date.now()}.png`);
    await page.screenshot({ path: result.screenshotPath, fullPage: true });
    
    console.log(`  Title: ${result.pageTitle}`);
    console.log(`  Success: ${result.success ? '✅' : '❌'}`);
    console.log(`  Login required: ${result.loginRequired}`);
    console.log(`  Captcha: ${result.captchaDetected ? result.captchaType : 'none'}`);
    console.log(`  Anti-bot: ${antiBotIndicators.join(', ') || 'none'}`);
    
    if (proxyRotator && proxy) {
      if (result.success) {
        proxyRotator.markSuccess(proxy.server);
      } else {
        proxyRotator.markFailed(proxy.server, result.captchaType || 'blocked');
      }
    }
    
  } catch (err) {
    result.error = err.message;
    console.error(`  ❌ Error: ${err.message}`);
    
    if (proxyRotator && proxy) {
      proxyRotator.markFailed(proxy.server, err.message);
    }
  }
  
  await browser.close();
  return result;
}

async function main() {
  console.log('=== Taobao Lite Test ===');
  console.log('Testing different configurations to find what works\n');
  
  const results = [];
  
  // Test 1: No protection
  results.push(await testTaobaoHomepage(false, false));
  
  // Test 2: Stealth only
  results.push(await testTaobaoHomepage(false, true));
  
  // Test 3: Proxy only
  const proxyResult = await testTaobaoHomepage(true, false);
  if (proxyResult) results.push(proxyResult);
  
  // Test 4: Proxy + Stealth
  const combinedResult = await testTaobaoHomepage(true, true);
  if (combinedResult) results.push(combinedResult);
  
  // Save results
  const outDir = path.resolve('data', 'taobao-tests');
  mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `taobao-lite-results-${Date.now()}.json`);
  writeFileSync(outPath, JSON.stringify(results, null, 2));
  
  console.log('\n=== Summary ===');
  for (const r of results) {
    if (!r) continue;
    console.log(`${r.success ? '✅' : '❌'} ${r.config}: ${r.success ? 'WORKING' : 'BLOCKED'}`);
  }
  
  console.log(`\n📄 Results saved to: ${outPath}`);
  
  const anySuccess = results.some(r => r?.success);
  process.exit(anySuccess ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
