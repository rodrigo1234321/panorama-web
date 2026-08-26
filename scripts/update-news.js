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

const candidateModels = ['gemini-flash-latest', 'gemini-3.5-flash', 'gemini-3.6-flash', 'gemini-2.5-flash'];

// Helper to call Gemini API with fallback models
async function callGemini(prompt, responseSchema, description) {
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
      responseSchema: responseSchema
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" }
    ]
  };

  let lastError = null;
  for (const modelName of candidateModels) {
    try {
      console.log(`[Gemini API] Ejecutando "${description}" con modelo: ${modelName}...`);
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
        console.warn(`[Gemini API] Modelo ${modelName} falló con status ${res.status}. Probando siguiente modelo...`);
        lastError = new Error(`Status ${res.status}: ${errText.slice(0, 150)}`);
        continue;
      }

      const data = await res.json();
      if (!data.candidates || data.candidates.length === 0) continue;
      const part = data.candidates[0].content?.parts?.[0];
      if (!part || !part.text) continue;

      const parsed = JSON.parse(part.text);
      console.log(`✓ [Gemini API] "${description}" completado con éxito con ${modelName}.`);
      return parsed;
    } catch (err) {
      console.warn(`[Gemini API] Error con modelo ${modelName}:`, err.message);
      lastError = err;
    }
  }

  throw new Error(`Error crítico en Gemini (${description}): ${lastError?.message}`);
}

// ETAPA 1: Editor Jefe y Selector Editorial con Scoring
async function selectTopStories(newsItems, trends = []) {
  console.log('📌 [Etapa 1/2] Iniciando Evaluación Editorial y Selección de Top 10 Noticias...');
  const today = new Date().toISOString().split('T')[0];

  const prompt = `
    Sos el editor jefe de "Panorama.ar", el portal digital argentino de periodismo de análisis político, económico y debate social con fuerte distribución en Google Discover, Google Search y X (Twitter).

    OBJETIVO PRINCIPAL (ETAPA 1 — SELECCIÓN EDITORIAL Y SCORING):
    A partir de la lista de noticias de entrada y de las tendencias en tiempo real de Argentina, evaluá y seleccioná EXACTAMENTE las 10 noticias con mayor potencial combinado de:
    1. Tráfico orgánico en Google Search y Discover.
    2. Interés público, debate e impresiones en X (Twitter).
    3. Relevancia política y económica nacional.
    4. Actualidad y frescura informativa.

    TENDENCIAS ACTUALES EN ARGENTINA (X/Twitter y Google Trends):
    ${JSON.stringify(trends, null, 2)}

    NOTICIAS DE ENTRADA (${newsItems.length} noticias recolectadas):
    ${JSON.stringify(newsItems, null, 2)}

    REGLAS DE SELECCIÓN EDITORIAL (OBLIGATORIAS):

    1. EVALUACIÓN Y SCORING MULTIDIMENSIONAL:
       - Evaluá internamente cada noticia de 0 a 10 en: relevancia política/económica, coincidencia real con tendencias, potencial de búsqueda, potencial de CTR en Discover, debate en X e impacto nacional.
       - DESCARTÁ noticias intrascendentes, gacetillas menores, sucesos locales irrelevantes o notas sin interés nacional.
       - Seleccioná únicamente las 10 noticias con mejor score general.

    2. PRIORIDADES TEMÁTICAS:
       - Priorizá: Política nacional, Economía argentina, Decisiones del gobierno de Javier Milei, Congreso, Inflación, Dólar, Salarios, Jubilaciones, Pymes, Seguridad y grandes controversias sociales con impacto nacional.
       - Si la política y economía dominan claramente la agenda del día, pueden ocupar la gran mayoría del TOP 10.

    3. CONEXIÓN FACTUAL CON TENDENCIAS (SIN FORZAR):
       - Las tendencias de X y Google Trends funcionan como señales editoriales, NO como palabras que deban insertarse artificialmente.
       - Si una noticia tiene relación real y factual con una tendencia (ej: trata sobre Milei, Caputo o el Dólar), asigná el término exacto en "relacion_tendencia_real".
       - Si la noticia NO tiene relación directa con la tendencia, NO la fuerces (dejá null o cadena vacía). Prohibido inventar conexiones.

    4. ROTACIÓN DE FÓRMULAS DE TITULARES:
       - Asigná a cada nota una fórmula de título distinta para evitar repeticiones:
         * "Dato + consecuencia"
         * "Medida + impacto"
         * "Conflicto + protagonista"
         * "Qué cambia y a quién beneficia/afecta"
         * "Quién gana / quién pierde"
         * "Tensión política"
         * "Pregunta/incógnita"
         * "Explicación / Análisis a fondo"

    5. DEFINICIÓN DE ÁNGULO Y SEO:
       - Para cada una de las 10 noticias definí:
         * titulo_propuesto: Título claro y magnético (máx 15 palabras).
         * angulo_editorial: El enfoque periodístico específico de la nota.
         * keyword_principal: La consulta central de búsqueda en Google.
         * keywords_secundarias: Array de 3 a 5 términos semánticos vinculados.
         * categoria: "politica", "economia" o "sociedad".
         * destacada: true SOLO para la noticia de mayor impacto nacional de la jornada (las otras 9 deben tener false).
  `;

  const schema = {
    type: "ARRAY",
    description: "Lista de 10 noticias seleccionadas por el Editor Jefe",
    items: {
      type: "OBJECT",
      properties: {
        id_fuente: { type: "INTEGER", description: "Índice de la noticia en la lista de entrada" },
        titulo_fuente_original: { type: "STRING" },
        titulo_propuesto: { type: "STRING" },
        categoria: { type: "STRING", enum: ["politica", "economia", "sociedad"] },
        angulo_editorial: { type: "STRING" },
        formula_titular: { type: "STRING" },
        keyword_principal: { type: "STRING" },
        keywords_secundarias: { type: "ARRAY", items: { type: "STRING" } },
        destacada: { type: "BOOLEAN" },
        relacion_tendencia_real: { type: "STRING" }
      },
      required: [
        "titulo_propuesto", "categoria", "angulo_editorial", "formula_titular", 
        "keyword_principal", "keywords_secundarias", "destacada"
      ]
    }
  };

  const selected = await callGemini(prompt, schema, "Etapa 1: Selección Editorial y Scoring");
  if (!Array.isArray(selected) || selected.length === 0) {
    throw new Error('La selección editorial no devolvió noticias válidas.');
  }

  return selected.slice(0, 10);
}

// ETAPA 2: Redactor Periodístico Senior, SEO/Discover y Redacción de Tweets
async function draftFullArticles(selectedStories, rawNewsItems, trends = []) {
  console.log('✍️ [Etapa 2/2] Iniciando Redacción Periodística Profunda, Optimización SEO y Redes...');
  const today = new Date().toISOString().split('T')[0];

  const prompt = `
    Sos el Redactor Periodístico Senior y Especialista en SEO/Discover de "Panorama.ar".

    Tu misión: Redactar los 10 artículos completos a partir de la selección editorial definida por el Editor Jefe.

    SELECCIÓN EDITORIAL DEFINIDA (TOP 10 CON ÁNGULOS, FÓRMULAS Y KEYWORDS):
    ${JSON.stringify(selectedStories, null, 2)}

    FUENTES DE NOTICIAS DE ENTRADA COMO REFERENCIA:
    ${JSON.stringify(rawNewsItems, null, 2)}

    REGLAS DE REDACCIÓN Y PERIODISMO (OBLIGATORIAS):

    1. ESTRUCTURA DEL ARTÍCULO Y EXTENSIÓN:
       - Cada artículo debe tener entre 350 y 600 palabras (densidad analítica y calidad sin notas artificialmente cortas).
       - Separar los párrafos con dobles saltos de línea (\\n\\n).
       - Párrafo 1: Apertura fuerte con el hecho principal, protagonistas y por qué importa.
       - Párrafos siguientes: Desarrollo con datos duros, contexto, antecedentes, declaraciones y posturas de los protagonistas.
       - Párrafo de análisis: Consecuencias políticas, económicas o sociales concretas.
       - Cierre: SIEMPRE cerrar el último párrafo con una pregunta incisiva y reflexiva que invite al debate en comentarios.

    2. LÍNEA EDITORIAL CAMALEÓNICA:
       - ESCENARIO A (Medidas favorables al gobierno de Javier Milei / reformas): Destacá datos duros oficiales, reducción de déficit, inflación a la baja, desregulación y firmeza. Contrastá con las fallas estructurales del modelo estatista previo sin caer en propaganda.
       - ESCENARIO B (Críticas o costos sociales de las medidas): NUNCA militar a favor del kirchnerismo o la izquierda. Planteá un análisis inteligente en zonas de GRISES: costos sociales, impacto en clase media, jubilados, pymes, velocidad de implementación o contradicciones, con datos reales y preguntas legítimas.
       - ESCENARIO C (Temas institucionales o judiciales): Tono analítico, directo y riguroso basado en hechos comprobables.

    3. OPTIMIZACIÓN MULTIDIMENSIONAL (SEO + DISCOVER + SEARCH):
       - "titulo": Titular editorial magnético de máximo 15 palabras, claro, evitando clickbait engañoso o mayúsculas innecesarias.
       - "meta_title": Titular optimizado para Google Search y Discover (máximo 60 caracteres).
       - "meta_description": Resumen gancho de 140 a 155 caracteres optimizado para CTR en resultados de búsqueda.
       - "keyword_principal" y "keywords_secundarias": Integrar de manera 100% natural en el texto.
       - "slug": URL slug limpio en minúsculas, guiones y sin tildes ni caracteres especiales.

    4. FORMATO DE TWEET PARA X/TWITTER:
       - MÁXIMO 220 caracteres.
       - NO incluir enlaces ni URLs (se agregarán automáticamente después).
       - PROHIBIDO poner hashtags con '#' dentro de las oraciones o en el medio del texto.
       - Estructura: Oración 1 con gancho potente o dato revelador + Oración 2 con pregunta punzante sobre el conflicto específico de la nota.

    5. CAMPOS DEL JSON REQUERIDOS:
       - titulo, bajada, cuerpo, categoria, autor ("Redacción Panorama"), lectura ("4 min"), slug, fecha ("${today}"), imagen ("img/fallback_general.png"), destacada (boolean), tweet, meta_title, meta_description, keyword_principal, keywords_secundarias, angulo_editorial.
  `;

  const schema = {
    type: "ARRAY",
    description: "Lista de 10 artículos completos para Panorama.ar",
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
        tweet: { type: "STRING" },
        meta_title: { type: "STRING" },
        meta_description: { type: "STRING" },
        keyword_principal: { type: "STRING" },
        keywords_secundarias: { type: "ARRAY", items: { type: "STRING" } },
        angulo_editorial: { type: "STRING" }
      },
      required: [
        "titulo", "bajada", "cuerpo", "categoria", "autor", "lectura", 
        "slug", "fecha", "imagen", "destacada", "tweet", 
        "meta_title", "meta_description", "keyword_principal", "keywords_secundarias", "angulo_editorial"
      ]
    }
  };

  const articles = await callGemini(prompt, schema, "Etapa 2: Redacción Profunda y SEO");
  if (!Array.isArray(articles) || articles.length === 0) {
    throw new Error('La redacción editorial no devolvió artículos válidos.');
  }

  return articles;
}

// Pipeline coordinador de IA en 2 etapas
async function generateArticles(newsItems, trends = []) {
  console.log('🤖 Iniciando Pipeline Editorial en 2 Etapas...');
  
  // Etapa 1: Editor Jefe / Selector
  const selectedStories = await selectTopStories(newsItems, trends);
  console.log(`✓ [Etapa 1/2] Se seleccionaron ${selectedStories.length} noticias de alto impacto.`);

  // Etapa 2: Redactor Periodístico / SEO / Tweets
  const fullArticles = await draftFullArticles(selectedStories, newsItems, trends);
  console.log(`✓ [Etapa 2/2] Se redactaron ${fullArticles.length} artículos completos con metadatos SEO.`);

  return fullArticles;
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

    // Generar páginas HTML estáticas con etiquetas Open Graph, Twitter Cards y Schema JSON-LD
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
          const paragraphs = item.cuerpo.split('\n\n').map(p => p.trim()).filter(Boolean);
          if (paragraphs.length > 1) {
            const lastParagraph = paragraphs[paragraphs.length - 1];
            const isQuestion = lastParagraph && (
              lastParagraph.includes('?') || 
              lastParagraph.includes('¿') || 
              lastParagraph.toLowerCase().includes('debate') || 
              lastParagraph.toLowerCase().includes('dilema') ||
              lastParagraph.toLowerCase().includes('pregunta')
            );

            if (isQuestion) {
              const mainParagraphs = paragraphs.slice(0, -1).map(p => `<p>${p}</p>`).join('');
              const debateCallout = `\n<div class="debate-callout-card">\n  <div class="debate-callout-header">\n    <span class="debate-icon">💬</span>\n    <strong>Punto de debate</strong>\n  </div>\n  <p class="debate-text">${lastParagraph}</p>\n</div>`;
              bodyHtml = mainParagraphs + debateCallout;
            } else {
              bodyHtml = paragraphs.map(p => `<p>${p}</p>`).join('');
            }
          } else {
            bodyHtml = paragraphs.map(p => `<p>${p}</p>`).join('');
          }
        } else {
          bodyHtml = `<p>${item.bajada}</p>`;
        }

        const formattedDate = new Date(item.fecha + 'T00:00:00').toLocaleDateString('es-AR', {
          day: 'numeric',
          month: 'short'
        });

        const metaTitle = item.meta_title || item.titulo;
        const metaDesc = item.meta_description || item.bajada || '';
        const keywordsList = [item.keyword_principal, ...(item.keywords_secundarias || [])].filter(Boolean).join(', ') || 'Argentina, Política, Economía, Panorama';

        let html = templateContent
          .replace(/\{\{TITLE\}\}/g, item.titulo)
          .replace(/\{\{TITLE_ESCAPED\}\}/g, (item.titulo || '').replace(/"/g, '&quot;'))
          .replace(/\{\{META_TITLE\}\}/g, metaTitle)
          .replace(/\{\{META_TITLE_ESCAPED\}\}/g, metaTitle.replace(/"/g, '&quot;'))
          .replace(/\{\{DEK\}\}/g, item.bajada || '')
          .replace(/\{\{DEK_ESCAPED\}\}/g, (item.bajada || '').replace(/"/g, '&quot;'))
          .replace(/\{\{META_DESCRIPTION\}\}/g, metaDesc)
          .replace(/\{\{META_DESCRIPTION_ESCAPED\}\}/g, metaDesc.replace(/"/g, '&quot;'))
          .replace(/\{\{KEYWORDS\}\}/g, keywordsList)
          .replace(/\{\{ISO_DATE\}\}/g, item.fecha || new Date().toISOString().split('T')[0])
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
