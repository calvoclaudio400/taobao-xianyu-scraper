// Proxy rotator with health tracking
import { loadProxies, formatProxyForPlaywright } from './proxy-loader.mjs';

export class ProxyRotator {
  constructor() {
    this.proxies = loadProxies();
    this.health = new Map(); // proxy.url -> { success: 0, fail: 0, lastUsed: null }
    this.currentIndex = 0;
    
    // Initialize health tracking
    for (const proxy of this.proxies) {
      this.health.set(proxy.url, { success: 0, fail: 0, lastUsed: null });
    }
  }
  
  hasProxies() {
    return this.proxies.length > 0;
  }
  
  getProxyCount() {
    return this.proxies.length;
  }
  
  getNextProxy() {
    if (!this.proxies.length) return null;
    
    // Find proxy with best health score
    let bestProxy = null;
    let bestScore = -Infinity;
    let attempts = 0;
    let index = this.currentIndex;
    
    while (attempts < this.proxies.length) {
      const proxy = this.proxies[index % this.proxies.length];
      const health = this.health.get(proxy.url);
      
      // Score = success rate - fail penalty
      const total = health.success + health.fail;
      const successRate = total > 0 ? health.success / total : 0.5;
      const score = successRate - (health.fail * 0.1);
      
      if (score > bestScore) {
        bestScore = score;
        bestProxy = proxy;
      }
      
      index++;
      attempts++;
    }
    
    this.currentIndex = (this.currentIndex + 1) % this.proxies.length;
    
    if (bestProxy) {
      const health = this.health.get(bestProxy.url);
      health.lastUsed = Date.now();
      console.log(`🔄 Using proxy: ${bestProxy.host}:${bestProxy.port}`);
    }
    
    return bestProxy;
  }
  
  markSuccess(proxyUrl) {
    const health = this.health.get(proxyUrl);
    if (health) {
      health.success++;
      console.log(`✅ Proxy ${proxyUrl} marked as success (${health.success} successes)`);
    }
  }
  
  markFailed(proxyUrl, reason = '') {
    const health = this.health.get(proxyUrl);
    if (health) {
      health.fail++;
      console.log(`❌ Proxy ${proxyUrl} marked as failed (${health.fail} failures) ${reason}`);
    }
  }
  
  getHealthReport() {
    const report = [];
    for (const [url, health] of this.health) {
      const total = health.success + health.fail;
      report.push({
        url,
        success: health.success,
        fail: health.fail,
        successRate: total > 0 ? (health.success / total * 100).toFixed(1) + '%' : 'N/A',
        lastUsed: health.lastUsed ? new Date(health.lastUsed).toISOString() : 'never'
      });
    }
    return report;
  }
  
  getPlaywrightProxy() {
    const proxy = this.getNextProxy();
    return formatProxyForPlaywright(proxy);
  }
}

export default ProxyRotator;
