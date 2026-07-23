const fs = require('fs');
const path = require('path');

const SITE_URL = 'https://panorama-web-one.vercel.app';

function generateSitemap() {
  const today = new Date().toISOString().split('T')[0];
  
  const staticUrls = [
    { url: `${SITE_URL}/`, priority: '1.0', changefreq: 'daily' },
    { url: `${SITE_URL}/sobre-nosotros.html`, priority: '0.5', changefreq: 'monthly' },
    { url: `${SITE_URL}/privacidad.html`, priority: '0.3', changefreq: 'yearly' }
  ];

  const notasDir = path.join(__dirname, '../notas');
  const notaFiles = fs.readdirSync(notasDir).filter(file => file.endsWith('.html'));

  const notaUrls = notaFiles.map(file => {
    return {
      url: `${SITE_URL}/notas/${file}`,
      priority: '0.8',
      changefreq: 'weekly'
    };
  });

  const allUrls = [...staticUrls, ...notaUrls];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allUrls.map(item => `  <url>
    <loc>${item.url}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>${item.changefreq}</changefreq>
    <priority>${item.priority}</priority>
  </url>`).join('\n')}
</urlset>`;

  const sitemapPath = path.join(__dirname, '../sitemap.xml');
  fs.writeFileSync(sitemapPath, xml, 'utf8');
  console.log(`✅ sitemap.xml generado con éxito (${allUrls.length} URLs totales).`);
}

generateSitemap();
