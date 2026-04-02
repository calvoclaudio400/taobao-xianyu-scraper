// Proxy loader - loads from env var or file
import { readFileSync, existsSync } from 'fs';
import path from 'path';

function parseProxyLine(line) {
  line = line.trim();
  if (!line || line.startsWith('#')) return null;
  
  // Format: host:port or host:port:user:pass
  const parts = line.split(':');
  if (parts.length === 2) {
    return {
      host: parts[0],
      port: parseInt(parts[1], 10),
      username: null,
      password: null,
      url: `http://${parts[0]}:${parts[1]}`
    };
  } else if (parts.length >= 4) {
    const host = parts[0];
    const port = parseInt(parts[1], 10);
    const username = parts[2];
    const password = parts.slice(3).join(':'); // password might contain colons
    return {
      host,
      port,
      username,
      password,
      url: `http://${username}:${password}@${host}:${port}`
    };
  }
  return null;
}

export function loadProxies() {
  const proxies = [];
  
  // Try environment variable first
  const envProxies = process.env.PROXY_LIST;
  if (envProxies) {
    for (const line of envProxies.split(',')) {
      const proxy = parseProxyLine(line.trim());
      if (proxy) proxies.push(proxy);
    }
    if (proxies.length) {
      console.log(`✅ Loaded ${proxies.length} proxies from PROXY_LIST env var`);
      return proxies;
    }
  }
  
  // Try file
  const proxyFile = path.resolve('data', 'proxies.txt');
  if (existsSync(proxyFile)) {
    const content = readFileSync(proxyFile, 'utf8');
    for (const line of content.split('\n')) {
      const proxy = parseProxyLine(line);
      if (proxy) proxies.push(proxy);
    }
    if (proxies.length) {
      console.log(`✅ Loaded ${proxies.length} proxies from ${proxyFile}`);
      return proxies;
    }
  }
  
  console.log('⚠️ No proxies configured. Set PROXY_LIST env var or create data/proxies.txt');
  return [];
}

export function formatProxyForPlaywright(proxy) {
  if (!proxy) return null;
  
  const config = {
    server: `http://${proxy.host}:${proxy.port}`
  };
  
  if (proxy.username && proxy.password) {
    config.username = proxy.username;
    config.password = proxy.password;
  }
  
  return config;
}
