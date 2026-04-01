// Captcha solver with 2Captcha + CapSolver fallback
// Priority: 2Captcha first, then CapSolver

async function solve2Captcha(page) {
  const apiKey = process.env.TWOCAPTCHA_API_KEY || '62cc557ed2c55773b49bfbe2e6aa45ee';
  
  try {
    const pageUrl = page.url();
    const screenshot = await page.screenshot({ encoding: 'base64' });
    
    // Submit captcha
    const submitRes = await fetch(`https://2captcha.com/in.php?key=${apiKey}&method=base64&body=${screenshot}&json=1`);
    const submitData = await submitRes.json();
    
    if (submitData.status !== 1) {
      console.error('❌ 2Captcha submit failed:', submitData.request);
      return null;
    }
    
    const captchaId = submitData.request;
    console.log('🔄 2Captcha solving, ID:', captchaId);
    
    // Poll for result
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 3000));
      
      const resultRes = await fetch(`https://2captcha.com/res.php?key=${apiKey}&action=get&id=${captchaId}&json=1`);
      const resultData = await resultRes.json();
      
      if (resultData.status === 1) {
        console.log('✅ 2Captcha solved:', resultData.request);
        return resultData.request;
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

async function solveCapSolver(page) {
  const apiKey = process.env.CAPSOLVER_API_KEY;
  if (!apiKey) return null;
  
  try {
    const pageUrl = page.url();
    
    const createRes = await fetch('https://api.capsolver.com/createTask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        clientKey: apiKey,
        task: {
          type: 'AntiTurnstileTaskProxyLess',
          websiteURL: pageUrl,
          websiteKey: await page.evaluate(() => {
            const el = document.querySelector('[data-sitekey]');
            return el?.getAttribute('data-sitekey') || '';
          })
        }
      })
    });

    const createData = await createRes.json();
    if (createData.errorId !== 0) {
      console.error('❌ CapSolver failed:', createData.errorDescription);
      return null;
    }

    const taskId = createData.taskId;
    console.log('🔄 CapSolver solving, task:', taskId);

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
        return resultData.solution.token;
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

async function solveCaptcha(page) {
  console.log('🔄 Attempting captcha solve...');
  
  // Try 2Captcha first
  let solution = await solve2Captcha(page);
  if (solution) {
    await page.evaluate((text) => {
      const input = document.querySelector('input[name="captcha"], input[type="text"]');
      if (input) {
        input.value = text;
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, solution);
    return true;
  }
  
  // Fallback to CapSolver
  solution = await solveCapSolver(page);
  if (solution) {
    await page.evaluate((token) => {
      const callback = window.turnstileCallback || window.captchaCallback;
      if (callback) callback(token);
    }, solution);
    return true;
  }
  
  console.warn('⚠️ All captcha solvers failed');
  return false;
}

export { solveCaptcha };
