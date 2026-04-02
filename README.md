# Taobao/Xianyu Scraper

Human-like scraper for Taobao and Xianyu with anti-bot evasion, proxy rotation, and captcha solving.

## Features

- ✅ **Human-like behavior** - Randomized delays, mouse movements, scrolling
- ✅ **Proxy rotation** - Automatic proxy switching on failure
- ✅ **Stealth mode** - WebGL masking, UA rotation, anti-detection
- ✅ **Captcha solving** - Image + slider captcha support (2Captcha/CapSolver)
- ✅ **Retry logic** - Auto-retry with new proxy on failure
- ✅ **Health tracking** - Proxy success/failure monitoring

## Quick Start

### 1. Install Dependencies

```bash
cd scripts
npm install playwright-core
```

### 2. Configure Proxies (Optional but Recommended)

**Option A: Environment Variable**
```bash
set PROXY_LIST=host1:port1:user1:pass1,host2:port2:user2:pass2
```

**Option B: File**
Create `data/proxies.txt`:
```
# Format: host:port or host:port:username:password
192.168.1.1:8080
proxy.example.com:3128:user:pass
```

### 3. Configure Captcha Solvers (Optional)

Set API keys as environment variables:
```bash
set TWOCAPTCHA_API_KEY=your_key_here
set CAPSOLVER_API_KEY=your_key_here
```

### 4. Run Tests

**Test basic functionality:**
```bash
node scripts/test-simple-site.mjs
```

**Test Taobao with different configs:**
```bash
# No protection (likely to fail)
node scripts/test-taobao-lite.mjs

# With stealth
node scripts/test-taobao-lite.mjs --stealth

# With proxy
node scripts/test-taobao-lite.mjs --proxy

# With both
node scripts/test-taobao-lite.mjs --proxy --stealth
```

**Full scraper:**
```bash
# Search for "brave" with stealth
node scripts/taobao_brave_firstpage_test.mjs brave --stealth

# With proxy rotation
node scripts/taobao_brave_firstpage_test.mjs brave --proxy --stealth
```

## Files

| File | Purpose |
|------|---------|
| `taobao_brave_firstpage_test.mjs` | Main scraper with all features |
| `proxy-loader.mjs` | Load proxies from env/file |
| `proxy-rotator.mjs` | Rotate proxies, track health |
| `stealth-config.mjs` | Stealth/anti-detection config |
| `captcha-solver.mjs` | Solve image + slider captchas |
| `test-simple-site.mjs` | Test basic scraper functionality |
| `test-taobao-lite.mjs` | Diagnose Taobao blocking |

## Anti-Bot Profile

Current human-like settings:
- Page settle: 4-9s
- Pre-scroll delay: 2-5s
- Scroll gap: 1.2-4.5s
- Scroll step: 220-780px
- Micro back-scroll: every 3-7 scrolls
- Card dwell: 1.5-4s
- Listing dwell: 8-20s
- Session: 8-20min
- Cooldown: 10-30min

## Output

Results saved to `data/taobao-tests/`:
- `*-firstpage-*.json` - Scraped data
- `taobao-home-*.png` - Screenshots
- `taobao-lite-results-*.json` - Test results

## Troubleshooting

**No listings found:**
- Check proxy health in output
- Try different proxies
- Increase delays in human behavior

**Captcha keeps failing:**
- Verify API keys are set
- Check captcha type (image vs slider)
- Some captchas require manual solving

**Blocked immediately:**
- Enable stealth mode (`--stealth`)
- Use residential/mobile proxies
- Increase initial page settle time

## Safety

- Never scrape without proxies (risk of IP ban)
- Respect rate limits
- Stop immediately on captcha/login challenge
- Use cooldown periods between sessions
