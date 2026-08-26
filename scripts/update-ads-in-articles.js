const fs = require('fs');
const path = require('path');

const NOTICIAS_FILE = path.join(__dirname, '../noticias.json');
const TEMPLATE_FILE = path.join(__dirname, '../templates/noticia-template.html');
const NOTAS_DIR = path.join(__dirname, '../notas');

if (!fs.existsSync(NOTICIAS_FILE) || !fs.existsSync(TEMPLATE_FILE)) {
  console.error('Archivos necesarios no encontrados');
  process.exit(1);
}

if (!fs.existsSync(NOTAS_DIR)) {
  fs.mkdirSync(NOTAS_DIR, { recursive: true });
}

const news = JSON.parse(fs.readFileSync(NOTICIAS_FILE, 'utf8'));
const templateContent = fs.readFileSync(TEMPLATE_FILE, 'utf8');
const NOMBRES_CAT = { economia: 'Economía', sociedad: 'Sociedad', politica: 'Política' };

let count = 0;
for (const item of news) {
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
    bodyHtml = `<p>${item.bajada || ''}</p>`;
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
  count++;
}
console.log(`✅ ${count} notas estáticas fueron regeneradas con el nuevo diseño 100% responsive para móviles.`);

