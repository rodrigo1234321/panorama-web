# 🗞️ Sistema de Noticias Automáticas y Publicación en X (Twitter)

Este módulo contiene todos los archivos, scripts y automatizaciones necesarias para integrar un **sistema de generación diaria de noticias alimentado por Inteligencia Artificial y sincronizado con las tendencias reales de X (Twitter)**, con publicación automática en redes en cualquier sitio web.

---

## 📂 Estructura de la Carpeta

```text
sistema-noticias-standalone/
├── package.json                   # Dependencias de Node.js (Playwright, Stealth, Dotenv)
├── .env.example                   # Plantilla de variables de entorno para desarrollo local
├── README.md                      # Esta guía de instalación y uso
├── .github/
│   └── workflows/
│       └── update-news.yml        # Workflow de GitHub Actions (Ejecución cada 12 horas)
├── scripts/
│   ├── update-news.js             # Generador periodístico (Google News + Trends X + IA Gemini)
│   └── post-tweet.js              # Publicador automático en X (Playwright + Cookie auth_token)
├── templates/
│   └── noticia-template.html      # Plantilla HTML con etiquetas Open Graph para vista previa en X/WhatsApp
└── img/                           # Pool de 24 imágenes temáticas locales + fallback
```

---

## 🚀 Guía de Instalación en un Nuevo Proyecto (Paso a Paso)

### Paso 1: Copiar los archivos a tu proyecto
Copiá la estructura de esta carpeta dentro del directorio raíz de tu nuevo sitio web:
* Mové la carpeta `scripts/` a la raíz de tu proyecto.
* Mové la carpeta `templates/` a la raíz de tu proyecto.
* Mové la carpeta `img/` a la raíz de tu proyecto.
* Mové la carpeta `.github/` a la raíz de tu proyecto.
* Fusioná las dependencias de `package.json` en el `package.json` de tu proyecto (o copiá el archivo si es un proyecto nuevo).

---

### Paso 2: Configurar las variables en GitHub Secrets & Variables
En tu nuevo repositorio de GitHub, ve a **Settings > Secrets and variables > Actions**:

#### 1. Repository Secrets (Variables Privadas):
* **`GEMINI_API_KEY`**: Tu clave gratuita de la API de Google Gemini (obtenela en [aistudio.google.com](https://aistudio.google.com/)).
* **`TWITTER_AUTH_TOKEN`**: La cookie `auth_token` extraída de tu navegador al iniciar sesión en tu cuenta de X (F12 -> Application -> Cookies -> `x.com` -> `auth_token`).

#### 2. Repository Variables (Variables Públicas):
* **`SITE_URL`**: La URL pública de tu sitio (ej: `https://mi-nuevo-medio.vercel.app`).
* **`SITE_NAME`**: El nombre de tu periódico o medio (ej: `ElFaroDigital`).
* **`SEARCH_QUERY`**: Los términos o país para buscar noticias en Google News (ej: `Argentina`, `Tecnologia`, `Mexico`, `Finanzas`).

---

### Paso 3: Habilitar Permisos de Escritura en GitHub Actions
Para que GitHub Actions pueda hacer `git push` de las notas generadas:
1. Ve a **Settings > Actions > General** en tu repositorio de GitHub.
2. En la sección **Workflow permissions**, seleccioná **Read and write permissions**.
3. Guardá los cambios.

---

### Paso 4: Probar la Automatización
1. Ve a la pestaña **Actions** en tu repositorio de GitHub.
2. Seleccioná el flujo de trabajo **"Auto Actualizar Noticias y Postear en X"**.
3. Hacé clic en **Run workflow**.

El sistema:
1. Scrapeará las tendencias del momento en X y las noticias recientes de Google News.
2. La IA de Gemini redactará 7 artículos con tono de análisis crítico y preguntas reflexivas.
3. Generará la base de datos `noticias.json` y las páginas HTML estáticas en `/notas/`.
4. Hará `git push` de los cambios para que Vercel o tu hosting lo despliegue inmediatamente.
5. Iniciará un navegador Chromium en la nube de forma gratuita y publicará la nota destacada en tu cuenta de X.

---

## 🛠️ Desarrollo y Pruebas Locales

Si querés probar la generación localmente antes de subir a GitHub:

1. Copiá `.env.example` como `.env` y completá tus llaves:
   ```bash
   cp .env.example .env
   ```
2. Instalá las dependencias:
   ```bash
   npm install
   npx playwright install chromium
   ```
3. Ejecutá la generación de noticias:
   ```bash
   npm run update-news
   ```
4. Publicá en X de forma local:
   ```bash
   npm run post-tweet
   ```
