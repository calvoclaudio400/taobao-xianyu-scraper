import { chromium } from 'playwright-core';
import { writeFileSync } from 'fs';

const KEYWORD = process.argv[2] || 'perplexity pro 1年';
const CDP_URL = 'http://127.0.0.1:18800';

console.log(`Searching Xianyu for: ${KEYWORD}`);

const browser = await chromium.connectOverCDP(CDP_URL);
const context = browser.contexts()[0];
const page = await context.newPage();

try {
  const searchUrl = `https://s.2.taobao.com/list/list.htm?q=${encodeURIComponent(KEYWORD)}`;
  console.log(`Navigating to: ${searchUrl}`);
  
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(8000);

  const bodyText = await page.evaluate(() => document.body?.innerText || '');
  
  if (/验证码|captcha|登录|异常/i.test(bodyText)) {
    console.log('⚠️ Challenge detected');
    process.exit(1);
  }

  console.log('Extracting listings...');
  
  const listings = await page.evaluate(() => {
    const items = [];
    const cards = document.querySelectorAll('a[href*="2.taobao.com/item"], a[href*="goofish.com/item"]');
    
    for (const card of cards) {
      const url = card.href;
      const titleEl = card.querySelector('[class*="title"], [class*="Title"]');
      const priceEl = card.querySelector('[class*="price"], [class*="Price"]');
      
      const title = titleEl?.textContent?.trim() || '';
      const priceText = priceEl?.textContent?.trim() || '';
      const priceMatch = priceText.match(/(\d+(?:\.\d+)?)/);
      const price = priceMatch ? parseFloat(priceMatch[1]) : null;
      
      if (url && title && price) {
        items.push({ url, title, price, priceText });
      }
    }
    
    return items;
  });

  console.log(`Found ${listings.length} listings`);
  
  if (listings.length === 0) {
    console.log('No listings found. Page might need login or has anti-bot protection.');
    process.exit(1);
  }

  listings.sort((a, b) => a.price - b.price);
  
  const output = {
    keyword: KEYWORD,
    platform: 'xianyu',
    timestamp: new Date().toISOString(),
    count: listings.length,
    cheapest: listings[0],
    listings
  };

  const outPath = `data/xianyu-perplexity-pro-1year.json`;
  writeFileSync(outPath, JSON.stringify(output, null, 2));
  
  console.log(`\n✅ Cheapest: ${listings[0].title}`);
  console.log(`   Price: ¥${listings[0].price}`);
  console.log(`   URL: ${listings[0].url}`);
  console.log(`\nSaved to: ${outPath}`);

} catch (err) {
  console.error('Error:', err.message);
  process.exit(1);
} finally {
  await page.close();
  await browser.close();
}
