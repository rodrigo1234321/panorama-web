const fs = require('fs');
const path = require('path');

const TWEET_FILE = path.join(__dirname, '../tweet.txt');

// Intentar cargar la librería oficial
let TwitterApi;
try {
  TwitterApi = require('twitter-api-v2').TwitterApi;
} catch (e) {
  console.error('Error: La librería "twitter-api-v2" no está instalada. Ejecutá npm install.');
  process.exit(1);
}

// Credenciales oficiales de X (Twitter) desde variables de entorno
const appKey = process.env.TWITTER_CONSUMER_KEY;
const appSecret = process.env.TWITTER_CONSUMER_SECRET;
const accessToken = process.env.TWITTER_ACCESS_TOKEN;
const accessSecret = process.env.TWITTER_ACCESS_SECRET;

async function main() {
  // Validación y Fallback amigable si faltan las credenciales
  if (!appKey || !appSecret || !accessToken || !accessSecret) {
    console.warn('\n⚠️  [X / Twitter] Las credenciales no están configuradas en los secretos de GitHub.');
    console.warn('Saltando la publicación del tweet automático.');
    console.warn('------------------------------------------------------------');
    console.warn('Guía para activar la publicación automática en X:');
    console.warn('1. Entrá a https://developer.x.com/ y creá un proyecto de App.');
    console.warn('2. Habilitá permisos de Escritura ("Read and Write") en la configuración de la App.');
    console.warn('3. Generá las credenciales bajo OAuth 1.0a (User Context):');
    console.warn('   - API Key (Consumer Key)');
    console.warn('   - API Key Secret (Consumer Secret)');
    console.warn('   - Access Token');
    console.warn('   - Access Token Secret');
    console.warn('4. Agregalos en GitHub (Settings > Secrets and variables > Actions):');
    console.warn('   - TWITTER_CONSUMER_KEY');
    console.warn('   - TWITTER_CONSUMER_SECRET');
    console.warn('   - TWITTER_ACCESS_TOKEN');
    console.warn('   - TWITTER_ACCESS_SECRET');
    console.warn('------------------------------------------------------------\n');
    return;
  }

  // Verificar si existe el archivo con el borrador del tweet
  if (!fs.existsSync(TWEET_FILE)) {
    console.log('No se encontró ningún borrador de tweet en tweet.txt. Saltando.');
    return;
  }

  const tweetText = fs.readFileSync(TWEET_FILE, 'utf8').trim();
  if (!tweetText) {
    console.log('El archivo tweet.txt está vacío. Saltando publicación.');
    return;
  }

  console.log(`Intentando publicar tweet en X: "${tweetText}"`);
  try {
    const client = new TwitterApi({
      appKey,
      appSecret,
      accessToken,
      accessSecret,
    });

    // Usar el cliente en modo de lectura/escritura
    const rwClient = client.readWrite;
    const response = await rwClient.v2.tweet(tweetText);
    console.log('✓ ¡Tweet publicado con éxito en X!', response.data);
  } catch (error) {
    console.error('✗ Error al publicar el tweet en X:', error.message || error);
    // Salir de forma limpia (exit 0) para que no falle la Acción en GitHub si es un error de API menor
    process.exit(0);
  }
}

main();
