const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
const dotenv = require('dotenv');

dotenv.config();
chromium.use(stealthPlugin());

const USER_DATA_DIR = path.resolve(__dirname, '../twitter-session');
const TWEET_FILE = path.join(__dirname, '../tweet.txt');
const RESULT_FILE = path.join(__dirname, '../tweet-result.json');

// Guardar resultado para que el workflow reporte con 100% de fidelidad
function saveResult(success, message, detail = '') {
  try {
    fs.writeFileSync(RESULT_FILE, JSON.stringify({
      success,
      message,
      detail,
      timestamp: new Date().toISOString()
    }, null, 2), 'utf8');
  } catch (e) {}
}

async function dismissPopupsIfAny(page) {
  try {
    const dismissSelectors = [
      'button[data-testid="app-bar-close"]',
      'div[role="dialog"] button:has-text("Not now")',
      'div[role="dialog"] button:has-text("Ahora no")',
      'div[role="dialog"] button:has-text("Dismiss")',
      'div[role="dialog"] button:has-text("Entendido")',
      'button:has-text("Refuse non-essential cookies")',
      'button:has-text("Rechazar cookies no esenciales")',
      'button:has-text("Aceptar todas las cookies")',
      'button:has-text("Accept all cookies")',
      'button[data-testid="sheet-close"]'
    ];
    for (const selector of dismissSelectors) {
      const btn = page.locator(selector).first();
      if (await btn.count() > 0 && await btn.isVisible().catch(() => false)) {
        console.log(`🧹 Cerrando diálogo o banner (${selector})...`);
        await btn.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(500);
      }
    }
  } catch (err) {}
}

async function run() {
  console.log('🤖 Iniciando Automatización de Twitter/X via Playwright...');
  const isHeadless = process.env.HEADLESS === 'true';
  console.log(`🌐 Modo Headless: ${isHeadless}`);

  let tweetText = '';
  if (fs.existsSync(TWEET_FILE)) {
    tweetText = fs.readFileSync(TWEET_FILE, 'utf8').trim();
  }
  if (!tweetText) {
    tweetText = (process.env.TWEET_TEXT || '').trim();
  }

  if (!tweetText) {
    console.log('⚠️ No se encontró borrador en tweet.txt. Saltando.');
    saveResult(false, 'No hay borrador de tweet para publicar');
    process.exit(0);
  }

  console.log(`📝 Tweet a publicar (${tweetText.length} caracteres):\n"${tweetText}"\n`);

  if (!process.env.TWITTER_AUTH_TOKEN) {
    console.error('❌ Error: Falta la variable TWITTER_AUTH_TOKEN.');
    saveResult(false, 'Falta la variable TWITTER_AUTH_TOKEN en GitHub Secrets');
    process.exit(1);
  }

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
    const rawToken = process.env.TWITTER_AUTH_TOKEN.trim();
    console.log('🔑 Inyectando cookies de sesión en todos los dominios de X...');

    const domains = ['.x.com', 'x.com', '.twitter.com', 'twitter.com'];
    const cookiesToInject = [];

    for (const d of domains) {
      cookiesToInject.push({
        name: 'auth_token',
        value: rawToken,
        domain: d,
        path: '/',
        httpOnly: true,
        secure: true
      });
    }

    if (process.env.TWITTER_CT0) {
      const rawCt0 = process.env.TWITTER_CT0.trim();
      for (const d of domains) {
        cookiesToInject.push({
          name: 'ct0',
          value: rawCt0,
          domain: d,
          path: '/',
          httpOnly: false,
          secure: true
        });
      }
    }

    if (process.env.TWITTER_AUTH_MULTI) {
      const rawAuthMulti = process.env.TWITTER_AUTH_MULTI.trim();
      for (const d of domains) {
        cookiesToInject.push({
          name: 'auth_multi',
          value: rawAuthMulti,
          domain: d,
          path: '/',
          httpOnly: false,
          secure: true
        });
      }
    }

    await context.addCookies(cookiesToInject);

    // Navegar directamente al compositor de tweets de X
    console.log('🔗 Navegando a https://x.com/compose/post...');
    await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(6000);
    await dismissPopupsIfAny(page);

    // Si redirigió a login
    if (page.url().includes('/login') || page.url().includes('/i/flow/login')) {
      console.error('❌ Error: Redirigido a pantalla de inicio de sesión. La cookie auth_token es inválida o expiró.');
      await page.screenshot({ path: path.resolve('./tweet-error-screenshot.png') }).catch(() => {});
      saveResult(false, 'auth_token inválido o expirado (redirigió al login de X)');
      await context.close();
      process.exit(1);
    }

    const maxRetries = 3;
    let postedSuccessfully = false;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`\n🔄 [Intento ${attempt}/${maxRetries}] Preparando editor...`);

        // Selector amplio para la caja de texto del tweet
        const tweetBox = page.locator([
          'div[data-testid="tweetTextarea_0"]',
          'div[role="textbox"][contenteditable="true"]',
          'div[aria-label="Texto del post"]',
          'div[aria-label="Post text"]',
          'div[aria-label="Tweet text"]'
        ].join(', ')).first();

        await tweetBox.waitFor({ state: 'visible', timeout: 25000 });
        await tweetBox.click();
        await page.waitForTimeout(500);

        // Limpiar contenido previo
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(300);

        // Ingresar texto usando insertText
        console.log('⌨️ Escribiendo texto en el editor...');
        await page.keyboard.insertText(tweetText);
        await page.waitForTimeout(600);

        // Activar estado interno de React
        await page.keyboard.press('Space');
        await page.keyboard.press('Backspace');
        await page.waitForTimeout(1000);

        // Localizar el botón de postear
        const postButton = page.locator([
          'button[data-testid="tweetButton"]',
          'button[data-testid="tweetButtonInline"]',
          'button:has-text("Postear")',
          'button:has-text("Post")',
          'button:has-text("Publicar")'
        ].join(', ')).first();

        await postButton.waitFor({ state: 'visible', timeout: 15000 });

        let isDisabled = await postButton.evaluate(el => el.disabled || el.getAttribute('aria-disabled') === 'true');

        if (isDisabled) {
          console.log('⏳ Botón deshabilitado. Probando tipeo caracter por caracter...');
          await page.keyboard.press('Control+A');
          await page.keyboard.press('Backspace');
          await page.waitForTimeout(300);

          await page.keyboard.type(tweetText, { delay: 35 });
          await page.keyboard.press('Space');
          await page.keyboard.press('Backspace');
          await page.waitForTimeout(1000);

          isDisabled = await postButton.evaluate(el => el.disabled || el.getAttribute('aria-disabled') === 'true');
        }

        if (isDisabled) {
          throw new Error('El botón de publicar permaneció deshabilitado.');
        }

        console.log('🚀 Haciendo clic en el botón de publicar...');

        // Escuchar respuesta GraphQL de CreateTweet
        let apiSuccess = false;
        const responseHandler = (response) => {
          const url = response.url();
          if ((url.includes('CreateTweet') || url.includes('/tweet') || url.includes('/create.json')) && response.request().method() === 'POST') {
            const status = response.status();
            console.log(`📡 Respuesta del servidor de X: HTTP ${status}`);
            if (status === 200 || status === 201) {
              apiSuccess = true;
            }
          }
        };

        page.on('response', responseHandler);

        await postButton.click();
        await page.waitForTimeout(6000);

        page.off('response', responseHandler);

        // Verificamos si la caja se vació o el modal se cerró
        const boxStillVisible = await tweetBox.isVisible().catch(() => false);
        const boxEmpty = boxStillVisible ? (await tweetBox.innerText().catch(() => '')) === '' : true;

        if (apiSuccess || !boxStillVisible || boxEmpty) {
          console.log('✅ ¡TWEET PUBLICADO CON ÉXITO EN TWITTER/X!');
          saveResult(true, 'Tweet publicado exitosamente en X');
          postedSuccessfully = true;
          break;
        } else {
          throw new Error('No se detectó confirmación de envío.');
        }

      } catch (err) {
        console.warn(`⚠️ Intento ${attempt} no completado: ${err.message}`);
        if (attempt < maxRetries) {
          console.log('⏳ Recargando página para reintentar...');
          await page.goto('https://x.com/compose/post', { waitUntil: 'domcontentloaded' }).catch(() => {});
          await page.waitForTimeout(4000);
        }
      }
    }

    if (!postedSuccessfully) {
      console.error('❌ No se pudo publicar el tweet tras 3 intentos.');
      await page.screenshot({ path: path.resolve('./tweet-error-screenshot.png') }).catch(() => {});
      saveResult(false, 'Fallaron los 3 intentos de publicación en el editor de X');
      await context.close();
      process.exit(1);
    }

    await context.close();
    process.exit(0);

  } catch (error) {
    console.error('❌ Error crítico en post-tweet:', error.message);
    await page.screenshot({ path: path.resolve('./tweet-error-screenshot.png') }).catch(() => {});
    saveResult(false, `Error crítico: ${error.message}`);
    await context.close().catch(() => {});
    process.exit(1);
  }
}

run();
