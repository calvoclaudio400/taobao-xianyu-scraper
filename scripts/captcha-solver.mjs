// Captcha solver using CapSolver API
// Set CAPSOLVER_API_KEY environment variable

async function solveCaptcha(page, type = 'slider') {
  const apiKey = process.env.CAPSOLVER_API_KEY;
  if (!apiKey) {
    console.warn('⚠️ CAPSOLVER_API_KEY not set, skipping captcha solve');
    return false;
  }

  try {
    const pageUrl = page.url();
    
    // Create task
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
      console.error('❌ Captcha task creation failed:', createData.errorDescription);
      return false;
    }

    const taskId = createData.taskId;
    console.log('🔄 Solving captcha, task:', taskId);

    // Poll for result
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 2000));
      
      const resultRes = await fetch('https://api.capsolver.com/getTaskResult', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientKey: apiKey, taskId })
      });

      const resultData = await resultRes.json();
      
      if (resultData.status === 'ready') {
        console.log('✅ Captcha solved');
        
        // Inject solution
        await page.evaluate((token) => {
          const callback = window.turnstileCallback || window.captchaCallback;
          if (callback) callback(token);
        }, resultData.solution.token);
        
        return true;
      }
      
      if (resultData.status === 'failed') {
        console.error('❌ Captcha solve failed');
        return false;
      }
    }
    
    console.warn('⏱️ Captcha solve timeout');
    return false;
  } catch (err) {
    console.error('❌ Captcha solver error:', err.message);
    return false;
  }
}

export { solveCaptcha };
