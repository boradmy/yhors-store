const app = document.querySelector('#app');
const ADMIN_PATH = '/yhors/admin593';
const ORDER_STATUS_CLASS = { Pendiente:'pending', Confirmado:'confirmed', Preparando:'preparing', Enviado:'shipped', Entregado:'delivered', Cancelado:'cancelled' };
const statusClass = value => ORDER_STATUS_CLASS[value] || 'pending';
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
function productSlug(product) {
  const base = String(product?.name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/&/g, ' y ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || 'producto';
  const sku = String(product?.sku || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return sku ? `${base}-${sku}` : `${base}-${String(product?.id || '').slice(0, 8)}`;
}
function productHref(product) { return `/producto/${encodeURIComponent(productSlug(product))}`; }

async function request(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.headers || {}) } });
  const json = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(json.error || 'No se pudo completar la operación.'); error.status = response.status; error.data = json; throw error; }
  return json;
}

function accountMenu(account = {}) {
  const username = escapeHTML(account.username || 'Usuario');
  return `<div class="account-menu-wrap">
    <button class="account-menu-trigger" id="accountMenuTrigger" type="button" aria-label="Abrir menú de usuario" aria-haspopup="menu" aria-expanded="false">
      <span class="account-menu-avatar" aria-hidden="true"><svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="3.2"></circle><path d="M5.5 20c.8-3.2 3.1-5 6.5-5s5.7 1.8 6.5 5"></path></svg></span>
      <span class="account-menu-caret" aria-hidden="true">⌄</span>
    </button>
    <div class="account-menu" id="accountMenu" role="menu" hidden>
      <div class="account-menu-user"><strong>${username}</strong><small>${escapeHTML(userRoleLabel(account.role || ''))}</small></div>
      <a href="/mi-cuenta" role="menuitem">Mi cuenta</a>
      <button type="button" role="menuitem" id="accountMenuLogout">Cerrar sesión</button>
    </div>
  </div>`;
}

function wireAccountMenu() {
  const wrap = document.querySelector('.account-menu-wrap');
  const trigger = document.querySelector('#accountMenuTrigger');
  const menu = document.querySelector('#accountMenu');
  if (!wrap || !trigger || !menu) return;
  const close = () => { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
  trigger.addEventListener('click', event => {
    event.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('click', event => {
    if (!wrap.contains(event.target)) close();
  });
  document.querySelector('#accountMenuLogout')?.addEventListener('click', async () => {
    try { await request('/api/logout', { method: 'POST' }); } finally { renderLogin(); }
  });
}

function base64UrlToBytes(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(String(value || '').length / 4) * 4, '=');
  const binary = atob(normalized);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}
function bytesToBase64Url(value) {
  const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : new Uint8Array(value);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function registrationOptionsForBrowser(options) {
  return {
    ...options,
    challenge: base64UrlToBytes(options.challenge),
    user: { ...options.user, id: base64UrlToBytes(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map(item => ({ ...item, id: base64UrlToBytes(item.id) }))
  };
}
function authenticationOptionsForBrowser(options) {
  return {
    ...options,
    challenge: base64UrlToBytes(options.challenge),
    allowCredentials: (options.allowCredentials || []).map(item => ({ ...item, id: base64UrlToBytes(item.id) }))
  };
}
function serializeRegistrationCredential(credential) {
  return {
    id: credential.id,
    rawId: bytesToBase64Url(credential.rawId),
    response: {
      clientDataJSON: bytesToBase64Url(credential.response.clientDataJSON),
      attestationObject: bytesToBase64Url(credential.response.attestationObject),
      transports: typeof credential.response.getTransports === 'function' ? credential.response.getTransports() : []
    },
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {}
  };
}
function serializeAuthenticationCredential(credential) {
  return {
    id: credential.id,
    rawId: bytesToBase64Url(credential.rawId),
    response: {
      clientDataJSON: bytesToBase64Url(credential.response.clientDataJSON),
      authenticatorData: bytesToBase64Url(credential.response.authenticatorData),
      signature: bytesToBase64Url(credential.response.signature),
      userHandle: credential.response.userHandle ? bytesToBase64Url(credential.response.userHandle) : null
    },
    type: credential.type,
    clientExtensionResults: credential.getClientExtensionResults ? credential.getClientExtensionResults() : {}
  };
}
async function nativeStartRegistration(options) {
  if (!window.PublicKeyCredential || !navigator.credentials?.create) throw new Error('Este navegador no admite Passkeys/WebAuthn.');
  const credential = await navigator.credentials.create({ publicKey: registrationOptionsForBrowser(options) });
  if (!credential) throw new Error('No se pudo crear la Passkey.');
  return serializeRegistrationCredential(credential);
}
async function nativeStartAuthentication(options) {
  if (!window.PublicKeyCredential || !navigator.credentials?.get) throw new Error('Este navegador no admite Passkeys/WebAuthn.');
  try {
    const credential = await navigator.credentials.get({ publicKey: authenticationOptionsForBrowser(options) });
    if (!credential) throw new Error('No se pudo completar la autenticación con Passkey.');
    return serializeAuthenticationCredential(credential);
  } catch (error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      const friendly = new Error('Inicio con Passkey cancelado. Puedes volver a intentarlo o usar tu contraseña.');
      friendly.code = 'PASSKEY_CANCELLED';
      throw friendly;
    }
    if (error?.name === 'SecurityError') throw new Error('Passkey no disponible en este dominio. Verifica que YHORS esté usando HTTPS y el dominio configurado.');
    throw new Error('No se pudo completar el inicio con Passkey. Inténtalo nuevamente.');
  }
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
    <div class="cart-items" id="cartItems"></div><div class="cart-total"><span>Subtotal</span><span id="cartTotal">$0</span></div>
    <button class="button checkout-button" id="checkout">Finalizar pedido <span>→</span></button>
    <p class="message" id="checkoutMessage"></p>
  </aside>`;
}

function compactHeroText(value, max = 180) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  return clean.length > max ? `${clean.slice(0, max - 1).trim()}…` : clean;
}
function heroMarkup(slides, isCategory = false, categoryKey = 'all') {
  const safeSlides = slides.length ? slides : [{ image: placeholder, name: categories[categoryKey] || 'YHORS', category: categoryKey, description: categoryDescriptions[categoryKey] }];
  return `<section class="hero-slider ${isCategory ? 'category-hero' : ''}" id="heroSlider" aria-label="${escapeHTML(categories[categoryKey] || 'Colección YHORS')}">
    <div class="hero-track">${safeSlides.map((slide, index) => {
      const title = slide.heroTitle || (isCategory ? categories[categoryKey] : slide.name) || 'PIEZAS QUE CUENTAN TU HISTORIA';
      const description = compactHeroText(slide.heroDescription || slide.description || categoryDescriptions[categoryKey] || 'Descubre una selección pensada para hacer especial cada ocasión.');
      const href = slide.id ? productHref(slide) : (isCategory ? '#productos-categoria' : '#destacados');
      return `<article class="hero-slide ${index === 0 ? 'active' : ''}" data-slide="${index}">
      <div class="hero-backdrop" aria-hidden="true" style="background-image:url('${escapeHTML(slide.image)}')"></div><img class="hero-bg" data-fallback src="${escapeHTML(slide.image)}" alt="${escapeHTML(slide.name || 'YHORS')}"><div class="hero-overlay"></div>
      <div class="hero-content"><span class="eyebrow">YHORS · ${escapeHTML(categories[slide.category] || categories[categoryKey] || 'COLECCIÓN')}</span>
      <h1>${escapeHTML(title).replace(/\n/g, '<br>')}</h1>
      <p>${escapeHTML(description)}</p>
      <a class="button hero-button" href="${escapeHTML(href)}">${isCategory && !slide.id ? 'Explorar colección' : 'Ver producto'}</a></div>
    </article>`;
    }).join('')}</div>
    ${safeSlides.length > 1 ? `<button class="hero-arrow hero-prev" type="button" aria-label="Anterior">‹</button><button class="hero-arrow hero-next" type="button" aria-label="Siguiente">›</button><div class="hero-dots">${safeSlides.map((_, i) => `<button type="button" class="hero-dot ${i === 0 ? 'active' : ''}" data-hero-index="${i}" aria-label="Ir a la imagen ${i + 1}"></button>`).join('')}</div>` : ''}
  </section>`;
}
function wireHero(slides) {
  const slider = document.querySelector('#heroSlider');
  if (!slider) return;
  wireImageFallback(slider);
  if (slides.length <= 1) return;

  let current = 0;
  const slideEls = [...slider.querySelectorAll('.hero-slide')];
  const dots = [...slider.querySelectorAll('.hero-dot')];
  const DURATION = 5500;
  let autoTimer = null;

  const restartProgress = () => {
    dots.forEach(dot => {
      dot.classList.remove('active');
      // Force a reflow so the CSS progress animation always starts from 0.
      void dot.offsetWidth;
    });
    if (dots[current]) dots[current].classList.add('active');
  };

  const go = (index, restartAuto = true) => {
    current = (index + slideEls.length) % slideEls.length;
    slideEls.forEach((el, i) => el.classList.toggle('active', i === current));
    restartProgress();
    if (restartAuto) scheduleNext();
  };

  const scheduleNext = () => {
    clearTimeout(autoTimer);
    autoTimer = setTimeout(() => go(current + 1, true), DURATION);
  };

  slider.querySelector('.hero-prev')?.addEventListener('click', () => go(current - 1));
  slider.querySelector('.hero-next')?.addEventListener('click', () => go(current + 1));
  dots.forEach(dot => dot.addEventListener('click', () => go(Number(dot.dataset.heroIndex))));

  // The progress bar is now the clock: when it finishes, the next slide starts.
  slider.addEventListener('mouseenter', () => {
    paused = true;
    clearTimeout(autoTimer);
    const dot = dots[current];
    if (dot) dot.style.setProperty('--hero-progress-play-state', 'paused');
  });
  slider.addEventListener('mouseleave', () => {
    paused = false;
    const dot = dots[current];
    if (dot) dot.style.setProperty('--hero-progress-play-state', 'running');
    scheduleNext();
  });

  // Initial state.
  restartProgress();
  scheduleNext();
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
  return `<article class="product" data-product="${escapeHTML(product.id)}"><a class="product-open" data-open="${escapeHTML(product.id)}" href="${escapeHTML(productHref(product))}" aria-label="Ver ${escapeHTML(product.name)}"><div class="product-image"><img data-fallback src="${escapeHTML(image)}" alt="${escapeHTML(product.name)}" loading="lazy"></div><div class="product-info"><span class="product-category">${escapeHTML(categories[product.category] || product.category)}</span>${meta ? `<small class="product-meta">${escapeHTML(meta)}</small>` : ''}<h3>${escapeHTML(product.name)}</h3><p>${escapeHTML(product.description).replace(/\n/g, '<br>')}</p><span class="detail-link">Ver detalles <span>→</span></span></div></a><div class="product-bottom"><div><span class="price">${productPriceLabel(product)}</span>${rental}</div>${action}</div></article>`;
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
  const checkoutButton = document.querySelector('#checkout');
  const checkoutMessage = document.querySelector('#checkoutMessage');
  checkoutButton?.addEventListener('click', () => {
    if (!cart.length) {
      checkoutMessage.textContent = 'Agrega al menos un producto para continuar.';
      return;
    }
    window.open('/pedido', '_blank', 'noopener');
  });
  updateCartCount(); drawCart(); return { addToCart, openCart, closeCart };
}


function checkoutPage() {
  let cart = getCart();
  const subtotal = () => cart.reduce((sum, line) => sum + Number(line.price || 0) * Number(line.quantity || 0), 0);
  const shipping = { office: 0, local: 3, courier: 5 };
  const labels = {
    office: { title: 'Retiro en oficina', text: 'Retira tu pedido directamente en la oficina YHORS.', price: 0 },
    local: { title: 'Envío YHORS', text: 'Entrega dentro de la ciudad. Recargo fijo de $3,00.', price: 3 },
    courier: { title: 'Courier', text: 'Envío mediante servicio de courier. Recargo fijo de $5,00.', price: 5 }
  };
  if (!cart.length) {
    app.innerHTML = `<main class="checkout-page"><div class="checkout-page-inner"><span class="eyebrow">YHORS-STORE</span><h1>Tu carrito está vacío</h1><p>Agrega productos antes de realizar un pedido.</p><a class="button" href="/">Volver a la tienda <span>→</span></a></div></main>`;
    return;
  }
  app.innerHTML = `<main class="checkout-page"><div class="checkout-page-inner">
    <div class="checkout-page-top"><a class="brand" href="/">YHORS <small>STORE</small></a><a class="checkout-back" href="/">← Seguir comprando</a></div>
    <div class="checkout-layout">
      <section class="checkout-card"><span class="eyebrow">Finalizar pedido</span><h1>Datos de tu pedido</h1><p class="checkout-intro">Completa tus datos y selecciona cómo quieres recibir tu compra.</p>
        <form id="fullCheckoutForm" class="form-grid">
          <div class="field"><label for="fullCedula">Cédula / RUC *</label><input id="fullCedula" name="cedula" type="text" inputmode="numeric" minlength="10" maxlength="13" pattern="[0-9]{10,13}" autocomplete="off" placeholder="Cédula o RUC" required></div>
          <div class="field"><label for="fullName">Nombre completo *</label><input id="fullName" name="name" required maxlength="100" autocomplete="name" placeholder="Nombre y apellido"></div>
          <div class="field"><label for="fullPhone">Teléfono / WhatsApp *</label><input id="fullPhone" name="phone" required maxlength="40" autocomplete="tel" placeholder="099 999 9999"></div>
          <div class="field"><label for="fullEmail">Correo electrónico</label><input id="fullEmail" name="email" type="email" maxlength="120" autocomplete="email" placeholder="correo@ejemplo.com"></div>
          <div class="field"><label for="fullCity">Ciudad *</label><input id="fullCity" name="city" required maxlength="80" autocomplete="address-level2" placeholder="Quito"></div>
          <div class="field full" id="fullAddressField"><label for="fullAddress">Dirección *</label><input id="fullAddress" name="address" maxlength="240" autocomplete="street-address" placeholder="Calle, número y referencia"></div>
          <div class="field full hidden" id="fullMapsField"><label for="fullMapsUrl">Dirección vía Google Maps <small>(opcional)</small></label><input id="fullMapsUrl" name="mapsUrl" type="url" maxlength="500" placeholder="Pega aquí el enlace de tu ubicación de Google Maps"></div>
          <div class="field full"><label>Forma de entrega *</label>
            <div class="delivery-options">
              ${Object.entries(labels).map(([key,item],i)=>`<label class="delivery-option"><input type="radio" name="deliveryMethod" value="${key}" ${i===0?'checked':''}><span><strong>${item.title}</strong><small>${item.text}</small></span><b>${item.price ? money(item.price) : 'Sin costo'}</b></label>`).join('')}
            </div>
          </div>
          <div class="field full"><label for="fullNotes">Notas del pedido</label><textarea id="fullNotes" name="notes" maxlength="500" rows="3" placeholder="Referencia, horario u otra indicación"></textarea></div>
          <div class="form-actions full"><button class="button" type="submit">Confirmar pedido <span>→</span></button><span class="message" id="fullCheckoutMessage"></span></div>
        </form>
      </section>
      <aside class="checkout-card order-review"><span class="eyebrow">Resumen</span><h2>Tu pedido</h2><div id="fullOrderItems">${cart.map(line=>`<div class="checkout-item"><div><strong>${escapeHTML(line.quantity)}× ${escapeHTML(line.name || 'Producto')}</strong><small>SKU: ${escapeHTML(line.sku || '—')}</small></div><strong>${money(Number(line.price)*Number(line.quantity))}</strong></div>`).join('')}</div>
        <div class="checkout-totals"><div><span>Subtotal</span><strong id="fullSubtotal">${money(subtotal())}</strong></div><div><span>Envío</span><strong id="fullShipping">Sin costo</strong></div><div class="checkout-grand"><span>Total</span><strong id="fullTotal">${money(subtotal())}</strong></div></div>
      </aside>
    </div>
  </div></main>`;
  const address = document.querySelector('#fullAddress');
  const addressField = document.querySelector('#fullAddressField');
  const shippingEl = document.querySelector('#fullShipping');
  const totalEl = document.querySelector('#fullTotal');
  const updateDelivery = () => {
    const method = document.querySelector('input[name="deliveryMethod"]:checked')?.value || 'office';
    const cost = shipping[method];
    const mapsField = document.querySelector('#fullMapsField');
    const mapsInput = document.querySelector('#fullMapsUrl');
    address.required = method !== 'office';
    addressField.querySelector('label').textContent = method === 'office' ? 'Dirección (opcional)' : 'Dirección *';
    address.placeholder = method === 'office' ? 'No es necesaria para retiro en oficina' : 'Calle, número y referencia';
    if (mapsField) mapsField.classList.toggle('hidden', method !== 'local');
    if (mapsInput && method !== 'local') mapsInput.value = '';
    shippingEl.textContent = cost ? money(cost) : 'Sin costo';
    totalEl.textContent = money(subtotal() + cost);
  };
  document.querySelectorAll('input[name="deliveryMethod"]').forEach(r => r.addEventListener('change', updateDelivery));
  updateDelivery();
  document.querySelector('#fullCheckoutForm').addEventListener('submit', async e => {
    e.preventDefault();
    const form=e.currentTarget, submit=form.querySelector('[type="submit"]'), message=document.querySelector('#fullCheckoutMessage');
    submit.disabled=true; message.className='message'; message.textContent='Registrando pedido…';
    try {
      const data=Object.fromEntries(new FormData(form).entries());
      const payload={customer:{name:data.name,phone:data.phone,cedula:data.cedula,email:data.email,city:data.city,address:data.address,mapsUrl:data.mapsUrl,notes:data.notes},deliveryMethod:data.deliveryMethod,items:cart.map(line=>({productId:line.productId||line.id,quantity:Number(line.quantity),purchaseMode:line.purchaseMode||'purchase'}))};
      const result=await request('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      localStorage.removeItem('yhors-cart'); cart=[];
      app.innerHTML=`<main class="checkout-page"><div class="checkout-success-page"><span class="success-mark">✓</span><span class="eyebrow">Pedido recibido</span><h1>#${escapeHTML(result.orderNumber)}</h1><p>Tu pedido fue registrado correctamente.</p><div class="success-total">Total del pedido: <strong>${money(result.total)}</strong></div><p class="success-note">Guarda tu número de pedido para futuras consultas.</p><a class="button" href="/">Volver a YHORS STORE <span>→</span></a></div></main>`;
    } catch(err) { message.className='message error'; message.textContent=err.message; submit.disabled=false; }
  });
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
    product.name, product.brand, product.productType, product.sku, categories[product.category], product.category,
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
function openProduct(id, products) { const product = getProduct(id, products); if (!product) return; history.pushState({ product: id }, '', productHref(product)); renderStore(); window.scrollTo({ top: 0, behavior: 'smooth' }); }

function updateSeoMeta({ title, description, canonical, image = '', robots = 'index,follow' }) {
  document.title = title;
  const upsert = (selector, attr, value) => { let el = document.head.querySelector(selector); if (!el) { el = document.createElement('meta'); el.setAttribute(attr, selector.includes('property=') ? selector.match(/property=\"([^\"]+)/)?.[1] || attr : attr); document.head.appendChild(el); } el.setAttribute(attr, value); };
  upsert('meta[name=\"description\"]', 'content', description);
  upsert('meta[name=\"robots\"]', 'content', robots);
  const canonicalEl = document.head.querySelector('link[rel=\"canonical\"]') || document.head.appendChild(Object.assign(document.createElement('link'), { rel: 'canonical' })); canonicalEl.href = canonical;
  upsert('meta[property=\"og:title\"]', 'content', title); upsert('meta[property=\"og:description\"]', 'content', description); upsert('meta[property=\"og:url\"]', 'content', canonical);
  if (image) upsert('meta[property=\"og:image\"]', 'content', image);
}

async function renderHome() {
  updateSeoMeta({ title: 'YHORS-STORE | Tecnología, detalles, cosplay y más', description: 'YHORS-STORE: tecnología, celulares, accesorios, cosplay, detalles, regalos, mascotas y coleccionables. Descubre productos seleccionados en Ecuador.', canonical: `${location.origin}/` });
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
    ${searchTerm ? '' : `<section class="promo-ribbon" aria-label="Beneficios YHORS"><div class="promo-item"><span>01</span><strong>DISEÑO CON IDENTIDAD</strong><small>Una tienda pensada alrededor de YHORS.</small></div><div class="promo-item"><span>02</span><strong>PRODUCTOS DE CALIDAD</strong><small>Productos elegidos por estilo y utilidad.</small></div><div class="promo-item"><span>03</span><strong>ATENCIÓN DIRECTA</strong><small>Pedidos y consultas de forma personal.</small></div></section>${heroMarkup(heroSlides)}`}
    ${searchCatalog}
    ${!searchTerm ? `<section class="statement-strip"><div><span class="eyebrow">YHORS-STORE</span><h2>Elegancia que también se encuentra en los detalles.</h2></div><a class="button" href="#categorias">Explorar universos <span>→</span></a></section>${categoryBlocks()}` : ''}
    <section class="brand-section" id="nosotros"><div class="brand-section-inner"><span class="eyebrow">Sobre nosotros</span><h2>YHORS<br><em>más que un producto</em></h2><p>Un catálogo dividido por universos para que cada persona encuentre algo que conecte con su estilo, sus pasiones y sus momentos especiales.</p></div></section>
  </main>${renderFooter()}${cartMarkup()}</div>`;
  wireMobileMenu(); wireSearch(); wireHero(heroSlides); const cart = wireCart(products, storefront); const featuredArea = document.querySelector('#featuredProducts');
  const renderSearchResults = (items) => { renderProductsInto(featuredArea, items, id => openProduct(id, products), (product, button) => cart.addToCart(product, button)); const count = document.querySelector('#resultsCount'); if (count) count.textContent = `${items.length} producto${items.length === 1 ? '' : 's'} encontrado${items.length === 1 ? '' : 's'}`; if (!items.length) featuredArea.innerHTML = '<div class="empty featured-empty">No encontramos productos con esa búsqueda.<br><small>Prueba con otra marca, categoría o nombre.</small></div>'; };
  if (searchTerm) { renderSearchResults(searchResults); } else { renderProductsInto(featuredArea, visibleFeatured, id => openProduct(id, products), (product, button) => cart.addToCart(product, button)); if (!visibleFeatured.length) featuredArea.innerHTML = '<div class="empty featured-empty">Todavía no has seleccionado productos destacados.<br><small>Entra a YHORS Administración y marca los productos que quieres mostrar aquí.</small></div>'; }
}

async function renderCategoryPage(categoryKey) {
  const label = categories[categoryKey] || 'YHORS';
  updateSeoMeta({ title: `${label} | YHORS-STORE`, description: categoryDescriptions[categoryKey] || 'Productos seleccionados en YHORS-STORE.', canonical: `${location.origin}/categoria/${encodeURIComponent(categoryKey === 'all' ? 'principal' : categoryKey)}` });
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
  const images = productImages(product); updateSeoMeta({ title: `${product.name} | YHORS-STORE`, description: String(product.description || `${product.name} disponible en YHORS-STORE.`).replace(/\s+/g, ' ').slice(0, 155), canonical: `${location.origin}${productHref(product)}`, image: images[0] && (images[0].startsWith('http') ? images[0] : `${location.origin}${images[0]}`) }); let selected = 0; const isCosplay = product.category === 'cosplay'; const hasRental = isCosplay && Number.isFinite(Number(product.rentalPrice));
  const modeOptions = hasRental ? `<div class="purchase-choice"><span class="choice-label">¿Cómo quieres obtenerlo?</span><div class="purchase-options" role="radiogroup" aria-label="Modalidad"><button type="button" class="purchase-option active" data-purchase-mode="purchase"><strong>Comprar</strong><span>${productPriceLabel(product)}</span></button><button type="button" class="purchase-option" data-purchase-mode="rental"><strong>Alquilar</strong><span>${money(product.rentalPrice)}</span></button></div></div>` : '';
  app.innerHTML = `${renderHeader(product.category)}<main class="product-detail-page"><div class="breadcrumbs"><a href="${categoryHref(product.category)}">${escapeHTML(categories[product.category])}</a><span>/</span><strong>${escapeHTML(product.name)}</strong></div><section class="detail-layout"><div class="detail-gallery"><div class="detail-main-image"><img id="detailMainImage" data-fallback src="${escapeHTML(images[0])}" alt="${escapeHTML(product.name)}"></div>${images.length > 1 ? `<div class="thumbnail-row">${images.map((image, index) => `<button class="thumb ${index === 0 ? 'active' : ''}" data-image-index="${index}"><img data-fallback src="${escapeHTML(image)}" alt="Imagen ${index + 1}"></button>`).join('')}</div>` : ''}</div><div class="detail-copy"><span class="eyebrow">${escapeHTML(categories[product.category])}</span><h1>${escapeHTML(product.name)}</h1><div class="detail-price" id="detailPrice">${productPriceLabel(product)}</div><div class="detail-sku" aria-label="SKU de YHORS"><span class="detail-sku-icon">⌑</span><span>SKU: <strong>${escapeHTML(product.sku || '—')}</strong></span></div><div class="detail-divider"></div>${modeOptions}<h3>Descripción</h3><div class="detail-description">${escapeHTML(product.description).replace(/\n/g, '<br>')}</div><div class="detail-buy"><button class="add detail-add" id="detailAdd"><span>${hasRental ? 'Añadir al carrito' : 'Añadir al carrito'}</span><span>+</span></button><a class="button secondary back-button" href="${categoryHref(product.category)}">← Volver a ${escapeHTML(categories[product.category])}</a></div><div class="detail-note"><span>✓</span>${hasRental ? 'Elige comprar o alquilar antes de añadirlo al carrito.' : 'Compra directa y atención personal.'}</div></div></section></main>${renderFooter()}${cartMarkup()}`;
  wireMobileMenu(); wireSearch(); wireImageFallback(document.querySelector('.product-detail-page')); document.querySelectorAll('[data-image-index]').forEach(button => button.addEventListener('click', () => { selected = Number(button.dataset.imageIndex); document.querySelector('#detailMainImage').src = images[selected]; document.querySelectorAll('.thumb').forEach(item => item.classList.remove('active')); button.classList.add('active'); }));
  const cart = wireCart(products, storefront); let purchaseMode = 'purchase';
  document.querySelectorAll('[data-purchase-mode]').forEach(button => button.addEventListener('click', () => { purchaseMode = button.dataset.purchaseMode; document.querySelectorAll('[data-purchase-mode]').forEach(item => item.classList.toggle('active', item === button)); document.querySelector('#detailPrice').firstChild.textContent = purchaseMode === 'rental' ? money(product.rentalPrice) : productPriceLabel(product); }));
  document.querySelector('#detailAdd').addEventListener('click', e => cart.addToCart(product, e.currentTarget, hasRental ? purchaseMode : 'purchase'));
}

async function renderStore() {
  const categoryKey = currentCategoryFromPath();
  let products = [], storefront = { whatsappNumber: '', heroProductIds: [], featuredProductIds: [] };
  try { ({ products, storefront } = await loadStoreData()); } catch { /* empty state */ }
  const productSlugPath = location.pathname.match(/^\/producto\/([^/]+)\/?$/);
  if (productSlugPath) { const product = products.find(item => productSlug(item) === decodeURIComponent(productSlugPath[1])); if (product) return renderProductDetail(product, products, storefront); }
  const productId = new URLSearchParams(location.search).get('producto');
  if (productId) { const product = getProduct(productId, products); if (product) return renderProductDetail(product, products, storefront); }
  if (categoryKey) return renderCategoryPage(categoryKey);
  return renderHome();
}

function productForm(product = {}, classifications = {}) {
  const images = Array.isArray(product.images) && product.images.length ? product.images : (product.image ? [product.image] : []);
  const selectedCategory = product.category || '';
  const brands = selectedCategory ? (classifications.brands?.[selectedCategory] || []) : [];
  const types = selectedCategory ? (classifications.productTypes?.[selectedCategory] || []) : [];
  const isCosplay = selectedCategory === 'cosplay';
  const locked = !selectedCategory;
  const lock = locked ? 'disabled' : '';
  return `<form id="productForm"><div class="form-grid">
    <div class="field full"><label for="category">Categoría / universo</label><select id="category" name="category" required><option value="">Elegir Categoría</option>${Object.entries(categories).filter(([key]) => key !== 'all').map(([key, label]) => `<option value="${key}" ${selectedCategory === key ? 'selected' : ''}>${label}</option>`).join('')}</select><small class="field-help">Las clasificaciones se administran abajo. Elige una categoría para habilitar el resto del formulario.</small></div>
    <div class="field"><label for="name">Nombre del producto</label><input id="name" name="name" required maxlength="90" ${lock} value="${escapeHTML(product.name || '')}"></div>
    <div class="field"><label for="sku">SKU</label><input id="sku" name="sku" required maxlength="40" pattern="[A-Za-z0-9._-]+" ${lock} value="${escapeHTML(product.sku || '')}"><small class="field-help">Código único del producto. Ejemplo: YH-TEC-001</small></div>
    <div class="field"><label for="brand">Marca</label><select id="brand" name="brand" ${lock}><option value="">Sin marca</option>${brands.map(v => `<option value="${escapeHTML(v)}" ${product.brand === v ? 'selected' : ''}>${escapeHTML(v)}</option>`).join('')}</select></div>
    <div class="field"><label for="productType">Tipo de producto</label><select id="productType" name="productType" ${lock}><option value="">Sin clasificación</option>${types.map(v => `<option value="${escapeHTML(v)}" ${product.productType === v ? 'selected' : ''}>${escapeHTML(v)}</option>`).join('')}</select></div>
    <div class="field"><label for="salePrice">Precio de venta (USD)</label><input id="salePrice" name="salePrice" required min="0" step="0.01" type="number" ${lock} value="${escapeHTML(product.salePrice ?? product.price ?? '')}"></div>
    <div class="field ${isCosplay ? '' : 'hidden'}"><label for="rentalPrice">Precio de alquiler (USD)</label><input id="rentalPrice" name="rentalPrice" ${isCosplay ? 'required' : ''} ${lock} min="0" step="0.01" type="number" value="${escapeHTML(product.rentalPrice ?? '')}"><small class="field-help">Disponible para productos de Cosplay.</small></div>
    <div class="field full"><span class="eyebrow image-section-label">Fotos del producto</span><small class="field-help">Puedes subir cada foto desde tu equipo o pegar directamente su URL.</small></div>
    ${[0,1,2,3].map((index) => {
      const num=index+1, id=index===0?'image':'image'+num, fileId=index===0?'imageFile':'imageFile'+num, label=index===0?'FOTO PRINCIPAL':'FOTO '+num, urlLabel=index===0?'URL de imagen principal':'Imagen adicional '+num+' · URL', currentImage=images[index] || (index===0 ? product.image || '' : ''), previewId=`productImagePreview${num}`;
      return `<div class="image-upload-row field full"><div class="image-upload-layout"><div class="image-upload-preview"><span>Foto referencial</span><div class="image-reference-preview"><img id="${previewId}" data-fallback src="${escapeHTML(currentImage || placeholder)}" alt="Vista previa ${escapeHTML(label)}"></div></div><div class="image-upload-file"><label for="${fileId}">SUBIR ${label} <small>(máx. 5 MB)</small></label><input id="${fileId}" name="${fileId}" type="file" ${lock} accept="image/jpeg,image/png,image/webp,image/gif"></div><div class="image-upload-url"><label for="${id}">${urlLabel}</label><input id="${id}" name="${id}" type="url" ${lock} placeholder="https://..." value="${escapeHTML(currentImage)}"></div></div></div>`;
    }).join('')}
    <div class="field full"><label for="description">Descripción completa</label><textarea id="description" name="description" required maxlength="2000" rows="9" ${lock}>${escapeHTML(product.description || '')}</textarea><small class="field-help">Puedes usar saltos de línea y emojis.</small></div>
    <div class="field featured-field"><label><input id="hero" name="hero" type="checkbox" ${lock} ${product.hero ? 'checked' : ''}> Usar en slider de portada</label><label><input id="featured" name="featured" type="checkbox" ${lock} ${product.featured ? 'checked' : ''}> Mostrar como destacado</label></div>
  </div><div class="form-actions"><button class="button" type="submit" ${lock}>${product.id ? 'Guardar cambios' : 'Crear producto'}</button><button class="button secondary ${product.id ? '' : 'hidden'}" type="button" id="cancelEdit">Cancelar</button><span class="message" id="formMessage"></span></div></form>`;
}
function selectionPanel(products, settings) {
  const heroIds = settings.heroProductIds || [];
  const featuredIds = settings.featuredProductIds || [];
  const heroSet = new Set(heroIds);
  const featuredSet = new Set(featuredIds);
  const heroOrderMap = new Map(heroIds.map((id, index) => [id, Number(products.find(p => p.id === id)?.heroOrder) > 0 ? Number(products.find(p => p.id === id).heroOrder) : index + 1]));
  const featuredOrderMap = new Map(featuredIds.map((id, index) => [id, index + 1]));

  // El orden guardado vive en storefront.json (heroProductIds / featuredProductIds).
  // Al recargar el administrador usamos ese orden para reconstruir la lista,
  // en lugar del orden original de products.json.
  const orderProducts = (items, ids) => {
    const rank = new Map(ids.map((id, index) => [id, index]));
    return [...items].sort((a, b) => {
      const aRank = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
      const bRank = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
      return aRank - bRank;
    });
  };

  const heroProducts = orderProducts(products, heroIds);
  const featuredProducts = orderProducts(products, featuredIds);
  const row = (p, type) => {
    const isHero = type === 'hero';
    const selected = isHero ? heroSet.has(p.id) : featuredSet.has(p.id);
    const order = isHero ? heroOrderMap.get(p.id) : featuredOrderMap.get(p.id);
    const mark = isHero ? '◆' : '✦';
    const label = isHero ? 'Usar' : 'Mostrar';
    const meta = isHero ? (categories[p.category] || '') : money(p.price);
    return `<div class="selection-row ${selected ? 'is-selected' : ''}" data-selection-row data-selection-name="${escapeHTML(`${p.name} ${p.sku || ''} ${p.brand || ''} ${categories[p.category] || ''}`.toLowerCase())}" draggable="${selected ? 'true' : 'false'}">
      <label class="selection-main">
        <input class="selection-toggle ${isHero ? 'hero-toggle' : 'featured-toggle'}" type="checkbox" data-${isHero ? 'hero' : 'featured'}-select="${escapeHTML(p.id)}" ${selected ? 'checked' : ''} aria-label="${label} ${escapeHTML(p.name)} ${isHero ? 'en portada' : 'como destacado'}">
        <span class="selection-mark" aria-hidden="true">${mark}</span>
        <img data-fallback src="${escapeHTML(productImages(p)[0])}" alt="">
        <span class="selection-copy"><strong>${escapeHTML(p.name)}</strong><small>${escapeHTML(meta)}</small></span>
      </label>
      <span class="selection-order" aria-label="${selected ? `Orden ${order || 1}` : 'No seleccionado'}"><span>Orden</span><b class="selection-order-number" data-order-number="${escapeHTML(p.id)}">${selected ? escapeHTML(order || 1) : '—'}</b><span class="drag-hint" aria-hidden="true">↕</span></span>
    </div>`;
  };
  return `<section class="admin-panel selection-panel" id="selectionPanel">
    <div class="section-heading"><div><span class="eyebrow">Experiencia de inicio</span><h2>Portada y productos destacados</h2></div><p>Busca productos, selecciónalos y arrástralos para definir el orden en que aparecerán.</p></div>
    <div class="selection-grid">
      <div>
        <div class="selection-heading-row"><div><h3>Slider de portada <small>máx. 6</small></h3><span class="selection-order-help">Arrastra para ordenar · se numera solo</span></div><label class="selection-search"><span aria-hidden="true">⌕</span><input type="search" id="heroSelectionSearch" placeholder="Buscar producto, SKU o marca…" autocomplete="off"><button type="button" id="clearHeroSelectionSearch" aria-label="Limpiar búsqueda">×</button></label></div>
        <div class="selection-list" id="heroSelectionList">${heroProducts.map(p => row(p, 'hero')).join('')}</div>
      </div>
      <div>
        <div class="selection-heading-row"><div><h3>Productos destacados <small>máx. 8</small></h3><span class="selection-order-help">Arrastra para ordenar · se numera solo</span></div><label class="selection-search"><span aria-hidden="true">⌕</span><input type="search" id="featuredSelectionSearch" placeholder="Buscar producto, SKU o marca…" autocomplete="off"><button type="button" id="clearFeaturedSelectionSearch" aria-label="Limpiar búsqueda">×</button></label></div>
        <div class="selection-list" id="featuredSelectionList">${featuredProducts.map(p => row(p, 'featured')).join('')}</div>
      </div>
    </div>
    <div class="form-actions"><button class="button" id="saveSelections">Guardar portada y destacados</button><span class="message" id="selectionMessage"></span></div>
  </section>`;
}


function classificationPanel(classifications) {
  return `<section class="admin-panel classification-panel" id="classificationPanel"><div class="section-heading"><div><span class="eyebrow">Organización</span><h2>Clasificaciones</h2></div><p>Crea tus propias marcas y tipos de producto por universo.</p></div>
    <div class="classification-grid">
      <div><h3>Marcas</h3><div class="classification-add"><select id="classBrandCategory">${Object.entries(categories).filter(([k])=>k!=='all').map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><input id="newBrand" maxlength="50" placeholder="Ej. Infinix"><button class="button small" id="addBrand">Agregar</button></div><div id="brandLists"></div></div>
      <div><h3>Tipos de producto</h3><div class="classification-add"><select id="classTypeCategory">${Object.entries(categories).filter(([k])=>k!=='all').map(([k,v])=>`<option value="${k}">${v}</option>`).join('')}</select><input id="newType" maxlength="50" placeholder="Ej. Celular"><button class="button small" id="addType">Agregar</button></div><div id="typeLists"></div></div>
    </div><span class="message" id="classificationMessage"></span>
  </section>`;
}

function ordersPanel(orders = [], canDelete = true) {
  const statuses = ['Pendiente', 'Confirmado', 'Preparando', 'Enviado', 'Entregado', 'Cancelado'];
  return `<section class="admin-panel orders-panel" id="ordersPanel">
    <div class="section-heading"><div><span class="eyebrow">Ventas</span><h2>Pedidos recibidos <small class="orders-count">${orders.length}</small></h2></div><p>Administra pedidos sin mezclarlos con el catálogo.</p></div>
    <div class="orders-toolbar">
      <label class="order-date-filter"><span>Fecha</span><input id="ordersDateFilter" type="date" aria-label="Filtrar pedidos por fecha"><button id="clearOrdersDate" type="button" title="Quitar fecha">×</button></label>
      <select id="ordersStatusFilter"><option value="">Todos los estados</option>${statuses.map(s => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('')}</select>
      <input id="ordersSearch" type="search" placeholder="Buscar por pedido, cliente, cédula/RUC, teléfono o SKU…" autocomplete="off">
    </div>
    <div id="adminOrdersList">${ordersListMarkup(orders, { canDelete })}</div>
  </section>`;
}
function ordersListMarkup(orders = [], options = {}) {
  const canDelete = options.canDelete !== false;
  const date = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' }); };
  const shortDate = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-EC', { day:'2-digit', month:'short', year:'numeric' }); };
  const statuses = ['Pendiente', 'Confirmado', 'Preparando', 'Enviado', 'Entregado', 'Cancelado'];
  if (!orders.length) return '<div class="empty">No hay pedidos que coincidan con los filtros.</div>';
  return orders.map(order => `<article class="admin-order admin-order-compact" data-order-search="${escapeHTML(`${order.orderNumber} ${order.customer?.name || ''} ${order.customer?.cedula || ''} ${order.customer?.phone || ''} ${order.customer?.email || ''} ${(order.items || []).map(i => `${i.sku} ${i.name}`).join(' ')}`.toLowerCase())}" data-order-status="${escapeHTML(order.status || '')}" data-order-date="${escapeHTML(String(order.createdAt || '').slice(0,10))}">
    <button type="button" class="admin-order-summary" data-order-toggle="${escapeHTML(order.id)}" aria-expanded="false">
      <span class="order-summary-date">${escapeHTML(shortDate(order.createdAt))}</span>
      <span class="order-summary-main"><strong>#${escapeHTML(order.orderNumber)}</strong><b>${escapeHTML(order.customer?.name || 'Cliente')}</b><small class="order-summary-item">${escapeHTML((order.items?.[0]?.quantity || 1) + '× ' + (order.items?.[0]?.name || 'Sin productos'))}${(order.items?.length || 0) > 1 ? ` · +${order.items.length - 1} más` : ''}</small></span>
      <span class="order-summary-total">${money(order.total)}</span>
      <span class="order-summary-status status-${statusClass(order.status || 'Pendiente')}">${escapeHTML(order.status || 'Pendiente')}</span>
      <span class="order-summary-chevron">⌄</span>
    </button>
    <div class="admin-order-details" id="orderDetails-${escapeHTML(order.id)}" hidden>
      <div class="admin-order-head"><div><span class="eyebrow">${escapeHTML(date(order.createdAt))}</span><h3>#${escapeHTML(order.orderNumber)}</h3><strong>${escapeHTML(order.customer?.name || 'Cliente')}</strong></div><div class="order-status-wrap"><label>Estado</label><select data-order-status="${escapeHTML(order.id)}">${statuses.map(s => `<option ${s === order.status ? 'selected' : ''} value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('')}</select></div></div>
      <div class="admin-order-grid"><div><span class="order-label">Contacto</span><p>${escapeHTML(order.customer?.phone || '—')}${order.customer?.email ? `<br>${escapeHTML(order.customer.email)}` : ''}<br><strong>Cédula / RUC:</strong> ${escapeHTML(order.customer?.cedula || '—')}</p></div><div><span class="order-label">Entrega</span><p><strong>${escapeHTML(order.delivery?.label || '—')}</strong><br>${escapeHTML(order.customer?.city || '—')}${order.customer?.address ? ` · ${escapeHTML(order.customer.address)}` : ''}${order.customer?.mapsUrl ? `<br><a href="${escapeHTML(order.customer.mapsUrl)}" target="_blank" rel="noopener">📍 Abrir ubicación en Google Maps</a>` : ''}</p></div><div><span class="order-label">Total</span><p class="order-total">${money(order.total)}</p><small>Subtotal ${money(order.subtotal ?? order.total)} · Envío ${money(order.shippingCost ?? 0)}</small></div></div>
      <div class="admin-order-items">${(order.items || []).map(item => `<div class="admin-order-item"><span><strong>${escapeHTML(item.quantity)}×</strong> ${escapeHTML(item.name)} <small>SKU: ${escapeHTML(item.sku || '—')} · ${item.purchaseMode === 'rental' ? 'Alquiler' : 'Compra'}</small></span><strong>${money(item.subtotal)}</strong></div>`).join('')}</div>
      ${order.customer?.notes ? `<div class="order-notes"><span>Nota</span><p>${escapeHTML(order.customer.notes)}</p></div>` : ''}
      <div class="admin-order-internal-note">
        <label for="internalNote-${escapeHTML(order.id)}">Nota interna</label>
        <textarea id="internalNote-${escapeHTML(order.id)}" data-order-note="${escapeHTML(order.id)}" rows="3" maxlength="5000" placeholder="Escribe aquí cualquier comentario interno sobre este pedido…" disabled>${escapeHTML(order.internalNote || '')}</textarea>
      </div>
      <div class="admin-order-footer">
        <button class="button success small" type="button" data-order-note-save="${escapeHTML(order.id)}" disabled>Guardar nota</button>
        <button class="button edit-note small" type="button" data-order-note-edit="${escapeHTML(order.id)}">Editar</button>
        ${canDelete ? `<button class="button danger small" type="button" data-order-delete="${escapeHTML(order.id)}">Eliminar pedido</button>` : ''}
      </div>
    </div>
  </article>`).join('');
}
async function renderAdminOrders() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated: false }));
  if (!session.authenticated) return renderLogin();
  let orders = await request('/api/admin/orders').catch(() => []);
  const sectionNav = (session.role === 'orders' || session.role === 'store_manager')
    ? `<nav class="admin-section-nav" aria-label="Secciones de administración"><a href="${ADMIN_PATH}/pedidos" class="admin-section-link active">PEDIDOS</a></nav>`
    : `<nav class="admin-section-nav" aria-label="Secciones de administración"><a href="${ADMIN_PATH}" class="admin-section-link">PÁGINA WEB</a><a href="${ADMIN_PATH}/usuarios" class="admin-section-link">USUARIOS</a><a href="${ADMIN_PATH}/pedidos" class="admin-section-link active">PEDIDOS</a></nav>`;
  app.innerHTML = `<main class="admin-shell"><div class="admin-wrap"><div class="admin-top"><div><a class="brand" href="/">YHORS</a><h1 class="admin-title">${(session.role === 'orders' || session.role === 'store_manager') ? 'Gestión de pedidos' : 'Administración'}</h1><p class="admin-subtitle">${session.role === 'orders' ? 'Panel exclusivo para pedidos de YHORS STORE' : (session.role === 'store_manager' ? 'Jefe de tienda · pedidos y control operativo' : 'Gestión de YHORS STORE')}</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>${sectionNav}${ordersPanel(orders, session.role === 'admin' || session.role === 'store_manager')}</div></main>`;
  const drawOrders = () => {
    const list=document.querySelector('#adminOrdersList'); if(!list) return;
    const query=(document.querySelector('#ordersSearch')?.value||'').trim().toLowerCase();
    const status=document.querySelector('#ordersStatusFilter')?.value||'';
    const dateFilter=(document.querySelector('#ordersDateFilter')?.value||'');
    const orderLocalDate = value => { const d=new Date(value); if(Number.isNaN(d.getTime())) return ''; return d.toLocaleDateString('en-CA',{timeZone:'America/Guayaquil'}); };
    const filtered=orders.filter(order=>(!dateFilter||orderLocalDate(order.createdAt)===dateFilter)&&(!status||order.status===status)&&(!query||`${order.orderNumber} ${order.customer?.name||''} ${order.customer?.cedula||''} ${order.customer?.phone||''} ${order.customer?.email||''} ${(order.items||[]).map(i=>`${i.sku} ${i.name}`).join(' ')}`.toLowerCase().includes(query)));
    list.innerHTML=ordersListMarkup(filtered, { canDelete: session.role === 'admin' });
    list.querySelectorAll('select[data-order-status]').forEach(select=>select.addEventListener('change',async()=>{
      const id = select.dataset.orderStatus;
      const newStatus = String(select.value || '').trim();
      const previous = orders.find(o=>o.id===id)?.status || '';
      select.disabled = true;
      try {
        const updated = await request(`/api/admin/orders/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:newStatus})});
        orders=orders.map(o=>o.id===updated.id?updated:o);
        // No redibujar toda la lista: así no se cierra el pedido ni se pierde la nota escrita.
        const card = select.closest('.admin-order');
        const badge = card?.querySelector('.order-summary-status');
        if (badge) {
          badge.textContent = updated.status;
          badge.className = `order-summary-status status-${statusClass(updated.status)}`;
        }
        select.className = `status-select-${statusClass(updated.status)}`;
        select.disabled = false;
      } catch(e) {
        select.value = previous;
        select.disabled = false;
        alert(e.message);
      }
    }));
    list.querySelectorAll('[data-order-toggle]').forEach(button=>button.addEventListener('click',()=>{ const details=document.querySelector(`#orderDetails-${button.dataset.orderToggle}`); if(!details) return; const opening=details.hidden; details.hidden=!opening; button.setAttribute('aria-expanded',String(opening)); button.closest('.admin-order')?.classList.toggle('is-open',opening); }));
    list.querySelectorAll('[data-order-note-edit]').forEach(button => button.addEventListener('click', () => {
      const id = button.dataset.orderNoteEdit;
      const textarea = list.querySelector(`[data-order-note="${id}"]`);
      const saveButton = list.querySelector(`[data-order-note-save="${id}"]`);
      if (!textarea || !saveButton) return;
      textarea.disabled = false;
      textarea.focus();
      button.disabled = true;
      button.textContent = 'Editando…';
      saveButton.disabled = false;
    }));
    list.querySelectorAll('[data-order-note-save]').forEach(button=>button.addEventListener('click',async()=>{
      const id=button.dataset.orderNoteSave;
      const textarea=list.querySelector(`[data-order-note="${id}"]`);
      const editButton=list.querySelector(`[data-order-note-edit="${id}"]`);
      if(!textarea || textarea.disabled) return;
      const original=button.textContent;
      button.disabled=true;
      try {
        const updated=await request(`/api/admin/orders/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({internalNote:textarea.value})});
        orders=orders.map(o=>o.id===updated.id?updated:o);
        textarea.value = updated.internalNote || '';
        textarea.disabled = true;
        if (editButton) {
          editButton.disabled = false;
          editButton.textContent = 'Editar';
        }
        button.textContent='Nota guardada ✓';
        setTimeout(()=>{button.textContent='Guardar nota';},1200);
      } catch(e) {
        button.disabled=false;
        alert(e.message);
      }
    }));
     list.querySelectorAll('[data-order-delete]').forEach(button=>button.addEventListener('click',async()=>{
      const order=orders.find(o=>o.id===button.dataset.orderDelete); if(!order) return;
      if(!confirm(`¿Eliminar el pedido #${order.orderNumber}? Esta acción no se puede deshacer.`)) return;
      try { await request(`/api/admin/orders/${order.id}`,{method:'DELETE'}); orders=orders.filter(o=>o.id!==order.id); drawOrders(); } catch(e){alert(e.message);}
    }));
  };
  document.querySelector('#ordersSearch')?.addEventListener('input',drawOrders);
  document.querySelector('#ordersStatusFilter')?.addEventListener('change',drawOrders);
   document.querySelector('#ordersDateFilter')?.addEventListener('change',drawOrders);
   document.querySelector('#clearOrdersDate')?.addEventListener('click',()=>{ const input=document.querySelector('#ordersDateFilter'); if(input){input.value='';drawOrders();} });
  wireAccountMenu();
  drawOrders();
}



function userRoleLabel(role) {
  return role === 'admin' ? 'Administrador' : (role === 'store_manager' ? 'Jefe de tienda' : 'Ventas / Pedidos');
}

function usersPanel(users = []) {
  const rows = users.map(user => `<article class="admin-user-card ${user.active ? '' : 'is-disabled'}">
    <div class="admin-user-main">
      <div class="admin-user-avatar">${escapeHTML((user.name || user.username || '?').slice(0,1).toUpperCase())}</div>
      <div>
        <strong>${escapeHTML(user.name || 'Sin nombre')}</strong>
        <span>@${escapeHTML(user.username)}</span>
        <small>${escapeHTML(userRoleLabel(user.role))} · ${user.active ? 'Activo' : 'Desactivado'}${user.system ? ' · Cuenta del sistema' : ''}</small>
      </div>
    </div>
    <div class="admin-user-actions">
      <button class="button secondary small" type="button" data-user-edit="${escapeHTML(user.id)}">Editar</button>
      <button class="button secondary small" type="button" data-user-passkey="${escapeHTML(user.id)}">${user.passkeyAllowed ? 'Bloquear Passkey' : 'Permitir Passkey'}</button>${user.passkeyCount ? `<button class="button secondary small" type="button" data-user-passkey-revoke="${escapeHTML(user.id)}">Revocar (${user.passkeyCount})</button>` : ''}
      ${!user.system ? `<button class="button danger small" type="button" data-user-delete="${escapeHTML(user.id)}">Eliminar</button>` : ''}
    </div>
  </article>`).join('');

  return `<section class="admin-panel users-panel" id="usersPanel">
    <div class="section-heading">
      <div><span class="eyebrow">Seguridad y acceso</span><h2>Usuarios</h2></div>
      <p>Crea y administra las cuentas que pueden entrar al panel de YHORS.</p>
    </div>
    <div class="users-layout">
      <form id="userForm" class="user-form">
        <input type="hidden" id="userId" name="id" value="">
        <div class="user-form-heading">
          <strong id="userFormTitle">Crear usuario</strong>
          <button class="button secondary small" id="userCancelEdit" type="button" hidden>Cancelar</button>
        </div>
        <div class="form-grid">
          <div class="field full"><label for="userName">Nombre completo</label><input id="userName" name="name" maxlength="100" required placeholder="Ej. Juan Pérez"></div>
          <div class="field"><label for="userUsername">Nombre de usuario</label><input id="userUsername" name="username" minlength="3" maxlength="40" pattern="[A-Za-z0-9._-]{3,40}" required placeholder="juan.ventas" autocomplete="off"><small class="field-help">Sin espacios. Usa letras, números, punto, guion o guion bajo.</small></div>
          <div class="field"><label for="userPassword">Contraseña <span id="userPasswordHint"></span></label><input id="userPassword" name="password" type="password" minlength="8" maxlength="200" placeholder="Mínimo 8 caracteres" autocomplete="new-password"><small class="field-help">La contraseña se guarda cifrada mediante hash; nunca se muestra en la lista.</small></div>
          <div class="field"><label for="userRole">Rol</label><select id="userRole" name="role"><option value="orders">Ventas / Pedidos</option><option value="store_manager">Jefe de tienda</option><option value="admin">Administrador</option></select></div>
          <div class="field"><label for="userActive">Estado</label><select id="userActive" name="active"><option value="true">Activo</option><option value="false">Desactivado</option></select></div>
        </div>
        <div id="userMessage" class="message" hidden></div>
        <div class="form-actions"><button class="button primary" id="userSubmit" type="submit">Crear usuario</button></div>
      </form>
      <div class="users-list-wrap">
        <div class="users-list-head"><div><span class="eyebrow">Cuentas existentes</span><strong id="usersCount">${users.length} usuario(s)</strong></div></div>
        <div id="adminUsersList">${rows || '<p class="backup-empty">No hay usuarios registrados.</p>'}</div>
      </div>
    </div>
  </section>`;
}

async function renderAdminUsers() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated: false }));
  if (!session.authenticated) return renderLogin();
  if (session.role !== 'admin') return renderAdminOrders();

  let users = await request('/api/admin/users').catch(() => []);
  app.innerHTML = `<main class="admin-shell"><div class="admin-wrap">
    <div class="admin-top"><div><a class="brand" href="/">YHORS</a><h1 class="admin-title">Administración</h1><p class="admin-subtitle">Control de usuarios y accesos</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>
    <nav class="admin-section-nav" aria-label="Secciones de administración"><a href="${ADMIN_PATH}" class="admin-section-link">PÁGINA WEB</a><a href="${ADMIN_PATH}/usuarios" class="admin-section-link active">USUARIOS</a><a href="${ADMIN_PATH}/pedidos" class="admin-section-link">PEDIDOS</a></nav>
    ${usersPanel(users)}
  </div></main>`;

  const form = document.querySelector('#userForm');
  const message = document.querySelector('#userMessage');
  const submit = document.querySelector('#userSubmit');
  const cancel = document.querySelector('#userCancelEdit');

  const resetForm = () => {
    form.reset();
    document.querySelector('#userId').value = '';
    document.querySelector('#userRole').value = 'orders';
    document.querySelector('#userActive').value = 'true';
    document.querySelector('#userPassword').required = true;
    document.querySelector('#userPasswordHint').textContent = '';
    document.querySelector('#userFormTitle').textContent = 'Crear usuario';
    submit.textContent = 'Crear usuario';
    cancel.hidden = true;
    message.hidden = true;
    message.textContent = '';
  };

  const editUser = user => {
    document.querySelector('#userId').value = user.id;
    document.querySelector('#userName').value = user.name || '';
    document.querySelector('#userUsername').value = user.username || '';
    document.querySelector('#userUsername').disabled = Boolean(user.system);
    document.querySelector('#userPassword').value = '';
    document.querySelector('#userPassword').required = false;
    document.querySelector('#userPasswordHint').textContent = '(dejar vacío para conservarla)';
    document.querySelector('#userRole').value = user.role;
    document.querySelector('#userActive').value = String(user.active);
    document.querySelector('#userFormTitle').textContent = 'Editar usuario';
    submit.textContent = 'Guardar cambios';
    cancel.hidden = false;
    message.hidden = true;
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  document.querySelector('#adminUsersList')?.querySelectorAll('[data-user-edit]').forEach(button => button.addEventListener('click', () => {
    const user = users.find(item => item.id === button.dataset.userEdit);
    if (user) editUser(user);
  }));

  document.querySelector('#adminUsersList')?.querySelectorAll('[data-user-delete]').forEach(button => button.addEventListener('click', async () => {
    const user = users.find(item => item.id === button.dataset.userDelete);
    if (!user || !confirm(`¿Eliminar el usuario “${user.name}” (@${user.username})? Esta acción no se puede deshacer.`)) return;
    try {
      await request(`/api/admin/users/${user.id}`, { method: 'DELETE' });
      users = users.filter(item => item.id !== user.id);
      await renderAdminUsers();
    } catch (error) { alert(error.message); }
  }));

  document.querySelector('#adminUsersList')?.querySelectorAll('[data-user-passkey]').forEach(button => button.addEventListener('click', async () => {
    const user = users.find(item => item.id === button.dataset.userPasskey); if (!user) return;
    try {
      const enabled = !user.passkeyAllowed;
      if (!enabled && user.passkeyCount && !confirm(`¿Bloquear el inicio con Passkey para “${user.username}”? Las Passkeys registradas se conservarán, pero no podrán utilizarse.`)) return;
      await request(`/api/admin/users/${encodeURIComponent(user.id)}/passkeys/policy`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) });
      await renderAdminUsers();
    } catch (error) { alert(error.message); }
  }));

  document.querySelector('#adminUsersList')?.querySelectorAll('[data-user-passkey-revoke]').forEach(button => button.addEventListener('click', async () => {
    const user = users.find(item => item.id === button.dataset.userPasskeyRevoke); if (!user) return;
    if (!confirm(`¿Revocar todas las Passkeys de “${user.username}”? El usuario conservará su contraseña.`)) return;
    try { await request(`/api/admin/users/${encodeURIComponent(user.id)}/passkeys`, { method: 'DELETE' }); await renderAdminUsers(); } catch (error) { alert(error.message); }
  }));

  cancel?.addEventListener('click', resetForm);
  wireAccountMenu();

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const formData = new FormData(form);
    const id = String(formData.get('id') || '');
    const payload = {
      name: String(formData.get('name') || ''),
      username: String(formData.get('username') || ''),
      password: String(formData.get('password') || ''),
      role: String(formData.get('role') || 'orders'),
      active: String(formData.get('active')) === 'true'
    };
    if (!id && !payload.password) {
      message.hidden = false; message.className = 'message error'; message.textContent = 'La contraseña es obligatoria al crear un usuario.'; return;
    }
    submit.disabled = true;
    message.hidden = true;
    try {
      const saved = await request(id ? `/api/admin/users/${id}` : '/api/admin/users', {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (id) users = users.map(user => user.id === saved.id ? saved : user);
      else users = [...users, saved];
      await renderAdminUsers();
    } catch (error) {
      message.hidden = false; message.className = 'message error'; message.textContent = error.message;
      submit.disabled = false;
    }
  });
}

function backupPanel(data = null) {
  const persistent = data?.storageMode === 'persistent';
  const backups = Array.isArray(data?.backups) ? data.backups : [];
  const total = backups.length;
  return `<section class="admin-panel backup-panel is-collapsed" id="backupPanel">
    <div class="backup-panel-head">
      <button class="backup-collapse-toggle" type="button" id="backupCollapseToggle" aria-expanded="false">
        <span class="backup-title-wrap">
          <span class="eyebrow">Seguridad de datos</span>
          <strong>BACKUPS</strong>
          <small>${total ? `${total} respaldo(s) disponible(s)` : 'Sin respaldos todavía'}</small>
        </span>
        <span class="backup-chevron">⌄</span>
      </button>
      <div class="backup-status ${persistent ? 'is-ok' : 'is-warning'}">
        <strong>${persistent ? 'ALMACENAMIENTO PERSISTENTE' : 'ALMACENAMIENTO LOCAL'}</strong>
        <span>${persistent ? 'Render conservará los datos entre despliegues y reinicios.' : 'Configura el disco persistente de Render antes de producción.'}</span>
      </div>
    </div>
    <div class="backup-panel-body">
      <p class="admin-help">Los respaldos protegen productos, pedidos, clasificaciones, portada y fotografías. Se conserva un máximo de ${escapeHTML(data?.retention || 30)} respaldos. Puedes descargar un respaldo o subir uno anterior para restaurarlo.</p>
      <div class="backup-actions backup-main-actions">
        <button class="button" type="button" id="createBackup">Crear respaldo ahora</button>
        <button class="button secondary" type="button" id="uploadBackupButton">Subir respaldo</button>
        <input id="backupUploadInput" type="file" accept=".tar.gz,.tgz,application/gzip" hidden>
        <span class="backup-last" id="backupLast">${backups[0] ? `Último respaldo: ${formatBackupDate(backups[0].createdAt)}` : 'Todavía no hay respaldos.'}</span>
      </div>
      <div class="backup-upload-help">Acepta archivos <strong>.tar.gz</strong> o <strong>.tgz</strong> descargados desde YHORS. Al subirlo, se crea primero un respaldo de seguridad y luego se restaura el archivo.</div>
      <div class="backup-list" id="backupList">
        ${backups.length ? backups.map((item, index) => {
          const isNewest = index === 0;
          const isOldest = index === total - 1;
          const marker = isNewest && isOldest ? 'MÁS RECIENTE · MÁS ANTIGUO' : isNewest ? 'MÁS RECIENTE' : isOldest ? 'MÁS ANTIGUO' : '';
          const position = item.position || (total - index);
          return `<div class="backup-row ${isNewest ? 'is-newest' : ''} ${isOldest ? 'is-oldest' : ''}">
            <div class="backup-row-info">
              <div class="backup-row-title">
                <strong>Backup #${escapeHTML(position)} de ${escapeHTML(item.total || total)}</strong>
                ${marker ? `<span class="backup-age-badge">${marker}</span>` : ''}
              </div>
              <small>Creado: <b>${escapeHTML(formatBackupDate(item.createdAt))}</b> · ${escapeHTML(item.reason === 'automatico' ? 'Automático' : item.reason === 'antes-de-restaurar' ? 'Seguridad antes de restaurar' : 'Manual')}</small>
              <small class="backup-file-name">${escapeHTML(item.name)}</small>
            </div>
            <div class="backup-row-actions">
              <button class="button secondary small" type="button" data-backup-download="${escapeHTML(item.name)}">Descargar</button>
              <button class="button danger small" type="button" data-backup-delete="${escapeHTML(item.name)}">Eliminar</button>
            </div>
          </div>`;
        }).join('') : '<p class="backup-empty">No hay respaldos todavía.</p>'}
      </div>
    </div>
  </section>`;
}
function formatBackupDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Fecha no disponible';
  const parts = new Intl.DateTimeFormat('es-EC', {
    timeZone: 'America/Guayaquil',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(date).reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
  return `${parts.day}-${parts.month}-${parts.year}-${parts.hour}${parts.minute}`;
}

async function renderAdmin() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated: false })); if (!session.authenticated) return renderLogin(); if (session.role === 'orders') return renderAdminOrders();
  let products = await request('/api/admin/products').catch(() => []); let classifications = await request('/api/admin/classifications').catch(() => ({ brands: {}, productTypes: {} })); let settings = await request('/api/admin/storefront').catch(() => ({ heroProductIds: [], featuredProductIds: [] })); let editing = null;
  const backupState = await request('/api/admin/backups').catch(() => ({ storageMode: 'local', backups: [], retention: 30 }));
  app.innerHTML = `<main class="admin-shell"><aside class="admin-quick-nav" aria-label="Navegación rápida">
    <strong>YHORS</strong>
    <button type="button" data-admin-scroll="backupPanel">Backup</button>
    <button type="button" data-admin-scroll="selectionPanel">Portada</button>
    <button type="button" data-admin-scroll="classificationPanel">Categorías</button>
    <button type="button" data-admin-scroll="productEditorPanel">Producto</button>
    <button type="button" data-admin-scroll="inventoryPanel">Inventario</button>
  </aside><div class="admin-wrap"><div class="admin-top"><div><a class="brand" href="/">YHORS</a><h1 class="admin-title">Administración</h1></div><div class="admin-top-actions">${accountMenu(session)}</div></div><nav class="admin-section-nav" aria-label="Secciones de administración"><a href="${ADMIN_PATH}" class="admin-section-link active">PÁGINA WEB</a><a href="${ADMIN_PATH}/usuarios" class="admin-section-link">USUARIOS</a><a href="${ADMIN_PATH}/pedidos" class="admin-section-link">PEDIDOS</a></nav>${backupPanel(backupState)}${selectionPanel(products, settings)}${classificationPanel(classifications)}<section class="admin-panel product-editor-panel" id="productEditorPanel"><span class="eyebrow">Catálogo</span><h2 id="formTitle">Agregar producto</h2><div id="formArea"></div></section><section class="admin-products" id="inventoryPanel"><div class="section-heading inventory-heading"><div><span class="eyebrow">Inventario</span><h2>Productos publicados (${products.length})</h2></div><p>Edita datos, imágenes, portada y destacados.</p></div><div class="inventory-toolbar"><label class="inventory-search"><span aria-hidden="true">⌕</span><input id="inventorySearch" type="search" placeholder="Buscar por nombre, SKU, marca o categoría…" autocomplete="off"><button id="clearInventorySearch" type="button" aria-label="Limpiar búsqueda">×</button></label><span class="inventory-count" id="inventoryCount">${products.length} productos</span></div><div id="adminProducts"></div></section></div></main>`;
  const quickNav = document.querySelector('.admin-quick-nav');
  quickNav?.querySelectorAll('[data-admin-scroll]').forEach(button => button.addEventListener('click', () => {
    const target = document.getElementById(button.dataset.adminScroll);
    if (!target) return;
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    quickNav.querySelectorAll('[data-admin-scroll]').forEach(item => item.classList.remove('is-active'));
    button.classList.add('is-active');
  }));
  const formArea = document.querySelector('#formArea'); const listArea = document.querySelector('#adminProducts');
  function drawList() {
    const categoryKeys = Object.keys(categories).filter(k => k !== 'all');
    const query = (document.querySelector('#inventorySearch')?.value || '').trim().toLowerCase();
    const matches = products.filter(p => {
      if (!query) return true;
      return [p.name, p.sku, p.brand, p.productType, p.category, categories[p.category], productMeta(p)].filter(Boolean).some(value => String(value).toLowerCase().includes(query));
    });
    const count = document.querySelector('#inventoryCount');
    if (count) count.textContent = query ? `${matches.length} de ${products.length} productos` : `${products.length} productos`;
    listArea.innerHTML = matches.length ? categoryKeys.map(key => {
      const group = matches.filter(p => p.category === key);
      if (!group.length) return '';
      return `<section class="admin-category-group"><div class="admin-category-heading"><span class="eyebrow">Universo</span><h3>${escapeHTML(categories[key])} <small>${group.length}</small></h3></div>${group.map(p => `<article class="admin-product"><img data-fallback src="${escapeHTML(productImages(p)[0])}" alt=""><div><h3>${escapeHTML(p.name)} ${p.featured ? '<span class="featured-star">★ Destacado</span>' : ''} ${p.hero ? '<span class="hero-tag">◆ Portada</span>' : ''}</h3><p><strong class="admin-sku">SKU: ${escapeHTML(p.sku || '—')}</strong> · ${escapeHTML(categories[p.category] || p.category)}${productMeta(p) ? ` · ${escapeHTML(productMeta(p))}` : ''} · Venta ${productPriceLabel(p)}${p.category === 'cosplay' && p.rentalPrice !== null && p.rentalPrice !== undefined && p.rentalPrice !== '' ? ` · Alquiler ${money(p.rentalPrice)}` : ''} · ${productImages(p).length} imagen(es)</p></div><div class="admin-actions"><button class="button secondary small yhors-edit-note" data-edit="${escapeHTML(p.id)}">Editar</button><button class="button danger small" data-delete="${escapeHTML(p.id)}">Eliminar</button></div></article>`).join('')}</section>`;
    }).join('') : `<div class="empty">${query ? 'No encontramos productos con esa búsqueda.' : 'No hay productos aún.'}</div>`;
    wireImageFallback(listArea);
    listArea.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => { editing = products.find(p => p.id === b.dataset.edit); drawForm(); requestAnimationFrame(() => document.querySelector('#productEditorPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }));
    listArea.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', async () => { const product = products.find(p => p.id === b.dataset.delete); if (!confirm(`¿Eliminar “${product.name}”? Esta acción no se puede deshacer.`)) return; try { await request(`/api/admin/products/${product.id}`, { method: 'DELETE' }); products = products.filter(p => p.id !== product.id); settings.heroProductIds = settings.heroProductIds.filter(id => id !== product.id); settings.featuredProductIds = settings.featuredProductIds.filter(id => id !== product.id); await request('/api/admin/storefront', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }); drawList(); drawSelectionPanel(); drawForm(); } catch (e) { alert(e.message); } }));
  }
  document.querySelector('#inventorySearch')?.addEventListener('input', drawList);
  document.querySelector('#clearInventorySearch')?.addEventListener('click', () => { const input = document.querySelector('#inventorySearch'); if (!input) return; input.value = ''; input.focus(); drawList(); });
  function drawSelectionPanel() { document.querySelector('.selection-panel')?.remove(); const anchor = document.querySelector('.admin-top'); anchor.insertAdjacentHTML('afterend', selectionPanel(products, settings)); bindSelectionEvents(); }
  function bindSelectionEvents() {
    const panel = document.querySelector('.selection-panel');
    if (!panel) return;
    wireImageFallback(panel);
    const wireSearch = (inputId, listId, clearId) => {
      const input = document.querySelector(inputId);
      const list = document.querySelector(listId);
      const clear = document.querySelector(clearId);
      const apply = () => {
        const query = (input?.value || '').trim().toLowerCase();
        list?.querySelectorAll('[data-selection-row]').forEach(row => {
          row.hidden = Boolean(query) && !String(row.dataset.selectionName || '').includes(query);
        });
      };
      input?.addEventListener('input', apply);
      clear?.addEventListener('click', () => { if (input) { input.value = ''; input.focus(); apply(); } });
    };
    wireSearch('#heroSelectionSearch', '#heroSelectionList', '#clearHeroSelectionSearch');
    wireSearch('#featuredSelectionSearch', '#featuredSelectionList', '#clearFeaturedSelectionSearch');

    const renumberSelectionRows = (listId) => {
      const list = document.querySelector(listId);
      if (!list) return;

      // Los seleccionados quedan siempre ANCLADOS ARRIBA.
      // Dentro de ese bloque se conserva exactamente el orden conseguido
      // con el arrastre. Los no seleccionados quedan debajo.
      const rows = [...list.querySelectorAll('.selection-row')];
      const selectedRows = rows.filter(row => row.querySelector('.selection-toggle')?.checked);
      const unselectedRows = rows.filter(row => !row.querySelector('.selection-toggle')?.checked);
      [...selectedRows, ...unselectedRows].forEach(row => list.appendChild(row));

      let number = 1;
      [...selectedRows, ...unselectedRows].forEach(row => {
        const toggle = row.querySelector('.selection-toggle');
        const badge = row.querySelector('.selection-order-number');
        const order = row.querySelector('.selection-order');
        const selected = Boolean(toggle?.checked);
        row.classList.toggle('is-selected', selected);
        row.draggable = selected;
        if (badge) badge.textContent = selected ? String(number++) : '—';
        if (order) order.setAttribute('aria-label', selected ? `Orden ${number - 1}` : 'No seleccionado');
      });
    };

    const moveDraggedRow = (list, dragged, target, before) => {
      if (!list || !dragged || !target || dragged === target) return;
      if (before) list.insertBefore(dragged, target);
      else list.insertBefore(dragged, target.nextSibling);
    };

    const wireDragReorder = (listId) => {
      const list = document.querySelector(listId);
      if (!list) return;
      let draggedRow = null;

      list.querySelectorAll('.selection-row').forEach(row => {
        row.addEventListener('dragstart', e => {
          if (!row.querySelector('.selection-toggle')?.checked) {
            e.preventDefault();
            return;
          }
          draggedRow = row;
          row.classList.add('dragging');
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', row.dataset.selectionName || '');
        });

        row.addEventListener('dragend', () => {
          row.classList.remove('dragging');
          list.querySelectorAll('.drag-over').forEach(item => item.classList.remove('drag-over'));
          draggedRow = null;
          renumberSelectionRows(listId);
        });

        row.addEventListener('dragover', e => {
          if (!draggedRow || draggedRow === row || !row.querySelector('.selection-toggle')?.checked) return;
          e.preventDefault();
          const rect = row.getBoundingClientRect();
          const before = e.clientY < rect.top + rect.height / 2;
          list.querySelectorAll('.drag-over').forEach(item => item.classList.remove('drag-over'));
          row.classList.add('drag-over');
          moveDraggedRow(list, draggedRow, row, before);
        });

        row.addEventListener('drop', e => {
          if (!draggedRow) return;
          e.preventDefault();
          row.classList.remove('drag-over');
          renumberSelectionRows(listId);
        });
      });
    };

    // Evita que el navegador haga scroll automático al checkbox oculto.
    // La selección se realiza manualmente y la página conserva exactamente su posición.
    panel.querySelectorAll('.selection-main').forEach(label => {
      label.addEventListener('click', e => {
        if (e.target.closest('.selection-order')) return;
        e.preventDefault();
        const toggle = label.querySelector('.selection-toggle');
        if (!toggle) return;
        toggle.checked = !toggle.checked;
        toggle.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    panel.querySelectorAll('.selection-toggle').forEach(toggle => {
      toggle.addEventListener('change', () => {
        const row = toggle.closest('.selection-row');
        const listId = toggle.dataset.heroSelect ? '#heroSelectionList' : '#featuredSelectionList';
        const list = document.querySelector(listId);
        if (!list || !row) return;

        if (toggle.checked) {
          // Al seleccionar, el producto queda inmediatamente dentro del bloque
          // de seleccionados y pasa a ser el último número de ese bloque.
          const selectedRows = [...list.querySelectorAll('.selection-row')]
            .filter(item => item !== row && item.querySelector('.selection-toggle')?.checked);
          const lastSelected = selectedRows[selectedRows.length - 1];
          if (lastSelected) list.insertBefore(row, lastSelected.nextSibling);
          else list.insertBefore(row, list.firstElementChild);
        } else {
          // Al quitar la selección, baja automáticamente debajo de todos
          // los seleccionados y los números se reajustan.
          list.appendChild(row);
        }
        renumberSelectionRows(listId);
      });
    });

    renumberSelectionRows('#heroSelectionList');
    renumberSelectionRows('#featuredSelectionList');
    wireDragReorder('#heroSelectionList');
    wireDragReorder('#featuredSelectionList');

    document.querySelector('#saveSelections')?.addEventListener('click', async () => {
      const message = document.querySelector('#selectionMessage');
      const heroChecked = [...panel.querySelectorAll('[data-hero-select]:checked')];
      const featuredChecked = [...panel.querySelectorAll('[data-featured-select]:checked')];
      if (heroChecked.length > 6 || featuredChecked.length > 8) { message.className = 'message error'; message.textContent = 'Máximo: 6 imágenes en portada y 8 productos destacados.'; return; }

      const sortByOrder = (items, attr) => {
        const listId = attr === 'hero' ? '#heroSelectionList' : '#featuredSelectionList';
        const orderedRows = [...panel.querySelectorAll(`${listId} .selection-row`)]
          .filter(row => row.querySelector('.selection-toggle')?.checked);
        return orderedRows.map((row, index) => ({
          id: row.querySelector(`[data-${attr}-select]`).dataset[`${attr}Select`],
          order: index + 1,
          index
        }));
      };

      const heroOrdered = sortByOrder(heroChecked, 'hero');
      const featuredOrdered = sortByOrder(featuredChecked, 'featured');
      const heroProductIds = heroOrdered.map(item => item.id);
      const featuredProductIds = featuredOrdered.map(item => item.id);
      try {
        await request('/api/admin/storefront', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ heroProductIds, featuredProductIds }) });
        settings = { heroProductIds, featuredProductIds };
        products = products.map(p => ({
          ...p,
          hero: heroProductIds.includes(p.id),
          featured: featuredProductIds.includes(p.id)
        }));
        showSaveSuccess(message, 'Portada y destacados guardados con el orden indicado.');
        drawList();
      } catch (e) { message.className = 'message error'; message.textContent = e.message; }
    });
  }
  function renderClassifications() {
    const render = (target, values, type) => {
      const container = document.querySelector(target);
      if (!container) return;
      container.innerHTML = Object.entries(values || {}).filter(([, list]) => Array.isArray(list) && list.length).map(([cat, list]) => `<div class="classification-group"><strong>${escapeHTML(categories[cat])}</strong><div class="classification-chips">${list.map((v,i)=>`<span class="classification-chip"><span class="classification-chip-text">${escapeHTML(v)}</span><button type="button" class="classification-edit" data-edit-class="${type}" data-category="${escapeHTML(cat)}" data-index="${i}" title="Editar">✎</button><button type="button" class="classification-delete" data-remove-class="${type}" data-category="${escapeHTML(cat)}" data-index="${i}" title="Eliminar">×</button></span>`).join('')}</div></div>`).join('') || '<small class="field-help">Todavía no hay clasificaciones.</small>';
      container.querySelectorAll('[data-remove-class]').forEach(btn => btn.addEventListener('click', async () => { classifications[btn.dataset.removeClass][btn.dataset.category].splice(Number(btn.dataset.index), 1); await saveClassifications(); }));
      container.querySelectorAll('[data-edit-class]').forEach(btn => btn.addEventListener('click', async () => {
        const key=btn.dataset.editClass, cat=btn.dataset.category, index=Number(btn.dataset.index), current=classifications[key]?.[cat]?.[index] || '';
        const value=window.prompt('Editar clasificación:', current);
        if (value === null) return;
        const clean=value.trim().slice(0,50);
        if (!clean) return;
        const duplicate=classifications[key][cat].some((v,i)=>i!==index && v.toLowerCase()===clean.toLowerCase());
        if (duplicate) { alert('Ya existe una clasificación con ese nombre en esta categoría.'); return; }
        classifications[key][cat][index]=clean; await saveClassifications();
      }));
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
  function showSaveSuccess(messageElement, text) {
    if (!messageElement) return;
    if (messageElement._successTimer) clearTimeout(messageElement._successTimer);
    messageElement.className = 'message success save-success';
    messageElement.innerHTML = `<span class="save-check" aria-hidden="true">✓</span><span>${escapeHTML(text)}</span>`;
    messageElement.classList.remove('save-pop');
    void messageElement.offsetWidth;
    messageElement.classList.add('save-pop');
    messageElement._successTimer = setTimeout(() => {
      messageElement.classList.remove('save-pop');
      messageElement.classList.add('save-fade-out');
      setTimeout(() => { messageElement.textContent = ''; messageElement.className = 'message'; }, 350);
    }, 3000);
  }

  function drawForm(draft = editing || {}) {
    formArea.innerHTML = productForm(draft, classifications);
    wireImageFallback(formArea);
    document.querySelector('#formTitle').textContent = editing ? `Editar: ${editing.name}` : 'Agregar producto';
    const imageUrl = document.querySelector('#image');
    const imageFile = document.querySelector('#imageFile');
    const preview = document.querySelector('#productImagePreview');
    const previewName = document.querySelector('.product-editor-preview-copy strong');
    const updatePreview = (src) => {
      if (!preview) return;
      preview.src = src || placeholder;
      preview.alt = imageUrl?.value ? `Vista previa de ${draft.name || 'producto'}` : 'Vista previa del producto';
    };
    imageUrl?.addEventListener('input', () => updatePreview(imageUrl.value.trim()));
    imageFile?.addEventListener('change', () => {
      const file = imageFile.files?.[0];
      if (!file) return;
      const objectUrl = URL.createObjectURL(file);
      updatePreview(objectUrl);
      preview?.addEventListener('load', () => URL.revokeObjectURL(objectUrl), { once: true });
    });
    document.querySelector('#name')?.addEventListener('input', e => { if (previewName) previewName.textContent = e.target.value.trim() || 'Nuevo producto'; });
    document.querySelector('#cancelEdit')?.addEventListener('click', () => { editing = null; drawForm(); });
    document.querySelector('#category')?.addEventListener('change', event => drawForm({ ...(editing || {}), category: event.target.value }));
    document.querySelector('#productForm').addEventListener('submit', async event => {
      event.preventDefault(); const form = event.currentTarget; const submit = form.querySelector('[type="submit"]'); const message = document.querySelector('#formMessage');
      if (!form.elements.category.value) { message.className='message error'; message.textContent='Selecciona una categoría antes de guardar el producto.'; form.elements.category.focus(); return; }
      submit.disabled = true; message.textContent = 'Guardando…';
      try {
        const data = Object.fromEntries(new FormData(form).entries()); delete data.heroOrder; data.featured = form.elements.featured.checked; data.hero = form.elements.hero.checked; data.price = data.salePrice; data.images = [data.image, data.image2, data.image3, data.image4].filter(Boolean);
        const fileFields = ['imageFile','imageFile2','imageFile3','imageFile4'];
         for (let index = 0; index < fileFields.length; index++) {
           const file = form.elements[fileFields[index]]?.files?.[0];
           if (!file) continue;
           const uploadData = new FormData(); uploadData.append('image', file);
           const uploaded = await request('/api/admin/upload', { method: 'POST', body: uploadData });
           const urlField = index === 0 ? 'image' : `image${index+1}`;
           data[urlField] = uploaded.image;
           data.images[index] = uploaded.image;
         }
         data.images = data.images.filter(Boolean);
         data.image = data.images[0] || '';
        const url = editing ? `/api/admin/products/${editing.id}` : '/api/admin/products';
        const product = await request(url, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        products = editing ? products.map(p => p.id === product.id ? product : p) : [product, ...products];
        const heroIds = new Set(settings.heroProductIds); const featuredIds = new Set(settings.featuredProductIds); product.hero ? heroIds.add(product.id) : heroIds.delete(product.id); product.featured ? featuredIds.add(product.id) : featuredIds.delete(product.id);
        settings = { heroProductIds: [...heroIds].slice(0, 6), featuredProductIds: [...featuredIds].slice(0, 8) };
        await request('/api/admin/storefront', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) });
        products = products.map(p => p.id === product.id ? { ...p, hero: settings.heroProductIds.includes(p.id), featured: settings.featuredProductIds.includes(p.id) } : p);
        showSaveSuccess(message, editing ? 'Cambios guardados correctamente.' : 'Producto creado correctamente.');
        editing = null; drawList(); drawSelectionPanel();
        setTimeout(() => drawForm(), 650);
      } catch (e) { message.className = 'message error'; message.textContent = e.message; submit.disabled = false; }
    });
  }

  async function refreshBackups() {
    const state = await request('/api/admin/backups');
    const panel = document.querySelector('#backupPanel');
    if (!panel) return;
    const replacement = document.createRange().createContextualFragment(backupPanel(state));
    panel.replaceWith(replacement);
    bindBackupEvents();
  }
  function bindBackupEvents() {
    const backupPanel = document.querySelector('#backupPanel');
    const collapseButton = document.querySelector('#backupCollapseToggle');
    collapseButton?.addEventListener('click', () => {
      const collapsed = backupPanel?.classList.toggle('is-collapsed');
      collapseButton.setAttribute('aria-expanded', String(!collapsed));
    });
    document.querySelector('#createBackup')?.addEventListener('click', async () => {
      const button = document.querySelector('#createBackup');
      if (!button) return;
      const original = button.textContent;
      button.disabled = true;
      button.textContent = 'Creando respaldo…';
      try {
        await request('/api/admin/backups', { method: 'POST' });
        await refreshBackups();
      } catch (e) {
        alert(e.message);
        button.disabled = false;
        button.textContent = original;
      }
    });
    document.querySelectorAll('[data-backup-download]').forEach(button => {
      button.addEventListener('click', () => {
        const name = button.dataset.backupDownload;
        window.location.href = `/api/admin/backups/${encodeURIComponent(name)}/download`;
      });
    });
    const uploadButton = document.querySelector('#uploadBackupButton');
    const uploadInput = document.querySelector('#backupUploadInput');
    uploadButton?.addEventListener('click', () => uploadInput?.click());
    uploadInput?.addEventListener('change', async () => {
      const file = uploadInput.files?.[0];
      if (!file) return;
      const confirmed = confirm(`¿Subir y restaurar "${file.name}"?\n\nSe reemplazarán los datos actuales de YHORS por los del respaldo. Antes de hacerlo, el sistema creará automáticamente un respaldo de seguridad del estado actual.\n\nSi el archivo fue creado con otra YHORS_DATA_KEY, la restauración será rechazada para proteger tus pedidos.\n\n¿Deseas continuar?`);
      if (!confirmed) { uploadInput.value = ''; return; }
      uploadButton.disabled = true;
      uploadButton.textContent = 'Subiendo y restaurando…';
      try {
        const formData = new FormData();
        formData.append('backup', file);
        const result = await request('/api/admin/backups/upload', { method: 'POST', body: formData });
        await refreshBackups();
        alert(`Respaldo restaurado correctamente.\n\nSe creó el respaldo de seguridad ${result.safetyBackup?.name || 'antes de restaurar'} por si necesitas volver al estado anterior.`);
      } catch (e) {
        alert(e.message);
      } finally {
        uploadInput.value = '';
        uploadButton.disabled = false;
        uploadButton.textContent = 'Subir respaldo';
      }
    });

    document.querySelectorAll('[data-backup-delete]').forEach(button => {
      button.addEventListener('click', async () => {
        const name = button.dataset.backupDelete;
        if (!confirm(`¿Eliminar el backup ${name}? Esta acción no se puede deshacer.`)) return;
        button.disabled = true;
        try {
          await request(`/api/admin/backups/${encodeURIComponent(name)}`, { method: 'DELETE' });
          await refreshBackups();
        } catch (e) {
          button.disabled = false;
          alert(e.message);
        }
      });
    });
  }

  wireAccountMenu();
  bindBackupEvents();
  drawList(); renderClassifications(); bindClassificationEvents(); drawForm(); bindSelectionEvents();
  const quickTargets = [...document.querySelectorAll('[data-admin-scroll]')].map(button => ({ button, target: document.getElementById(button.dataset.adminScroll) })).filter(item => item.target);
  if ('IntersectionObserver' in window && quickTargets.length) {
    const observer = new IntersectionObserver(entries => {
      const visible = entries.filter(entry => entry.isIntersecting).sort((a,b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (!visible) return;
      quickTargets.forEach(item => item.button.classList.toggle('is-active', item.target === visible.target));
    }, { rootMargin: '-18% 0px -65% 0px', threshold: [0.1, 0.35, 0.6] });
    quickTargets.forEach(item => observer.observe(item.target));
  }
}
async function registerMyPasskey() {
  const options = await request('/api/me/passkeys/options');
  const credential = await nativeStartRegistration(options);
  const deviceName = prompt('Nombre para este dispositivo (opcional):', 'Este dispositivo') || 'Este dispositivo';
  credential.deviceName = deviceName.slice(0, 80);
  await request('/api/me/passkeys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credential) });
  alert('Passkey registrada correctamente. Ahora puedes usar Windows Hello, huella, Face ID o el método compatible de tu dispositivo.');
  await renderMyAccount();
}

async function loginWithPasskey() {
  const options = await request('/api/passkey/options');
  const assertion = await nativeStartAuthentication(options);
  await request('/api/passkey/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(assertion) });
  const session = await request('/api/admin/session');
  if (session.role === 'orders' || session.role === 'store_manager') renderAdminOrders(); else renderAdmin();
}

async function renderMyAccount() {
  const me = await request('/api/me').catch(() => null); if (!me) return renderLogin();
  const passkeys = me.passkeys || [];
  app.innerHTML = `<main class="admin-shell"><div class="admin-wrap">
    <div class="admin-top"><div><a class="brand" href="/">YHORS</a><h1 class="admin-title">Mi cuenta</h1><p class="admin-subtitle">Datos y métodos de inicio de sesión</p></div><div class="admin-top-actions">${accountMenu(me)}</div></div>
    <section class="admin-panel users-panel"><div class="section-heading"><div><span class="eyebrow">Cuenta</span><h2>${escapeHTML(me.name)}</h2></div><p>@${escapeHTML(me.username)} · ${escapeHTML(userRoleLabel(me.role))}</p></div>
      <div class="form-grid"><div class="field"><label>Nombre</label><input value="${escapeHTML(me.name)}" disabled></div><div class="field"><label>Usuario</label><input value="${escapeHTML(me.username)}" disabled></div></div>
      <hr><div class="section-heading"><div><span class="eyebrow">Contraseña</span><h2>Cambiar contraseña</h2></div></div>
      <form id="changePasswordForm" class="form-grid"><div class="field"><label>Contraseña actual</label><input name="currentPassword" type="password" autocomplete="current-password" required></div><div class="field"><label>Nueva contraseña</label><input name="newPassword" type="password" minlength="8" maxlength="200" autocomplete="new-password" required></div><div class="form-actions"><button class="button" type="submit">Actualizar contraseña</button><span class="message" id="passwordMessage"></span></div></form>
      <hr><div class="section-heading"><div><span class="eyebrow">Inicio de sesión moderno</span><h2>Passkeys</h2></div><p>Windows Hello, huella, Face ID o el método seguro compatible con tu dispositivo.</p></div>
      <div id="myPasskeys">${passkeys.length ? passkeys.map(pk => `<div class="admin-user-card"><div><strong>🔐 ${escapeHTML(pk.name || 'Passkey')}</strong><small>Registrada ${escapeHTML(new Date(pk.createdAt).toLocaleString())}${pk.lastUsedAt ? ` · Último uso ${escapeHTML(new Date(pk.lastUsedAt).toLocaleString())}` : ''}</small></div><button class="button danger small" data-delete-passkey="${escapeHTML(pk.id)}" type="button">Revocar</button></div>`).join('') : '<p class="backup-empty">No tienes Passkeys registradas.</p>'}</div>
      <div class="form-actions"><button class="button primary" id="addPasskey" type="button" ${me.passkeyAllowed ? '' : 'disabled'}>+ Registrar Passkey</button><span class="message">${me.passkeyAllowed ? 'Permitido en esta cuenta.' : 'El administrador ha bloqueado el inicio con Passkey para esta cuenta.'}</span></div>
    </section></div></main>`;
  wireAccountMenu();
  document.querySelector('#addPasskey').addEventListener('click', async () => { try { await registerMyPasskey(); } catch (e) { alert(e.message); } });
  document.querySelectorAll('[data-delete-passkey]').forEach(btn => btn.addEventListener('click', async () => { if (!confirm('¿Revocar esta Passkey?')) return; try { await request(`/api/me/passkeys/${encodeURIComponent(btn.dataset.deletePasskey)}`, { method: 'DELETE' }); await renderMyAccount(); } catch (e) { alert(e.message); } }));
  document.querySelector('#changePasswordForm').addEventListener('submit', async e => { e.preventDefault(); const message=document.querySelector('#passwordMessage'); try { await request('/api/me/password',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))}); message.className='message success'; message.textContent='Contraseña actualizada. Se cerraron las demás sesiones.'; e.currentTarget.reset(); } catch(err){ message.className='message error'; message.textContent=err.message; } });
}

function renderLogin(twoFactorMode = false) {
  if (twoFactorMode) {
    app.innerHTML = `<main class="login-page"><section class="login-card"><a class="brand" href="/">YHORS</a><span class="eyebrow">Verificación en dos pasos</span><h1>Confirma tu acceso</h1><p>Abre tu aplicación autenticadora e ingresa el código de 6 dígitos.</p><form id="twoFactorForm" class="form-grid"><div class="field full"><label for="twoFactorCode">Código 2FA</label><input id="twoFactorCode" name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" minlength="6" required autofocus></div><div class="form-actions"><button class="button" type="submit">Verificar acceso</button><span class="message" id="loginMessage"></span></div></form></section></main>`;
    document.querySelector('#twoFactorForm').addEventListener('submit', async e => {
      e.preventDefault();
      const message = document.querySelector('#loginMessage');
      try {
        const result = await request('/api/login/2fa', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))
        });
        const session = await request('/api/admin/session');
        (session.role === 'orders' || session.role === 'store_manager') ? renderAdminOrders() : renderAdmin();
      } catch (error) {
        message.className = 'message error';
        message.textContent = error.message;
      }
    });
    return;
  }

  app.innerHTML = `<main class="login-page"><section class="login-card"><a class="brand" href="/">YHORS</a><span class="eyebrow">Panel privado</span><h1>Acceso a YHORS</h1><p>Ingresa con tu cuenta autorizada.</p><form id="loginForm" class="form-grid"><div class="field full"><label for="username">Usuario</label><input id="username" name="username" autocomplete="username webauthn" required></div><div class="field full"><label for="password">Contraseña</label><input id="password" name="password" type="password" autocomplete="current-password" required></div><div class="login-attempts" id="loginAttempts" aria-live="polite"></div><div class="form-actions"><button class="button" id="loginSubmit" type="submit">Iniciar sesión</button><button class="button secondary" id="passkeyLogin" type="button">🔐 Iniciar con Passkey</button><span class="message" id="loginMessage"></span></div></form></section></main>`;
  let loginLockTimer = null;
  const attemptsBox = document.querySelector('#loginAttempts');
  const submitButton = document.querySelector('#loginSubmit');
  const passkeyButton = document.querySelector('#passkeyLogin');
  const message = document.querySelector('#loginMessage');
  const setLockedUI = (seconds, permanent = false) => {
    if (loginLockTimer) clearInterval(loginLockTimer);
    if (permanent) {
      submitButton.disabled = true; passkeyButton.disabled = true;
      attemptsBox.textContent = 'Acceso bloqueado. Indica a tu proveedor que restablezca la contraseña.';
      attemptsBox.className = 'login-attempts locked permanent';
      return;
    }
    let remaining = Math.max(0, Number(seconds || 0));
    const paint = () => {
      const mins = Math.floor(remaining / 60); const secs = remaining % 60;
      attemptsBox.textContent = `Acceso bloqueado por seguridad. Tiempo restante: ${mins}:${String(secs).padStart(2,'0')}`;
      attemptsBox.className = 'login-attempts locked';
      submitButton.disabled = true; passkeyButton.disabled = true;
      if (remaining <= 0) { clearInterval(loginLockTimer); attemptsBox.textContent = 'Puedes volver a intentarlo.'; attemptsBox.className = 'login-attempts'; submitButton.disabled = false; passkeyButton.disabled = false; message.textContent = ''; }
      remaining -= 1;
    };
    paint(); loginLockTimer = setInterval(paint, 1000);
  };
  document.querySelector('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const result = await request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))) });
      if (result.requiresTwoFactor) return renderLogin(true);
      const session = await request('/api/admin/session');
      (session.role === 'orders' || session.role === 'store_manager') ? renderAdminOrders() : renderAdmin();
    } catch (error) {
      message.className = 'message error';
      if (error.data?.permanentLock) { setLockedUI(0, true); message.textContent = error.message; return; }
      if (error.data?.lockoutSeconds) { setLockedUI(error.data.lockoutSeconds); message.textContent = error.message; return; }
      if (typeof error.data?.attemptsRemaining === 'number') {
        const left = error.data.attemptsRemaining;
        attemptsBox.textContent = left > 0 ? `Intentos restantes: ${left} de 4` : 'El próximo intento incorrecto bloqueará el acceso durante 3 minutos.';
        attemptsBox.className = 'login-attempts warning';
      }
      message.textContent = error.message;
    }
  });
  passkeyButton.addEventListener('click', async () => { try { await loginWithPasskey(); } catch (error) { message.className = error.code === 'PASSKEY_CANCELLED' ? 'message' : 'message error'; message.textContent = error.message; } });
}

window.addEventListener('popstate', () => renderStore());
if (window.location.pathname === ADMIN_PATH || window.location.pathname === `${ADMIN_PATH}/`) renderAdmin(); else if (window.location.pathname === `${ADMIN_PATH}/pedidos` || window.location.pathname === `${ADMIN_PATH}/pedidos/`) renderAdminOrders(); else if (window.location.pathname === `${ADMIN_PATH}/usuarios` || window.location.pathname === `${ADMIN_PATH}/usuarios/`) renderAdminUsers(); else if (window.location.pathname === '/mi-cuenta' || window.location.pathname === '/mi-cuenta/') renderMyAccount(); else if (window.location.pathname === '/pedido' || window.location.pathname === '/pedido/') checkoutPage(); else renderStore();

document.addEventListener('change', e => { const file=e.target.closest('input[type=file][id^=\"imageFile\"]'); if(!file)return; const num=file.id==='imageFile'?1:Number(file.id.replace('imageFile','')); const preview=document.querySelector(`#productImagePreview${num}`); if(preview&&file.files?.[0]){const r=new FileReader();r.onload=()=>preview.src=r.result;r.readAsDataURL(file.files[0]);}});
document.addEventListener('input', e => { const input=e.target.closest('input[type=url][id^=\"image\"]'); if(!input)return; const num=input.id==='image'?1:Number(input.id.replace('image','')); const preview=document.querySelector(`#productImagePreview${num}`); if(preview&&input.value.trim())preview.src=input.value.trim();});
