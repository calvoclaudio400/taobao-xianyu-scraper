import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { writeFileSync } from 'fs';
import { getWorkingProxy } from './proxy_manager.mjs';

puppeteer.use(StealthPlugin());

const KEYWORD = process.argv[2] || 'perplexity pro 1年';

console.log(`Searching Xianyu for: ${KEYWORD}`);

const proxy = await getWorkingProxy();
if (!proxy) {
  console.error('No working proxy available');
  process.exit(1);
}

console.log(`Using proxy: ${proxy.host}:${proxy.port}`);

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
  args: [
    `--proxy-server=http://${proxy.host}:${proxy.port}`,
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-setuid-sandbox'
  ]
});

const page = await browser.newPage();

await page.authenticate({
  username: proxy.username,
  password: proxy.password
});

// Human-like viewport
await page.setViewport({ width: 1366, height: 768 });

try {
  const searchUrl = `https://s.2.taobao.com/list/list.htm?q=${encodeURIComponent(KEYWORD)}`;
  console.log(`Navigating to: ${searchUrl}`);
  
  await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  
  // Human delay
  await page.waitForTimeout(5000 + Math.random() * 3000);

  // Random scroll
  await page.evaluate(() => {
    window.scrollBy(0, Math.random() * 300 + 100);
  });
  await page.waitForTimeout(1000 + Math.random() * 2000);

  const bodyText = await page.evaluate(() => document.body?.innerText || '');
  
  if (/验证码|captcha|登录|异常/i.test(bodyText)) {
    console.log('⚠️ Challenge detected');
    await browser.close();
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
    console.log('No listings found.');
    await browser.close();
    process.exit(1);
  }

  listings.sort((a, b) => a.price - b.price);
  
  const output = {
    keyword: KEYWORD,
    platform: 'xianyu',
    timestamp: new Date().toISOString(),
    proxy: `${proxy.host}:${proxy.port}`,
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
} finally {
  await browser.close();
}
