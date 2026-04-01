# Taobao/Xianyu Scraper

Automated scraper with human-like behavior and captcha solving.

## Features
- Realistic mouse movements with easing
- Variable scroll patterns (up/down)
- Random clicks and long pauses
- Automatic captcha solving via CapSolver

## Setup

1. Install dependencies:
```bash
npm install playwright-core
```

2. Set CapSolver API key (optional):
```bash
set CAPSOLVER_API_KEY=your_key_here
```

Get API key: https://dashboard.capsolver.com/

## Usage

```bash
node scripts/taobao_brave_firstpage_test.mjs
```

Results saved to `data/taobao-tests/`
