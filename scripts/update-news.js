const fs = require('fs');
const path = require('path');

// Configuration
const RSS_URL = 'https://news.google.com/rss/search?q=Argentina&hl=es-419&gl=AR&ceid=AR:es-419';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const NOTICIAS_FILE = path.join(__dirname, '../noticias.json');
const TWEET_FILE = path.join(__dirname, '../tweet.txt');
const SITE_URL = process.env.SITE_URL || 'https://panorama-web-one.vercel.app';

if (!GEMINI_API_KEY) {
  console.error('Error: La variable de entorno GEMINI_API_KEY no está configurada.');
  process.exit(1);
}

// Function to decode HTML entities from RSS
function decodeHtml(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// Fetch RSS feed using native fetch
async function fetchNews() {
  console.log('Obteniendo noticias desde Google News RSS...');
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
    return items.slice(0, 15); // Process the top 15 news items
  } catch (err) {
    console.error('Error al obtener el RSS:', err);
    process.exit(1);
  }
}
// Call Gemini API to process and format news
async function generateArticles(newsItems) {
  console.log('Llamando a la API de Gemini para procesar y redactar las noticias...');
  const today = new Date().toISOString().split('T')[0];
  
  const prompt = `
    Sos el editor jefe de "Panorama.ar", un medio digital argentino de opinión y análisis crítico, agudo y directo.
    Tu misión: elegir las 4 noticias que generen más debate, conversación e interés público de la lista de entrada.
    Priorizá temas de economía, política y sociedad que dividan opiniones, presenten diferentes puntos de vista o requieran un análisis profundo.
    
    TONO EDITORIAL:
    - Crítico, agudo y directo. Hacé preguntas reflexivas en los títulos cuando sea efectivo (ej: "¿Quién se beneficia realmente?").
    - Analizá las contradicciones de los distintos sectores, datos de la realidad y opiniones encontradas.
    - Buscá que el lector reflexione y quiera debatir sobre el tema tras leer la nota.
    - Incluí datos concretos (cifras, porcentajes, nombres de voceros/sectores) para dar peso a la nota.
    - NO inventes datos. Basate en los hechos reales de la entrada, presentados de forma atractiva para generar conversación.
    
    NOTICIAS DE ENTRADA:
    ${JSON.stringify(newsItems, null, 2)}
    
    Reglas de generación para cada noticia:
    - titulo: Título AGUDO que llame a la reflexión y al debate. Puede usar preguntas retóricas o señalar contrastes. Máximo 15 palabras.
    - bajada: Un gancho corto que introduzca el dilema o punto central de la discusión.
    - cuerpo: Redacta 2-3 párrafos con tono de análisis crítico y periodismo de opinión, separados por saltos de línea dobles (\\n\\n). Exponé los diferentes argumentos, cifras y datos. Cerrá con una pregunta reflexiva que invite al debate.
    - categoria: Clasifica en "economia", "sociedad" o "politica".
    - autor: "Redacción Panorama".
    - lectura: Tiempo estimado (ej: "3 min").
    - slug: URL slug basado en el título, minúsculas sin caracteres especiales (ej: "quien-se-beneficia-realmente").
    - fecha: "${today}".
    - imagen: Elige según el tema:
        * Inflación, dólar, impuestos, finanzas: "img/economia_inflacion.png"
        * Campo, sequía, cosechas, ganadería: "img/economia_campo.png"
        * Salud, hospitales, virus: "img/sociedad_salud.png"
        * Educación, comedores, pobreza, protestas: "img/sociedad_comedor.png"
        * Leyes, Congreso, debates políticos, elecciones: "img/politica_congreso.png"
        * Otro: "img/fallback_general.png"
    - destacada: true solo para la MÁS relevante para el debate público, el resto false.
    - tweet: Borrador de tweet/post de X. MÁXIMO 230 caracteres (para dejar espacio al link). Tono directo y analítico que llame al debate. Incluí 1-2 hashtags relevantes. NO incluyas ningún link, el link se agrega automáticamente después.
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
        description: "Lista de noticias formateadas para Panorama.ar",
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
    },
    safetySettings: [
      {
        category: "HARM_CATEGORY_HARASSMENT",
        threshold: "BLOCK_ONLY_HIGH"
      },
      {
        category: "HARM_CATEGORY_HATE_SPEECH",
        threshold: "BLOCK_ONLY_HIGH"
      },
      {
        category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        threshold: "BLOCK_ONLY_HIGH"
      },
      {
        category: "HARM_CATEGORY_DANGEROUS_CONTENT",
        threshold: "BLOCK_ONLY_HIGH"
      }
    ]
  };

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestBody)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API error! status: ${res.status}, body: ${errText}`);
    }

    const data = await res.json();
    
    if (!data.candidates || data.candidates.length === 0) {
      console.error("La respuesta de la API no contiene candidatos. Respuesta completa:", JSON.stringify(data, null, 2));
      throw new Error("La API de Gemini no devolvió candidatos de respuesta. Posiblemente bloqueado por filtros de seguridad.");
    }
    
    const candidate = data.candidates[0];
    if (candidate.finishReason && candidate.finishReason !== "STOP") {
      console.warn(`Advertencia: La generación finalizó con motivo: ${candidate.finishReason}`);
    }
    
    if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
      console.error("El candidato de respuesta no contiene partes de contenido. Candidato completo:", JSON.stringify(candidate, null, 2));
      throw new Error("El candidato de la API de Gemini no contiene partes de texto.");
    }

    const textResponse = candidate.content.parts[0].text;
    const articles = JSON.parse(textResponse);
    
    console.log(`Gemini generó ${articles.length} artículos exitosamente.`);
    return articles;
  } catch (err) {
    console.error('Error detallado al procesar noticias con Gemini:', err.stack || err);
    process.exit(1);
  }
}

// Merge new articles with the existing local database
function updateDatabase(newArticles) {
  console.log('Actualizando archivo noticias.json local...');
  try {
    let existingNews = [];
    if (fs.existsSync(NOTICIAS_FILE)) {
      const fileData = fs.readFileSync(NOTICIAS_FILE, 'utf8');
      existingNews = JSON.parse(fileData);
    }
    
    // Extract the tweet of the featured story and append the direct link to the article
    const featuredStory = newArticles.find(n => n.destacada) || newArticles[0];
    if (featuredStory && featuredStory.tweet) {
      const articleUrl = `${SITE_URL}/noticia.html?slug=${featuredStory.slug}`;
      const tweetText = `${featuredStory.tweet.trim()}\n\n👉 ${articleUrl}`;
      fs.writeFileSync(TWEET_FILE, tweetText, 'utf8');
      console.log('Borrador de tweet con link extraído y guardado en tweet.txt.');
    }

    // Clean up the tweet property from the JSON to keep it lean and match front-end
    const cleanNewArticles = newArticles.map(art => {
      const { tweet, ...rest } = art;
      return rest;
    });

    const cleanExistingNews = existingNews.map(art => {
      const { tweet, ...rest } = art;
      return rest;
    });
    
    // Combine and remove duplicates based on the slug
    const allNews = [...cleanNewArticles, ...cleanExistingNews];
    const uniqueSlugs = new Set();
    const mergedNews = [];
    
    for (const item of allNews) {
      const cleanSlug = item.slug.trim();
      if (!uniqueSlugs.has(cleanSlug)) {
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
          item.destacada = false; // Only allow one featured story
        } else {
          foundDestacada = true;
        }
      }
    }
    
    // Fallback if none is featured
    if (!foundDestacada && mergedNews.length > 0) {
      mergedNews[0].destacada = true;
    }

    // Keep the file light by saving only the latest 24 news items
    const limitedNews = mergedNews.slice(0, 24);

    fs.writeFileSync(NOTICIAS_FILE, JSON.stringify(limitedNews, null, 2), 'utf8');
    console.log(`Base de datos actualizada. Total de noticias archivadas: ${limitedNews.length}`);
  } catch (err) {
    console.error('Error al guardar noticias.json:', err);
    process.exit(1);
  }
}

// Execute pipeline
async function main() {
  const newsItems = await fetchNews();
  if (newsItems.length === 0) {
    console.log('No se encontraron noticias para actualizar hoy.');
    return;
  }
  const newArticles = await generateArticles(newsItems);
  updateDatabase(newArticles);
  console.log('Pipeline de noticias finalizado con éxito.');
}

main();
