// Stealth configuration for Playwright

// Real Chrome user agents
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36 Edg/121.0.0.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
];

// Common viewport sizes
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1280, height: 720 }
];

export function getRandomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

export function getRandomViewport() {
  return VIEWPORTS[Math.floor(Math.random() * VIEWPORTS.length)];
}

export function getStealthContextOptions(proxy = null) {
  const viewport = getRandomViewport();
  const ua = getRandomUA();
  
  const options = {
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    viewport,
    userAgent: ua,
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    javaScriptEnabled: true,
    bypassCSP: false,
    extraHTTPHeaders: {
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'max-age=0',
      'Sec-Ch-Ua': '"Google Chrome";v="123", "Not:A-Brand";v="8"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"Windows"',
      'Sec-Fetch-Dest': 'document',
      'Sec-Fetch-Mode': 'navigate',
      'Sec-Fetch-Site': 'none',
      'Sec-Fetch-User': '?1',
      'Upgrade-Insecure-Requests': '1'
    }
  };
  
  if (proxy) {
    options.proxy = proxy;
  }
  
  return options;
}

// Scripts to inject for stealth
export const STEALTH_SCRIPTS = {
  // Hide webdriver
  webdriver: () => {
    Object.defineProperty(navigator, 'webdriver', {
      get: () => undefined
    });
  },
  
  // Mock plugins
  plugins: () => {
    Object.defineProperty(navigator, 'plugins', {
      get: () => [
        {
          0: { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' },
          description: 'Portable Document Format',
          filename: 'internal-pdf-viewer',
          length: 1,
          name: 'Chrome PDF Plugin'
        },
        {
          0: { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
          description: 'Portable Document Format',
          filename: 'internal-pdf-viewer2',
          length: 1,
          name: 'Chrome PDF Viewer'
        }
      ]
    });
  },
  
  // Mock mimeTypes
  mimeTypes: () => {
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => [
        { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: {} },
        { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format', enabledPlugin: {} }
      ]
    });
  },
  
  // Mock permissions
  permissions: () => {
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' 
        ? Promise.resolve({ state: Notification.permission })
        : originalQuery(parameters)
    );
  },
  
  // Hide chrome runtime
  chrome: () => {
    window.chrome = {
      runtime: {
        OnInstalledReason: { CHROME_UPDATE: 'chrome_update', UPDATE: 'update', INSTALL: 'install' },
        OnRestartRequiredReason: { APP_UPDATE: 'app_update', OS_UPDATE: 'os_update', PERIODIC: 'periodic' },
        PlatformArch: { ARM: 'arm', ARM64: 'arm64', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformNaclArch: { ARM: 'arm', MIPS: 'mips', MIPS64: 'mips64', X86_32: 'x86-32', X86_64: 'x86-64' },
        PlatformOs: { ANDROID: 'android', CROS: 'cros', LINUX: 'linux', MAC: 'mac', OPENBSD: 'openbsd', WIN: 'win' },
        RequestUpdateCheckStatus: { NO_UPDATE: 'no_update', THROTTLED: 'throttled', UPDATE_AVAILABLE: 'update_available' }
      }
    };
  },
  
  // Canvas fingerprint randomization
  canvas: () => {
    const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
    const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
    
    HTMLCanvasElement.prototype.toDataURL = function(type) {
      if (this.width > 16 && this.height > 16) {
        const ctx = this.getContext('2d');
        const imageData = ctx.getImageData(0, 0, this.width, this.height);
        // Add subtle noise
        for (let i = 0; i < imageData.data.length; i += 4) {
          imageData.data[i] = Math.max(0, Math.min(255, imageData.data[i] + (Math.random() - 0.5) * 2));
        }
        ctx.putImageData(imageData, 0, 0);
      }
      return originalToDataURL.apply(this, arguments);
    };
  },
  
  // WebGL fingerprint randomization
  webgl: () => {
    const getParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function(parameter) {
      if (parameter === 37445) return 'Intel Inc.';
      if (parameter === 37446) return 'Intel Iris OpenGL Engine';
      return getParameter(parameter);
    };
  }
};

export async function applyStealth(page) {
  for (const [name, script] of Object.entries(STEALTH_SCRIPTS)) {
    try {
      await page.addInitScript(script);
    } catch (err) {
      console.warn(`⚠️ Failed to apply stealth script ${name}:`, err.message);
    }
  }
  console.log('✅ Stealth scripts applied');
}

export default {
  getRandomUA,
  getRandomViewport,
  getStealthContextOptions,
  applyStealth,
  STEALTH_SCRIPTS
};
