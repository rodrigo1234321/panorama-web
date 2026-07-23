const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '../notas');
const adCode = `      <!-- Article Ad Slot (A-Ads) -->
      <div class="ad-slot-wrapper">
        <span class="ad-label">Publicidad</span>
        <div class="ad-slot-card" id="ad-slot-article">
          <!-- BEGIN AADS AD UNIT 2448841 -->
          <div id="frame" style="width: 100%; max-width: 728px; margin: auto; z-index: 99998; height: auto;">
            <iframe data-aa="2448841" src="https://ad.a-ads.com/2448841/?size=728x90" style="border:0; padding:0; width:100%; max-width:728px; height:90px; overflow:hidden; display: block; margin: auto;"></iframe>
          </div>
          <!-- END AADS AD UNIT 2448841 -->
        </div>
      </div>
    </article>`;

const files = fs.readdirSync(dir);
let updatedCount = 0;

files.forEach(file => {
  if (file.endsWith('.html')) {
    const filePath = path.join(dir, file);
    let content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes('2448841')) {
      content = content.replace('</div>\r\n    </article>', '</div>\r\n' + adCode);
      content = content.replace('</div>\n    </article>', '</div>\n' + adCode);
      fs.writeFileSync(filePath, content, 'utf8');
      updatedCount++;
    }
  }
});

console.log(`✅ ${updatedCount} notas fueron actualizadas con el anuncio de A-Ads.`);
