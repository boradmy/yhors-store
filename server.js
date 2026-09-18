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

function validateProduct(input, current = {}) {
  const name = cleanText(input.name, 90);
  const description = cleanText(input.description, 2000);
  const category = cleanText(input.category, 30).toLowerCase();
  const price = Number(input.price);
  const image = cleanText(input.image, 1000);
  const validCategories = ['elegant', 'sports', 'tech', 'cosplay', 'pets', 'details', 'collectibles'];
  if (!name || !description || !validCategories.includes(category) || !Number.isFinite(price) || price < 0 || price > 100000000) {
    return { error: 'Revisa nombre, descripción, categoría y precio.' };
  }
  const rawImages = Array.isArray(input.images) ? input.images : [image];
  const images = rawImages
    .map(value => cleanText(value, 1000))
    .filter(Boolean)
    .slice(0, 4);
  if (image && !(/^\/uploads\/[a-zA-Z0-9._-]+$/.test(image) || /^https:\/\/[a-zA-Z0-9./?&=_:%#-]+$/.test(image))) {
    return { error: 'La URL de la imagen principal no es válida.' };
  }
  for (const imageUrl of images) {
    if (!(/^\/uploads\/[a-zA-Z0-9._-]+$/.test(imageUrl) || /^https:\/\/[a-zA-Z0-9./?&=_:%#-]+$/.test(imageUrl))) {
      return { error: 'Una de las URL de las imágenes no es válida.' };
    }
  }
  const finalImages = images.length ? images : (current.images?.length ? current.images : (current.image ? [current.image] : []));
  return {
    product: {
      ...current,
      name,
      description,
      category,
      price: Math.round(price * 100) / 100,
      image: finalImages[0] || '',
      images: finalImages,
      featured: input.featured === true || input.featured === 'true',
      hero: input.hero === true || input.hero === 'true',
      heroOrder: Number.isFinite(Number(input.heroOrder)) ? Math.max(0, Math.min(999, Number(input.heroOrder))) : (Number(current.heroOrder) || 0)
    }
  };
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
  return { ...product, image: product.image || images[0] || '', images };
}

app.get('/api/products', (_, res) => res.json(readProducts().map(normalizeProduct)));
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

app.put('/api/admin/storefront', requireAdmin, (req, res) => {
  const products = readProducts();
  const ids = new Set(products.map(product => product.id));
  const heroProductIds = Array.isArray(req.body?.heroProductIds) ? req.body.heroProductIds.filter(id => ids.has(id)).slice(0, 8) : [];
  const featuredProductIds = Array.isArray(req.body?.featuredProductIds) ? req.body.featuredProductIds.filter(id => ids.has(id)).slice(0, 12) : [];
  const settings = { heroProductIds, featuredProductIds };
  writeStorefront(settings);
  const heroSet = new Set(heroProductIds);
  const featuredSet = new Set(featuredProductIds);
  const updated = products.map(product => ({ ...product, hero: heroSet.has(product.id), featured: featuredSet.has(product.id), updatedAt: new Date().toISOString() }));
  writeProducts(updated);
  return res.json(settings);
});

app.post('/api/admin/upload', requireAdmin, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Selecciona una imagen JPG, PNG, WEBP o GIF de máximo 5 MB.' });
  return res.status(201).json({ image: `/uploads/${req.file.filename}` });
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  const result = validateProduct(req.body);
  if (result.error) return res.status(400).json(result);
  const products = readProducts();
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
  const result = validateProduct(req.body, previous);
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
