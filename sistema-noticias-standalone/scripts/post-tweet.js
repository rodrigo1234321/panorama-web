const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
const dotenv = require('dotenv');

dotenv.config();

// Habilitar plugin antibot Stealth
chromium.use(stealthPlugin());

const USER_DATA_DIR = path.resolve(__dirname, '../twitter-session');
const TWEET_FILE = path.join(__dirname, '../tweet.txt');

// Función auxiliar para cerrar modales o banners de cookies que puedan bloquear la UI
async function dismissPopupsIfAny(page) {
  try {
    const dismissSelectors = [
      'button[data-testid="app-bar-close"]',
      'div[role="dialog"] button:has-text("Not now")',
      'div[role="dialog"] button:has-text("Ahora no")',
      'div[role="dialog"] button:has-text("Dismiss")',
      'button:has-text("Refuse non-essential cookies")',
      'button:has-text("Rechazar cookies no esenciales")',
      'button:has-text("Aceptar todas las cookies")',
      'button:has-text("Accept all cookies")'
    ];
    for (const selector of dismissSelectors) {
      const btn = page.locator(selector).first();
      if (await btn.count() > 0 && await btn.isVisible()) {
        console.log(`🧹 Cerrando diálogo o banner superpuesto (${selector})...`);
        await btn.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(500);
      }
    }
  } catch (err) {
    // Ignorar errores menores al cerrar popups
  }
}

async function run() {
  console.log('🤖 Iniciando Automatización de Twitter/X via Playwright...');
  console.log(`📂 Carpeta de sesión persistente: ${USER_DATA_DIR}`);
  
  const isHeadless = process.env.HEADLESS === 'true';
  console.log(`🌐 Lanzando navegador (Headless: ${isHeadless})...`);

  let tweetText = '';
  if (fs.existsSync(TWEET_FILE)) {
    tweetText = fs.readFileSync(TWEET_FILE, 'utf8').trim();
  }
  if (!tweetText) {
    tweetText = (process.env.TWEET_TEXT || '').trim();
  }

  if (!tweetText) {
    console.log('⚠️ No se encontró ningún borrador de tweet en tweet.txt ni en TWEET_TEXT. Saltando ejecución.');
    return;
  }

  console.log(`📝 Mensaje a publicar (${tweetText.length} caracteres):\n"${tweetText}"\n`);

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: isHeadless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-infobars',
      '--window-size=1366,768'
    ],
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    // Inyectar cookie auth_token en .x.com y .twitter.com
    if (process.env.TWITTER_AUTH_TOKEN) {
      const rawToken = process.env.TWITTER_AUTH_TOKEN.trim();
      console.log('🔑 Inyectando cookies auth_token en dominios x.com y twitter.com...');
      const cookies = [
        { name: 'auth_token', value: rawToken, domain: '.x.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' },
        { name: 'auth_token', value: rawToken, domain: '.twitter.com', path: '/', httpOnly: true, secure: true, sameSite: 'None' }
      ];

      if (process.env.TWITTER_CT0) {
        const rawCt0 = process.env.TWITTER_CT0.trim();
        cookies.push(
          { name: 'ct0', value: rawCt0, domain: '.x.com', path: '/', httpOnly: false, secure: true, sameSite: 'Lax' },
          { name: 'ct0', value: rawCt0, domain: '.twitter.com', path: '/', httpOnly: false, secure: true, sameSite: 'Lax' }
        );
      }

      await context.addCookies(cookies);
    }

    console.log('🔗 Navegando a Twitter/X...');
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 60000 });

    console.log('⏳ Verificando estado de la sesión...');
    await page.waitForTimeout(5000);

    await dismissPopupsIfAny(page);

    const currentUrl = page.url();
    const isLoginPage = currentUrl.includes('/login') || 
                        currentUrl.includes('/i/flow/login') || 
                        (await page.locator('a[href="/login"]').count() > 0 && await page.locator('div[data-testid="tweetTextarea_0"]').count() === 0);

    if (isLoginPage) {
      console.log('\n⚠️ SESIÓN NO DETECTADA O TOKEN EXPIRADO.');
      
      if (isHeadless) {
        console.error('❌ Error fatal: Imposible iniciar sesión manual en modo Headless (nube).');
        console.error('Asegurate de configurar el secreto TWITTER_AUTH_TOKEN en tu repositorio de GitHub.\n');
        await context.close();
        process.exit(1);
      }

      console.log('Por favor, inicia sesión manualmente en la ventana del navegador.');
      console.log('Una vez en el inicio de X, presiona ENTER en esta consola para continuar...\n');

      await new Promise(resolve => process.stdin.once('data', resolve));
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(5000);
      await dismissPopupsIfAny(page);
    } else {
      console.log('✅ ¡Sesión detectada correctamente en X!');
    }

    console.log('✍️ Localizando caja de texto (Lexical/Draft.js contenteditable)...');
    const tweetBoxLocator = page.locator('div[data-testid="tweetTextarea_0"], div[role="textbox"][contenteditable="true"]').first();
    await tweetBoxLocator.waitFor({ state: 'visible', timeout: 20000 });

    console.log('✍️ Escribiendo tweet vía eventos de teclado...');
    await tweetBoxLocator.click();
    await page.waitForTimeout(400);

    // Limpiamos contenido previo si existiera
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(200);

    // Escribimos el tweet usando keyboard.insertText para activar el estado de React/Lexical
    await page.keyboard.insertText(tweetText);
    await page.waitForTimeout(500);

    await page.keyboard.press('Space');
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(600);

    console.log('🔍 Localizando botón de publicación...');
    const postButtonLocator = page.locator('button[data-testid="tweetButtonInline"], button[data-testid="tweetButton"]').first();
    await postButtonLocator.waitFor({ state: 'visible', timeout: 15000 });

    // Verificamos si el botón está habilitado
    let isDisabled = await postButtonLocator.evaluate(el => el.disabled || el.getAttribute('aria-disabled') === 'true');
    if (isDisabled) {
      console.log('⏳ El botón está deshabilitado. Reintentando activación con tipeo...');
      await tweetBoxLocator.click();
      await page.keyboard.type(' ', { delay: 50 });
      await page.keyboard.press('Backspace');
      await page.waitForTimeout(1000);
      isDisabled = await postButtonLocator.evaluate(el => el.disabled || el.getAttribute('aria-disabled') === 'true');
    }

    if (isDisabled) {
      throw new Error('El botón de publicar tweet permaneció en estado deshabilitado (aria-disabled="true"). No se pudo enviar.');
    }

    console.log('🚀 Interceptando llamada GraphQL y haciendo click en publicar...');
    const tweetResponsePromise = page.waitForResponse(
      res => (res.url().includes('CreateTweet') || res.url().includes('/tweet') || res.url().includes('/create.json')) && 
             res.request().method() === 'POST',
      { timeout: 25000 }
    ).catch(err => {
      console.warn('⚠️ No se capturó la respuesta GraphQL dentro del timeout:', err.message);
      return null;
    });

    await postButtonLocator.click();

    const apiResponse = await tweetResponsePromise;
    if (apiResponse) {
      const status = apiResponse.status();
      console.log(`📡 Respuesta del servidor de Twitter (HTTP ${status}) recibida.`);
      try {
        const json = await apiResponse.json();
        if (json.errors && json.errors.length > 0) {
          console.error('❌ Twitter devolvió errores en la respuesta API:', JSON.stringify(json.errors, null, 2));
          throw new Error(`Twitter API error: ${json.errors[0].message}`);
        }
        console.log('🎉 ¡Tweet confirmado y registrado exitosamente por la API de Twitter/X!');
      } catch (parseErr) {
        if (status >= 400) {
          throw new Error(`Twitter devolvió error HTTP ${status}`);
        }
      }
    } else {
      console.log('⏳ Esperando confirmación visual...');
      await page.waitForTimeout(5000);
    }

    const isBoxEmpty = await tweetBoxLocator.evaluate(el => !el.innerText || el.innerText.trim() === '');
    if (isBoxEmpty) {
      console.log('✅ Área de redacción despejada. El tweet fue enviado correctamente.');
    }

    console.log('🌟 ¡Proceso de publicación completado con éxito!');

  } catch (error) {
    console.error('❌ Ocurrió un error crítico en la publicación:', error.message || error);
    if (isHeadless) {
      await context.close().catch(() => {});
      process.exit(1);
    }
  } finally {
    console.log('🔒 Cerrando navegador y guardando sesión...');
    await context.close().catch(() => {});
  }
}

run();
