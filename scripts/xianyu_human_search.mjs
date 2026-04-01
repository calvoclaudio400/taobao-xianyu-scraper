import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import { writeFileSync } from 'fs';

puppeteer.use(StealthPlugin());

const KEYWORD = process.argv[2] || 'perplexity pro 1年';

console.log(`Searching Xianyu for: ${KEYWORD}`);

const browser = await puppeteer.launch({
  headless: false,
  executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
  args: [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-web-security'
  ]
});

const page = await browser.newPage();
await page.setViewport({ width: 1366, height: 768 });

// Random user agent
await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

try {
  const searchUrl = `https://s.2.taobao.com/list/list.htm?q=${encodeURIComponent(KEYWORD)}`;
  console.log(`Navigating to: ${searchUrl}`);
  
  await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  
  // Human delay after load
  const initialDelay = 4000 + Math.random() * 3000;
  console.log(`Waiting ${Math.round(initialDelay)}ms...`);
  await new Promise(r => setTimeout(r, initialDelay));

  // Random mouse movement
  await page.mouse.move(Math.random() * 800 + 100, Math.random() * 400 + 100);
  await new Promise(r => setTimeout(r, 500 + Math.random() * 1000));

  // Human-like scroll pattern
  console.log('Scrolling like human...');
  for (let i = 0; i < 3; i++) {
    const scrollAmount = Math.random() * 400 + 200;
    await page.evaluate((amount) => {
      window.scrollBy({
        top: amount,
        behavior: 'smooth'
      });
    }, scrollAmount);
    
    await new Promise(r => setTimeout(r, 1500 + Math.random() * 2000));
    
    // Random small back-scroll
    if (Math.random() > 0.5) {
      await page.evaluate(() => {
        window.scrollBy({
          top: -50 - Math.random() * 100,
          behavior: 'smooth'
        });
      });
      await new Promise(r => setTimeout(r, 800 + Math.random() * 1200));
    }
  }

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
