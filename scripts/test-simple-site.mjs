// Simple test to verify base scraper functionality
import { chromium } from 'playwright-core';
import { existsSync } from 'fs';

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

async function testHttpBin() {
  console.log('🧪 Testing httpbin.org/headers...');
  
  const browserPath = resolveBrowserPath();
  const browser = await chromium.launch({
    headless: true,
    executablePath: browserPath,
    args: ['--disable-blink-features=AutomationControlled']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.0.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 }
  });
  
  const page = await context.newPage();
  
  try {
    await page.goto('https://httpbin.org/headers', { waitUntil: 'networkidle', timeout: 30000 });
    const content = await page.textContent('body');
    const headers = JSON.parse(content);
    
    console.log('✅ httpbin test passed');
    console.log('Headers received:', JSON.stringify(headers, null, 2));
    
    await browser.close();
    return true;
  } catch (err) {
    console.error('❌ httpbin test failed:', err.message);
    await browser.close();
    return false;
  }
}

async function testQuotesScraper() {
  console.log('\n🧪 Testing quotes.toscrape.com...');
  
  const browserPath = resolveBrowserPath();
  const browser = await chromium.launch({
    headless: true,
    executablePath: browserPath,
    args: ['--disable-blink-features=AutomationControlled']
  });
  
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
  });
  
  const page = await context.newPage();
  
  try {
    await page.goto('http://quotes.toscrape.com/', { waitUntil: 'networkidle', timeout: 30000 });
    
    // Extract quotes
    const quotes = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('.quote')).map(q => ({
        text: q.querySelector('.text')?.textContent,
        author: q.querySelector('.author')?.textContent,
        tags: Array.from(q.querySelectorAll('.tag')).map(t => t.textContent)
      }));
    });
    
    console.log('✅ Quotes scraper test passed');
    console.log(`Found ${quotes.length} quotes`);
    console.log('First quote:', quotes[0]);
    
    await browser.close();
    return true;
  } catch (err) {
    console.error('❌ Quotes scraper test failed:', err.message);
    await browser.close();
    return false;
  }
}

async function main() {
  console.log('=== Simple Scraper Tests ===\n');
  
  const results = {
    httpbin: await testHttpBin(),
    quotes: await testQuotesScraper()
  };
  
  console.log('\n=== Results ===');
  for (const [name, passed] of Object.entries(results)) {
    console.log(`${passed ? '✅' : '❌'} ${name}: ${passed ? 'PASSED' : 'FAILED'}`);
  }
  
  const allPassed = Object.values(results).every(r => r);
  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
