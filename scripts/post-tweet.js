const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
const dotenv = require('dotenv');

// Cargamos variables de entorno desde el archivo .env
dotenv.config();

// Agregamos el plugin de stealth para evadir la detección de bots
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

  // Obtenemos el texto del tweet desde el archivo tweet.txt o variable de entorno
  let tweetText = '';
  if (fs.existsSync(TWEET_FILE)) {
    tweetText = fs.readFileSync(TWEET_FILE, 'utf8').trim();
  }
  if (!tweetText) {
    tweetText = (process.env.TWEET_TEXT || '').trim();
  }

  if (!tweetText) {
    console.log('⚠️ No se encontró ningún borrador de tweet en tweet.txt ni en TWEET_TEXT. Saltando ejecución.');
    process.exit(0);
  }

  console.log(`📝 Mensaje a publicar (${tweetText.length} caracteres):\n"${tweetText}"\n`);

  // Iniciamos un contexto de navegador persistente con evasión antibot
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
    // Inyectamos cookies auth_token en dominios x.com y twitter.com para asegurar la sesión
    if (process.env.TWITTER_AUTH_TOKEN) {
      const rawToken = process.env.TWITTER_AUTH_TOKEN.trim();
      console.log('🔑 Inyectando cookie auth_token en dominios x.com y twitter.com...');
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

      if (process.env.TWITTER_AUTH_MULTI) {
        const rawAuthMulti = process.env.TWITTER_AUTH_MULTI.trim();
        cookies.push(
          { name: 'auth_multi', value: rawAuthMulti, domain: '.x.com', path: '/', httpOnly: false, secure: true, sameSite: 'Lax' },
          { name: 'auth_multi', value: rawAuthMulti, domain: '.twitter.com', path: '/', httpOnly: false, secure: true, sameSite: 'Lax' }
        );
      }

      await context.addCookies(cookies);
    }

    console.log('🔗 Navegando a Twitter/X...');
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 60000 });

    console.log('⏳ Verificando estado de la sesión y refrescando ct0...');
    await page.waitForTimeout(5000);
    await dismissPopupsIfAny(page);

    // 7. ct0 token refresh: extraer ct0 fresco de cookies y actualizar la sesión
    const currentCookies = await context.cookies();
    const freshCt0Cookie = currentCookies.find(c => c.name === 'ct0');
    const freshCt0 = freshCt0Cookie ? freshCt0Cookie.value : '';

    // 6. Better session validation: verify_credentials.json + DOM verification
    console.log('🔐 Validando credenciales de sesión...');
    let isValidSession = await page.evaluate(async (ct0Value) => {
      try {
        const response = await fetch('https://api.x.com/1.1/account/verify_credentials.json', {
          method: 'GET',
          headers: {
            'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
            'x-csrf-token': ct0Value || ''
          }
        });
        return response.ok;
      } catch (e) {
        return null;
      }
    }, freshCt0);

    // Si la API no respondió o dio error por CORS/v1.1 deprecation, verificamos en el DOM
    if (!isValidSession) {
      console.log('🔍 Comprobando sesión mediante elementos de la interfaz de X...');
      const isLoggedDom = await page.locator('div[data-testid="tweetTextarea_0"], div[data-testid="SideNav_AccountSwitcher_Button"], a[data-testid="AppTabBar_Profile_Link"]').first().isVisible().catch(() => false);
      const isLoginRedirect = page.url().includes('/i/flow/login') || page.url().includes('/login');
      
      if (isLoggedDom && !isLoginRedirect) {
        console.log('✅ Sesión confirmada mediante elementos de UI de X.');
        isValidSession = true;
      } else {
        console.error('❌ Error de Autenticación: La sesión no es válida (auth_token expirado o cuenta no logueada).');
        await page.screenshot({ path: path.resolve('./tweet-error-screenshot.png') }).catch(() => {});
        await context.close();
        process.exit(1); // exit code 1 on auth failure
      }
    } else {
      console.log('✅ ¡Sesión validada correctamente en la API!');
    }

    // 1. Retry with exponential backoff
    const maxRetries = 3;
    const retryDelays = [3000, 8000, 15000];
    let tweetSuccess = false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`\n🔄 Intento de publicación ${attempt}/${maxRetries}...`);
        
        // Volver a Home si no estamos ahí
        if (!page.url().includes('x.com/home')) {
          await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
          await page.waitForTimeout(4000);
          await dismissPopupsIfAny(page);
        }

        console.log('✍️ Localizando área de redacción del tweet...');
        const tweetBoxLocator = page.locator('div[data-testid="tweetTextarea_0"], div[role="textbox"][contenteditable="true"]').first();
        await tweetBoxLocator.waitFor({ state: 'visible', timeout: 20000 });
        await tweetBoxLocator.click();
        await page.waitForTimeout(400);

        // Limpiamos contenido previo
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(200);

        // 2. Better text input method
        console.log('⌨️ Ingresando texto (Método 1: insertText)...');
        await page.keyboard.insertText(tweetText);
        await page.waitForTimeout(1000);

        const postButtonLocator = page.locator('button[data-testid="tweetButtonInline"], button[data-testid="tweetButton"]').first();
        await postButtonLocator.waitFor({ state: 'visible', timeout: 15000 });

        let isDisabled = await postButtonLocator.evaluate(el => el.disabled || el.getAttribute('aria-disabled') === 'true');

        if (isDisabled) {
          console.log('⏳ Botón deshabilitado. Fallback 2: Tipeo humano caracter por caracter...');
          await page.keyboard.press('Control+A');
          await page.keyboard.press('Backspace');
          await page.waitForTimeout(200);
          
          await page.keyboard.type(tweetText, { delay: 40 });
          await page.keyboard.press('Space');
          await page.keyboard.press('Backspace');
          await page.waitForTimeout(1000);
          
          isDisabled = await postButtonLocator.evaluate(el => el.disabled || el.getAttribute('aria-disabled') === 'true');
        }

        if (isDisabled) {
          console.log('⏳ Botón deshabilitado. Fallback 3: Portapapeles (Clipboard Event) vía evaluate...');
          await page.keyboard.press('Control+A');
          await page.keyboard.press('Backspace');
          await page.waitForTimeout(200);

          await tweetBoxLocator.evaluate((el, text) => {
            const dataTransfer = new DataTransfer();
            dataTransfer.setData('text/plain', text);
            const event = new ClipboardEvent('paste', {
              clipboardData: dataTransfer,
              bubbles: true,
              cancelable: true
            });
            el.dispatchEvent(event);
          }, tweetText);
          
          await page.waitForTimeout(500);
          await page.keyboard.press('Space');
          await page.keyboard.press('Backspace');
          await page.waitForTimeout(1000);
          
          isDisabled = await postButtonLocator.evaluate(el => el.disabled || el.getAttribute('aria-disabled') === 'true');
        }

        if (isDisabled) {
          throw new Error('El botón de publicar tweet permaneció deshabilitado tras todos los métodos de ingreso de texto.');
        }

        console.log('🚀 Interceptando respuesta de API y haciendo click en publicar...');
        const tweetResponsePromise = page.waitForResponse(
          res => (res.url().includes('CreateTweet') || res.url().includes('/tweet') || res.url().includes('/create.json')) && 
                 res.request().method() === 'POST',
          { timeout: 25000 }
        ).catch(() => null);

        await postButtonLocator.click();

        const apiResponse = await tweetResponsePromise;
        if (apiResponse) {
          const status = apiResponse.status();
          console.log(`📡 Respuesta de API recibida (HTTP ${status})`);
          
          // 4. Rate limit handling
          if (status === 429) {
            console.warn('⚠️ Límite de tasa excedido (HTTP 429). Esperando 60 segundos antes de reintentar...');
            await page.waitForTimeout(60000);
            throw new Error('Rate limit 429');
          }
          
          if (status >= 400) {
            throw new Error(`API de Twitter devolvió error HTTP ${status}`);
          }
        }

        await page.waitForTimeout(3000);

        // 3. Post-publish verification
        console.log('🔍 Verificando publicación en el perfil...');
        await page.goto('https://x.com/opinadordex', { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(5000);
        await dismissPopupsIfAny(page);

        const recentTweet = page.locator('article[data-testid="tweet"]').first();
        await recentTweet.waitFor({ state: 'visible', timeout: 15000 });
        const tweetContent = await recentTweet.innerText();

        const textToCheck = tweetText.substring(0, 50).trim();
        if (!tweetContent.includes(textToCheck)) {
          throw new Error('El tweet más reciente en el perfil no coincide con el texto publicado.');
        }

        console.log('✅ ¡Verificación exitosa! El tweet está publicado en el perfil.');
        tweetSuccess = true;
        break; // Éxito, salir del loop de reintentos

      } catch (error) {
        console.error(`❌ Falló el intento ${attempt}: ${error.message}`);
        if (attempt < maxRetries) {
          const delay = retryDelays[attempt - 1];
          console.log(`⏳ Esperando ${delay / 1000}s antes del próximo intento...`);
          await page.waitForTimeout(delay);
        }
      }
    }

    if (!tweetSuccess) {
      console.error('❌ Todos los intentos de publicar el tweet fallaron.');
      await page.screenshot({ path: path.resolve('./tweet-error-screenshot.png') }).catch(() => {});
      await context.close();
      process.exit(2); // exit code 2 on tweet failure
    }

    console.log('🌟 ¡Proceso completado con éxito!');
    await context.close();
    process.exit(0); // exit code 0 on success

  } catch (error) {
    console.error('❌ Ocurrió un error crítico durante la ejecución global:', error.message || error);
    // 5. Screenshot on error
    await page.screenshot({ path: path.resolve('./tweet-error-screenshot.png') }).catch(() => {});
    await context.close().catch(() => {});
    process.exit(2);
  }
}

run();
