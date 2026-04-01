import { readFileSync, writeFileSync, existsSync } from 'fs';

const API_KEY = process.env.WEBSHARE_API_KEY || '9drvvrtah5f93jqp1p3jkkuy85ochz5v7bzkjadl';
const CACHE_FILE = 'data/webshare_proxies.json';
const CACHE_TTL_MS = 3600000; // 1 hour

export async function getWorkingProxy() {
  let cache = loadCache();
  
  if (!cache || Date.now() - cache.timestamp > CACHE_TTL_MS) {
    console.log('Fetching fresh proxies from Webshare...');
    cache = await fetchProxies();
    saveCache(cache);
  }
  
  // Test and return first working proxy
  for (const proxy of cache.proxies) {
    if (await testProxy(proxy)) {
      return proxy;
    }
  }
  
  // All dead, fetch fresh
  console.log('All cached proxies dead, fetching fresh...');
  cache = await fetchProxies();
  saveCache(cache);
  
  return cache.proxies[0] || null;
}

async function fetchProxies() {
  const response = await fetch('https://proxy.webshare.io/api/v2/proxy/list/?mode=direct&page=1&page_size=25', {
    headers: { 'Authorization': `Token ${API_KEY}` }
  });
  
  const data = await response.json();
  const proxies = data.results.map(p => ({
    host: p.proxy_address,
    port: p.port,
    username: p.username,
    password: p.password,
    url: `http://${p.username}:${p.password}@${p.proxy_address}:${p.port}`
  }));
  
  return { proxies, timestamp: Date.now() };
}

async function testProxy(proxy) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch('https://httpbin.org/ip', {
      signal: controller.signal,
      headers: { 'Proxy-Authorization': `Basic ${btoa(`${proxy.username}:${proxy.password}`)}` }
    });
    
    clearTimeout(timeout);
    return response.ok;
  } catch {
    return false;
  }
}

function loadCache() {
  if (!existsSync(CACHE_FILE)) return null;
  try {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function saveCache(cache) {
  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
}
