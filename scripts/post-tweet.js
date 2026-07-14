const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright-extra');
const stealthPlugin = require('puppeteer-extra-plugin-stealth');
const dotenv = require('dotenv');

// Cargamos variables de entorno desde el archivo .env
dotenv.config();

// Agregamos el plugin de stealth para evadir la deteccion de bots
chromium.use(stealthPlugin());

const USER_DATA_DIR = path.resolve(__dirname, '../twitter-session');
const TWEET_FILE = path.join(__dirname, '../tweet.txt');

async function run() {
  console.log('🤖 Iniciando Automatizacion de Twitter/X via Playwright...');
  console.log(`📂 Carpeta de sesion persistente: ${USER_DATA_DIR}`);

  // Para el login inicial el navegador DEBE abrirse de forma visible (headless: false)
  const isHeadless = process.env.HEADLESS === 'true';
  console.log(`🌐 Lanzando navegador (Headless: ${isHeadless})...`);

  // Obtenemos el texto del tweet desde el archivo tweet.txt o variable de entorno
  let tweetText = '';
  if (fs.existsSync(TWEET_FILE)) {
    tweetText = fs.readFileSync(TWEET_FILE, 'utf8').trim();
  }
  if (!tweetText) {
    tweetText = process.env.TWEET_TEXT || '';
  }

  if (!tweetText) {
    console.log('⚠️  No se encontró ningún borrador de tweet en tweet.txt ni en TWEET_TEXT. Saltando.');
    return;
  }

  // Iniciamos un contexto de navegador persistente
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
    // Inyectamos el auth_token si esta configurado en el archivo .env para omitir el login
    if (process.env.TWITTER_AUTH_TOKEN) {
      console.log('🔑 Inyectando cookie auth_token para saltar inicio de sesion manual...');
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

    console.log('🔗 Navegando a Twitter/X...');
    await page.goto('https://x.com/home', { waitUntil: 'domcontentloaded', timeout: 60000 });

    console.log('⏳ Verificando estado de la sesion...');
    await page.waitForTimeout(5000); // Damos margen para que cargue la redireccion

    const currentUrl = page.url();
    const needsLogin = currentUrl.includes('/login') || 
                       currentUrl.includes('/i/flow/login') || 
                       await page.locator('a[href="/login"]').count() > 0;

    if (needsLogin) {
      console.log('\n⚠️  SESION NO DETECTADA.');
      
      if (isHeadless) {
        console.log('❌ Error: No se puede iniciar sesion manual en modo Headless (nube).');
        console.log('Por favor, configura el secreto de GitHub TWITTER_AUTH_TOKEN con un token válido,');
        console.log('o ejecuta el script localmente con HEADLESS=false para iniciar sesión manualmente.\n');
        await context.close();
        return;
      }

      console.log('Por favor, inicia sesion manualmente en la ventana del navegador.');
      console.log('Una vez que estes en el inicio (Home) de tu cuenta de Twitter, presiona ENTER aqui en esta consola para continuar...\n');

      // Espera input del usuario en consola
      await new Promise(resolve => process.stdin.once('data', resolve));
      console.log('👍 Continuando proceso de envio de tweet...');
    } else {
      console.log('✅ ¡Sesion persistente detectada correctamente!');
    }

    // Aseguramos estar en la url de inicio
    await page.goto('https://x.com/home', { waitUntil: 'networkidle' });

    console.log('✍️  Localizando area de redaccion del tweet...');
    const tweetBoxSelector = 'div[data-testid="tweetTextarea_0"]';
    await page.waitForSelector(tweetBoxSelector, { timeout: 15000 });
    
    console.log('✍️  Escribiendo mensaje...');
    await page.click(tweetBoxSelector);
    await page.fill(tweetBoxSelector, tweetText);
    console.log(`📝 Mensaje: "${tweetText}"`);
    await page.waitForTimeout(1000);

    console.log('🚀 Localizando boton de publicar...');
    const postButtonSelector = 'button[data-testid="tweetButtonInline"]';
    await page.waitForSelector(postButtonSelector);
    
    console.log('🚀 Publicando tweet...');
    await page.click(postButtonSelector);

    // Esperamos que se complete la peticion
    await page.waitForTimeout(5000);
    console.log('🎉 ¡Tweet publicado con exito!');

  } catch (error) {
    console.error('❌ Ocurrio un error durante la automatizacion:', error);
  } finally {
    console.log('🔒 Cerrando navegador y guardando sesion...');
    await context.close();
  }
}

run();
