const fs = require('fs');
const path = require('path');

// Configuration
const RSS_FEEDS = [
  { name: 'politica', url: 'https://news.google.com/rss/search?q=politica+argentina+milei+gobierno&hl=es-419&gl=AR&ceid=AR:es-419' },
  { name: 'economia', url: 'https://news.google.com/rss/search?q=economia+argentina+dolar+inflacion+medidas&hl=es-419&gl=AR&ceid=AR:es-419' },
  { name: 'sociedad', url: 'https://news.google.com/rss/search?q=Argentina+sociedad+debate+nacional&hl=es-419&gl=AR&ceid=AR:es-419' },
  { name: 'portada', url: 'https://news.google.com/rss?hl=es-419&gl=AR&ceid=AR:es-419' }
];

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const NOTICIAS_FILE = path.join(__dirname, '../noticias.json');
const TRENDS_FILE = path.join(__dirname, '../trends.json');
const TWEET_FILE = path.join(__dirname, '../tweet.txt');
const SITE_URL = process.env.SITE_URL || 'https://panorama-web-one.vercel.app';

if (!GEMINI_API_KEY) {
  console.error('Error: La variable de entorno GEMINI_API_KEY no está configurada.');
  process.exit(1);
}

// Function to decode HTML entities from RSS
function decodeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

// Fetch Twitter/X & Google Trends in Argentina
async function fetchTrends() {
  console.log('Obteniendo tendencias en tiempo real (X / Twitter + Google Trends) en Argentina...');
  const combinedTrends = [];

  // 1. Scraping GetDayTrends (X / Twitter)
  try {
    const res = await fetch('https://getdaytrends.com/argentina/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (res.ok) {
      const html = await res.text();
      const trendRegex = /<a class="string" href="\/argentina\/trend\/[^"]+?">([^<]+?)<\/a>/g;
      let match;
      while ((match = trendRegex.exec(html)) !== null) {
        const trendText = match[1].trim();
        if (trendText && !combinedTrends.includes(trendText)) {
          combinedTrends.push(trendText);
        }
      }
      console.log(`✓ Obtenidas tendencias de X (GetDayTrends): ${combinedTrends.length} encontradas.`);
    }
  } catch (err) {
    console.warn('Advertencia: No se pudieron obtener las tendencias de GetDayTrends:', err.message);
  }

  // 2. Scraping Google Trends RSS Argentina
  try {
    const resG = await fetch('https://trends.google.com/trending/rss?geo=AR', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
    });
    if (resG.ok) {
      const xmlG = await resG.text();
      const gItemRegex = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g;
      let matchG;
      let gCount = 0;
      while ((matchG = gItemRegex.exec(xmlG)) !== null) {
        const titleText = decodeHtml(matchG[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim());
        if (titleText && !combinedTrends.includes(titleText)) {
          combinedTrends.push(titleText);
          gCount++;
        }
      }
      console.log(`✓ Obtenidas tendencias de Google Trends AR: ${gCount} adicionales.`);
    }
  } catch (err) {
    console.warn('Advertencia: No se pudieron obtener las tendencias de Google Trends:', err.message);
  }

  const topTrends = combinedTrends.slice(0, 20);
  console.log(`Total de tendencias activas unificadas: ${topTrends.length}`);

  // Save trends to trends.json
  try {
    fs.writeFileSync(TRENDS_FILE, JSON.stringify(topTrends, null, 2), 'utf8');
    console.log('trends.json actualizado correctamente.');
  } catch (err) {
    console.warn('Advertencia al escribir trends.json:', err.message);
  }

  return topTrends;
}

// Fetch multi-source RSS feeds
async function fetchNews() {
  console.log('Obteniendo noticias desde múltiples feeds RSS especializados...');
  const allItems = [];
  const seenTitles = new Set();

  const fetchPromises = RSS_FEEDS.map(async (feed) => {
    try {
      const res = await fetch(feed.url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();

      const itemRegex = /<item>([\s\S]*?)<\/item>/g;
      let match;
      let count = 0;

      while ((match = itemRegex.exec(xml)) !== null) {
        const itemContent = match[1];
        const titleMatch = /<title>([\s\S]*?)<\/title>/.exec(itemContent);
        const linkMatch = /<link>([\s\S]*?)<\/link>/.exec(itemContent);

        if (titleMatch && linkMatch) {
          const rawTitle = decodeHtml(titleMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim());
          const rawLink = decodeHtml(linkMatch[1].replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1').trim());

          const normalizedTitle = rawTitle.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (rawTitle && !seenTitles.has(normalizedTitle)) {
            seenTitles.add(normalizedTitle);
            allItems.push({
              sourceCategory: feed.name,
              title: rawTitle,
              link: rawLink
            });
            count++;
          }
        }
      }
      console.log(`✓ Feed [${feed.name}]: ${count} noticias recolectadas.`);
    } catch (err) {
      console.warn(`Advertencia en feed [${feed.name}]:`, err.message);
    }
  });

  await Promise.allSettled(fetchPromises);
  console.log(`Total de noticias únicas recolectadas: ${allItems.length}`);

  if (allItems.length === 0) {
    console.error('Error: No se pudo obtener ninguna noticia de los feeds RSS.');
    process.exit(1);
  }

  // Devolver las 35 noticias más relevantes para alimentar a Gemini
  return allItems.slice(0, 35);
}

// Call Gemini API to process and format news aligning with political pulse & X trends
async function generateArticles(newsItems, trends = []) {
  console.log('Llamando a la API de Gemini para procesar y redactar las noticias con enfoque político y dinámico...');
  const today = new Date().toISOString().split('T')[0];

  const prompt = `
    Sos el editor jefe de "Panorama.ar", el portal digital argentino de periodismo de análisis político, económico y debate social con fuerte repercusión e interactividad en X (Twitter).

    Tu misión: seleccionar y redactar EXACTAMENTE 10 noticias de la lista de entrada que mejor se conecten con las tendencias actuales en redes sociales y el pulso político nacional argentino.

    TENDENCIAS ACTUALES EN ARGENTINA (X/Twitter y Google Trends):
    ${JSON.stringify(trends, null, 2)}

    NOTICIAS DE ENTRADA (Multi-fuente especializada):
    ${JSON.stringify(newsItems, null, 2)}

    REGLAS EDITORIALES Y ESTRATEGIA DE CONTENIDO (OBLIGATORIAS):

    1. ORIENTACIÓN TEMÁTICA:
       - Priorizá fuertemente la POLÍTICA NACIONAL y la ECONOMÍA (medidas del gobierno, decisiones de Javier Milei, Congreso, gobernadores, tensión política, dólar, inflación, desregulación, seguridad y debates institucionales).
       - Complementá con temas de alto impacto social o controversias que dominen la conversación pública en redes.

    2. POSICIONAMIENTO EDITORIAL DINÁMICO Y CAMALEÓNICO (MUY IMPORTANTE):
       - ESCENARIO A (Cuando la tendencia o el tema sea favorable al gobierno de Javier Milei / respaldo a reformas):
         El tinte de la noticia debe ser a favor. Realzá con datos duros, cifras oficiales y argumentos sólidos lo que el gobierno está haciendo (déficit cero, baja de inflación, quita de privilegios, desregulaciones, firmeza en seguridad). Contrastá con las fallas del modelo estatista previo.
       - ESCENARIO B (Cuando la tendencia sea cuestionar al gobierno, clima de descontento social o crítica a medidas oficiales):
         REGLA DE ORO: NUNCA apoyar abiertamente a la izquierda ni al kirchnerismo. En lugar de militar a la oposición, adoptá una postura inteligente en zonas de GRISES: hacé preguntas incisivas y punzantes sobre la efectividad de las medidas de Milei, los costos sociales del ajuste, el impacto en la clase media/jubilados/pymes, la celeridad de las soluciones o contradicciones operativas. Hablá con datos reales y planteá interrogantes legítimos para detonar el debate ciudadano.
       - ESCENARIO C (Otros temas institucionales o judiciales):
         Mantené un tono agudo, analítico y directo, respaldado por hechos verificables.

    3. PALABRAS CLAVE DE TENDENCIA EN EL TÍTULO (MÁXIMA VISIBILIDAD):
       - Cuando una noticia conecte con una tendencia, el título DEBE contener textualmente de 1 a 3 palabras clave exactas de la lista de tendencias (ej: "Milei", "Dólar", "Kicillof", "Villarruel", "Inflación", "Jubilados", "Aerolíneas").
       - Titulares gancheros, directos y con gancho periodístico (máximo 15 palabras).

    4. RIGOR PERIODÍSTICO:
       - No inventes datos, números ni citas falsas. Basate en los hechos reales de las noticias provistas.
       - Cerrá el cuerpo con una pregunta reflexiva incisiva que invite a debatir en los comentarios.

    5. FORMATO DE TWEET PARA X/TWITTER (CAMPO "tweet"):
       - MÁXIMO 220 caracteres (para dejar espacio al link que se agregará automáticamente al final).
       - REGLA ESTRICTA DE FORMATO: PROHIBIDO poner hashtags con '#' dentro de las oraciones o en el medio del texto (evitar que queden palabras cortadas en azul que arruinan la lectura).
       - El texto debe redactarse como un post periodístico de alto impacto:
         * Oración 1: Gancho potente o dato revelador con los nombres propios de la tendencia de forma natural (ej: Milei, Pagni, Tolosa Paz).
         * Oración 2: Pregunta punzante o dilema que detone el debate en comentarios.
       - NO incluyas ningún link ni URL en el campo "tweet" (el enlace se agregará automáticamente).

    Campos requeridos para cada uno de los 10 artículos en el JSON:
    - titulo: Título agudo con palabras clave de tendencia (máx 15 palabras).
    - bajada: Resumen gancho de 1-2 oraciones que plantee el dilema central.
    - cuerpo: 2-3 párrafos separados por dobles saltos de línea (\\n\\n) con análisis de datos, argumentos y pregunta final de debate.
    - categoria: "politica", "economia" o "sociedad".
    - autor: "Redacción Panorama".
    - lectura: Tiempo estimado (ej: "3 min").
    - slug: URL slug basado en el título, minúsculas, guiones y sin tildes ni caracteres especiales (ej: "debate-por-medidas-economicas-de-milei").
    - fecha: "${today}".
    - imagen: "img/fallback_general.png" (se asignará automáticamente por hash).
    - destacada: true SOLO para la nota MÁS relevante de la jornada política/económica (las otras 9 deben tener false).
    - tweet: Borrador de post de X limpio, sin '#' en medio de oraciones (máx 220 chars).
  `;

  const requestBody = {
    contents: [
      {
        parts: [
          { text: prompt }
        ]
      }
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "ARRAY",
        description: "Lista de 10 noticias formateadas para Panorama.ar",
        items: {
          type: "OBJECT",
          properties: {
            titulo: { type: "STRING" },
            bajada: { type: "STRING" },
            cuerpo: { type: "STRING" },
            categoria: { type: "STRING", enum: ["politica", "economia", "sociedad"] },
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
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
    ]
  };

  const candidateModels = ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-2.5-flash'];
  let articles = null;
  let lastError = null;

  for (const modelName of candidateModels) {
    try {
      console.log(`Intentando generación con modelo: ${modelName}...`);
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${GEMINI_API_KEY}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn(`Aviso: Modelo ${modelName} falló con status ${res.status}. Probando siguiente modelo...`);
        lastError = new Error(`Gemini API error (${modelName})! status: ${res.status}, body: ${errText}`);
        continue;
      }

      const data = await res.json();

      if (!data.candidates || data.candidates.length === 0) {
        console.warn(`Aviso: Modelo ${modelName} no devolvió candidatos. Probando siguiente...`);
        continue;
      }

      const candidate = data.candidates[0];
      if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
        console.warn(`Aviso: Modelo ${modelName} no devolvió partes de texto. Probando siguiente...`);
        continue;
      }

      const textResponse = candidate.content.parts[0].text;
      articles = JSON.parse(textResponse);

      if (Array.isArray(articles) && articles.length > 0) {
        console.log(`✓ Gemini (${modelName}) generó ${articles.length} artículos exitosamente.`);
        return articles;
      }
    } catch (err) {
      console.warn(`Error intentando con modelo ${modelName}:`, err.message);
      lastError = err;
    }
  }

  if (!articles) {
    console.error('Error crítico: Ningún modelo de Gemini pudo generar los artículos.', lastError);
    process.exit(1);
  }
}

// Merge new articles with the existing local database
function updateDatabase(newArticles) {
  console.log('Actualizando base de datos local y generando páginas estáticas...');
  try {
    let existingNews = [];
    if (fs.existsSync(NOTICIAS_FILE)) {
      const fileData = fs.readFileSync(NOTICIAS_FILE, 'utf8');
      existingNews = JSON.parse(fileData);
    }

    // Extract the tweet of the featured story, sanitize any inline hashtags, and append the direct link
    const featuredStory = newArticles.find(n => n.destacada) || newArticles[0];
    if (featuredStory && featuredStory.tweet) {
      const articleUrl = `${SITE_URL}/notas/${featuredStory.slug}.html`;
      // Sanitizamos para remover '#' accidentales en medio del texto y dejar palabras limpias
      const cleanTweet = featuredStory.tweet.replace(/#([a-zA-Z0-9_]+)/g, '$1').replace(/\s+/g, ' ').trim();
      const tweetText = `${cleanTweet}\n\n👉 ${articleUrl}`;
      fs.writeFileSync(TWEET_FILE, tweetText, 'utf8');
      console.log('Borrador de tweet para X guardado en tweet.txt (limpio de hashtags intermedios).');
    }

    // Función hash consistente para asignar una imagen del pool ampliado (1 a 14) por slug y categoría
    function getSlugHashImage(slug, category) {
      let hash = 0;
      const cleanSlug = (slug || '').trim().toLowerCase();
      for (let i = 0; i < cleanSlug.length; i++) {
        hash = (hash << 5) - hash + cleanSlug.charCodeAt(i);
        hash |= 0;
      }
      const index = (Math.abs(hash) % 14) + 1; // 1 a 14 imágenes por categoría

      const cleanCat = (category || '').trim().toLowerCase();
      if (['economia', 'sociedad', 'politica'].includes(cleanCat)) {
        return `img/${cleanCat}_${index}.png`;
      }
      return 'img/fallback_general.png';
    }

    // Clean up the tweet property from the JSON and assign unique images
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

    // Combine and remove duplicates based on the slug
    const allNews = [...cleanNewArticles, ...cleanExistingNews];
    const uniqueSlugs = new Set();
    const mergedNews = [];

    for (const item of allNews) {
      const cleanSlug = item.slug ? item.slug.trim() : '';
      if (cleanSlug && !uniqueSlugs.has(cleanSlug)) {
        uniqueSlugs.add(cleanSlug);
        mergedNews.push(item);
      }
    }

    // Sort news so the latest dates are first
    mergedNews.sort((a, b) => new Date(b.fecha) - new Date(a.fecha));

    // Ensure only one article is marked as "destacada" (the newest highlighted one)
    let foundDestacada = false;
    for (const item of mergedNews) {
      if (item.destacada) {
        if (foundDestacada) {
          item.destacada = false;
        } else {
          foundDestacada = true;
        }
      }
    }

    // Fallback if none is featured
    if (!foundDestacada && mergedNews.length > 0) {
      mergedNews[0].destacada = true;
    }

    // Guardar hasta 48 noticias recientes para mantener mayor volumen diario
    const limitedNews = mergedNews.slice(0, 48);

    fs.writeFileSync(NOTICIAS_FILE, JSON.stringify(limitedNews, null, 2), 'utf8');
    console.log(`Base de datos actualizada. Total de noticias archivadas en noticias.json: ${limitedNews.length}`);

    // Generar páginas HTML estáticas con etiquetas Open Graph y Twitter Cards
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
          .replace(/\{\{TITLE_ESCAPED\}\}/g, (item.titulo || '').replace(/"/g, '&quot;'))
          .replace(/\{\{DEK\}\}/g, item.bajada || '')
          .replace(/\{\{SLUG\}\}/g, item.slug)
          .replace(/\{\{IMAGE\}\}/g, item.imagen || 'img/fallback_general.png')
          .replace(/\{\{CATEGORY\}\}/g, item.categoria)
          .replace(/\{\{CATEGORY_LABEL\}\}/g, NOMBRES_CAT[item.categoria] || item.categoria)
          .replace(/\{\{AUTHOR\}\}/g, item.autor || 'Redacción')
          .replace(/\{\{DATE\}\}/g, formattedDate)
          .replace(/\{\{READTIME\}\}/g, item.lectura || '3 min')
          .replace(/\{\{BODY_HTML\}\}/g, bodyHtml);

        const filePath = path.join(NOTAS_DIR, `${item.slug}.html`);
        fs.writeFileSync(filePath, html, 'utf8');
      }
      console.log(`¡Páginas estáticas generadas con éxito en ${NOTAS_DIR}!`);
    } else {
      console.warn('Advertencia: No se encontró la plantilla templates/noticia-template.html.');
    }
  } catch (err) {
    console.error('Error al guardar noticias.json o generar páginas estáticas:', err);
    process.exit(1);
  }
}

// Execute pipeline
async function main() {
  const trends = await fetchTrends();
  const newsItems = await fetchNews();
  if (newsItems.length === 0) {
    console.log('No se encontraron noticias para actualizar hoy.');
    return;
  }
  const newArticles = await generateArticles(newsItems, trends);
  updateDatabase(newArticles);
  try {
    const { execSync } = require('child_process');
    execSync('node scripts/generate-sitemap.js', { stdio: 'inherit' });
  } catch (e) {
    console.warn('Advertencia al generar sitemap:', e.message);
  }
  console.log('Pipeline de noticias finalizado con éxito.');
}

main();
