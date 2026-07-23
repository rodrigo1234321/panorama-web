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

async function run() {
  console.log('🤖 Iniciando Automatización de Twitter/X via Playwright...');
  
  const isHeadless = process.env.HEADLESS === 'true';
  console.log(`🌐 Lanzando navegador (Headless: ${isHeadless})...`);

  let tweetText = '';
  if (fs.existsSync(TWEET_FILE)) {
    tweetText = fs.readFileSync(TWEET_FILE, 'utf8').trim();
  }
  if (!tweetText) {
    tweetText = process.env.TWEET_TEXT || '';
  }

  if (!tweetText) {
    console.log('⚠️  No se encontró ningún borrador de tweet en tweet.txt. Saltando.');
    return;
  }

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: isHeadless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox'
    ],
    viewport: { width: 1280, height: 720 }
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    // Inyectar cookie auth_token si está definida en variables de entorno
    if (process.env.TWITTER_AUTH_TOKEN) {
      console.log('🔑 Inyectando cookie auth_token...');
      await context.addCookies([{
        name: 'auth_token',
        value: process.env.TWITTER_AUTH_TOKEN.trim(),
        domain: '.x.com',
        path: '/',
        httpOnly: true,
        secure: true,
        sameSite: 'None'
      }]);
    }

    console.log('🔗 Navegando a X...');
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 60000 });

    await page.waitForTimeout(5000);

    const currentUrl = page.url();
    const needsLogin = currentUrl.includes('/login') || 
                       currentUrl.includes('/i/flow/login') || 
                       await page.locator('a[href="/login"]').count() > 0;

    if (needsLogin) {
      console.log('\n⚠️  SESION NO DETECTADA.');
      
      if (isHeadless) {
        console.log('❌ Error: Imposible iniciar sesión manual en modo Headless.');
        console.log('Asegurate de configurar el secreto TWITTER_AUTH_TOKEN en tu repositorio.');
        await context.close();
        return;
      }

      console.log('Por favor, inicia sesión manualmente en la ventana del navegador.');
      console.log('Una vez en el inicio de X, presiona ENTER en esta consola para continuar...\n');

      await new Promise(resolve => process.stdin.once('data', resolve));
      await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded' });
    } else {
      console.log('✅ ¡Sesión detectada correctamente!');
    }

    console.log('✍️  Localizando caja de texto...');
    const tweetBoxSelector = 'div[data-testid="tweetTextarea_0"]';
    await page.waitForSelector(tweetBoxSelector, { timeout: 15000 });
    
    console.log('✍️  Escribiendo tweet...');
    await page.click(tweetBoxSelector);
    await page.fill(tweetBoxSelector, tweetText);
    console.log(`📝 Mensaje: "${tweetText}"`);
    await page.waitForTimeout(1000);

    console.log('🚀 Publicando tweet...');
    const postButtonSelector = 'button[data-testid="tweetButtonInline"]';
    await page.waitForSelector(postButtonSelector);
    await page.click(postButtonSelector);

    await page.waitForTimeout(5000);
    console.log('🎉 ¡Tweet publicado con éxito!');

  } catch (error) {
    console.error('❌ Ocurrió un error en la publicación:', error.message || error);
  } finally {
    await context.close();
  }
}

run();
