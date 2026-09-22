require('dotenv').config();

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ADMIN_PATH = '/yhors/admin593';
const DATA_FILE = path.join(__dirname, 'data', 'products.json');
const STOREFRONT_FILE = path.join(__dirname, 'data', 'storefront.json');
const CLASSIFICATIONS_FILE = path.join(__dirname, 'data', 'classifications.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const SESSION_SECRET = process.env.SESSION_SECRET || 'cambia-este-secreto-antes-de-publicar';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'cambia-esta-contrasena';
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'");
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());


const SITE_URL = String(process.env.PUBLIC_BASE_URL || 'https://yhors-store.onrender.com').replace(/\/$/, '');
const SITE_NAME = 'YHORS-STORE';
const CORPORATE_NAME = 'YHORS-CORP';
const CATEGORY_LABELS = {
  principal: 'Principal', elegant: 'Elegant', sports: 'Sports', tech: 'Tech', cosplay: 'Cosplay',
  pets: 'Pets', details: 'Details', collectibles: 'Coleccionables'
};
const CATEGORY_DESCRIPTIONS = {
  principal: 'Descubre todo el universo YHORS en un solo lugar.',
  elegant: 'Detalles refinados, regalos y piezas pensadas para momentos especiales.',
  sports: 'Accesorios y productos para quienes viven con energía y movimiento.',
  tech: 'Tecnología, gadgets y soluciones que combinan utilidad con estilo.',
  cosplay: 'Piezas para transformar tu personaje y llevar tu imaginación más lejos.',
  pets: 'Detalles y productos para consentir a quienes siempre están contigo.',
  details: 'Regalos, arreglos y detalles creados para sorprender.',
  collectibles: 'Figuras y objetos para quienes disfrutan coleccionar lo extraordinario.'
};
const VALID_PUBLIC_CATEGORIES = Object.keys(CATEGORY_LABELS).filter(key => key !== 'principal');
function seoSlug(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' y ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'producto';
}
function productSlug(product) {
  const base = seoSlug(product.name);
  const sku = seoSlug(product.sku || '');
  return sku ? `${base}-${sku}` : `${base}-${String(product.id || '').slice(0, 8)}`;
}
function productUrl(product) { return `${SITE_URL}/producto/${encodeURIComponent(productSlug(product))}`; }
function findProductBySlug(products, slug) {
  const target = decodeURIComponent(String(slug || '')).toLowerCase();
  return products.find(product => productSlug(product).toLowerCase() === target);
}
function esc(value = '') { return String(value).replace(/[&<>'"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[c])); }
function stripText(value = '') { return String(value).replace(/\s+/g, ' ').trim(); }
function absoluteImage(value = '') {
  if (!value) return `${SITE_URL}/favicon.svg`;
  return value.startsWith('http') ? value : `${SITE_URL}${value.startsWith('/') ? '' : '/'}${value}`;
}
function seoDescription(text, fallback) {
  const clean = stripText(text || fallback);
  return clean.length > 155 ? `${clean.slice(0, 152).replace(/\s+\S*$/, '')}…` : clean;
}
function jsonLd(value) { return JSON.stringify(value).replace(/</g, '\\u003c'); }
function baseHead({ title, description, canonical, robots = 'index,follow', image = '', json = [] }) {
  const graph = Array.isArray(json) ? json : [json];
  return `
    <meta name="description" content="${esc(description)}">
    <meta name="robots" content="${esc(robots)}">
    <link rel="canonical" href="${esc(canonical)}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="${SITE_NAME}">
    <meta property="og:locale" content="es_EC">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:url" content="${esc(canonical)}">
    ${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(title)}">
    <meta name="twitter:description" content="${esc(description)}">
    ${image ? `<meta name="twitter:image" content="${esc(image)}">` : ''}
    ${graph.map(item => `<script type="application/ld+json">${jsonLd(item)}</script>`).join('\n')}
  `;
}
function layout({ title, description, canonical, body, robots, image, json }) {
  const template = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const head = baseHead({ title, description, canonical, robots, image, json });
  return template.replace('<meta name="description" content="YHORS · piezas que cuentan tu historia.">', head)
    .replace('<title>YHORS-STORE</title>', `<title>${esc(title)}</title>`)
    .replace('<div id="app"></div>', `<div id="app">${body}</div>`);
}
function productSeoBody(product) {
  const images = Array.isArray(product.images) && product.images.length ? product.images : (product.image ? [product.image] : []);
  const image = images[0] || '';
  const category = CATEGORY_LABELS[product.category] || product.category;
  const price = Number(product.salePrice ?? product.price);
  const rental = product.category === 'cosplay' && Number.isFinite(Number(product.rentalPrice)) ? `<p class="price-secondary">Alquiler: $${Number(product.rentalPrice).toFixed(2)}</p>` : '';
  return `<main class="product-detail-page"><div class="breadcrumbs"><a href="/categoria/${encodeURIComponent(product.category)}">${esc(category)}</a><span>/</span><strong>${esc(product.name)}</strong></div><section class="detail-layout"><div class="detail-gallery"><div class="detail-main-image"><img src="${esc(absoluteImage(image))}" alt="${esc(product.name)}" width="800" height="800"></div>${images.length > 1 ? `<div class="thumbnail-row">${images.slice(1,4).map((url,i)=>`<img src="${esc(absoluteImage(url))}" alt="${esc(product.name)} - imagen ${i+2}" width="200" height="200">`).join('')}</div>`:''}</div><div class="detail-copy"><span class="eyebrow">${esc(category)}</span><h1>${esc(product.name)}</h1><div class="detail-price">$${price.toFixed(2)}</div>${rental}<div class="detail-sku"><span>SKU: <strong>${esc(product.sku || '—')}</strong></span></div><div class="detail-divider"></div><h2>Descripción</h2><div class="detail-description">${esc(product.description).replace(/\n/g,'<br>')}</div><div class="detail-buy"><a class="button" href="/categoria/${encodeURIComponent(product.category)}">Ver más productos <span>→</span></a></div></div></section></main>`;
}
function categorySeoBody(categoryKey, products) {
  const label = CATEGORY_LABELS[categoryKey];
  const list = products.filter(p => categoryKey === 'principal' || p.category === categoryKey);
  return `<main><section class="section category-page-section"><div class="category-intro"><div><span class="eyebrow">YHORS-STORE</span><h1>${esc(label)}</h1></div><p>${esc(CATEGORY_DESCRIPTIONS[categoryKey])}</p></div><section class="section"><div class="products">${list.map(p => `<article class="product"><a class="product-open" href="${esc(productUrl(p))}"><div class="product-image"><img src="${esc(absoluteImage((p.images||[])[0]||p.image))}" alt="${esc(p.name)}" width="800" height="800"></div><div class="product-info"><span class="product-category">${esc(CATEGORY_LABELS[p.category] || p.category)}</span><h2>${esc(p.name)}</h2><p>${esc(seoDescription(p.description, p.name))}</p><span class="detail-link">Ver detalles →</span></div></a></article>`).join('')}</div></section></section></main>`;
}
function homeSeoBody(products) {
  const featured = products.filter(p => p.featured).slice(0, 12);
  const items = (featured.length ? featured : products).slice(0, 12);
  return `<main><section class="hero-slider"><div class="hero-content"><span class="eyebrow">YHORS-STORE</span><h1>Tecnología, detalles y piezas que cuentan tu historia.</h1><p>Descubre el catálogo YHORS: tecnología, regalos, cosplay, mascotas, coleccionables y productos seleccionados.</p><a class="button" href="/categoria/principal">Explorar catálogo <span>→</span></a></div></section><section class="section"><div class="section-heading"><div><span class="eyebrow">Selección YHORS</span><h2>Productos destacados</h2></div><p>Explora productos disponibles en nuestra tienda online.</p></div><div class="products">${items.map(p=>`<article class="product"><a class="product-open" href="${esc(productUrl(p))}"><div class="product-image"><img src="${esc(absoluteImage((p.images||[])[0]||p.image))}" alt="${esc(p.name)}" width="800" height="800"></div><div class="product-info"><span class="product-category">${esc(CATEGORY_LABELS[p.category]||p.category)}</span><h2>${esc(p.name)}</h2><p>${esc(seoDescription(p.description,p.name))}</p><span class="detail-link">Ver detalles →</span></div></a></article>`).join('')}</div></section><section class="section category-blocks"><div class="section-heading"><div><span class="eyebrow">Explora por universo</span><h2>Categorías YHORS</h2></div></div><div class="category-grid">${Object.entries(CATEGORY_LABELS).filter(([k])=>k!=='principal').map(([k,v])=>`<a class="category-card" href="/categoria/${k}"><h2>${esc(v)}</h2><p>${esc(CATEGORY_DESCRIPTIONS[k])}</p></a>`).join('')}</div></section><section class="brand-section"><div class="brand-section-inner"><span class="eyebrow">YHORS-CORP</span><h2>YHORS<br><em>más que un producto</em></h2><p>YHORS-CORP es el espacio corporativo de la marca YHORS y su ecosistema digital, mientras YHORS-STORE presenta el catálogo de productos.</p><a class="button" href="/yhors-corp">Conocer YHORS-CORP <span>→</span></a></div></section></main>`;
}
function corpSeoBody() {
  return `<main class="section"><div class="brand-section-inner"><span class="eyebrow">YHORS-CORP</span><h1>YHORS-CORP</h1><p>Espacio corporativo de YHORS y punto de referencia para conocer el ecosistema de la marca.</p><h2>YHORS-STORE</h2><p>YHORS-STORE es la tienda online de YHORS, con un catálogo de tecnología, detalles, cosplay, mascotas, coleccionables y otros productos seleccionados.</p><a class="button" href="/">Visitar YHORS-STORE <span>→</span></a></div></main>`;
}

// SEO public files are served explicitly so crawler access is independent of the static/admin middleware.
app.get('/robots.txt', (_, res) => {
  res.status(200)
    .set('Content-Type', 'text/plain; charset=utf-8')
    .set('Cache-Control', 'public, max-age=0, must-revalidate')
    .send(`User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: ${ADMIN_PATH}\nDisallow: ${ADMIN_PATH}/\nSitemap: ${SITE_URL}/sitemap.xml\n`);
});

app.get('/sitemap.xml', (_, res) => {
  const products = readProducts().map(normalizeProduct);
  const urls = [
    { loc: `${SITE_URL}/` },
    { loc: `${SITE_URL}/yhors-corp` },
    { loc: `${SITE_URL}/categoria/principal` },
    ...VALID_PUBLIC_CATEGORIES.map(category => ({ loc: `${SITE_URL}/categoria/${category}` })),
    ...products.map(product => ({ loc: productUrl(product), lastmod: product.updatedAt || product.createdAt }))
  ];

  const body = urls.map(({ loc, lastmod }) => {
    let safeLastmod = '';
    if (lastmod) {
      const date = new Date(lastmod);
      if (!Number.isNaN(date.getTime())) {
        safeLastmod = `<lastmod>${date.toISOString()}</lastmod>`;
      }
    }
    return `  <url><loc>${esc(loc)}</loc>${safeLastmod}</url>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
  res.status(200)
    .set('Content-Type', 'application/xml; charset=utf-8')
    .set('Cache-Control', 'public, max-age=0, must-revalidate')
    .send(xml);
});

// SEO-friendly public routes are rendered server-side so search engines receive useful HTML on first response.
app.get('/producto/:slug', (req, res) => {
  const products = readProducts().map(normalizeProduct);
  const product = findProductBySlug(products, req.params.slug);
  if (!product) return res.status(404).send(layout({
    title: 'Producto no encontrado | YHORS-STORE',
    description: 'El producto solicitado no está disponible en YHORS-STORE.',
    canonical: `${SITE_URL}/producto/${encodeURIComponent(req.params.slug)}`,
    robots: 'noindex,follow',
    body: `<main class="section"><h1>Producto no encontrado</h1><p>Este producto ya no está disponible.</p><a class="button" href="/">Volver a YHORS-STORE</a></main>`
  }));
  const url = productUrl(product);
  const images = Array.isArray(product.images) && product.images.length ? product.images : (product.image ? [product.image] : []);
  const description = seoDescription(product.description, `${product.name} disponible en YHORS-STORE.`);
  const price = Number(product.salePrice ?? product.price);
  const productJson = {
    '@context': 'https://schema.org', '@type': 'Product', name: product.name,
    image: images.map(absoluteImage), description: stripText(product.description), sku: product.sku || undefined,
    brand: product.brand ? { '@type': 'Brand', name: product.brand } : undefined,
    category: CATEGORY_LABELS[product.category] || product.category,
    offers: Number.isFinite(price) ? { '@type': 'Offer', url, priceCurrency: 'USD', price: price.toFixed(2), seller: { '@type': 'Organization', name: CORPORATE_NAME, url: `${SITE_URL}/yhors-corp` } } : undefined
  };
  Object.keys(productJson).forEach(k => productJson[k] === undefined && delete productJson[k]);
  const breadcrumb = { '@context':'https://schema.org', '@type':'BreadcrumbList', itemListElement:[
    { '@type':'ListItem', position:1, name:'YHORS-STORE', item:`${SITE_URL}/` },
    { '@type':'ListItem', position:2, name:CATEGORY_LABELS[product.category] || product.category, item:`${SITE_URL}/categoria/${product.category}` },
    { '@type':'ListItem', position:3, name:product.name, item:url }
  ]};
  return res.send(layout({ title: `${product.name} | YHORS-STORE`, description, canonical:url, image:images[0] ? absoluteImage(images[0]) : '', json:[productJson,breadcrumb], body:productSeoBody(product) }));
});

app.get('/categoria/:category', (req, res, next) => {
  const key = String(req.params.category || '').toLowerCase();
  if (key === 'principal') return next();
  if (!VALID_PUBLIC_CATEGORIES.includes(key)) return next();
  const products = readProducts().map(normalizeProduct);
  const label = CATEGORY_LABELS[key];
  const canonical = `${SITE_URL}/categoria/${key}`;
  const description = CATEGORY_DESCRIPTIONS[key];
  const itemList = products.filter(p=>p.category===key).slice(0,100).map((p,i)=>({ '@type':'ListItem', position:i+1, name:p.name, url:productUrl(p) }));
  const breadcrumb = { '@context':'https://schema.org', '@type':'BreadcrumbList', itemListElement:[
    { '@type':'ListItem', position:1, name:'YHORS-STORE', item:`${SITE_URL}/` },
    { '@type':'ListItem', position:2, name:label, item:canonical }
  ]};
  const listJson = { '@context':'https://schema.org', '@type':'ItemList', name:`Productos ${label} | YHORS-STORE`, itemListElement:itemList };
  return res.send(layout({ title:`${label} | YHORS-STORE`, description, canonical, json:[breadcrumb,listJson], body:categorySeoBody(key,products) }));
});

app.get('/categoria/todo', (_, res) => res.redirect(301, '/categoria/principal'));

app.get('/categoria/principal', (_, res) => {
  const products = readProducts().map(normalizeProduct);
  const canonical = `${SITE_URL}/categoria/principal`;
  const itemList = products.slice(0,100).map((p,i)=>({ '@type':'ListItem', position:i+1, name:p.name, url:productUrl(p) }));
  return res.send(layout({ title:'Catálogo | YHORS-STORE', description:CATEGORY_DESCRIPTIONS.principal, canonical, json:[
    { '@context':'https://schema.org', '@type':'ItemList', name:'Catálogo YHORS-STORE', itemListElement:itemList },
    { '@context':'https://schema.org', '@type':'BreadcrumbList', itemListElement:[{ '@type':'ListItem', position:1, name:'YHORS-STORE', item:`${SITE_URL}/` },{ '@type':'ListItem', position:2, name:'Catálogo', item:canonical }] }
  ], body:categorySeoBody('principal',products) }));
});

app.get('/yhors-corp', (_, res) => {
  const canonical = `${SITE_URL}/yhors-corp`;
  return res.send(layout({ title:'YHORS-CORP | YHORS', description:'YHORS-CORP: espacio corporativo de YHORS y referencia de su ecosistema digital.', canonical, json:[
    { '@context':'https://schema.org', '@type':'Organization', name:CORPORATE_NAME, url:canonical, brand:{ '@type':'Brand', name:'YHORS' }, sameAs:[SITE_URL] },
    { '@context':'https://schema.org', '@type':'BreadcrumbList', itemListElement:[{ '@type':'ListItem', position:1, name:'YHORS-STORE', item:`${SITE_URL}/` },{ '@type':'ListItem', position:2, name:'YHORS-CORP', item:canonical }] }
  ], body:corpSeoBody() }));
});

app.get('/', (req, res, next) => {
  // Redirect legacy product query URLs to their permanent, descriptive URL.
  if (req.query.producto) {
    const product = readProducts().map(normalizeProduct).find(item => item.id === String(req.query.producto));
    if (product) return res.redirect(301, productUrl(product));
  }
  // Search result pages are useful to users but should not become an indexable URL for every query.
  if (req.query.buscar) {
    const query = stripText(req.query.buscar).slice(0, 80);
    const products = readProducts().map(normalizeProduct);
    return res.send(layout({ title: `Resultados para ${query} | YHORS-STORE`, description: `Resultados de búsqueda de ${query} en YHORS-STORE.`, canonical: `${SITE_URL}/`, robots: 'noindex,follow', json: [], body: `<main class="section"><div class="section-heading"><div><span class="eyebrow">Búsqueda YHORS</span><h1>Resultados para “${esc(query)}”</h1></div><p>Usa el buscador para explorar productos, marcas y categorías de YHORS-STORE.</p></div><p><a class="button" href="/">Volver al catálogo <span>→</span></a></p></main>` }));
  }
  const products = readProducts().map(normalizeProduct);
  const canonical = `${SITE_URL}/`;
  const organization = { '@context':'https://schema.org', '@type':'Organization', name:CORPORATE_NAME, url:`${SITE_URL}/yhors-corp`, brand:{ '@type':'Brand', name:'YHORS' }, subOrganization:{ '@type':'OnlineStore', name:SITE_NAME, url:canonical } };
  const website = { '@context':'https://schema.org', '@type':'WebSite', name:SITE_NAME, alternateName:['YHORS','YHORS-STORE'], url:canonical, potentialAction:{ '@type':'SearchAction', target:`${SITE_URL}/?buscar={search_term_string}`, 'query-input':'required name=search_term_string' } };
  return res.send(layout({ title:'YHORS-STORE | Tecnología, detalles, cosplay y más', description:'YHORS-STORE: tecnología, celulares, accesorios, cosplay, detalles, regalos, mascotas y coleccionables. Descubre productos seleccionados en Ecuador.', canonical, json:[organization,website], body:homeSeoBody(products) }));
});

app.use(ADMIN_PATH, (req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive'); next(); });

app.use('/uploads', express.static(UPLOADS_DIR, { maxAge: '7d', immutable: true }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

const storage = multer.diskStorage({
  destination: (_, __, done) => done(null, UPLOADS_DIR),
  filename: (_, file, done) => {
    const extension = path.extname(file.originalname).toLowerCase();
    done(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${extension}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_, file, done) => done(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype))
});

function readProducts() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function readStorefront() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STOREFRONT_FILE, 'utf8'));
    return {
      heroProductIds: Array.isArray(parsed.heroProductIds) ? parsed.heroProductIds.filter(Boolean).slice(0, 8) : [],
      featuredProductIds: Array.isArray(parsed.featuredProductIds) ? parsed.featuredProductIds.filter(Boolean).slice(0, 12) : []
    };
  } catch {
    return { heroProductIds: [], featuredProductIds: [] };
  }
}

function writeStorefront(settings) {
  const temporaryFile = `${STOREFRONT_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryFile, STOREFRONT_FILE);
}

function readClassifications() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CLASSIFICATIONS_FILE, 'utf8'));
    return { brands: parsed.brands || {}, productTypes: parsed.productTypes || {} };
  } catch { return { brands: {}, productTypes: {} }; }
}
function writeClassifications(settings) {
  const clean = { brands: {}, productTypes: {} };
  for (const key of ['brands','productTypes']) {
    for (const [category, values] of Object.entries(settings?.[key] || {})) {
      if (!['elegant','sports','tech','cosplay','pets','details','collectibles'].includes(category)) continue;
      clean[key][category] = [...new Set((Array.isArray(values) ? values : []).map(v => cleanText(v, 50)).filter(Boolean))].slice(0, 100);
    }
  }
  const temporaryFile = `${CLASSIFICATIONS_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(clean, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryFile, CLASSIFICATIONS_FILE);
  return clean;
}

function writeProducts(products) {
  const temporaryFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(temporaryFile, `${JSON.stringify(products, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryFile, DATA_FILE);
}

function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}

function makeSession() {
  const payload = Buffer.from(JSON.stringify({ user: ADMIN_USER, expires: Date.now() + 1000 * 60 * 60 * 12 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function hasValidSession(req) {
  const token = req.cookies.yhors_session;
  if (!token || !token.includes('.')) return false;
  const [payload, signature] = token.split('.');
  if (signature.length !== sign(payload).length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(sign(payload)))) return false;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return session.user === ADMIN_USER && Number(session.expires) > Date.now();
  } catch {
    return false;
  }
}

function requireAdmin(req, res, next) {
  if (!hasValidSession(req)) return res.status(401).json({ error: 'No autorizado.' });
  return next();
}

function cleanText(value, maxLength) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function normalizeSku(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9._-]/g, '').slice(0, 40);
}

function skuBaseForProduct(product = {}) {
  const categoryCodes = { elegant: 'ELE', sports: 'SPT', tech: 'TEC', cosplay: 'COS', pets: 'PET', details: 'DET', collectibles: 'COL' };
  const category = categoryCodes[String(product.category || '').toLowerCase()] || 'YHR';
  const source = String(product.name || 'PROD').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 12) || 'PROD';
  return `YH-${category}-${source}`;
}

function makeUniqueSku(inputSku, product, products, currentId = '') {
  const requested = normalizeSku(inputSku);
  const base = requested || skuBaseForProduct(product);
  const used = new Set(products.filter(item => item.id !== currentId).map(item => normalizeSku(item.sku)).filter(Boolean));
  if (!used.has(base)) return base;
  for (let i = 2; i < 10000; i += 1) {
    const candidate = `${base.slice(0, 36)}-${i}`;
    if (!used.has(candidate)) return candidate;
  }
  return `YH-${Date.now()}`;
}

function validateProduct(input, current = {}, allProducts = []) {
  const name = cleanText(input.name, 90);
  const description = cleanText(input.description, 2000);
  const category = cleanText(input.category, 30).toLowerCase();
  const brand = cleanText(input.brand, 50);
  const productType = cleanText(input.productType, 50);
  const requestedSku = normalizeSku(input.sku);
  const salePrice = Number(input.salePrice ?? input.price);
  const rentalRaw = input.rentalPrice;
  const rentalPrice = rentalRaw === '' || rentalRaw === null || rentalRaw === undefined ? null : Number(rentalRaw);
  const image = cleanText(input.image, 1000);
  const validCategories = ['elegant', 'sports', 'tech', 'cosplay', 'pets', 'details', 'collectibles'];
  const sku = makeUniqueSku(requestedSku, { name, category }, allProducts, current.id || '');
  if (!name || !description || !validCategories.includes(category) || !Number.isFinite(salePrice) || salePrice < 0 || salePrice > 100000000) {
    return { error: 'Revisa nombre, descripción, categoría y precio de venta.' };
  }
  if (category === 'cosplay' && (rentalPrice === null || !Number.isFinite(rentalPrice) || rentalPrice < 0 || rentalPrice > 100000000)) {
    return { error: 'En Cosplay debes indicar un precio de alquiler válido.' };
  }
  const rawImages = Array.isArray(input.images) ? input.images : [image];
  const images = rawImages.map(value => cleanText(value, 1000)).filter(Boolean).slice(0, 4);
  if (image && !(/^\/uploads\/[a-zA-Z0-9._-]+$/.test(image) || /^https:\/\/[a-zA-Z0-9./?&=_:%#-]+$/.test(image))) return { error: 'La URL de la imagen principal no es válida.' };
  for (const imageUrl of images) {
    if (!(/^\/uploads\/[a-zA-Z0-9._-]+$/.test(imageUrl) || /^https:\/\/[a-zA-Z0-9./?&=_:%#-]+$/.test(imageUrl))) return { error: 'Una de las URL de las imágenes no es válida.' };
  }
  const finalImages = images.length ? images : (current.images?.length ? current.images : (current.image ? [current.image] : []));
  return { product: {
    ...current, name, description, category, brand, productType, sku,
    salePrice: Math.round(salePrice * 100) / 100,
    rentalPrice: category === 'cosplay' ? Math.round(rentalPrice * 100) / 100 : null,
    price: Math.round(salePrice * 100) / 100,
    image: finalImages[0] || '', images: finalImages,
    featured: input.featured === true || input.featured === 'true',
    hero: input.hero === true || input.hero === 'true',
    heroOrder: Number.isFinite(Number(input.heroOrder)) ? Math.max(0, Math.min(999, Number(input.heroOrder))) : (Number(current.heroOrder) || 0)
  }};
}
function deleteUploadedImage(image) {
  if (!image || !image.startsWith('/uploads/')) return;
  const fileName = path.basename(image);
  const target = path.join(UPLOADS_DIR, fileName);
  if (target.startsWith(UPLOADS_DIR + path.sep) && fs.existsSync(target)) fs.unlinkSync(target);
}

function normalizeProduct(product) {
  const images = Array.isArray(product.images) && product.images.length
    ? product.images.filter(Boolean)
    : (product.image ? [product.image] : []);
  return { ...product, sku: normalizeSku(product.sku) || makeUniqueSku('', product, [], product.id), image: product.image || images[0] || '', images };
}

app.get('/api/products', (_, res) => res.json(readProducts().map(normalizeProduct)));
app.get('/api/classifications', (_, res) => res.json(readClassifications()));
app.get('/api/storefront', (_, res) => {
  const settings = readStorefront();
  return res.json({ ...settings, whatsappNumber: String(process.env.WHATSAPP_NUMBER || '').replace(/\D/g, '') });
});
app.get('/api/health', (_, res) => res.json({ ok: true }));

app.post('/api/login', async (req, res) => {
  const username = cleanText(req.body?.username, 80);
  const password = String(req.body?.password || '');
  const expectedUser = String(ADMIN_USER);
  const nameMatches = username.length === expectedUser.length &&
    crypto.timingSafeEqual(Buffer.from(username), Buffer.from(expectedUser));
  const passwordMatches = await bcrypt.compare(password, await bcrypt.hash(ADMIN_PASSWORD, 10));
  if (!nameMatches || !passwordMatches) return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  res.cookie('yhors_session', makeSession(), { httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, maxAge: 1000 * 60 * 60 * 12, path: '/' });
  return res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie('yhors_session', { httpOnly: true, sameSite: 'strict', secure: COOKIE_SECURE, path: '/' });
  res.json({ ok: true });
});

app.get('/api/admin/session', (req, res) => res.json({ authenticated: hasValidSession(req), username: hasValidSession(req) ? ADMIN_USER : null }));
app.get('/api/admin/products', requireAdmin, (_, res) => res.json(readProducts().map(normalizeProduct)));
app.get('/api/admin/storefront', requireAdmin, (_, res) => res.json(readStorefront()));
app.get('/api/admin/classifications', requireAdmin, (_, res) => res.json(readClassifications()));
app.put('/api/admin/classifications', requireAdmin, (req, res) => res.json(writeClassifications(req.body || {})));

app.put('/api/admin/storefront', requireAdmin, (req, res) => {
  const products = readProducts();
  const ids = new Set(products.map(product => product.id));
  const heroProductIds = Array.isArray(req.body?.heroProductIds) ? req.body.heroProductIds.filter(id => ids.has(id)).slice(0, 8) : [];
  const featuredProductIds = Array.isArray(req.body?.featuredProductIds) ? req.body.featuredProductIds.filter(id => ids.has(id)).slice(0, 12) : [];
  const heroOrders = (req.body && req.body.heroOrders && typeof req.body.heroOrders === 'object') ? req.body.heroOrders : {};
  const settings = { heroProductIds, featuredProductIds };
  writeStorefront(settings);
  const heroSet = new Set(heroProductIds);
  const featuredSet = new Set(featuredProductIds);
  const updated = products.map(product => ({
    ...product,
    hero: heroSet.has(product.id),
    featured: featuredSet.has(product.id),
    heroOrder: heroSet.has(product.id)
      ? Math.max(1, Math.min(999, Number(heroOrders[product.id]) || (heroProductIds.indexOf(product.id) + 1)))
      : 0,
    updatedAt: new Date().toISOString()
  }));
  writeProducts(updated);
  return res.json(settings);
});

app.post('/api/admin/upload', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Selecciona una imagen JPG, PNG, WEBP o GIF de máximo 5 MB.' });
  return res.status(201).json({ image: `/uploads/${req.file.filename}` });
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  const products = readProducts();
  const result = validateProduct(req.body, {}, products);
  if (result.error) return res.status(400).json(result);
  const product = normalizeProduct({ ...result.product, id: crypto.randomUUID(), createdAt: new Date().toISOString() });
  products.unshift(product);
  writeProducts(products);
  return res.status(201).json(product);
});

app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  const products = readProducts();
  const index = products.findIndex((product) => product.id === req.params.id);
  if (index < 0) return res.status(404).json({ error: 'Producto no encontrado.' });
  const previous = products[index];
  const result = validateProduct(req.body, previous, products);
  if (result.error) return res.status(400).json(result);
  products[index] = normalizeProduct({ ...result.product, id: previous.id, createdAt: previous.createdAt, updatedAt: new Date().toISOString() });
  const previousImages = Array.isArray(previous.images) ? previous.images : (previous.image ? [previous.image] : []);
  const currentImages = new Set(products[index].images || []);
  previousImages.forEach(imageUrl => { if (!currentImages.has(imageUrl)) deleteUploadedImage(imageUrl); });
  writeProducts(products);
  return res.json(products[index]);
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  const products = readProducts();
  const product = products.find((item) => item.id === req.params.id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado.' });
  writeProducts(products.filter((item) => item.id !== req.params.id));
  (product.images || [product.image]).forEach(deleteUploadedImage);
  return res.status(204).end();
});

app.use((_, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((error, _, res, __) => {
  if (error instanceof multer.MulterError) return res.status(400).json({ error: 'La imagen supera el límite de 5 MB.' });
  if (error) return res.status(400).json({ error: 'No se pudo procesar la solicitud.' });
});

app.listen(PORT, () => console.log(`YHORS disponible en http://localhost:${PORT}`));
