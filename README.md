# Taobao/Xianyu Scraper

Automated scraper with human-like behavior and dual captcha solving.

## Features
- Realistic mouse movements with easing
- Variable scroll patterns (up/down)
- Random clicks and long pauses
- Automatic captcha solving: 2Captcha (primary) + CapSolver (fallback)

## Setup

1. Install dependencies:
```bash
npm install playwright-core
```

2. API keys (2Captcha included, CapSolver optional):
```bash
set TWOCAPTCHA_API_KEY=62cc557ed2c55773b49bfbe2e6aa45ee
set CAPSOLVER_API_KEY=your_capsolver_key_here
```

## Usage

```bash
node scripts/taobao_brave_firstpage_test.mjs
```

Results saved to `data/taobao-tests/`

