const fs = require('fs');
const path = require('path');

// Configuration
const RSS_URL = 'https://news.google.com/rss/search?q=Argentina&hl=es-419&gl=AR&ceid=AR:es-419';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const NOTICIAS_FILE = path.join(__dirname, '../noticias.json');
const TWEET_FILE = path.join(__dirname, '../tweet.txt');

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
    Toma la lista de títulos y enlaces de noticias de Argentina que se proporciona a continuación.
    Selecciona las 4 noticias más importantes de hoy y redacta artículos objetivos, profesionales y concisos en español neutro de Argentina.
    Usa el tono editorial de "Panorama.ar", sin sesgos políticos ni sensacionalismo.
    
    NOTICIAS DE ENTRADA:
    ${JSON.stringify(newsItems, null, 2)}
    
    Reglas de generación para cada noticia:
    - titulo: Titulo impactante pero neutral.
    - bajada: Resumen de un párrafo corto de la noticia.
    - cuerpo: Redacta el contenido en 2 o 3 párrafos concisos y bien estructurados separados por saltos de línea dobles (\\n\\n). Debe basarse en el hecho real.
    - categoria: Clasifica la noticia en "economia", "sociedad" o "politica" según corresponda.
    - autor: Debe ser "Redacción Panorama".
    - lectura: Tiempo estimado de lectura, por ejemplo "3 min".
    - slug: URL slug único basado en el título, en minúsculas y sin caracteres especiales (por ejemplo: "el-presidente-anuncia-medidas").
    - fecha: Debe ser hoy "${today}".
    - imagen: Elige una de estas rutas según el tema:
        * Si es de inflación, dólar, impuestos o finanzas: "img/economia_inflacion.png"
        * Si es de campo, sequía, cosechas o ganadería: "img/economia_campo.png"
        * Si es de salud, hospitales o virus: "img/sociedad_salud.png"
        * Si es de educación, comedores comunitarios, pobreza o protestas sociales: "img/sociedad_comedor.png"
        * Si es de leyes, el Congreso, debates políticos, gobernadores o elecciones: "img/politica_congreso.png"
        * De lo contrario: "img/fallback_general.png"
    - destacada: Marca con true la más relevante de todas, y las otras en false.
    - tweet: Un borrador de tweet o post de X de menos de 280 caracteres resumiendo de forma atractiva pero objetiva la noticia, incluyendo 1 o 2 hashtags relevantes (ej: #Economia #Argentina).
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
    }
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
    const textResponse = data.candidates[0].content.parts[0].text;
    const articles = JSON.parse(textResponse);
    
    console.log(`Gemini generó ${articles.length} artículos exitosamente.`);
    return articles;
  } catch (err) {
    console.error('Error al procesar noticias con Gemini:', err);
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
    
    // Extract the tweet of the featured story before stripping it out from the saved JSON
    const featuredStory = newArticles.find(n => n.destacada) || newArticles[0];
    if (featuredStory && featuredStory.tweet) {
      fs.writeFileSync(TWEET_FILE, featuredStory.tweet.trim(), 'utf8');
      console.log('Borrador de tweet extraído y guardado en tweet.txt.');
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
