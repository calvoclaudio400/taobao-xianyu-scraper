// Captcha solver with 2Captcha + CapSolver fallback
// Supports: Image captcha, Slider captcha, Rotate captcha

// Detect captcha type from page
export async function detectCaptchaType(page) {
  const captchaInfo = await page.evaluate(() => {
    const html = document.body.innerHTML;
    const text = document.body.innerText;
    
    // Slider captcha indicators
    const sliderSelectors = [
      '.nc_bg', '.nc_wrapper', '.slide', '.drag', 
      '[class*="slider"]', '[class*="slide"]', '[class*="drag"]',
      '#nc_1_wrapper', '.nc-container'
    ];
    
    for (const sel of sliderSelectors) {
      if (document.querySelector(sel)) return { type: 'slider', selector: sel };
    }
    
    // Rotate captcha indicators
    if (html.includes('rotate') || html.includes('旋转') || 
        document.querySelector('[class*="rotate"]') ||
        document.querySelector('[class*="spin"]')) {
      return { type: 'rotate' };
    }
    
    // Image captcha indicators
    const imgSelectors = [
      'img[src*="captcha"]', 'img.captcha', '.captcha img',
      'input[name*="captcha"]', 'input[placeholder*="验证码"]'
    ];
    
    for (const sel of imgSelectors) {
      if (document.querySelector(sel)) return { type: 'image' };
    }
    
    // Text-based detection
    if (/验证码|captcha|安全验证|slide|drag/i.test(text)) {
      if (/slide|drag|滑块/i.test(text)) return { type: 'slider' };
      if (/rotate|旋转/i.test(text)) return { type: 'rotate' };
      return { type: 'image' };
    }
    
    return null;
  });
  
  return captchaInfo;
}

async function solve2CaptchaImage(screenshot, apiKey) {
  try {
    const submitRes = await fetch(`https://2captcha.com/in.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `key=${apiKey}&method=base64&body=${screenshot}&json=1`
    });
    const submitData = await submitRes.json();
    
    if (submitData.status !== 1) {
      console.error('❌ 2Captcha submit failed:', submitData.request);
      return null;
    }
    
    const captchaId = submitData.request;
    console.log('🔄 2Captcha solving, ID:', captchaId);
    
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000));
      
      const resultRes = await fetch(`https://2captcha.com/res.php?key=${apiKey}&action=get&id=${captchaId}&json=1`);
      const resultData = await resultRes.json();
      
      if (resultData.status === 1) {
        console.log('✅ 2Captcha solved:', resultData.request);
        return { type: 'text', value: resultData.request };
      }
      
      if (resultData.request !== 'CAPCHA_NOT_READY') {
        console.error('❌ 2Captcha failed:', resultData.request);
        return null;
      }
    }
    
    console.warn('⏱️ 2Captcha timeout');
    return null;
  } catch (err) {
    console.error('❌ 2Captcha error:', err.message);
    return null;
  }
}

async function solve2CaptchaSlider(pageUrl, siteKey, apiKey) {
  // 2Captcha slider solving via AntiGate or similar
  console.log('🔄 Attempting 2Captcha slider solve...');
  
  try {
    const submitRes = await fetch(`https://2captcha.com/in.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `key=${apiKey}&method=antigate&pageurl=${encodeURIComponent(pageUrl)}&json=1`
    });
    const submitData = await submitRes.json();
    
    if (submitData.status !== 1) {
      console.error('❌ 2Captcha slider submit failed:', submitData.request);
      return null;
    }
    
    const captchaId = submitData.request;
    console.log('🔄 2Captcha slider solving, ID:', captchaId);
    
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 5000));
      
      const resultRes = await fetch(`https://2captcha.com/res.php?key=${apiKey}&action=get&id=${captchaId}&json=1`);
      const resultData = await resultRes.json();
      
      if (resultData.status === 1) {
        console.log('✅ 2Captcha slider solved');
        // Parse coordinates
        const coords = resultData.request.split(',').map(Number);
        return { type: 'slider', x: coords[0], y: coords[1] || 0 };
      }
      
      if (resultData.request !== 'CAPCHA_NOT_READY') {
        console.error('❌ 2Captcha slider failed:', resultData.request);
        return null;
      }
    }
    
    return null;
  } catch (err) {
    console.error('❌ 2Captcha slider error:', err.message);
    return null;
  }
}

async function solveCapSolverImage(screenshot, apiKey) {
  try {
    const createRes = await fetch('https://api.capsolver.com/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: { type: 'ImageToTextTask', body: screenshot }
      })
    });

    const createData = await createRes.json();
    if (createData.errorId !== 0) {
      console.error('❌ CapSolver failed:', createData.errorDescription);
      return null;
    }

    const taskId = createData.taskId;
    console.log('🔄 CapSolver solving (ImageToText), task:', taskId);

    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000));
      
      const resultRes = await fetch('https://api.capsolver.com/getTaskResult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: apiKey, taskId })
      });

      const resultData = await resultRes.json();
      
      if (resultData.status === 'ready') {
        console.log('✅ CapSolver solved');
        return { type: 'text', value: resultData.solution.text };
      }
      
      if (resultData.status === 'failed') {
        console.error('❌ CapSolver failed');
        return null;
      }
    }
    
    console.warn('⏱️ CapSolver timeout');
    return null;
  } catch (err) {
    console.error('❌ CapSolver error:', err.message);
    return null;
  }
}

async function solveCapSolverSlider(pageUrl, websiteKey, apiKey) {
  try {
    const createRes = await fetch('https://api.capsolver.com/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: 'AntiSliderTask',
          websiteURL: pageUrl,
          websiteKey: websiteKey || 'default'
        }
      })
    });

    const createData = await createRes.json();
    if (createData.errorId !== 0) {
      console.error('❌ CapSolver slider failed:', createData.errorDescription);
      return null;
    }

    const taskId = createData.taskId;
    console.log('🔄 CapSolver solving (AntiSlider), task:', taskId);

    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000));
      
      const resultRes = await fetch('https://api.capsolver.com/getTaskResult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: apiKey, taskId })
      });

      const resultData = await resultRes.json();
      
      if (resultData.status === 'ready') {
        console.log('✅ CapSolver slider solved');
        return { 
          type: 'slider', 
          distance: resultData.solution?.distance || resultData.solution?.x || 100 
        };
      }
      
      if (resultData.status === 'failed') {
        console.error('❌ CapSolver slider failed');
        return null;
      }
    }
    
    return null;
  } catch (err) {
    console.error('❌ CapSolver slider error:', err.message);
    return null;
  }
}

// Simulate human-like slider drag
async function simulateSliderDrag(page, sliderHandle, distance) {
  console.log(`🖱️ Simulating slider drag: ${distance}px`);
  
  const box = await sliderHandle.boundingBox();
  if (!box) {
    console.error('❌ Could not find slider handle');
    return false;
  }
  
  const startX = box.x + box.width / 2;
  const startY = box.y + box.height / 2;
  const endX = startX + distance;
  
  // Move to handle
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  
  // Drag with human-like curve (accelerate then decelerate)
  const steps = 20 + Math.floor(Math.random() * 15);
  for (let i = 0; i <= steps; i++) {
    const progress = i / steps;
    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const currentX = startX + (endX - startX) * eased;
    const jitterY = (Math.random() - 0.5) * 3; // Small Y jitter
    
    await page.mouse.move(currentX, startY + jitterY);
    await new Promise(r => setTimeout(r, 10 + Math.random() * 20));
  }
  
  // Small overshoot and correction (human behavior)
  await page.mouse.move(endX + 5, startY);
  await new Promise(r => setTimeout(r, 50));
  await page.mouse.move(endX, startY);
  
  await page.mouse.up();
  
  console.log('✅ Slider drag completed');
  return true;
}

async function solveImageCaptcha(page, apiKey2captcha, apiKeyCapSolver) {
  const screenshot = (await page.screenshot()).toString('base64');
  
  // Try CapSolver first
  let result = await solveCapSolverImage(screenshot, apiKeyCapSolver);
  if (!result) {
    result = await solve2CaptchaImage(screenshot, apiKey2captcha);
  }
  
  if (result && result.type === 'text') {
    await page.evaluate((text) => {
      const input = document.querySelector('input[name="captcha"], input[type="text"]');
      if (input) {
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }, result.value);
    
    // Try to submit
    await page.evaluate(() => {
      const btn = document.querySelector('button[type="submit"], .submit, .confirm');
      if (btn) btn.click();
    });
    
    return true;
  }
  
  return false;
}

async function solveSliderCaptcha(page, apiKey2captcha, apiKeyCapSolver) {
  const pageUrl = page.url();
  
  // Try CapSolver first
  let result = await solveCapSolverSlider(pageUrl, 'default', apiKeyCapSolver);
  if (!result) {
    result = await solve2CaptchaSlider(pageUrl, 'default', apiKey2captcha);
  }
  
  if (result && result.type === 'slider') {
    // Find slider handle
    const handleSelectors = [
      '.nc_iconfont.btn_slide', '.slide-btn', '.drag-handle',
      '[class*="slider"][class*="handle"]', '[class*="drag"]'
    ];
    
    for (const sel of handleSelectors) {
      const handle = await page.locator(sel).first();
      if (await handle.count() > 0) {
        const distance = result.distance || result.x || 100;
        return await simulateSliderDrag(page, handle, distance);
      }
    }
  }
  
  return false;
}

export async function solveCaptcha(page) {
  console.log('🔄 Detecting captcha type...');
  
  const captchaInfo = await detectCaptchaType(page);
  if (!captchaInfo) {
    console.log('ℹ️ No captcha detected');
    return false;
  }
  
  console.log(`🔍 Detected captcha type: ${captchaInfo.type}`);
  
  const apiKey2captcha = process.env.TWOCAPTCHA_API_KEY || '62cc557ed2c55773b49bfbe2e6aa45ee';
  const apiKeyCapSolver = process.env.CAPSOLVER_API_KEY || 'CAP-2589E729ED88F38704457D2188A0115447DADF4C160FDCC216E2A4C7D6CC54AE';
  
  switch (captchaInfo.type) {
    case 'image':
      return await solveImageCaptcha(page, apiKey2captcha, apiKeyCapSolver);
    case 'slider':
      return await solveSliderCaptcha(page, apiKey2captcha, apiKeyCapSolver);
    case 'rotate':
      console.warn('⚠️ Rotate captcha not yet implemented');
      return false;
    default:
      console.warn('⚠️ Unknown captcha type');
      return false;
  }
}

export default { solveCaptcha, detectCaptchaType };
