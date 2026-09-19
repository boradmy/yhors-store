const app = document.querySelector('#app');
const ADMIN_PATH = '/yhors/admin593';
const categories = {
  all: 'Principal', elegant: 'Elegant', sports: 'Sports', tech: 'Tech', cosplay: 'Cosplay',
  pets: 'Pets', details: 'Details', collectibles: 'Coleccionables'
};
const categoryDescriptions = {
  all: 'Descubre todo el universo YHORS en un solo lugar.',
  elegant: 'Detalles refinados, regalos y piezas pensadas para momentos especiales.',
  sports: 'Accesorios y productos para quienes viven con energía y movimiento.',
  tech: 'Tecnología, gadgets y soluciones que combinan utilidad con estilo.',
  cosplay: 'Piezas para transformar tu personaje y llevar tu imaginación más lejos.',
  pets: 'Detalles y productos para consentir a quienes siempre están contigo.',
  details: 'Regalos, arreglos y detalles creados para sorprender.',
  collectibles: 'Figuras y objetos para quienes disfrutan coleccionar lo extraordinario.'
};
const publicCategories = Object.entries(categories);
const placeholder = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="800" height="800"%3E%3Crect width="100%25" height="100%25" fill="%23e8e5de"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" fill="%23706d66" font-family="Arial" font-size="32"%3EYHORS%3C/text%3E%3C/svg%3E';

function escapeHTML(value = '') { return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])); }
function money(value) { return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value || 0)); }
function wireImageFallback(scope) { scope?.querySelectorAll('img[data-fallback]').forEach(image => image.addEventListener('error', () => { image.src = placeholder; }, { once: true })); }
function productImages(product) { const list = Array.isArray(product.images) ? product.images.filter(Boolean) : []; return list.length ? list : (product.image ? [product.image] : [placeholder]); }
function getProduct(id, products) { return products.find(item => item.id === id); }
async function request(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.headers || {}) } });
  const json = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || 'No se pudo completar la operación.');
  return json;
}
function getCart() { try { return JSON.parse(localStorage.getItem('yhors-cart')) || []; } catch { return []; } }
function setCart(cart) { localStorage.setItem('yhors-cart', JSON.stringify(cart)); }

function currentCategoryFromPath() {
  const match = location.pathname.match(/^\/categoria\/([^/]+)\/?$/);
  if (match && (categories[match[1]] || match[1] === 'principal')) return match[1] === 'principal' ? 'all' : match[1];
  return '';
}
function categoryHref(key) { return key === 'all' ? '/categoria/principal' : `/categoria/${encodeURIComponent(key)}`; }
function categoryLinks(currentId = '') {
  return publicCategories.map(([key, label]) => `<a class="header-category ${currentId === key ? 'current' : ''}" href="${categoryHref(key)}" data-category-link="${key}">${escapeHTML(label)}</a>`).join('');
}
function renderHeader(currentCategory = '') {
  return `<header class="site-header">
    <div class="topbar"><div class="header-main">
      <button class="mobile-menu-toggle" id="mobileMenuToggle" type="button" aria-label="Abrir menú" aria-controls="siteNav" aria-expanded="false"><span></span><span></span><span></span></button>
      <a class="brand" href="/" aria-label="YHORS inicio"><span>YHORS</span><small>STORE</small></a>
      <form class="search-form" id="siteSearch" role="search">
        <input id="siteSearchInput" type="search" name="buscar" placeholder="Buscar productos, marcas o categorías" autocomplete="off">
        <button type="submit" aria-label="Buscar">⌕</button>
      </form>
      <button class="cart-button" id="cartButton" aria-label="Abrir carrito"><span class="cart-icon" aria-hidden="true">🛒</span><span class="cart-label">Carrito</span><span class="count" id="cartCount">0</span></button>
    </div></div>
    <div class="nav-wrap"><nav class="nav" id="siteNav" aria-label="Categorías">${categoryLinks(currentCategory)}</nav></div>
  </header>`;
}
function wireSearch() {
  const form = document.querySelector('#siteSearch');
  if (!form) return;
  const input = form.querySelector('input');
  const query = new URLSearchParams(location.search).get('buscar') || '';
  input.value = query;
  form.addEventListener('submit', event => {
    event.preventDefault();
    const value = input.value.trim();
    history.pushState({}, '', value ? `/?buscar=${encodeURIComponent(value)}` : '/');
    renderStore();
  });
}

function wireMobileMenu() {
  const toggle = document.querySelector('#mobileMenuToggle');
  const nav = document.querySelector('#siteNav');
  if (!toggle || !nav) return;
  const close = () => {
    nav.classList.remove('mobile-open');
    toggle.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('aria-label', 'Abrir menú');
  };
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('mobile-open');
    toggle.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  });
  nav.querySelectorAll('a').forEach(link => link.addEventListener('click', close));
  if (document.__yhorsMobileEscapeHandler) document.removeEventListener('keydown', document.__yhorsMobileEscapeHandler);
  document.__yhorsMobileEscapeHandler = event => { if (event.key === 'Escape') close(); };
  document.addEventListener('keydown', document.__yhorsMobileEscapeHandler);
}
function renderFooter() {
  return `<footer class="site-footer"><div class="footer-inner footer-grid">
    <div><a class="brand" href="/">YHORS</a><p>©2021 YHORS. Todos los derechos reservados.</p></div>
    <div class="footer-links"><strong>Explora YHORS</strong><div>${categoryLinks()}</div></div>
    <div><strong>Atención personal</strong><p>Pedidos y consultas directamente con YHORS.</p></div>
  </div></footer>`;
}
function cartMarkup() {
  return `<div class="modal-backdrop" id="backdrop"></div><aside class="drawer" id="drawer" aria-label="Carrito de compra">
    <div class="drawer-head"><div><span class="eyebrow">Tu selección</span><h2>Carrito</h2></div><button class="icon-close" id="closeCart" aria-label="Cerrar">×</button></div>
    <div class="cart-items" id="cartItems"></div><div class="cart-total"><span>Total</span><span id="cartTotal">$0</span></div>
    <button class="button checkout-button" id="checkout">Finalizar pedido <span>→</span></button><p class="message" id="checkoutMessage"></p>
  </aside>`;
}

function heroMarkup(slides, isCategory = false, categoryKey = 'all') {
  const safeSlides = slides.length ? slides : [{ image: placeholder, name: categories[categoryKey] || 'YHORS', category: categoryKey, description: categoryDescriptions[categoryKey] }];
  return `<section class="hero-slider ${isCategory ? 'category-hero' : ''}" id="heroSlider" aria-label="${escapeHTML(categories[categoryKey] || 'Colección YHORS')}">
    <div class="hero-track">${safeSlides.map((slide, index) => `<article class="hero-slide ${index === 0 ? 'active' : ''}" data-slide="${index}">
      <div class="hero-backdrop" aria-hidden="true" style="background-image:url('${escapeHTML(slide.image)}')"></div><img class="hero-bg" data-fallback src="${escapeHTML(slide.image)}" alt="${escapeHTML(slide.name || 'YHORS')}"><div class="hero-overlay"></div>
      <div class="hero-content"><span class="eyebrow">YHORS · ${escapeHTML(categories[slide.category] || categories[categoryKey] || 'COLECCIÓN')}</span>
      <h1>${escapeHTML(slide.heroTitle || (isCategory ? categories[categoryKey] : slide.name) || 'PIEZAS QUE CUENTAN TU HISTORIA').replace(/\n/g, '<br>')}</h1>
      <p>${escapeHTML(slide.heroDescription || slide.description || categoryDescriptions[categoryKey] || 'Descubre una selección pensada para hacer especial cada ocasión.')}</p>
      <a class="button hero-button" href="${isCategory ? '#productos-categoria' : '#destacados'}">${isCategory ? 'Explorar colección' : 'Descubrir YHORS'} <span>→</span></a></div>
    </article>`).join('')}</div>
    ${safeSlides.length > 1 ? `<button class="hero-arrow hero-prev" type="button" aria-label="Anterior">‹</button><button class="hero-arrow hero-next" type="button" aria-label="Siguiente">›</button><div class="hero-dots">${safeSlides.map((_, i) => `<button type="button" class="hero-dot ${i === 0 ? 'active' : ''}" data-hero-index="${i}" aria-label="Ir a la imagen ${i + 1}"></button>`).join('')}</div>` : ''}
  </section>`;
}
function wireHero(slides) {
  const slider = document.querySelector('#heroSlider'); if (!slider) return; wireImageFallback(slider); if (slides.length <= 1) return;
  let current = 0; const slideEls = [...slider.querySelectorAll('.hero-slide')]; const dots = [...slider.querySelectorAll('.hero-dot')];
  const go = index => { current = (index + slideEls.length) % slideEls.length; slideEls.forEach((el, i) => el.classList.toggle('active', i === current)); dots.forEach((el, i) => el.classList.toggle('active', i === current)); };
  slider.querySelector('.hero-prev')?.addEventListener('click', () => go(current - 1)); slider.querySelector('.hero-next')?.addEventListener('click', () => go(current + 1));
  dots.forEach(dot => dot.addEventListener('click', () => go(Number(dot.dataset.heroIndex))));
  let timer = setInterval(() => go(current + 1), 5500); slider.addEventListener('mouseenter', () => clearInterval(timer)); slider.addEventListener('mouseleave', () => { timer = setInterval(() => go(current + 1), 5500); });
}

function categoryBlocks() {
  return `<section class="category-blocks section" id="categorias"><div class="section-heading"><div><span class="eyebrow">Explora por universo</span><h2>Encuentra tu estilo</h2></div><p>Cada categoría tiene su propio espacio.</p></div><div class="category-grid">${publicCategories.map(([key, label], index) => `<a class="category-card category-${key}" href="${categoryHref(key)}"><span class="category-number">0${index + 1}</span><div><span class="category-kicker">YHORS</span><h3>${escapeHTML(label)}</h3><p>${escapeHTML(categoryDescriptions[key])}</p></div><span class="category-arrow">↗</span></a>`).join('')}</div></section>`;
}
function productCard(product) {
  const image = productImages(product)[0];
  const meta = productMeta(product);
  const isCosplayRental = product.category === 'cosplay' && product.rentalPrice !== null && product.rentalPrice !== undefined && product.rentalPrice !== '';
  const rental = isCosplayRental ? `<small class="price-secondary">Alquiler: ${money(product.rentalPrice)}</small>` : '';
  const action = isCosplayRental ? `<button class="add cosplay-options" data-open-option="${escapeHTML(product.id)}"><span>Ver opciones</span><span>→</span></button>` : `<button class="add" data-id="${escapeHTML(product.id)}"><span>Añadir</span><span>+</span></button>`;
  return `<article class="product" data-product="${escapeHTML(product.id)}"><button class="product-open" data-open="${escapeHTML(product.id)}" aria-label="Ver ${escapeHTML(product.name)}"><div class="product-image"><img data-fallback src="${escapeHTML(image)}" alt="${escapeHTML(product.name)}" loading="lazy"></div><div class="product-info"><span class="product-category">${escapeHTML(categories[product.category] || product.category)}</span>${meta ? `<small class="product-meta">${escapeHTML(meta)}</small>` : ''}<h3>${escapeHTML(product.name)}</h3><p>${escapeHTML(product.description).replace(/\n/g, '<br>')}</p><span class="detail-link">Ver detalles <span>→</span></span></div></button><div class="product-bottom"><div><span class="price">${productPriceLabel(product)}</span>${rental}</div>${action}</div></article>`;
}

function renderProductsInto(area, products, onOpen, onAdd) {
  area.innerHTML = products.length ? products.map(productCard).join('') : '<div class="empty">Aún no hay productos en esta colección.</div>';
  wireImageFallback(area);
  area.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', e => { e.preventDefault(); onOpen(button.dataset.open); }));
  area.querySelectorAll('.add').forEach(button => button.addEventListener('click', e => { e.stopPropagation();
    const productId = button.dataset.openOption;
    if (productId) { onOpen(productId); return; }
    const product = products.find(item => item.id === button.dataset.id); if (product) onAdd(product, button);
  }));
}

function wireCart(products, storefront) {
  let cart = getCart();
  const count = document.querySelector('#cartCount'); const area = document.querySelector('#cartItems');
  const updateCartCount = () => { if (count) count.textContent = cart.reduce((sum, line) => sum + Number(line.quantity || 0), 0); };
  const drawCart = () => {
    if (!area) return;
    area.innerHTML = cart.length ? cart.map(line => `<div class="cart-item"><img data-fallback src="${escapeHTML(productImages(line)[0])}" alt=""><div class="cart-item-main"><h4>${escapeHTML(line.name)}</h4>${line.purchaseMode ? `<span class="cart-mode">${line.purchaseMode === 'rental' ? 'Alquiler' : 'Compra'}</span>` : ''}<p class="cart-line-price">${money(line.price)}</p><div class="quantity-control"><button type="button" data-qty="${escapeHTML(line.id)}" data-change="-1">−</button><input type="number" min="1" value="${Number(line.quantity) || 1}" data-input="${escapeHTML(line.id)}"><button type="button" data-qty="${escapeHTML(line.id)}" data-change="1">+</button></div></div><button class="remove" data-remove="${escapeHTML(line.id)}">Quitar</button></div>`).join('') : '<div class="empty cart-empty">Tu carrito está vacío.<br><small>Agrega algo que te guste.</small></div>';
    const total = cart.reduce((sum, line) => sum + Number(line.price) * Number(line.quantity), 0); document.querySelector('#cartTotal').textContent = money(total); wireImageFallback(area);
    area.querySelectorAll('[data-qty]').forEach(btn => btn.addEventListener('click', () => { const line = cart.find(item => item.id === btn.dataset.qty); if (!line) return; line.quantity = Math.max(1, Number(line.quantity) + Number(btn.dataset.change)); setCart(cart); updateCartCount(); drawCart(); }));
    area.querySelectorAll('[data-input]').forEach(input => input.addEventListener('change', () => { const line = cart.find(item => item.id === input.dataset.input); if (!line) return; line.quantity = Math.max(1, parseInt(input.value || '1', 10)); setCart(cart); updateCartCount(); drawCart(); }));
    area.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => { cart = cart.filter(line => line.id !== btn.dataset.remove); setCart(cart); updateCartCount(); drawCart(); }));
  };
  const addToCart = (product, button, purchaseMode = 'purchase') => {
    const price = purchaseMode === 'rental' ? Number(product.rentalPrice) : (product.category === 'cosplay' && Number.isFinite(Number(product.salePrice)) ? Number(product.salePrice) : Number(product.price));
    const cartKey = `${product.id}::${purchaseMode}`;
    const existing = cart.find(item => (item.cartKey || item.id) === cartKey);
    if (existing) existing.quantity += 1;
    else cart.push({ ...product, id: cartKey, productId: product.id, price, purchaseMode, quantity: 1 });
    setCart(cart); updateCartCount(); drawCart();
    button.disabled = true; const original = button.innerHTML; button.innerHTML = '<span class="spinner"></span><span>Añadiendo</span>'; setTimeout(() => { button.innerHTML = '<span class="check">✓</span><span>Añadido</span>'; button.classList.add('added'); setTimeout(() => { button.innerHTML = original; button.classList.remove('added'); button.disabled = false; }, 850); }, 420);
  };
  const openCart = () => { document.querySelector('#drawer')?.classList.add('open'); document.querySelector('#backdrop')?.classList.add('show'); document.body.classList.add('no-scroll'); };
  const closeCart = () => { document.querySelector('#drawer')?.classList.remove('open'); document.querySelector('#backdrop')?.classList.remove('show'); document.body.classList.remove('no-scroll'); };
  document.querySelector('#cartButton')?.addEventListener('click', openCart); document.querySelector('#closeCart')?.addEventListener('click', closeCart); document.querySelector('#backdrop')?.addEventListener('click', closeCart);
  document.querySelector('#checkout')?.addEventListener('click', () => { const message = document.querySelector('#checkoutMessage'); if (!cart.length) { message.textContent = 'Agrega al menos un producto para continuar.'; return; } const details = cart.map(line => `• ${line.quantity} × ${line.name}${line.purchaseMode ? ` — ${line.purchaseMode === 'rental' ? 'Alquiler' : 'Compra'}` : ''} — ${money(line.price * line.quantity)}`).join('\n'); const total = cart.reduce((sum, line) => sum + line.price * line.quantity, 0); const text = `Hola, quiero hacer este pedido de YHORS:\n${details}\n\nTotal: ${money(total)}`; if (storefront.whatsappNumber) window.open(`https://wa.me/${storefront.whatsappNumber}?text=${encodeURIComponent(text)}`, '_blank', 'noopener'); else { navigator.clipboard?.writeText(text); message.textContent = 'El resumen del pedido se copió. Configura WHATSAPP_NUMBER en .env para recibir pedidos por WhatsApp.'; } });
  updateCartCount(); drawCart(); return { addToCart, openCart, closeCart };
}

async function loadStoreData() {
  const [products, storefront, classifications] = await Promise.all([request('/api/products'), request('/api/storefront'), request('/api/classifications')]);
  return { products, storefront, classifications };
}
function productPriceLabel(product) {
  return product.category === 'cosplay' && Number.isFinite(Number(product.salePrice)) ? money(product.salePrice) : money(product.price);
}
function productMeta(product) {
  const parts = [];
  if (product.brand) parts.push(product.brand);
  if (product.productType) parts.push(product.productType);
  return parts.join(' · ');
}
function normalizeSearch(value = '') {
  return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}
function productMatchesQuery(product, query) {
  const terms = normalizeSearch(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = normalizeSearch([
    product.name, product.brand, product.productType, categories[product.category], product.category,
    product.description, product.heroTitle, product.heroDescription
  ].filter(Boolean).join(' '));
  return terms.every(term => haystack.includes(term));
}
function allClassificationValues(classifications = {}, key, category = null) {
  const source = category && category !== 'all'
    ? (classifications[key]?.[category] || [])
    : Object.values(classifications[key] || {}).flat();
  return [...new Set(source.filter(Boolean))].sort((a,b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}
function catalogFilters(classifications = {}, currentCategory = 'all', active = {}) {
  const scoped = currentCategory && currentCategory !== 'all';
  const brands = allClassificationValues(classifications, 'brands', currentCategory);
  const types = allClassificationValues(classifications, 'productTypes', currentCategory);
  const categoriesHtml = publicCategories
    .map(([key, label]) => `<label class="filter-check"><input type="checkbox" data-filter-category value="${escapeHTML(key)}" ${active.category === key ? 'checked' : ''}><span>${escapeHTML(label)}</span></label>`)
    .join('');
  const brandsHtml = brands.map(value => `<label class="filter-check"><input type="checkbox" data-filter-brand value="${escapeHTML(value)}" ${active.brand === value ? 'checked' : ''}><span>${escapeHTML(value)}</span></label>`).join('');
  const typesHtml = types.map(value => `<label class="filter-check"><input type="checkbox" data-filter-type value="${escapeHTML(value)}" ${active.type === value ? 'checked' : ''}><span>${escapeHTML(value)}</span></label>`).join('');
  const categoriesBlock = scoped ? '' : `
    <div class="filter-accordion">
      <button type="button" class="filter-title" aria-expanded="false"><span>Categorías</span><span>⌄</span></button>
      <div class="filter-options">${categoriesHtml}</div>
    </div>`;
  const brandsBlock = brands.length ? `
    <div class="filter-accordion">
      <button type="button" class="filter-title" aria-expanded="false"><span>Marcas</span><span>⌄</span></button>
      <div class="filter-options">${brandsHtml}</div>
    </div>` : '';
  const typesBlock = types.length ? `
    <div class="filter-accordion">
      <button type="button" class="filter-title" aria-expanded="false"><span>Tipo de producto</span><span>⌄</span></button>
      <div class="filter-options">${typesHtml}</div>
    </div>` : '';
  const contextLabel = scoped ? `Filtros de ${escapeHTML(categories[currentCategory] || currentCategory)}` : 'Filtros del catálogo';
  return `<aside class="catalog-sidebar" aria-label="${contextLabel}">
    <button type="button" class="mobile-filter-toggle" aria-expanded="false"><span>Filtros</span><span class="mobile-filter-count">Abrir opciones</span><span class="mobile-filter-chevron">⌄</span></button>
    <div class="sidebar-head">
      <div><span class="eyebrow">Filtrar</span><h2>${scoped ? escapeHTML(categories[currentCategory]) : 'Encuentra lo tuyo'}</h2></div>
      <button type="button" class="clear-filters" id="clearCatalogFilters">Restablecer</button>
    </div>
    ${categoriesBlock}${brandsBlock}${typesBlock}
  </aside>`;
}
function applyCatalogFilters(products, active = {}) {
  return products.filter(product =>
    (!active.category || active.category === 'all' || product.category === active.category) &&
    (!active.brand || product.brand === active.brand) &&
    (!active.type || product.productType === active.type) &&
    (!active.minPrice || Number(productPriceLabel(product).replace(/[^0-9.,-]/g, '').replace(',', '.')) >= Number(active.minPrice)) &&
    (!active.maxPrice || Number(productPriceLabel(product).replace(/[^0-9.,-]/g, '').replace(',', '.')) <= Number(active.maxPrice))
  );
}
function wireCatalogFilters(products, classifications, initial = {}, renderResults) {
  const sidebar = document.querySelector('.catalog-sidebar');
  if (!sidebar) return;
  const active = { ...initial };
  const categoryControl = sidebar.querySelector('[data-filter-category]');
  const contextualCategory = initial.category || '';
  const draw = () => {
    // En páginas de una categoría, la categoría queda fija aunque se limpien los filtros.
    active.category = categoryControl
      ? (sidebar.querySelector('[data-filter-category]:checked')?.value || '')
      : contextualCategory;
    active.brand = sidebar.querySelector('[data-filter-brand]:checked')?.value || '';
    active.type = sidebar.querySelector('[data-filter-type]:checked')?.value || '';
    const selectedCount = [categoryControl ? active.category : '', active.brand, active.type].filter(Boolean).filter(value => value !== contextualCategory).length;
    const mobileLabel = sidebar.querySelector('.mobile-filter-count');
    if (mobileLabel && !sidebar.classList.contains('mobile-open')) mobileLabel.textContent = selectedCount ? `${selectedCount} filtro${selectedCount === 1 ? '' : 's'} activo${selectedCount === 1 ? '' : 's'}` : 'Abrir opciones';
    renderResults(applyCatalogFilters(products, active), active);
  };
  sidebar.querySelectorAll('[data-filter-category],[data-filter-brand],[data-filter-type]').forEach(input => input.addEventListener('change', () => {
    const group = input.dataset.filterCategory !== undefined ? 'category' : input.dataset.filterBrand !== undefined ? 'brand' : 'type';
    sidebar.querySelectorAll(`input[data-filter-${group}]`).forEach(item => { if (item !== input) item.checked = false; });
    draw();
  }));
  sidebar.querySelectorAll('.filter-title').forEach(button => button.addEventListener('click', () => {
    const box = button.parentElement;
    const open = box.classList.toggle('open');
    button.setAttribute('aria-expanded', String(open));
  }));
  sidebar.querySelector('.mobile-filter-toggle')?.addEventListener('click', () => {
    const open = sidebar.classList.toggle('mobile-open');
    const toggle = sidebar.querySelector('.mobile-filter-toggle');
    toggle?.setAttribute('aria-expanded', String(open));
    const label = toggle?.querySelector('.mobile-filter-count');
    if (label) label.textContent = open ? 'Cerrar opciones' : 'Abrir opciones';
  });
  sidebar.querySelector('#clearCatalogFilters')?.addEventListener('click', () => {
    sidebar.querySelectorAll('input[data-filter-brand], input[data-filter-type]').forEach(input => input.checked = false);
    if (categoryControl) sidebar.querySelectorAll('input[data-filter-category]').forEach(input => input.checked = false);
    draw();
    sidebar.querySelectorAll('.filter-accordion.open').forEach(box => {
      box.classList.remove('open');
      box.querySelector('.filter-title')?.setAttribute('aria-expanded', 'false');
    });
    sidebar.classList.remove('mobile-open');
    sidebar.querySelector('.mobile-filter-toggle')?.setAttribute('aria-expanded', 'false');
    const mobileLabel = sidebar.querySelector('.mobile-filter-count');
    if (mobileLabel) mobileLabel.textContent = 'Abrir opciones';
  });
  draw();
}
function openProduct(id, products) { if (!getProduct(id, products)) return; history.pushState({ product: id }, '', `?producto=${encodeURIComponent(id)}`); renderStore(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

async function renderHome() {
  let products = [], storefront = { heroProductIds: [], featuredProductIds: [], whatsappNumber: '' }, classifications = {};
  try { ({ products, storefront, classifications } = await loadStoreData()); } catch { /* empty state */ }
  const searchTerm = (new URLSearchParams(location.search).get('buscar') || '').trim().toLowerCase();
  const heroIds = storefront.heroProductIds || []; const featuredIds = storefront.featuredProductIds || [];
  const byIds = ids => ids.map(id => getProduct(id, products)).filter(Boolean);
  const heroProducts = byIds(heroIds).sort((a, b) => (Number(a.heroOrder) || 0) - (Number(b.heroOrder) || 0));
  const featured = byIds(featuredIds);
  const heroSource = heroProducts.length ? heroProducts : (featured.length ? featured : products.slice(0, 4));
  const heroSlides = heroSource.map((product, index) => ({ ...product, image: productImages(product)[0], heroTitle: product.heroTitle || (index === 0 && !heroProducts.length ? 'PIEZAS QUE\nCUENTAN TU HISTORIA' : product.name), heroDescription: product.heroDescription || product.description }));
  const matchesSearch = product => {
    const haystack = [product.name, product.brand, product.productType, categories[product.category], product.description].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(searchTerm);
  };
  const searchResults = searchTerm ? products.filter(matchesSearch) : [];
  const visibleFeatured = searchTerm ? searchResults : featured;
  const featuredTitle = searchTerm ? `Resultados para “${escapeHTML(searchTerm)}”` : 'Selección YHORS';
  const featuredText = searchTerm ? `${searchResults.length} producto(s) encontrado(s) en nuestro catálogo.` : 'Tecnología, detalles y piezas elegidas para destacar.';
  const searchCatalog = searchTerm ? `<section class="catalog-shell section search-only" id="destacados"><div class="search-results-heading"><div><span class="eyebrow">Búsqueda YHORS</span><h1>Resultados para “${escapeHTML(searchTerm)}”</h1></div><p>Explora los productos relacionados con tu búsqueda.</p></div><div class="catalog-results"><div class="results-count" id="resultsCount"></div><div class="products" id="featuredProducts"></div></div></section>` : `<section class="section featured-section" id="destacados"><div class="section-heading"><div><span class="eyebrow">Edición YHORS</span><h2>Selección YHORS</h2></div><p>Tecnología, detalles y piezas elegidas para destacar.</p></div><div class="products" id="featuredProducts"></div></section>`;
  app.innerHTML = `${renderHeader('all')}<main>
    ${searchTerm ? '' : `<section class="promo-ribbon" aria-label="Beneficios YHORS"><div class="promo-item"><span>01</span><strong>DISEÑO CON IDENTIDAD</strong><small>Una tienda pensada alrededor de YHORS.</small></div><div class="promo-item"><span>02</span><strong>SELECCIÓN CURADA</strong><small>Productos elegidos por estilo y utilidad.</small></div><div class="promo-item"><span>03</span><strong>ATENCIÓN DIRECTA</strong><small>Pedidos y consultas de forma personal.</small></div></section>${heroMarkup(heroSlides)}`}
    ${searchCatalog}
    ${!searchTerm ? `<section class="statement-strip"><div><span class="eyebrow">YHORS-STORE</span><h2>Elegancia que también se encuentra en los detalles.</h2></div><a class="button" href="#categorias">Explorar universos <span>→</span></a></section>${categoryBlocks()}` : ''}
    <section class="brand-section" id="nosotros"><div class="brand-section-inner"><span class="eyebrow">Sobre nosotros</span><h2>YHORS<br><em>más que un producto</em></h2><p>Un catálogo dividido por universos para que cada persona encuentre algo que conecte con su estilo, sus pasiones y sus momentos especiales.</p></div></section>
  </main>${renderFooter()}${cartMarkup()}</div>`;
  wireMobileMenu(); wireSearch(); wireHero(heroSlides); const cart = wireCart(products, storefront); const featuredArea = document.querySelector('#featuredProducts');
  const renderSearchResults = (items) => { renderProductsInto(featuredArea, items, id => openProduct(id, products), (product, button) => cart.addToCart(product, button)); const count = document.querySelector('#resultsCount'); if (count) count.textContent = `${items.length} producto${items.length === 1 ? '' : 's'} encontrado${items.length === 1 ? '' : 's'}`; if (!items.length) featuredArea.innerHTML = '<div class="empty featured-empty">No encontramos productos con esa búsqueda.<br><small>Prueba con otra marca, categoría o nombre.</small></div>'; };
  if (searchTerm) { renderSearchResults(searchResults); } else { renderProductsInto(featuredArea, visibleFeatured, id => openProduct(id, products), (product, button) => cart.addToCart(product, button)); if (!visibleFeatured.length) featuredArea.innerHTML = '<div class="empty featured-empty">Todavía no has seleccionado productos destacados.<br><small>Entra a YHORS Administración y marca los productos que quieres mostrar aquí.</small></div>'; }
}

async function renderCategoryPage(categoryKey) {
  let products = [], storefront = { whatsappNumber: '' }, classifications = {};
  try { ({ products, storefront, classifications } = await loadStoreData()); } catch { /* empty */ }
  const categoryProducts = products.filter(product => categoryKey === 'all' || product.category === categoryKey);
  const slides = categoryProducts.slice(0, 4).map(product => ({ ...product, image: productImages(product)[0], heroTitle: product.name, heroDescription: product.description }));
  app.innerHTML = `${renderHeader(categoryKey)}<main>${heroMarkup(slides, true, categoryKey)}<section class="section category-page-section" id="productos-categoria"><div class="category-intro"><div><span class="eyebrow">Colección independiente</span><h1>${escapeHTML(categories[categoryKey])}</h1></div><p>${escapeHTML(categoryDescriptions[categoryKey])}</p></div><div class="catalog-layout">${catalogFilters(classifications, categoryKey, { category: categoryKey })}<div class="catalog-results"><div class="results-count" id="resultsCount"></div><div class="products" id="categoryProducts"></div></div></div></section></main>${renderFooter()}${cartMarkup()}`;
  wireMobileMenu(); wireSearch(); wireHero(slides); const cart = wireCart(products, storefront); const area = document.querySelector('#categoryProducts');
  const renderCategoryResults = (items) => { renderProductsInto(area, items, id => openProduct(id, products), (product, button) => cart.addToCart(product, button)); const count = document.querySelector('#resultsCount'); if (count) count.textContent = `${items.length} producto${items.length === 1 ? '' : 's'} en ${escapeHTML(categories[categoryKey])}`; if (!items.length) area.innerHTML = '<div class="empty">No hay productos que coincidan con estos filtros.</div>'; };
  wireCatalogFilters(categoryProducts, classifications, { category: categoryKey }, renderCategoryResults);
}

async function renderProductDetail(product, products, storefront) {
  const images = productImages(product); let selected = 0; const isCosplay = product.category === 'cosplay'; const hasRental = isCosplay && Number.isFinite(Number(product.rentalPrice));
  const modeOptions = hasRental ? `<div class="purchase-choice"><span class="choice-label">¿Cómo quieres obtenerlo?</span><div class="purchase-options" role="radiogroup" aria-label="Modalidad"><button type="button" class="purchase-option active" data-purchase-mode="purchase"><strong>Comprar</strong><span>${productPriceLabel(product)}</span></button><button type="button" class="purchase-option" data-purchase-mode="rental"><strong>Alquilar</strong><span>${money(product.rentalPrice)}</span></button></div></div>` : '';
  app.innerHTML = `${renderHeader(product.category)}<main class="product-detail-page"><div class="breadcrumbs"><a href="${categoryHref(product.category)}">${escapeHTML(categories[product.category])}</a><span>/</span><strong>${escapeHTML(product.name)}</strong></div><section class="detail-layout"><div class="detail-gallery"><div class="detail-main-image"><img id="detailMainImage" data-fallback src="${escapeHTML(images[0])}" alt="${escapeHTML(product.name)}"></div>${images.length > 1 ? `<div class="thumbnail-row">${images.map((image, index) => `<button class="thumb ${index === 0 ? 'active' : ''}" data-image-index="${index}"><img data-fallback src="${escapeHTML(image)}" alt="Imagen ${index + 1}"></button>`).join('')}</div>` : ''}</div><div class="detail-copy"><span class="eyebrow">${escapeHTML(categories[product.category])}</span><h1>${escapeHTML(product.name)}</h1><div class="detail-price" id="detailPrice">${productPriceLabel(product)}${hasRental ? `<small class="price-secondary">Alquiler: ${money(product.rentalPrice)}</small>` : ''}</div><div class="detail-divider"></div>${modeOptions}<h3>Descripción</h3><div class="detail-description">${escapeHTML(product.description).replace(/\n/g, '<br>')}</div><div class="detail-buy"><button class="add detail-add" id="detailAdd"><span>${hasRental ? 'Añadir al carrito' : 'Añadir al carrito'}</span><span>+</span></button><a class="button secondary back-button" href="${categoryHref(product.category)}">← Volver a ${escapeHTML(categories[product.category])}</a></div><div class="detail-note"><span>✓</span>${hasRental ? 'Elige comprar o alquilar antes de añadirlo al carrito.' : 'Compra directa y atención personal.'}</div></div></section></main>${renderFooter()}${cartMarkup()}`;
  wireMobileMenu(); wireImageFallback(document.querySelector('.product-detail-page')); document.querySelectorAll('[data-image-index]').forEach(button => button.addEventListener('click', () => { selected = Number(button.dataset.imageIndex); document.querySelector('#detailMainImage').src = images[selected]; document.querySelectorAll('.thumb').forEach(item => item.classList.remove('active')); button.classList.add('active'); }));
  const cart = wireCart(products, storefront); let purchaseMode = 'purchase';
  document.querySelectorAll('[data-purchase-mode]').forEach(button => button.addEventListener('click', () => { purchaseMode = button.dataset.purchaseMode; document.querySelectorAll('[data-purchase-mode]').forEach(item => item.classList.toggle('active', item === button)); document.querySelector('#detailPrice').firstChild.textContent = purchaseMode === 'rental' ? money(product.rentalPrice) : productPriceLabel(product); }));
  document.querySelector('#detailAdd').addEventListener('click', e => cart.addToCart(product, e.currentTarget, hasRental ? purchaseMode : 'purchase'));
}

async function renderStore() {
  const categoryKey = currentCategoryFromPath();
  let products = [], storefront = { whatsappNumber: '', heroProductIds: [], featuredProductIds: [] };
  try { ({ products, storefront } = await loadStoreData()); } catch { /* empty state */ }
  const productId = new URLSearchParams(location.search).get('producto');
  if (productId) { const product = getProduct(productId, products); if (product) return renderProductDetail(product, products, storefront); }
  if (categoryKey) return renderCategoryPage(categoryKey);
  return renderHome();
}

function productForm(product = {}, classifications = {}) {
  const images = Array.isArray(product.images) && product.images.length ? product.images : (product.image ? [product.image] : []);
  const selectedCategory = product.category || 'elegant';
  const brands = classifications.brands?.[selectedCategory] || [];
  const types = classifications.productTypes?.[selectedCategory] || [];
  const isCosplay = selectedCategory === 'cosplay';
  return `<form id="productForm"><div class="form-grid">
    <div class="field full"><label for="category">Categoría / universo</label><select id="category" name="category" required>${Object.entries(categories).filter(([key]) => key !== 'all').map(([key, label]) => `<option value="${key}" ${selectedCategory === key ? 'selected' : ''}>${label}</option>`).join('')}</select><small class="field-help">Las clasificaciones se administran abajo.</small></div>
    <div class="field"><label for="name">Nombre del producto</label><input id="name" name="name" required maxlength="90" value="${escapeHTML(product.name || '')}"></div>
    <div class="field"><label for="brand">Marca</label><select id="brand" name="brand"><option value="">Sin marca</option>${brands.map(v => `<option value="${escapeHTML(v)}" ${product.brand === v ? 'selected' : ''}>${escapeHTML(v)}</option>`).join('')}</select></div>
    <div class="field"><label for="productType">Tipo de producto</label><select id="productType" name="productType"><option value="">Sin clasificación</option>${types.map(v => `<option value="${escapeHTML(v)}" ${product.productType === v ? 'selected' : ''}>${escapeHTML(v)}</option>`).join('')}</select></div>
    <div class="field"><label for="salePrice">Precio de venta (USD)</label><input id="salePrice" name="salePrice" required min="0" step="0.01" type="number" value="${escapeHTML(product.salePrice ?? product.price ?? '')}"></div>
    <div class="field ${isCosplay ? '' : 'hidden'}"><label for="rentalPrice">Precio de alquiler (USD)</label><input id="rentalPrice" name="rentalPrice" ${isCosplay ? 'required' : ''} min="0" step="0.01" type="number" value="${escapeHTML(product.rentalPrice ?? '')}"><small class="field-help">Disponible para productos de Cosplay.</small></div>
    <div class="field"><label for="imageFile">Subir foto principal (máx. 5 MB)</label><input id="imageFile" name="imageFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></div>
    <div class="field full"><label for="image">URL de imagen principal</label><input id="image" name="image" type="url" placeholder="https://..." value="${escapeHTML(images[0] || product.image || '')}"></div>
    <div class="field full"><label for="image2">Imagen adicional 2 · URL</label><input id="image2" name="image2" type="url" value="${escapeHTML(images[1] || '')}"></div>
    <div class="field full"><label for="image3">Imagen adicional 3 · URL</label><input id="image3" name="image3" type="url" value="${escapeHTML(images[2] || '')}"></div>
    <div class="field full"><label for="image4">Imagen adicional 4 · URL</label><input id="image4" name="image4" type="url" value="${escapeHTML(images[3] || '')}"></div>
    <div class="field full"><label for="description">Descripción completa</label><textarea id="description" name="description" required maxlength="2000" rows="9">${escapeHTML(product.description || '')}</textarea><small class="field-help">Puedes usar saltos de línea y emojis.</small></div>
    <div class="field"><label for="heroOrder">Orden de portada</label><input id="heroOrder" name="heroOrder" type="number" min="0" max="999" value="${escapeHTML(product.heroOrder ?? 0)}"><small class="field-help">Menor número = aparece antes.</small></div>
    <div class="field featured-field"><label><input id="hero" name="hero" type="checkbox" ${product.hero ? 'checked' : ''}> Usar en slider de portada</label><label><input id="featured" name="featured" type="checkbox" ${product.featured ? 'checked' : ''}> Mostrar como destacado</label></div>
  </div><div class="form-actions"><button class="button" type="submit">${product.id ? 'Guardar cambios' : 'Crear producto'}</button><button class="button secondary ${product.id ? '' : 'hidden'}" type="button" id="cancelEdit">Cancelar</button><span class="message" id="formMessage"></span></div></form>`;
}
function selectionPanel(products, settings) {
  const heroSet = new Set(settings.heroProductIds || []); const featuredSet = new Set(settings.featuredProductIds || []);
  return `<section class="admin-panel selection-panel"><div class="section-heading"><div><span class="eyebrow">Experiencia de inicio</span><h2>Portada y productos destacados</h2></div><p>Elige qué aparece en el slider y qué productos se muestran en la portada.</p></div><div class="selection-grid"><div><h3>Slider de portada <small>máx. 6</small></h3><div class="selection-list">${products.map(p => `<label class="selection-row"><input type="checkbox" data-hero-select="${escapeHTML(p.id)}" ${heroSet.has(p.id) ? 'checked' : ''}><img data-fallback src="${escapeHTML(productImages(p)[0])}" alt=""><span><strong>${escapeHTML(p.name)}</strong><small>${escapeHTML(categories[p.category])}</small></span></label>`).join('')}</div></div><div><h3>Productos destacados <small>máx. 8</small></h3><div class="selection-list">${products.map(p => `<label class="selection-row"><input type="checkbox" data-featured-select="${escapeHTML(p.id)}" ${featuredSet.has(p.id) ? 'checked' : ''}><img data-fallback src="${escapeHTML(productImages(p)[0])}" alt=""><span><strong>${escapeHTML(p.name)}</strong><small>${money(p.price)}</small></span></label>`).join('')}</div></div></div><div class="form-actions"><button class="button" id="saveSelections">Guardar portada y destacados</button><span class="message" id="selectionMessage"></span></div></section>`;
}
function classificationPanel(classifications) {
  return `<section class="admin-panel classification-panel"><div class="section-heading"><div><span class="eyebrow">Organización</span><h2>Clasificaciones</h2></div><p>Crea tus propias marcas y tipos de producto por universo.</p></div>
    <div class="classification-grid">
      <div><h3>Marcas</h3><div class="classification-add"><select id="classBrandCategory">${Object.entries(categories).filter(([k])=>k!=='all').map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><input id="newBrand" maxlength="50" placeholder="Ej. Infinix"><button class="button small" id="addBrand">Agregar</button></div><div id="brandLists"></div></div>
      <div><h3>Tipos de producto</h3><div class="classification-add"><select id="classTypeCategory">${Object.entries(categories).filter(([k])=>k!=='all').map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><input id="newType" maxlength="50" placeholder="Ej. Celular"><button class="button small" id="addType">Agregar</button></div><div id="typeLists"></div></div>
    </div><span class="message" id="classificationMessage"></span>
  </section>`;
}
async function renderAdmin() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated: false })); if (!session.authenticated) return renderLogin();
  let products = await request('/api/admin/products').catch(() => []); let classifications = await request('/api/admin/classifications').catch(() => ({ brands: {}, productTypes: {} })); let settings = await request('/api/admin/storefront').catch(() => ({ heroProductIds: [], featuredProductIds: [] })); let editing = null;
  app.innerHTML = `<main class="admin-shell"><div class="admin-wrap"><div class="admin-top"><div><a class="brand" href="/">YHORS</a><h1 class="admin-title">Administración</h1></div><button class="button secondary" id="logout">Cerrar sesión</button></div>${selectionPanel(products, settings)}${classificationPanel(classifications)}<section class="admin-panel"><span class="eyebrow">Catálogo</span><h2 id="formTitle">Agregar producto</h2><div id="formArea"></div></section><section class="admin-products"><div class="section-heading"><div><span class="eyebrow">Inventario</span><h2>Productos publicados (${products.length})</h2></div><p>Edita datos, imágenes, portada y destacados.</p></div><div id="adminProducts"></div></section></div></main>`;
  const formArea = document.querySelector('#formArea'); const listArea = document.querySelector('#adminProducts');
  function drawList() {
    const categoryKeys = Object.keys(categories).filter(k => k !== 'all');
    listArea.innerHTML = products.length ? categoryKeys.map(key => {
      const group = products.filter(p => p.category === key);
      if (!group.length) return '';
      return `<section class="admin-category-group"><div class="admin-category-heading"><span class="eyebrow">Universo</span><h3>${escapeHTML(categories[key])} <small>${group.length}</small></h3></div>${group.map(p => `<article class="admin-product"><img data-fallback src="${escapeHTML(productImages(p)[0])}" alt=""><div><h3>${escapeHTML(p.name)} ${p.featured ? '<span class="featured-star">★ Destacado</span>' : ''} ${p.hero ? '<span class="hero-tag">◆ Portada</span>' : ''}</h3><p>${escapeHTML(categories[p.category] || p.category)}${productMeta(p) ? ` · ${escapeHTML(productMeta(p))}` : ''} · Venta ${productPriceLabel(p)}${p.category === 'cosplay' && p.rentalPrice !== null && p.rentalPrice !== undefined && p.rentalPrice !== '' ? ` · Alquiler ${money(p.rentalPrice)}` : ''} · ${productImages(p).length} imagen(es)</p></div><div class="admin-actions"><button class="button secondary small" data-edit="${escapeHTML(p.id)}">Editar</button><button class="button danger small" data-delete="${escapeHTML(p.id)}">Eliminar</button></div></article>`).join('')}</section>`;
    }).join('') : '<div class="empty">No hay productos aún.</div>';
    wireImageFallback(listArea);
    listArea.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => { editing = products.find(p => p.id === b.dataset.edit); drawForm(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
    listArea.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', async () => { const product = products.find(p => p.id === b.dataset.delete); if (!confirm(`¿Eliminar “${product.name}”? Esta acción no se puede deshacer.`)) return; try { await request(`/api/admin/products/${product.id}`, { method: 'DELETE' }); products = products.filter(p => p.id !== product.id); settings.heroProductIds = settings.heroProductIds.filter(id => id !== product.id); settings.featuredProductIds = settings.featuredProductIds.filter(id => id !== product.id); await request('/api/admin/storefront', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }); drawList(); drawSelectionPanel(); drawForm(); } catch (e) { alert(e.message); } }));
  }
  function drawSelectionPanel() { document.querySelector('.selection-panel')?.remove(); const anchor = document.querySelector('.admin-top'); anchor.insertAdjacentHTML('afterend', selectionPanel(products, settings)); bindSelectionEvents(); }
  function bindSelectionEvents() { wireImageFallback(document.querySelector('.selection-panel')); document.querySelector('#saveSelections')?.addEventListener('click', async () => { const message = document.querySelector('#selectionMessage'); const heroChecked = [...document.querySelectorAll('[data-hero-select]:checked')]; const featuredChecked = [...document.querySelectorAll('[data-featured-select]:checked')]; if (heroChecked.length > 6 || featuredChecked.length > 8) { message.className = 'message error'; message.textContent = 'Máximo: 6 imágenes en portada y 8 productos destacados.'; return; } const heroProductIds = heroChecked.map(x => x.dataset.heroSelect); const featuredProductIds = featuredChecked.map(x => x.dataset.featuredSelect); try { await request('/api/admin/storefront', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ heroProductIds, featuredProductIds }) }); settings = { heroProductIds, featuredProductIds }; products = products.map(p => ({ ...p, hero: heroProductIds.includes(p.id), featured: featuredProductIds.includes(p.id) })); message.textContent = '✓ Portada y destacados guardados.'; drawList(); } catch (e) { message.className = 'message error'; message.textContent = e.message; } }); }
  function renderClassifications() {
    const render = (target, values, type) => {
      const container = document.querySelector(target);
      if (!container) return;
      container.innerHTML = Object.entries(values || {}).filter(([, list]) => Array.isArray(list) && list.length).map(([cat, list]) => `<div class="classification-group"><strong>${escapeHTML(categories[cat])}</strong><div class="classification-chips">${list.map((v,i)=>`<span class="classification-chip">${escapeHTML(v)}<button type="button" data-remove-class="${type}" data-category="${escapeHTML(cat)}" data-index="${i}">×</button></span>`).join('')}</div></div>`).join('') || '<small class="field-help">Todavía no hay clasificaciones.</small>';
      container.querySelectorAll('[data-remove-class]').forEach(btn => btn.addEventListener('click', async () => { classifications[btn.dataset.removeClass][btn.dataset.category].splice(Number(btn.dataset.index), 1); await saveClassifications(); }));
    };
    render('#brandLists', classifications.brands, 'brands'); render('#typeLists', classifications.productTypes, 'productTypes');
  }
  async function saveClassifications() {
    try { classifications = await request('/api/admin/classifications', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(classifications) }); renderClassifications(); drawForm(); document.querySelector('#classificationMessage').textContent='✓ Clasificaciones guardadas.'; }
    catch(e) { const m=document.querySelector('#classificationMessage'); m.className='message error'; m.textContent=e.message; }
  }
  function bindClassificationEvents() {
    const bind = (buttonId, inputId, selectId, key) => document.querySelector(buttonId)?.addEventListener('click', async () => {
      const input=document.querySelector(inputId), cat=document.querySelector(selectId).value, value=input.value.trim();
      if (!value) return;
      classifications[key][cat] ||= [];
      if (!classifications[key][cat].some(v => v.toLowerCase() === value.toLowerCase())) classifications[key][cat].push(value);
      input.value=''; await saveClassifications();
    });
    bind('#addBrand','#newBrand','#classBrandCategory','brands'); bind('#addType','#newType','#classTypeCategory','productTypes');
  }
  function drawForm(draft = editing || {}) {
    formArea.innerHTML = productForm(draft, classifications);
    document.querySelector('#formTitle').textContent = editing ? `Editar: ${editing.name}` : 'Agregar producto';
    document.querySelector('#cancelEdit')?.addEventListener('click', () => { editing = null; drawForm(); });
    document.querySelector('#category')?.addEventListener('change', event => drawForm({ ...(editing || {}), category: event.target.value }));
    document.querySelector('#productForm').addEventListener('submit', async event => {
      event.preventDefault(); const form = event.currentTarget; const submit = form.querySelector('[type="submit"]'); const message = document.querySelector('#formMessage'); submit.disabled = true; message.textContent = 'Guardando…';
      try {
        const data = Object.fromEntries(new FormData(form).entries()); data.featured = form.elements.featured.checked; data.hero = form.elements.hero.checked; data.price = data.salePrice; data.images = [data.image, data.image2, data.image3, data.image4].filter(Boolean);
        const file = form.elements.imageFile.files[0];
        if (file) { const uploadData = new FormData(); uploadData.append('image', file); const uploaded = await request('/api/admin/upload', { method: 'POST', body: uploadData }); data.image = uploaded.image; data.images[0] = uploaded.image; }
        const url = editing ? `/api/admin/products/${editing.id}` : '/api/admin/products';
        const product = await request(url, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        products = editing ? products.map(p => p.id === product.id ? product : p) : [product, ...products];
        const heroIds = new Set(settings.heroProductIds); const featuredIds = new Set(settings.featuredProductIds); product.hero ? heroIds.add(product.id) : heroIds.delete(product.id); product.featured ? featuredIds.add(product.id) : featuredIds.delete(product.id);
        settings = { heroProductIds: [...heroIds].slice(0, 6), featuredProductIds: [...featuredIds].slice(0, 8) };
        await request('/api/admin/storefront', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
        products = products.map(p => p.id === product.id ? { ...p, hero: settings.heroProductIds.includes(p.id), featured: settings.featuredProductIds.includes(p.id) } : p);
        editing = null; drawList(); drawForm(); drawSelectionPanel();
      } catch (e) { message.className = 'message error'; message.textContent = e.message; submit.disabled = false; }
    });
  }

  document.querySelector('#logout').addEventListener('click', async () => { await request('/api/logout', { method: 'POST' }); renderLogin(); }); drawList(); renderClassifications(); bindClassificationEvents(); drawForm(); bindSelectionEvents();
}
function renderLogin() { app.innerHTML = `<main class="login-page"><section class="login-card"><a class="brand" href="/">YHORS</a><span class="eyebrow">Panel privado</span><h1>Acceso a YHORS</h1><p>Ingresa con la cuenta de administración para actualizar el catálogo.</p><form id="loginForm" class="form-grid"><div class="field full"><label for="username">Usuario</label><input id="username" name="username" autocomplete="username" required></div><div class="field full"><label for="password">Contraseña</label><input id="password" name="password" type="password" autocomplete="current-password" required></div><div class="form-actions"><button class="button" type="submit">Iniciar sesión</button><span class="message" id="loginMessage"></span></div></form></section></main>`; document.querySelector('#loginForm').addEventListener('submit', async e => { e.preventDefault(); const form = e.currentTarget; const message = document.querySelector('#loginMessage'); try { await request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); renderAdmin(); } catch (error) { message.className = 'message error'; message.textContent = error.message; } }); }

window.addEventListener('popstate', () => renderStore());
if (window.location.pathname === ADMIN_PATH || window.location.pathname === `${ADMIN_PATH}/`) renderAdmin(); else renderStore();
