const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

dotenv.config();

// Configuración general (parametrizable vía variables de entorno)
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const SEARCH_QUERY = process.env.SEARCH_QUERY || 'Argentina';
const SITE_NAME = process.env.SITE_NAME || 'Panorama.ar';
const SITE_URL = process.env.SITE_URL || 'https://panorama-web-one.vercel.app';

const RSS_URL = `https://news.google.com/rss/search?q=${encodeURIComponent(SEARCH_QUERY)}&hl=es-419&gl=AR&ceid=AR:es-419`;
const NOTICIAS_FILE = path.join(__dirname, '../noticias.json');
const TRENDS_FILE = path.join(__dirname, '../trends.json');
const TWEET_FILE = path.join(__dirname, '../tweet.txt');

if (!GEMINI_API_KEY) {
  console.error('Error: La variable de entorno GEMINI_API_KEY no está configurada.');
  process.exit(1);
}

// Función para decodificar entidades HTML del RSS
function decodeHtml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// 1. Obtener tendencias de X (Twitter) mediante scraping de getdaytrends
async function fetchTrends() {
  console.log(`Obteniendo tendencias de X (Twitter) para ${SEARCH_QUERY}...`);
  try {
    const res = await fetch('https://getdaytrends.com/argentina/');
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const html = await res.text();
    
    const trendRegex = /<a class="string" href="\/argentina\/trend\/[^"]+?">([^<]+?)<\/a>/g;
    const trends = [];
    let match;
    while ((match = trendRegex.exec(html)) !== null) {
      const trendText = match[1].trim();
      if (!trends.includes(trendText)) {
        trends.push(trendText);
      }
    }
    
    console.log(`Se encontraron ${trends.length} tendencias en X.`);
    const topTrends = trends.slice(0, 15);
    
    fs.writeFileSync(TRENDS_FILE, JSON.stringify(topTrends, null, 2), 'utf8');
    console.log('trends.json actualizado.');
    
    return topTrends;
  } catch (err) {
    console.warn('Advertencia: No se pudieron obtener las tendencias de X:', err.message);
    return [];
  }
}

// 2. Obtener feed RSS de Google News
async function fetchNews() {
  console.log(`Obteniendo noticias desde Google News RSS (${SEARCH_QUERY})...`);
  try {
    const res = await fetch(RSS_URL);
    if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
    const xml = await res.text();
    
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    
    while ((match = itemRegex.exec(xml)) !== null) {
      const itemContent = match[1];
      const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(itemContent);
      const linkMatch = /<link>([\s\S]*?)<\/link>/.exec(itemContent);
      
      if (titleMatch && linkMatch) {
        items.push({
          title: decodeHtml(titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim()),
          link: decodeHtml(linkMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim())
        });
      }
    }
    
    console.log(`Se encontraron ${items.length} noticias en el RSS.`);
    return items.slice(0, 20);
  } catch (err) {
    console.error('Error al obtener el RSS:', err);
    process.exit(1);
  }
}

// 3. Procesar y redactar las noticias con la API de Gemini
async function generateArticles(newsItems, trends = []) {
  console.log('Llamando a la API de Gemini para procesar y redactar noticias...');
  const today = new Date().toISOString().split('T')[0];
  
  const prompt = `
    Sos el editor jefe de "${SITE_NAME}", un medio digital de opinión y análisis crítico, agudo y directo.
    Tu misión: elegir las 7 noticias de la lista de entrada que mejor se conecten con las tendencias actuales en redes sociales (X/Twitter).
    
    TENDENCIAS ACTUALES DE X:
    ${JSON.stringify(trends, null, 2)}
    
    NOTICIAS DE ENTRADA (Google News):
    ${JSON.stringify(newsItems, null, 2)}
    
    Reglas de selección y redacción:
    1. Vinculación con tendencias: Seleccioná las 7 noticias más alineadas con los temas en tendencia en X.
    2. Tono editorial:
       - Crítico, agudo y directo. Usa preguntas reflexivas en los títulos cuando sea efectivo.
       - Analizá las contradicciones de los distintos sectores, datos de la realidad y opiniones encontradas.
       - Incluí datos concretos (cifras, porcentajes, nombres de voceros/sectores) para dar peso a la nota.
       - NO inventes datos. Basate en los hechos reales de la entrada.
    
    Campos para cada noticia en el JSON de salida:
    - titulo: Título AGUDO que llame a la reflexión y al debate. Máximo 15 palabras.
    - bajada: Un gancho corto que introduzca el dilema o punto central de la discusión.
    - cuerpo: Redacta 2-3 párrafos con tono de análisis crítico y periodismo de opinión, separados por saltos de línea dobles (\\n\\n). Exponé los diferentes argumentos, cifras y datos. Cerrá con una pregunta reflexiva.
    - categoria: Clasifica en "economia", "sociedad" o "politica".
    - autor: "Redacción ${SITE_NAME}".
    - lectura: Tiempo estimado (ej: "3 min").
    - slug: URL slug basado en el título, minúsculas sin caracteres especiales (ej: "quien-se-beneficia-realmente").
    - fecha: "${today}".
    - imagen: "img/fallback_general.png".
    - destacada: true solo para la MÁS relevante para el debate público nacional, el resto false.
    - tweet: Borrador de tweet/post de X. MÁXIMO 230 caracteres (para dejar espacio al link). Tono directo y analítico. Incluí 1-2 hashtags de las tendencias provistas si son aplicables. NO incluyas ningún link.
  `;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        description: `Lista de noticias formateadas para ${SITE_NAME}`,
        items: {
          type: "OBJECT",
          properties: {
            titulo: { type: "STRING" },
            bajada: { type: "STRING" },
            cuerpo: { type: "STRING" },
            categoria: { type: "STRING", enum: ["economia", "sociedad", "politica"] },
            autor: { type: "STRING" },
            lectura: { type: "STRING" },
            slug: { type: "STRING" },
            fecha: { type: "STRING" },
            imagen: { type: "STRING" },
            destacada: { type: "BOOLEAN" },
            tweet: { type: "STRING" }
          },
          required: ["titulo", "bajada", "cuerpo", "categoria", "autor", "lectura", "slug", "fecha", "imagen", "destacada", "tweet"]
        }
      }
    }
  };

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error ${response.status}: ${errorText}`);
  }

  const result = await response.json();
  const rawJson = result.candidates[0].content.parts[0].text;
  return JSON.parse(rawJson);
}

// 4. Actualizar base de datos noticias.json y compilar HTML estático
function updateDatabase(newArticles) {
  console.log('Actualizando archivo noticias.json local...');
  try {
    let existingNews = [];
    if (fs.existsSync(NOTICIAS_FILE)) {
      const fileData = fs.readFileSync(NOTICIAS_FILE, 'utf8');
      existingNews = JSON.parse(fileData);
    }
    
    // Guardar borrador del tweet
    const featuredStory = newArticles.find(n => n.destacada) || newArticles[0];
    if (featuredStory && featuredStory.tweet) {
      const articleUrl = `${SITE_URL}/notas/${featuredStory.slug}.html`;
      const tweetText = `${featuredStory.tweet.trim()}\n\n👉 ${articleUrl}`;
      fs.writeFileSync(TWEET_FILE, tweetText, 'utf8');
      console.log('Borrador de tweet con link guardado en tweet.txt.');
    }

    // Función hash consistente para asignar imagen del pool local por slug y categoría
    function getSlugHashImage(slug, category) {
      let hash = 0;
      const cleanSlug = slug.trim().toLowerCase();
      for (let i = 0; i < cleanSlug.length; i++) {
        hash = (hash << 5) - hash + cleanSlug.charCodeAt(i);
        hash |= 0;
      }
      const index = (Math.abs(hash) % 8) + 1;
      
      const cleanCat = category.trim().toLowerCase();
      if (['economia', 'sociedad', 'politica'].includes(cleanCat)) {
        return `img/${cleanCat}_${index}.png`;
      }
      return 'img/fallback_general.png';
    }

    const cleanNewArticles = newArticles.map(art => {
      const { tweet, ...rest } = art;
      rest.imagen = getSlugHashImage(rest.slug, rest.categoria);
      return rest;
    });

    const cleanExistingNews = existingNews.map(art => {
      const { tweet, ...rest } = art;
      rest.imagen = getSlugHashImage(rest.slug, rest.categoria);
      return rest;
    });
    
    // Remover duplicados por slug
    const mergedNews = [...cleanNewArticles];
    for (const item of cleanExistingNews) {
      if (!mergedNews.some(n => n.slug === item.slug)) {
        mergedNews.push(item);
      }
    }

    if (!mergedNews.some(n => n.destacada) && mergedNews.length > 0) {
      mergedNews[0].destacada = true;
    }

    const limitedNews = mergedNews.slice(0, 24);

    fs.writeFileSync(NOTICIAS_FILE, JSON.stringify(limitedNews, null, 2), 'utf8');
    console.log(`Base de datos actualizada. Total de noticias archivadas: ${limitedNews.length}`);

    // Generar HTML estático
    const TEMPLATE_FILE = path.join(__dirname, '../templates/noticia-template.html');
    const NOTAS_DIR = path.join(__dirname, '../notas');

    if (fs.existsSync(TEMPLATE_FILE)) {
      console.log('Generando páginas HTML estáticas en /notas...');
      if (!fs.existsSync(NOTAS_DIR)) {
        fs.mkdirSync(NOTAS_DIR, { recursive: true });
      }

      const templateContent = fs.readFileSync(TEMPLATE_FILE, 'utf8');
      const NOMBRES_CAT = { economia: 'Economía', sociedad: 'Sociedad', politica: 'Política' };

      for (const item of limitedNews) {
        let bodyHtml = '';
        if (item.cuerpo) {
          bodyHtml = item.cuerpo.split('\n\n').map(p => `<p>${p}</p>`).join('');
        } else {
          bodyHtml = `<p>${item.bajada}</p>`;
        }

        const formattedDate = new Date(item.fecha + 'T00:00:00').toLocaleDateString('es-AR', {
          day: 'numeric',
          month: 'short'
        });

        let html = templateContent
          .replace(/\{\{TITLE\}\}/g, item.titulo)
          .replace(/\{\{TITLE_ESCAPED\}\}/g, item.titulo.replace(/"/g, '&quot;'))
          .replace(/\{\{DEK\}\}/g, item.bajada)
          .replace(/\{\{SLUG\}\}/g, item.slug)
          .replace(/\{\{IMAGE\}\}/g, item.imagen || 'img/fallback_general.png')
          .replace(/\{\{CATEGORY\}\}/g, item.categoria)
          .replace(/\{\{CATEGORY_LABEL\}\}/g, NOMBRES_CAT[item.categoria] || item.categoria)
          .replace(/\{\{AUTHOR\}\}/g, item.autor || `Redacción ${SITE_NAME}`)
          .replace(/\{\{DATE\}\}/g, formattedDate)
          .replace(/\{\{READTIME\}\}/g, item.lectura || '3 min')
          .replace(/\{\{BODY_HTML\}\}/g, bodyHtml);

        const filePath = path.join(NOTAS_DIR, `${item.slug}.html`);
        fs.writeFileSync(filePath, html, 'utf8');
      }
      console.log(`¡Páginas estáticas generadas en ${NOTAS_DIR}!`);
    }
  } catch (err) {
    console.error('Error al actualizar base de datos o compilar HTML:', err);
    process.exit(1);
  }
}

// Ejecución principal
async function main() {
  const trends = await fetchTrends();
  const newsItems = await fetchNews();
  if (newsItems.length === 0) {
    console.log('No se encontraron noticias para actualizar hoy.');
    return;
  }
  const newArticles = await generateArticles(newsItems, trends);
  updateDatabase(newArticles);
  console.log('Pipeline de noticias finalizado con éxito.');
}

main();
