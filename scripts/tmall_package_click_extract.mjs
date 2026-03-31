import { chromium } from 'playwright-core';

const USER = process.env.USERNAME || 'Administrator';
const executablePath = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
const userDataDir = `C:/Users/${USER}/AppData/Local/BraveSoftware/Brave-Browser/User Data`;
const url = 'https://detail.tmall.com/item.htm?id=990894933632';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function parsePrice(text) {
  const m = String(text || '').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

(async () => {
  const context = await chromium.launchPersistentContext(userDataDir, {
    executablePath,
    headless: false,
    locale: 'zh-CN',
    viewport: { width: 1366, height: 900 },
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await sleep(9000);

    const out = await page.evaluate(async () => {
      const txt = (el) => (el?.textContent || '').replace(/\s+/g, ' ').trim();
      const sleep = (ms) => new Promise(r => setTimeout(r, ms));

      function getMainPriceText() {
        const cands = [];
        for (const sel of ['.Price--priceText', '.tm-price', '.tb-rmb-num', '[class*=priceText]', '[class*=price]']) {
          for (const n of Array.from(document.querySelectorAll(sel)).slice(0, 60)) {
            const t = txt(n);
            if (t && /\d/.test(t) && t.length < 80) cands.push(t);
          }
        }
        return cands[0] || null;
      }

      // find candidate package option elements by text content
      const all = Array.from(document.querySelectorAll('li,button,a,span,div'));
      const options = all
        .map((n) => ({
          el: n,
          t: txt(n)
        }))
        .filter((x) => x.t && x.t.length <= 220)
        .filter((x) => /(Brave|API|充值|绑卡|key|次|单月|answers|Spellcheck|Autosuggest)/i.test(x.t))
        .slice(0, 120);

      const rows = [];
      const seen = new Set();
      for (const x of options) {
        if (seen.has(x.t)) continue;
        seen.add(x.t);

        try { x.el.click(); } catch {}
        await sleep(700);
        const p = getMainPriceText();
        rows.push({ option: x.t, priceText: p });
      }

      // Dedup rows and keep useful package-like lines
      const uniqRows = [];
      const s2 = new Set();
      for (const r of rows) {
        const k = `${r.option}__${r.priceText}`;
        if (s2.has(k)) continue;
        s2.add(k);
        if (/(Brave|API|充值|绑卡|key|次|单月|answers|Spellcheck|Autosuggest)/i.test(r.option)) {
          uniqRows.push(r);
        }
      }

      const title = txt(document.querySelector('h1')) || document.title;
      const sales = Array.from(document.querySelectorAll('*')).map(txt).find(t => /(已售|已付款|人付款|销量)/.test(t) && t.length < 120) || null;
      return { title, sales, rows: uniqRows.slice(0, 80) };
    });

    const normalized = out.rows.map(r => ({
      ...r,
      price: parsePrice(r.priceText)
    }));

    console.log(JSON.stringify({ ok: true, url, title: out.title, sales: out.sales, rows: normalized }, null, 2));
  } finally {
    await context.close();
  }
})();
