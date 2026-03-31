import { chromium } from 'playwright-core';
import fs from 'fs';
import path from 'path';

const executablePath = 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
const INPUT = path.resolve('data','taobao-brave-buyer','brave-image-filter-1774977560881.json');

const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));
const clean = (s)=>String(s||'').replace(/\s+/g,' ').trim();

function pickUrls(data){
  const urls = (data.listings||[]).map(x=>x.url).filter(Boolean);
  return Array.from(new Set(urls)).slice(0,12);
}

function parseSales(txt){
  const m = String(txt||'').match(/(\d+(?:\.\d+)?)\s*\+?\s*(?:人付款|已付款|已售|销量|sale)/i);
  return m? Number(m[1]) : null;
}

function parsePrice(t){
  const m = String(t||'').match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

function parseMeta(option){
  const t = String(option||'');
  const count = (t.match(/(\d{3,})\s*次/)||[])[1];
  const duration = /单月|每月|月/.test(t)?'monthly':(/年/.test(t)?'yearly':'unspecified');
  const keys = (t.match(/(\d+)\s*(?:个)?\s*key/i)||[])[1] || (t.includes('一个key')?'1':(t.includes('两个key')?'2':null));
  return { count: count?Number(count):null, duration, keys: keys?Number(keys):null };
}

(async()=>{
  const raw = JSON.parse(fs.readFileSync(INPUT,'utf8'));
  const urls = pickUrls(raw);

  const browser = await chromium.launch({ executablePath, headless: true, args:['--no-sandbox'] });
  const context = await browser.newContext({ locale:'zh-CN', viewport:{width:1366,height:900} });

  const out = { keyword:'brave', ts:new Date().toISOString(), listings:[], rankedPackages:[] };

  for (const url of urls){
    const page = await context.newPage();
    const row = { url, title:null, salesText:null, sales:null, packages:[] };
    try{
      await page.goto(url,{waitUntil:'domcontentloaded', timeout:120000});
      await sleep(6000);

      const base = await page.evaluate(()=>{
        const txt=(el)=>(el?.textContent||'').replace(/\s+/g,' ').trim();
        const title = txt(document.querySelector('h1')) || document.title || '';
        const sales = Array.from(document.querySelectorAll('*')).map(txt).find(t=>/(人付款|已付款|已售|销量|sale)/i.test(t) && t.length<80) || null;
        return { title, sales };
      });

      row.title = clean(base.title);
      row.salesText = clean(base.sales);
      row.sales = parseSales(row.salesText);

      const options = await page.evaluate(async()=>{
        const txt=(el)=>(el?.textContent||'').replace(/\s+/g,' ').trim();
        const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));

        const getPrice=()=>{
          const arr=[];
          for (const sel of ['.Price--priceText','.tm-price','.tb-rmb-num','.J_Price','[class*=priceText]','[class*=price]']){
            for (const n of Array.from(document.querySelectorAll(sel)).slice(0,120)){
              const t=txt(n);
              if (t && /\d/.test(t) && t.length<80) arr.push(t);
            }
          }
          return arr[0]||null;
        }

        const candidates=[];
        const selectorGroups=['.J_TSaleProp li','.J_TSaleProp a','[class*=sku] li','[class*=Sku] li','[class*=prop] li','[role=radio]','[role=option]'];
        for (const sel of selectorGroups){
          const nodes = Array.from(document.querySelectorAll(sel)).slice(0,120);
          for (const n of nodes){
            const t=txt(n);
            if (!t || t.length<2 || t.length>220) continue;
            if (/(brave|api|search|answers|spellcheck|autosuggest|绑卡|充值|key|次|单月)/i.test(t)){
              candidates.push(n);
            }
          }
          if (candidates.length) break;
        }

        const rows=[];
        const seen=new Set();
        for (const n of candidates){
          const opt = txt(n);
          if (seen.has(opt)) continue;
          seen.add(opt);
          try{ n.click(); }catch{}
          await sleep(500);
          rows.push({ option: opt, priceText: getPrice() });
        }

        if (!rows.length){
          const body = (document.body?.innerText||'').split('\n').map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
          for (const line of body){
            if (/(brave|api|search|answers|spellcheck|autosuggest|绑卡|充值|key|次|单月)/i.test(line)){
              rows.push({ option: line, priceText: getPrice() });
            }
          }
        }

        const uniq=[]; const s2=new Set();
        for (const r of rows){
          const k=`${r.option}__${r.priceText}`;
          if (s2.has(k)) continue;
          s2.add(k);
          uniq.push(r);
        }
        return uniq.slice(0,80);
      });

      row.packages = options.map(o=>({ option: clean(o.option), priceText: clean(o.priceText), price: parsePrice(o.priceText), ...parseMeta(o.option) }));
    } catch(e){
      row.error = e.message;
    }
    await page.close();
    out.listings.push(row);
  }

  // flatten + rank: lower price first; tie => higher sales first
  const flat=[];
  for (const l of out.listings){
    for (const p of l.packages||[]){
      if (!Number.isFinite(p.price)) continue;
      flat.push({
        url:l.url,
        title:l.title,
        sales:l.sales,
        salesText:l.salesText,
        option:p.option,
        price:p.price,
        priceText:p.priceText,
        count:p.count,
        duration:p.duration,
        keys:p.keys
      });
    }
  }

  flat.sort((a,b)=>{
    if (a.price!==b.price) return a.price-b.price;
    const as=a.sales??-1, bs=b.sales??-1;
    if (as!==bs) return bs-as;
    return 0;
  });

  out.rankedPackages = flat;

  const outDir = path.resolve('data','taobao-brave-buyer');
  fs.mkdirSync(outDir,{recursive:true});
  const outPath = path.join(outDir,`brave-all-packages-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(out,null,2), 'utf8');

  console.log(JSON.stringify({ok:true, outPath, listings:out.listings.length, packageRows:out.rankedPackages.length},null,2));
  await browser.close();
})();
