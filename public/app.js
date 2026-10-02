const app = document.querySelector('#app');
const ADMIN_PATH = '/yhors/admin593';
const ORDER_STATUS_CLASS = { Pendiente:'pending', Confirmado:'confirmed', Preparado:'preparing', Enviado:'shipped', Entregado:'delivered', Cancelado:'cancelled' };
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
function decodeHtmlEntities(value = '') {
  let text = String(value ?? '');
  for (let i = 0; i < 3; i += 1) {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    const decoded = String(doc.body?.textContent || text);
    if (decoded === text) break;
    text = decoded;
  }
  return text;
}
function compactProductDescription(value = '', maxLength = 145) {
  let text = String(value ?? '').replace(/\r/g, '');
  if (!text) return '';

  // Las fichas antiguas pueden contener HTML real o HTML guardado como texto
  // (&lt;b&gt;...&lt;/b&gt;). Primero decodificamos entidades y luego eliminamos
  // cualquier etiqueta para que jamás aparezca código en las tarjetas.
  text = decodeHtmlEntities(text);
  const doc = new DOMParser().parseFromString(text, 'text/html');
  text = String(doc.body?.textContent || text);

  text = text.replace(/\s+/g, ' ').trim();
  if (!text) return '';
  if (text.length <= maxLength) return text;
  const cut = text.slice(0, maxLength).replace(/\s+\S*$/, '').trim();
  return `${cut}…`;
}
function decodeRichHtmlEntities(value = '') {
  // Decodifica entidades (&lt;ul&gt;, &amp;, etc.) SIN eliminar las etiquetas HTML
  // que ya vienen guardadas como HTML real. No podemos reutilizar decodeHtmlEntities()
  // porque esa función usa textContent y, al hacerlo, aplana todo el HTML.
  const textarea = document.createElement('textarea');
  textarea.innerHTML = String(value ?? '');
  return textarea.value;
}
function richDescriptionHTML(value = '') {
  let raw = String(value ?? '').replace(/\r/g, '');
  if (!raw) return '';
  raw = decodeRichHtmlEntities(raw);
  if (!/[<>]/.test(raw)) return escapeHTML(raw).replace(/\n/g, '<br>');
  const parser = new DOMParser();
  const doc = parser.parseFromString(raw, 'text/html');
  const allowed = new Set(['B','STRONG','I','EM','U','BR','P','DIV','H2','H3','UL','OL','LI']);
  const clean = node => {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) {
        // Conserva los Enter que quedaron como saltos de texto dentro de HTML mixto.
        if (/\n/.test(child.nodeValue || '')) {
          const frag = document.createDocumentFragment();
          String(child.nodeValue).split(/(\n)/).forEach(part => {
            if (part === '\n') frag.appendChild(document.createElement('br'));
            else if (part) frag.appendChild(document.createTextNode(part));
          });
          child.replaceWith(frag);
        }
        return;
      }
      if (child.nodeType !== Node.ELEMENT_NODE || !allowed.has(child.tagName)) {
        const frag = document.createDocumentFragment();
        while (child.firstChild) frag.appendChild(child.firstChild);
        child.replaceWith(frag);
        return;
      }
      [...child.attributes].forEach(attr => child.removeAttribute(attr.name));
      clean(child);
    });
  };
  clean(doc.body);
  return doc.body.innerHTML;
}
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

const YHORS_CUSTOMER_CACHE_KEY = 'yhors-admin-customers-v16';
function readLocalCustomerCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(YHORS_CUSTOMER_CACHE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(c => c && c.id && c.name && c.cedula) : [];
  } catch { return []; }
}
function writeLocalCustomerCache(customers = []) {
  try {
    const safe = customers.map(c => ({ id:c.id, identity:c.identity, name:c.name||'', phone:c.phone||'', cedula:c.cedula||'', email:c.email||'', city:c.city||'', address:c.address||'', mapsUrl:c.mapsUrl||'', notes:c.notes||'', createdAt:c.createdAt||'', updatedAt:c.updatedAt||'' }));
    localStorage.setItem(YHORS_CUSTOMER_CACHE_KEY, JSON.stringify(safe));
  } catch {}
}
async function recoverCustomersFromLocalCache(customers = []) {
  const cached = readLocalCustomerCache();
  if (!cached.length) return customers;
  const byIdentity = new Map();
  for (const row of [...customers, ...cached]) {
    const key = row.identity || `cedula:${String(row.cedula||'').replace(/\D/g,'')}`;
    byIdentity.set(key, { ...byIdentity.get(key), ...row });
  }
  const merged = [...byIdentity.values()];
  if (!customers.length) {
    for (const row of cached) {
      try { await request('/api/admin/clientes', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(row) }); } catch {}
    }
    try {
      const fresh = await request(`/api/admin/clientes?_=${Date.now()}`);
      if (Array.isArray(fresh) && fresh.length) { writeLocalCustomerCache(fresh); return fresh; }
    } catch {}
  }
  writeLocalCustomerCache(merged);
  return merged;
}

async function request(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options, headers: { 'Cache-Control': 'no-cache', ...(options.headers || {}) } });
  const json = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(json.error || (response.status === 401 ? 'Tu sesión administrativa expiró. Inicia sesión nuevamente.' : 'No se pudo completar la operación.'));
    error.status = response.status;
    error.data = json;
    if (response.status === 401 && String(url).startsWith('/api/admin/') && url !== '/api/admin/session') {
      window.__yhorsSession = null;
      if (typeof renderLogin === 'function') renderLogin();
    }
    throw error;
  }
  return json;
}

function accountMenu(account = {}) {
  const username = escapeHTML(account.username || 'Usuario');
  const displayName = escapeHTML(account.name || account.username || 'Usuario');
  const role = escapeHTML(userRoleLabel(account.role || ''));
  const initial = escapeHTML((account.name || account.username || 'U').trim().slice(0, 1).toUpperCase());
  return `<div class="account-menu-wrap">
    <button class="account-menu-trigger" id="accountMenuTrigger" type="button" aria-label="Abrir menú de cuenta" aria-haspopup="menu" aria-expanded="false">
      <span class="account-menu-avatar" aria-hidden="true">${initial}</span>
      <span class="account-menu-trigger-copy"><strong>${displayName}</strong><small>${role}</small></span>
      <span class="account-menu-caret" aria-hidden="true">⌄</span>
    </button>
    <div class="account-menu" id="accountMenu" role="menu" hidden>
      <div class="account-menu-user"><span class="account-menu-user-label">CUENTA YHORS</span><strong>${displayName}</strong><small>@${username} · ${role}</small></div>
      <a href="/mi-cuenta" data-smooth-route role="menuitem">Mi cuenta <span>→</span></a>
      <button type="button" role="menuitem" id="accountMenuLogout">Cerrar sesión <span>↗</span></button>
    </div>
  </div>`;
}

function wireAccountMenu() {
  const wrap = document.querySelector('.account-menu-wrap');
  const trigger = document.querySelector('#accountMenuTrigger');
  const menu = document.querySelector('#accountMenu');
  if (!wrap || !trigger || !menu) return;
  if (window.__yhorsAccountMenuDocumentHandler) {
    document.removeEventListener('click', window.__yhorsAccountMenuDocumentHandler);
  }
  const close = () => { menu.hidden = true; trigger.setAttribute('aria-expanded', 'false'); };
  trigger.addEventListener('click', event => {
    event.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
  });
  window.__yhorsAccountMenuDocumentHandler = event => {
    if (!wrap.contains(event.target)) close();
  };
  document.addEventListener('click', window.__yhorsAccountMenuDocumentHandler);
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
  try {
    const credential = await navigator.credentials.create({ publicKey: registrationOptionsForBrowser(options) });
    if (!credential) throw new Error('No se pudo crear la Passkey.');
    return serializeRegistrationCredential(credential);
  } catch (error) {
    if (error?.name === 'NotAllowedError' || error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      const friendly = new Error('Registro de Passkey cancelado. Puedes volver a intentarlo cuando quieras.');
      friendly.code = 'PASSKEY_CANCELLED';
      throw friendly;
    }
    if (error?.name === 'SecurityError') throw new Error('Passkey no disponible en este dominio. Verifica que YHORS esté usando HTTPS y el dominio configurado.');
    throw new Error('No se pudo registrar la Passkey. Inténtalo nuevamente.');
  }
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
function getCart() {
  try {
    const cart = JSON.parse(localStorage.getItem('yhors-cart')) || [];
    return Array.isArray(cart) ? cart.map(line => {
      const { stock, purchasePrice, ...safeLine } = line || {};
      return {
        ...safeLine,
        rentalDays: line.purchaseMode === 'rental' ? Math.max(1, Math.min(10, Number.parseInt(line.rentalDays, 10) || 1)) : null
      };
    }) : [];
  } catch { return []; }
}
function setCart(cart) { localStorage.setItem('yhors-cart', JSON.stringify(cart)); }
function rentalDaysValue(value) { return Math.max(1, Math.min(10, Number.parseInt(value, 10) || 1)); }
function cartLineTotal(line) {
  const unit = Number(line.price || 0);
  const days = line.purchaseMode === 'rental' ? rentalDaysValue(line.rentalDays) : 1;
  return Math.round(unit * Number(line.quantity || 0) * days * 100) / 100;
}

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
      <a class="brand" href="/" aria-label="YHORS inicio" data-home-link><span>YHORS</span><small>STORE</small></a>
      <form class="search-form" id="siteSearch" role="search">
        <input id="siteSearchInput" type="search" name="buscar" placeholder="Buscar productos, marcas o categorías" autocomplete="off">
        <button type="submit" aria-label="Buscar"><svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"></circle><path d="M16 16l5 5"></path></svg></button>
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

function wireCategoryNavigation() {
  const navigateWithStoreTransition = (link, event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const href = link.getAttribute('href');
    const currentHref = `${location.pathname}${location.search}`;
    const isHomeLink = link.hasAttribute('data-home-link');

    if (!href) return;

    // Si ya estamos en Principal, el logo debe funcionar como un botón de
    // "volver arriba" en lugar de no hacer nada.
    if (href === currentHref) {
      if (isHomeLink) {
        event.preventDefault();
        window.scrollTo({ top: 0, left: 0, behavior: 'smooth' });
      }
      return;
    }

    event.preventDefault();
    document.querySelector('#siteNav')?.classList.remove('mobile-open');
    document.querySelector('#mobileMenuToggle')?.classList.remove('open');
    document.querySelector('#mobileMenuToggle')?.setAttribute('aria-expanded', 'false');
    document.querySelector('#app > main')?.classList.add('products-refreshing');

    history.pushState({}, '', href);

    // Esperamos a que la nueva vista termine de renderizar y recién entonces
    // llevamos el documento al inicio. Así el logo nunca deja la portada
    // cargando a mitad de scroll ni conserva la posición de la publicación.
    window.setTimeout(async () => {
      await renderStore();
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    }, 70);
  };

  document.querySelectorAll('[data-category-link], [data-home-link]').forEach(link => {
    link.addEventListener('click', event => navigateWithStoreTransition(link, event));
  });
}

function markPageEnter() {
  const main = document.querySelector('#app > main');
  if (!main) return;
  main.classList.add('page-content-enter');
  requestAnimationFrame(() => main.classList.remove('products-refreshing'));
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
    ${safeSlides.length > 1 ? `<button class="hero-arrow hero-prev" type="button" aria-label="Anterior"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 5.5 8 12l6.5 6.5"></path></svg></button><button class="hero-arrow hero-next" type="button" aria-label="Siguiente"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 5.5 6.5 6.5-6.5 6.5"></path></svg></button><div class="hero-dots">${safeSlides.map((_, i) => `<button type="button" class="hero-dot ${i === 0 ? 'active' : ''}" data-hero-index="${i}" aria-label="Ir a la imagen ${i + 1}"></button>`).join('')}</div>` : ''}
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
  const inStock = product.inStock === true;
  const availability = inStock ? `` : ``;
  const isCosplayRental = product.category === 'cosplay' && product.isRental === true && Number.isFinite(Number(product.rentalPrice));
  const rental = isCosplayRental ? `<small class="price-secondary">Alquiler: ${money(product.rentalPrice)}</small>` : '';
  const action = isCosplayRental
    ? `<button class="add cosplay-options" data-open-option="${escapeHTML(product.id)}"><span>Ver opciones</span><span>→</span></button>`
    : `<button class="add" data-id="${escapeHTML(product.id)}" ${!inStock ? 'disabled' : ''}><span>${inStock ? 'Añadir' : 'Sin stock'}</span><span>${inStock ? '+' : '—'}</span></button>`;
  return `<article class="product" data-product="${escapeHTML(product.id)}"><a class="product-open" data-open="${escapeHTML(product.id)}" href="${escapeHTML(productHref(product))}" aria-label="Ver ${escapeHTML(product.name)}"><div class="product-image"><img data-fallback src="${escapeHTML(image)}" alt="${escapeHTML(product.name)}" loading="lazy"></div><div class="product-info"><span class="product-category">${escapeHTML(categories[product.category] || product.category)}</span>${meta ? `<small class="product-meta">${escapeHTML(meta)}</small>` : ''}<h3>${escapeHTML(product.name)}</h3><div class="product-description">${escapeHTML(compactProductDescription(product.description, 112))}</div><span class="detail-link">Ver detalles <span>→</span></span></div></a><div class="product-bottom"><div><span class="price">${productPriceLabel(product)}</span>${rental}<span class="price-secondary">${availability}</span></div>${action}</div></article>`;
}
function renderProductsInto(area, products, onOpen, onAdd, options = {}) {
  const groupByType = options.groupByType === true;
  const groupLabel = value => String(value || 'Otros productos').trim() || 'Otros productos';
  const groupedMarkup = () => {
    const groups = [];
    const groupMap = new Map();
    products.forEach(product => {
      const key = groupLabel(product.productType);
      if (!groupMap.has(key)) {
        const group = { key, items: [] };
        groupMap.set(key, group);
        groups.push(group);
      }
      groupMap.get(key).items.push(product);
    });
    return groups.map(group => `
      <section class="product-type-group" data-product-type-group="${escapeHTML(group.key)}">
        <div class="product-type-divider" aria-label="${escapeHTML(group.key)}">
          <h2>${escapeHTML(group.key)}</h2>
          <span class="product-type-rule" aria-hidden="true"></span>
        </div>
        <div class="products product-type-grid">${group.items.map(productCard).join('')}</div>
      </section>`).join('');
  };
  area.innerHTML = products.length
    ? (groupByType ? groupedMarkup() : products.map(productCard).join(''))
    : '<div class="empty">Aún no hay productos en esta colección.</div>';
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
  const getProductForLine = line => products.find(item => item.id === (line.productId || line.id || line.cartKey));
  // El catálogo público solo conoce si hay disponibilidad, nunca la cantidad exacta.
  // La cantidad solicitada se valida nuevamente en el servidor al crear el pedido.
  const getAvailableStock = line => {
    const product = getProductForLine(line);
    const available = product ? product.inStock === true : line.inStock === true;
    return available ? Number.POSITIVE_INFINITY : 0;
  };
  const clampQuantity = (line, requested) => {
    const minimum = Math.max(1, Number.parseInt(requested, 10) || 1);
    if (line.purchaseMode !== 'purchase') return minimum;
    return getAvailableStock(line) > 0 ? minimum : 0;
  };
  const drawCart = () => {
    if (!area) return;
    cart = cart.filter(line => line.purchaseMode !== 'purchase' || getAvailableStock(line) > 0);
    cart.forEach(line => {
      if (line.purchaseMode === 'purchase') line.quantity = clampQuantity(line, line.quantity);
    });
    setCart(cart);
    area.innerHTML = cart.length ? cart.map(line => {
      const isRental = line.purchaseMode === 'rental';
      const days = isRental ? rentalDaysValue(line.rentalDays) : 1;
      const quantity = Math.max(1, Number(line.quantity) || 1);
      return `<div class="cart-item"><img data-fallback src="${escapeHTML(productImages(line)[0])}" alt=""><div class="cart-item-main"><h4>${escapeHTML(line.name)}</h4>${line.purchaseMode ? `<span class="cart-mode">${isRental ? `Alquiler · ${days} día${days === 1 ? '' : 's'}` : 'Compra'}</span>` : ''}${isRental ? `<label class="cart-rental-days">Días de alquiler<select data-rental-days="${escapeHTML(line.id)}">${Array.from({length:10},(_,i)=>i+1).map(day => `<option value="${day}" ${day === days ? 'selected' : ''}>${day} día${day === 1 ? '' : 's'}</option>`).join('')}</select></label>` : ''}<p class="cart-line-price">${money(Number(line.price) * (isRental ? days : 1))}${isRental ? ' <small>/ día × duración</small>' : ''}</p><div class="quantity-control"><button type="button" data-qty="${escapeHTML(line.id)}" data-change="-1" ${quantity <= 1 ? 'disabled' : ''}>−</button><input type="number" min="1" value="${quantity}" data-input="${escapeHTML(line.id)}"><button type="button" data-qty="${escapeHTML(line.id)}" data-change="1">+</button></div></div><button class="remove" data-remove="${escapeHTML(line.id)}">Quitar</button></div>`;
    }).join('') : '<div class="empty cart-empty">Tu carrito está vacío.<br><small>Agrega algo que te guste.</small></div>';
    const total = cart.reduce((sum, line) => sum + cartLineTotal(line), 0);
    const totalEl = document.querySelector('#cartTotal'); if (totalEl) totalEl.textContent = money(total);
    wireImageFallback(area);
    area.querySelectorAll('[data-rental-days]').forEach(select => select.addEventListener('change', () => {
      const line = cart.find(item => item.id === select.dataset.rentalDays); if (!line) return;
      line.rentalDays = rentalDaysValue(select.value); setCart(cart); drawCart();
    }));
    area.querySelectorAll('[data-qty]').forEach(btn => btn.addEventListener('click', () => {
      const line = cart.find(item => item.id === btn.dataset.qty); if (!line) return;
      const requested = Math.max(1, Number(line.quantity) + Number(btn.dataset.change));
      const nextQuantity = clampQuantity(line, requested);
      if (nextQuantity < 1) return;
      line.quantity = nextQuantity;
      setCart(cart); updateCartCount(); drawCart();
    }));
    area.querySelectorAll('[data-input]').forEach(input => input.addEventListener('change', () => {
      const line = cart.find(item => item.id === input.dataset.input); if (!line) return;
      const nextQuantity = clampQuantity(line, input.value);
      if (nextQuantity < 1) return drawCart();
      line.quantity = nextQuantity;
      setCart(cart); updateCartCount(); drawCart();
    }));
    area.querySelectorAll('[data-remove]').forEach(btn => btn.addEventListener('click', () => { cart = cart.filter(line => line.id !== btn.dataset.remove); setCart(cart); updateCartCount(); drawCart(); }));
  };
  const addToCart = (product, button, purchaseMode = 'purchase', rentalDays = 1) => {
    const days = purchaseMode === 'rental' ? rentalDaysValue(rentalDays) : null;
    const inStock = product.inStock === true;
    const price = purchaseMode === 'rental' ? Number(product.rentalPrice) : (product.category === 'cosplay' && Number.isFinite(Number(product.salePrice)) ? Number(product.salePrice) : Number(product.price));
    const cartKey = `${product.id}::${purchaseMode}::${days || ''}`;
    const existing = cart.find(item => (item.cartKey || item.id) === cartKey);
    if (purchaseMode === 'purchase' && !inStock) {
      button.disabled = true;
      button.innerHTML = '<span>Agotado</span><span>—</span>';
      return;
    }
    if (existing) {
      const currentQuantity = Number(existing.quantity) || 0;
      existing.quantity = currentQuantity + 1;
    } else {
      cart.push({ ...product, id: cartKey, cartKey, productId: product.id, price, purchaseMode, rentalDays: days, quantity: 1 });
    }
    setCart(cart); updateCartCount(); drawCart();
    button.disabled = true;
    const original = button.innerHTML;
    button.innerHTML = '<span class="spinner"></span><span>Añadiendo</span>';
    setTimeout(() => {
      button.innerHTML = '<span class="check">✓</span><span>Añadido</span>';
      button.classList.add('added');
      setTimeout(() => { button.innerHTML = original; button.classList.remove('added'); button.disabled = false; }, 650);
    }, 420);
  };
  const openCart = () => { document.querySelector('#drawer')?.classList.add('open'); document.querySelector('#backdrop')?.classList.add('show'); document.body.classList.add('no-scroll'); };
  const closeCart = () => { document.querySelector('#drawer')?.classList.remove('open'); document.querySelector('#backdrop')?.classList.remove('show'); document.body.classList.remove('no-scroll'); };
  document.querySelector('#cartButton')?.addEventListener('click', openCart); document.querySelector('#closeCart')?.addEventListener('click', closeCart); document.querySelector('#backdrop')?.addEventListener('click', closeCart);
  const checkoutButton = document.querySelector('#checkout');
  const checkoutMessage = document.querySelector('#checkoutMessage');
  checkoutButton?.addEventListener('click', async () => {
    if (!cart.length) {
      checkoutMessage.textContent = 'Agrega al menos un producto para continuar.';
      return;
    }
    checkoutButton.disabled = true;
    checkoutButton.classList.add('is-loading');
    closeCart();
    await navigateToRoute('/pedido');
  });
  updateCartCount(); drawCart(); return { addToCart, openCart, closeCart };
}


let __yhorsNavigationPromise = null;
async function renderAdminAfterLogin(session) {
  const role = String(session?.role || '').toLowerCase();
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const isAdminRoute = current === ADMIN_PATH || current === `${ADMIN_PATH}/`
    || current.startsWith(`${ADMIN_PATH}/`);
  const limitedRole = role === 'vendedor' || role === 'store_manager' || role === 'orders';

  // El login puede ocurrir dentro de cualquier ruta administrativa. Antes se
  // renderizaba una vista distinta sin actualizar la URL, dejando por ejemplo
  // /generar-orden en la barra mientras visualmente se mostraban PEDIDOS.
  // Desde aquí la URL y la vista siempre se resuelven juntas.
  let target = current;
  // YHORS Inteligente es ahora la pantalla principal del panel.
  // Solo conservamos una ruta administrativa distinta cuando el usuario
  // llegó expresamente a ella antes de autenticarse.
  if (!isAdminRoute || current === ADMIN_PATH || current === `${ADMIN_PATH}/`) target = `${ADMIN_PATH}/inteligente`;

  if (limitedRole) {
    const allowed = [`${ADMIN_PATH}/inteligente`, `${ADMIN_PATH}/ventas-generales`, `${ADMIN_PATH}/pedidos`, `${ADMIN_PATH}/generar-orden`, `${ADMIN_PATH}/buscar-productos`, `${ADMIN_PATH}/historial-ventas`, `${ADMIN_PATH}/clientes`, `${ADMIN_PATH}/dinero`];
    if (!allowed.includes(target.replace(/\/$/, ''))) target = `${ADMIN_PATH}/pedidos`;
  }

  history.replaceState({}, '', target);
  await renderCurrentRoute();
}

async function navigateToRoute(href, { replace = false } = {}) {
  // Cada clic inicia su propia navegación. Una navegación anterior nunca debe
  // bloquear la siguiente, especialmente justo después del inicio de sesión.
  const target = new URL(href, window.location.origin);
  if (target.origin !== window.location.origin) return;
  const next = `${target.pathname}${target.search}${target.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next === current) {
    if (target.pathname === '/' && window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  const navigation = (async () => {
    const appEl = document.querySelector('#app');
    appEl?.classList.add('route-transitioning');
    if (replace) history.replaceState({}, '', next); else history.pushState({}, '', next);

    await new Promise(resolve => window.setTimeout(resolve, 90));

    // Las vistas administrativas hacen varias peticiones. Si una respuesta
    // se queda colgada, no dejamos la interfaz bloqueada: tras unos segundos
    // se hace una recarga controlada en la ruta ya seleccionada.
    let timedOut = false;
    const timeout = new Promise((_, reject) => setTimeout(() => {
      timedOut = true;
      reject(new Error('NAVIGATION_TIMEOUT'));
    }, 5000));
    try {
      await Promise.race([renderCurrentRoute(), timeout]);
      window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
      requestAnimationFrame(() => appEl?.classList.remove('route-transitioning'));
    } catch (error) {
      appEl?.classList.remove('route-transitioning');
      if (timedOut || error?.message === 'NAVIGATION_TIMEOUT') {
        // La URL ya representa el destino correcto. Una recarga limpia la
        // sesión/render anterior sin cambiar de pestaña ni perder la ruta.
        window.location.reload();
        return;
      }
      throw error;
    }
  })();

  __yhorsNavigationPromise = navigation;
  try {
    return await navigation;
  } finally {
    if (__yhorsNavigationPromise === navigation) __yhorsNavigationPromise = null;
  }
}

async function renderCurrentRoute() {
  const path = window.location.pathname;
  if (path === `${ADMIN_PATH}/inteligente` || path === `${ADMIN_PATH}/inteligente/`) return renderYhorsInteligente();
  if (path === ADMIN_PATH || path === `${ADMIN_PATH}/`) {
    const session = await request('/api/admin/session').catch(() => ({ authenticated: false }));
    return session.authenticated ? renderYhorsInteligente() : renderLogin();
  }
  if (path === `${ADMIN_PATH}/web` || path === `${ADMIN_PATH}/web/`) return renderAdmin();
  if (path === `${ADMIN_PATH}/ventas-generales` || path === `${ADMIN_PATH}/ventas-generales/`) return renderAdminSales();
  if (path === `${ADMIN_PATH}/resumen-financiero` || path === `${ADMIN_PATH}/resumen-financiero/`) return renderAdminFinancial();
  if (path === `${ADMIN_PATH}/dinero` || path === `${ADMIN_PATH}/dinero/`) return renderAdminMoney();
  if (path === `${ADMIN_PATH}/calculo-comision` || path === `${ADMIN_PATH}/calculo-comision/`) return renderAdminCommission();
  if (path === `${ADMIN_PATH}/multas` || path === `${ADMIN_PATH}/multas/`) return renderAdminFines();
  if (path === `${ADMIN_PATH}/pedidos` || path === `${ADMIN_PATH}/pedidos/`) return renderAdminOrders();
  if (path === `${ADMIN_PATH}/generar-orden` || path === `${ADMIN_PATH}/generar-orden/`) return renderAdminGenerateOrder();
  if (path === `${ADMIN_PATH}/historial-ventas` || path === `${ADMIN_PATH}/historial-ventas/`) return renderAdminSalesHistory();
    if (path === `${ADMIN_PATH}/auditoria` || path === `${ADMIN_PATH}/auditoria/`) return renderAdminAudit();
    if (path === `${ADMIN_PATH}/backups` || path === `${ADMIN_PATH}/backups/`) return renderAdminBackups();
  if (path === `${ADMIN_PATH}/seguridad` || path === `${ADMIN_PATH}/seguridad/`) return renderAdminSecurity(true);
if (path === `${ADMIN_PATH}/usuarios` || path === `${ADMIN_PATH}/usuarios/`) {
    const panel = new URLSearchParams(window.location.search).get('panel') || 'usuarios';
    return panel === 'seguridad' ? renderAdminSecurity(true) : renderAdminUsers('usuarios');
  }
  if (path === `${ADMIN_PATH}/inventario` || path === `${ADMIN_PATH}/inventario/`) return renderAdminInventory();
  if (path === `${ADMIN_PATH}/buscar-productos` || path === `${ADMIN_PATH}/buscar-productos/`) return renderAdminCatalogSearch();
  if (path === `${ADMIN_PATH}/series-imeis` || path === `${ADMIN_PATH}/series-imeis/`) return renderAdminSeriesImeis();
  if (path === `${ADMIN_PATH}/compras` || path === `${ADMIN_PATH}/compras/`) return renderAdminCompras();
  if (path === `${ADMIN_PATH}/clientes` || path === `${ADMIN_PATH}/clientes/`) return renderAdminClientes();
  if (path === `${ADMIN_PATH}/movimientos` || path === `${ADMIN_PATH}/movimientos/`) return renderAdminInventoryMovements();
  if (path === `${ADMIN_PATH}/reportes` || path === `${ADMIN_PATH}/reportes/`) return renderAdminReports();
  if (path === '/yhors/flyer' || path === '/yhors/flyer/') { window.location.replace(`${ADMIN_PATH}/buscar-productos`); return; }
  if (path === '/mi-cuenta' || path === '/mi-cuenta/') return renderMyAccount();
  if (path === '/pedido' || path === '/pedido/') return checkoutPage();
  return renderStore();
}


function checkoutPage() {
  let cart = getCart();
  const subtotal = () => cart.reduce((sum, line) => sum + cartLineTotal(line), 0);
  const shipping = { office: 0, local: 3, courier: 5 };
  const labels = {
    office: { title: 'Retiro en oficina', text: 'Retira tu pedido directamente en la oficina YHORS.', price: 0 },
    local: { title: 'Envío YHORS', text: 'Entrega dentro de la ciudad. Recargo fijo de $3,00.', price: 3 },
    courier: { title: 'Courier', text: 'Envío mediante servicio de courier. Recargo fijo de $5,00.', price: 5 }
  };
  if (!cart.length) {
    app.innerHTML = `<main class="checkout-page"><div class="checkout-page-inner"><span class="eyebrow">YHORS-STORE</span><h1>Tu carrito está vacío</h1><p>Agrega productos antes de realizar un pedido.</p><a class="button" href="/" data-smooth-route>Volver a la tienda <span>→</span></a></div></main>`;
    return;
  }
  app.innerHTML = `<main class="checkout-page"><div class="checkout-page-inner">
    <div class="checkout-page-top"><a class="brand" href="/">YHORS <small>STORE</small></a><a class="checkout-back" href="/" data-smooth-route>← Seguir comprando</a></div>
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
      <aside class="checkout-card order-review"><span class="eyebrow">Resumen</span><h2>Tu pedido</h2><div id="fullOrderItems">${cart.map(line=>{ const isRental=line.purchaseMode==='rental'; const days=isRental?rentalDaysValue(line.rentalDays):1; return `<div class="checkout-item"><div><strong>${escapeHTML(line.quantity)}× ${escapeHTML(line.name || 'Producto')}</strong><small>SKU: ${escapeHTML(line.sku || '—')}${isRental ? ` · Alquiler · ${days} día${days===1?'':'s'}` : ''}</small></div><strong>${money(cartLineTotal(line))}</strong></div>`; }).join('')}</div>
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
      const payload={customer:{name:data.name,phone:data.phone,cedula:data.cedula,email:data.email,city:data.city,address:data.address,mapsUrl:data.mapsUrl,notes:data.notes},deliveryMethod:data.deliveryMethod,items:cart.map(line=>({productId:line.productId||line.id,quantity:Number(line.quantity),purchaseMode:line.purchaseMode||'purchase',rentalDays:line.purchaseMode==='rental'?rentalDaysValue(line.rentalDays):null}))};
      const result=await request('/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      localStorage.removeItem('yhors-cart'); cart=[];
      app.innerHTML=`<main class="checkout-page"><div class="checkout-success-page"><span class="success-mark">✓</span><span class="eyebrow">Pedido recibido</span><h1>#${escapeHTML(result.orderNumber)}</h1><p>Tu pedido fue registrado correctamente.</p><div class="success-total">Total del pedido: <strong>${money(result.total)}</strong></div><p class="success-note">Guarda tu número de pedido para futuras consultas.</p><a class="button" href="/" data-smooth-route>Volver a YHORS STORE <span>→</span></a></div></main>`;
    } catch(err) {
      message.className='message error';
      message.textContent=err.message || 'No se pudo registrar el pedido.';
      submit.disabled=false;
    }
  });
}

async function loadStoreData() {
  // El HTML inicial de las rutas públicas ya viene renderizado por el servidor.
  // Si una API tarda o falla, nunca debemos reemplazar ese HTML indexable por
  // una vista vacía. Solo el catálogo de productos es imprescindible para la
  // hidratación; storefront y clasificaciones pueden usar valores seguros.
  const results = await Promise.allSettled([
    request('/api/products'),
    request('/api/storefront'),
    request('/api/classifications')
  ]);
  const productsResult = results[0];
  if (productsResult.status !== 'fulfilled' || !Array.isArray(productsResult.value)) {
    const error = productsResult.status === 'rejected' ? productsResult.reason : new Error('La API de productos no devolvió un catálogo válido.');
    error.code = 'PUBLIC_CATALOG_UNAVAILABLE';
    throw error;
  }
  return {
    products: productsResult.value,
    storefront: results[1].status === 'fulfilled' && results[1].value ? results[1].value : { heroProductIds: [], featuredProductIds: [], whatsappNumber: '' },
    classifications: results[2].status === 'fulfilled' && results[2].value ? results[2].value : { brands: {}, productTypes: {} }
  };
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
  const typesBlock = types.length ? `
    <div class="filter-accordion">
      <button type="button" class="filter-title" aria-expanded="false"><span>Tipo de producto</span><span>⌄</span></button>
      <div class="filter-options">${typesHtml}</div>
    </div>` : '';
  const brandsBlock = brands.length ? `
    <div class="filter-accordion">
      <button type="button" class="filter-title" aria-expanded="false"><span>Marcas</span><span>⌄</span></button>
      <div class="filter-options">${brandsHtml}</div>
    </div>` : '';
  const contextLabel = scoped ? `Filtros de ${escapeHTML(categories[currentCategory] || currentCategory)}` : 'Filtros del catálogo';
  return `<aside class="catalog-sidebar" aria-label="${contextLabel}">
    <button type="button" class="mobile-filter-toggle" aria-expanded="false"><span>Filtros</span><span class="mobile-filter-count">Abrir opciones</span><span class="mobile-filter-chevron">⌄</span></button>
    <div class="sidebar-head">
      <div><span class="eyebrow">Filtrar</span><h2>${scoped ? escapeHTML(categories[currentCategory]) : 'Encuentra lo tuyo'}</h2></div>
      <button type="button" class="clear-filters" id="clearCatalogFilters">Restablecer</button>
    </div>
    ${categoriesBlock}${typesBlock}${brandsBlock}
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
  try { ({ products, storefront, classifications } = await loadStoreData()); }
  catch (error) {
    // Conserva el HTML SSR que recibió el crawler. No lo sustituyas por un
    // contenedor vacío si la API pública está temporalmente indisponible.
    console.warn('[YHORS SEO] Se conserva el HTML SSR de inicio:', error?.message || error);
    return;
  }
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
  wireCategoryNavigation(); wireMobileMenu(); wireSearch(); wireHero(heroSlides); markPageEnter(); const cart = wireCart(products, storefront); const featuredArea = document.querySelector('#featuredProducts');
  const renderSearchResults = (items) => { renderProductsInto(featuredArea, items, id => openProduct(id, products), (product, button) => cart.addToCart(product, button)); const count = document.querySelector('#resultsCount'); if (count) count.textContent = `${items.length} producto${items.length === 1 ? '' : 's'} encontrado${items.length === 1 ? '' : 's'}`; if (!items.length) featuredArea.innerHTML = '<div class="empty featured-empty">No encontramos productos con esa búsqueda.<br><small>Prueba con otra marca, categoría o nombre.</small></div>'; };
  if (searchTerm) { renderSearchResults(searchResults); } else { renderProductsInto(featuredArea, visibleFeatured, id => openProduct(id, products), (product, button) => cart.addToCart(product, button)); if (!visibleFeatured.length) featuredArea.innerHTML = '<div class="empty featured-empty">Todavía no has seleccionado productos destacados.<br><small>Entra a YHORS Administración y marca los productos que quieres mostrar aquí.</small></div>'; }
}

async function renderCategoryPage(categoryKey) {
  const label = categories[categoryKey] || 'YHORS';
  updateSeoMeta({ title: `${label} | YHORS-STORE`, description: categoryDescriptions[categoryKey] || 'Productos seleccionados en YHORS-STORE.', canonical: `${location.origin}/categoria/${encodeURIComponent(categoryKey === 'all' ? 'principal' : categoryKey)}` });
  let products = [], storefront = { whatsappNumber: '' }, classifications = {};
  try { ({ products, storefront, classifications } = await loadStoreData()); }
  catch (error) {
    console.warn('[YHORS SEO] Se conserva el HTML SSR de categoría:', error?.message || error);
    return;
  }
  const categoryProducts = products.filter(product => categoryKey === 'all' || product.category === categoryKey);
  const slides = categoryProducts.slice(0, 4).map(product => ({ ...product, image: productImages(product)[0], heroTitle: product.name, heroDescription: product.description }));
  app.innerHTML = `${renderHeader(categoryKey)}<main>${heroMarkup(slides, true, categoryKey)}<section class="section category-page-section" id="productos-categoria"><div class="category-intro"><div><span class="eyebrow">Colección independiente</span><h1>${escapeHTML(categories[categoryKey])}</h1></div><p>${escapeHTML(categoryDescriptions[categoryKey])}</p></div><div class="catalog-layout">${catalogFilters(classifications, categoryKey, { category: categoryKey })}<div class="catalog-results"><div class="results-count" id="resultsCount"></div><div class="products product-type-container" id="categoryProducts"></div></div></div></section></main>${renderFooter()}${cartMarkup()}`;
  wireCategoryNavigation(); wireMobileMenu(); wireSearch(); wireHero(slides); markPageEnter(); const cart = wireCart(products, storefront); const area = document.querySelector('#categoryProducts');
  const renderCategoryResults = (items) => { renderProductsInto(area, items, id => openProduct(id, products), (product, button) => cart.addToCart(product, button), { groupByType: true }); const count = document.querySelector('#resultsCount'); if (count) count.textContent = `${items.length} producto${items.length === 1 ? '' : 's'} en ${escapeHTML(categories[categoryKey])}`; if (!items.length) area.innerHTML = '<div class="empty">No hay productos que coincidan con estos filtros.</div>'; };
  wireCatalogFilters(categoryProducts, classifications, { category: categoryKey }, renderCategoryResults);
}

async function renderProductDetail(product, products, storefront) {
  const images = productImages(product); updateSeoMeta({ title: `${product.name} | YHORS-STORE`, description: String(product.description || `${product.name} disponible en YHORS-STORE.`).replace(/\s+/g, ' ').slice(0, 155), canonical: `${location.origin}${productHref(product)}`, image: images[0] && (images[0].startsWith('http') ? images[0] : `${location.origin}${images[0]}`) }); let selected = 0; const isCosplay = product.category === 'cosplay'; const hasRental = isCosplay && Number.isFinite(Number(product.rentalPrice));
  const modeOptions = hasRental ? `<div class="purchase-choice"><span class="choice-label">¿Cómo quieres obtenerlo?</span><div class="purchase-options" role="radiogroup" aria-label="Modalidad"><button type="button" class="purchase-option active" data-purchase-mode="purchase"><strong>Comprar</strong><span>${productPriceLabel(product)}</span></button><button type="button" class="purchase-option" data-purchase-mode="rental"><strong>Alquilar</strong><span>Alquiler: ${money(product.rentalPrice)}</span></button></div><div class="rental-days-picker hidden" id="rentalDaysPicker"><label for="rentalDays">Días de alquiler</label><select id="rentalDays" name="rentalDays">${Array.from({length:10},(_,i)=>i+1).map(day=>`<option value="${day}" ${day===1?'selected':''}>${day} día${day===1?'':'s'}</option>`).join('')}</select><small class="field-help">Selecciona de 1 a 10 días.</small></div></div>` : '';
  app.innerHTML = `${renderHeader(product.category)}<main class="product-detail-page"><div class="breadcrumbs"><a href="${categoryHref(product.category)}">${escapeHTML(categories[product.category])}</a><span>/</span><strong>${escapeHTML(product.name)}</strong></div><section class="detail-layout"><div class="detail-gallery"><div class="detail-main-image"><img id="detailMainImage" data-fallback src="${escapeHTML(images[0])}" alt="${escapeHTML(product.name)}"></div>${images.length > 1 ? `<div class="thumbnail-row">${images.map((image, index) => `<button class="thumb ${index === 0 ? 'active' : ''}" data-image-index="${index}"><img data-fallback src="${escapeHTML(image)}" alt="Imagen ${index + 1}"></button>`).join('')}</div>` : ''}</div><div class="detail-copy"><span class="eyebrow">${escapeHTML(categories[product.category])}</span><h1>${escapeHTML(product.name)}</h1><div class="detail-price" id="detailPrice">${productPriceLabel(product)}</div><div class="detail-sku" aria-label="SKU de YHORS"><span class="detail-sku-icon">⌑</span><span>SKU: <strong>${escapeHTML(product.sku || '—')}</strong></span></div><div class="detail-availability ${product.inStock ? '' : 'out'}">${product.inStock ? 'DISPONIBLE' : 'SIN STOCK'}</div>${modeOptions}<div class="detail-buy"><button class="add detail-add" id="detailAdd" ${!hasRental && !product.inStock ? 'disabled' : ''}><span>${!hasRental && !product.inStock ? 'Sin stock' : 'Añadir al carrito'}</span><span>${!hasRental && !product.inStock ? '—' : '+'}</span></button><a class="button secondary back-button" href="${categoryHref(product.category)}">← Volver a ${escapeHTML(categories[product.category])}</a></div><div class="detail-divider"></div><h3>Descripción</h3><div class="detail-description">${richDescriptionHTML(product.description)}</div><div class="detail-note"><span>✓</span>${hasRental ? 'Elige comprar o alquilar antes de añadirlo al carrito.' : 'Compra directa y atención personal.'}</div></div></section></main>${renderFooter()}${cartMarkup()}`;
  wireCategoryNavigation(); wireMobileMenu(); wireSearch(); wireImageFallback(document.querySelector('.product-detail-page')); markPageEnter(); document.querySelectorAll('[data-image-index]').forEach(button => button.addEventListener('click', () => { selected = Number(button.dataset.imageIndex); document.querySelector('#detailMainImage').src = images[selected]; document.querySelectorAll('.thumb').forEach(item => item.classList.remove('active')); button.classList.add('active'); }));
  const cart = wireCart(products, storefront); let purchaseMode = 'purchase';
  document.querySelectorAll('[data-purchase-mode]').forEach(button => button.addEventListener('click', () => {
    purchaseMode = button.dataset.purchaseMode;
    document.querySelectorAll('[data-purchase-mode]').forEach(item => item.classList.toggle('active', item === button));
    document.querySelector('#detailPrice').firstChild.textContent = purchaseMode === 'rental' ? money(product.rentalPrice) : productPriceLabel(product);
    document.querySelector('#rentalDaysPicker')?.classList.toggle('hidden', purchaseMode !== 'rental');
    const detailAdd = document.querySelector('#detailAdd');
    if (detailAdd) {
      const soldOut = purchaseMode === 'purchase' && !product.inStock;
      detailAdd.disabled = soldOut;
      detailAdd.innerHTML = `<span>${soldOut ? 'Sin stock' : 'Añadir al carrito'}</span><span>${soldOut ? '—' : '+'}</span>`;
    }
  }));
  document.querySelector('#detailAdd').addEventListener('click', e => {
    const rentalDays = purchaseMode === 'rental' ? rentalDaysValue(document.querySelector('#rentalDays')?.value) : 1;
    cart.addToCart(product, e.currentTarget, hasRental ? purchaseMode : 'purchase', rentalDays);
  });
}

async function renderStore() {
  const categoryKey = currentCategoryFromPath();
  let products = [], storefront = { whatsappNumber: '', heroProductIds: [], featuredProductIds: [] };
  try { ({ products, storefront } = await loadStoreData()); }
  catch (error) {
    // Las rutas públicas ya tienen HTML SSR. Ante un fallo temporal de la API,
    // no debemos borrar ese contenido ni convertir la página en una Soft 404.
    console.warn('[YHORS SEO] Se conserva el HTML SSR de la ruta pública:', error?.message || error);
    return;
  }
  const productSlugPath = location.pathname.match(/^\/producto\/([^/]+)\/?$/);
  if (productSlugPath) { const product = products.find(item => productSlug(item) === decodeURIComponent(productSlugPath[1])); if (product) return renderProductDetail(product, products, storefront); }
  const productId = new URLSearchParams(location.search).get('producto');
  if (productId) { const product = getProduct(productId, products); if (product) return renderProductDetail(product, products, storefront); }
  if (categoryKey) return renderCategoryPage(categoryKey);
  return renderHome();
}

function productImagePickerModal(slot, current = '') {
  const title = slot === 1 ? 'Imagen principal' : `Imagen ${slot}`;
  return `<div class="product-image-picker-backdrop" id="productImagePickerModal" hidden>
    <div class="product-image-picker" role="dialog" aria-modal="true" aria-labelledby="productImagePickerTitle">
      <div class="product-image-picker-head"><div><span class="eyebrow">FOTOS DEL PRODUCTO</span><h3 id="productImagePickerTitle">${escapeHTML(title)}</h3><small>Agrega la imagen desde tu equipo o pega un enlace.</small></div><button type="button" class="product-image-picker-close" data-image-picker-close aria-label="Cerrar">×</button></div>
      <div class="product-image-picker-options">
        <section class="product-image-picker-option"><div class="image-picker-icon">↑</div><div><strong>Agregar por archivo</strong><small>JPG, PNG, WEBP o GIF · máximo 5 MB</small></div><button type="button" class="button secondary small" id="productImagePickerFileButton">Seleccionar archivo</button><input id="productImagePickerFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden></section>
        <section class="product-image-picker-option"><div class="image-picker-icon">↗</div><div><strong>Agregar por URL</strong><small>Pega el enlace directo de la imagen y comprueba la vista previa.</small></div><input id="productImagePickerUrl" type="url" placeholder="https://ejemplo.com/imagen.jpg" value="${escapeHTML(current)}"></section>
      </div>
      <div class="product-image-picker-preview"><span>Vista previa</span><div><img id="productImagePickerPreview" data-fallback src="${escapeHTML(current || placeholder)}" alt="Vista previa"></div></div>
      <div class="product-image-picker-foot"><button type="button" class="button secondary" data-image-picker-close>Cancelar</button><button type="button" class="button primary" id="productImagePickerApply">Usar esta imagen</button></div>
    </div>
  </div>`;
}

function openProductImagePicker(slot, current = '', onApply) {
  document.querySelector('#productImagePickerModal')?.remove();
  document.body.insertAdjacentHTML('beforeend', productImagePickerModal(slot, current));
  const modal = document.querySelector('#productImagePickerModal');
  if (modal) { modal.hidden = false; modal.setAttribute('aria-hidden', 'false'); document.body.classList.add('generate-modal-open'); }
  const file = document.querySelector('#productImagePickerFile');
  const fileButton = document.querySelector('#productImagePickerFileButton');
  const url = document.querySelector('#productImagePickerUrl');
  const preview = document.querySelector('#productImagePickerPreview');
  let selectedFile = null;
  let selectedFilePreviewUrl = '';
  const updatePreview = src => { if (preview) preview.src = src || placeholder; };
  fileButton?.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); file?.click(); });
  file?.addEventListener('change', () => {
    selectedFile = file.files?.[0] || null;
    if (selectedFile) {
      if (selectedFilePreviewUrl) URL.revokeObjectURL(selectedFilePreviewUrl);
      selectedFilePreviewUrl = URL.createObjectURL(selectedFile);
      updatePreview(selectedFilePreviewUrl);
    }
  });
  url?.addEventListener('input', () => { if (!selectedFile) updatePreview(url.value.trim()); });
  const close = () => { document.body.classList.remove('generate-modal-open'); if (selectedFilePreviewUrl) URL.revokeObjectURL(selectedFilePreviewUrl); modal?.remove(); };
  modal?.querySelectorAll('[data-image-picker-close]').forEach(btn => btn.addEventListener('click', close));
  modal?.addEventListener('click', e => { if (e.target === modal) close(); });
  modal?.querySelector('#productImagePickerApply')?.addEventListener('click', () => {
    const link = String(url?.value || '').trim();
    if (!selectedFile && !link) { url?.focus(); return; }
    if (selectedFile && selectedFile.size > 5 * 1024 * 1024) { alert('La imagen no puede superar 5 MB.'); return; }
    onApply?.({ file: selectedFile, url: link, preview: selectedFile ? URL.createObjectURL(selectedFile) : link });
    close();
  });
}

function productForm(product = {}, classifications = {}) {
  const images = Array.isArray(product.images) && product.images.length ? product.images : (product.image ? [product.image] : []);
  const selectedCategory = product.category || '';
  const brands = selectedCategory ? (classifications.brands?.[selectedCategory] || []) : [];
  const types = selectedCategory ? (classifications.productTypes?.[selectedCategory] || []) : [];
  const isCosplay = selectedCategory === 'cosplay';
  const locked = !selectedCategory;
  const lock = locked ? 'disabled' : '';
  window.__yhorsPendingImageFiles = {};
  return `<form id="productForm"><div class="form-grid">
    <div class="field full"><label for="category">Categoría / universo</label><select id="category" name="category" required><option value="">Elegir Categoría</option>${Object.entries(categories).filter(([key]) => key !== 'all').map(([key, label]) => `<option value="${key}" ${selectedCategory === key ? 'selected' : ''}>${label}</option>`).join('')}</select><small class="field-help">Las clasificaciones se administran abajo. Elige una categoría para habilitar el resto del formulario.</small></div>
    <div class="field"><label for="name">Nombre del producto</label><input id="name" name="name" required maxlength="90" ${lock} value="${escapeHTML(product.name || '')}"></div>
    <div class="field"><label for="sku">SKU</label><input id="sku" name="sku" required maxlength="40" pattern="[A-Za-z0-9._-]+" ${lock} value="${escapeHTML(product.sku || '')}"><small class="field-help">Código único del producto. Ejemplo: YH-TEC-001</small></div>
    <div class="field"><label for="brand">Marca</label><select id="brand" name="brand" ${lock}><option value="">Sin marca</option>${brands.map(v => `<option value="${escapeHTML(v)}" ${product.brand === v ? 'selected' : ''}>${escapeHTML(v)}</option>`).join('')}</select></div>
    <div class="field"><label for="productType">Tipo de producto</label><select id="productType" name="productType" ${lock}><option value="">Sin clasificación</option>${types.map(v => `<option value="${escapeHTML(v)}" ${product.productType === v ? 'selected' : ''}>${escapeHTML(v)}</option>`).join('')}</select></div>
    <div class="field"><label for="salePrice">Precio de venta (USD)</label><input id="salePrice" name="salePrice" required min="0" step="0.01" type="number" ${lock} value="${escapeHTML(product.salePrice ?? product.price ?? '')}"></div>
    <div class="field"><label for="purchasePrice">Precio de compra (USD)</label><input id="purchasePrice" name="purchasePrice" min="0" step="0.01" type="number" ${lock} value="${escapeHTML(product.purchasePrice ?? '')}"></div>
    <div class="field"><label for="stock">Stock disponible</label><input id="stock" name="stock" min="0" step="1" type="number" ${lock} value="${escapeHTML(product.stock ?? 0)}"></div>
    <div class="field"><label for="stockMin">Stock mínimo</label><input id="stockMin" name="stockMin" min="0" step="1" type="number" ${lock} value="${escapeHTML(product.stockMin ?? 0)}"></div>
    <div class="field full"><label for="tags">Etiquetas / palabras clave <small>(opcional)</small></label><input id="tags" name="tags" ${lock} value="${escapeHTML(Array.isArray(product.tags) ? product.tags.join(', ') : '')}" placeholder="Gaming, Xiaomi, 512GB..."><small class="field-help">Sirven para buscar y encontrar el producto rápidamente. Ej.: Gaming, 512GB, Ryzen 7.</small></div>
    <div class="field full product-form-options">
      <label><input type="checkbox" id="published" name="published" ${product.published !== false ? 'checked' : ''} ${lock}> Publicado en web</label>
      ${selectedCategory === 'tech' ? `<label><input type="checkbox" id="requiresDeviceIdentifier" name="requiresDeviceIdentifier" ${product.requiresDeviceIdentifier !== false ? 'checked' : ''} ${lock}> Requiere Serie / IMEI</label>` : ''}
      ${isCosplay ? `<label><input type="checkbox" id="isRental" name="isRental" ${product.isRental ? 'checked' : ''} ${lock}> Disponible para alquiler</label>` : ''}
    </div>
    <div class="field ${isCosplay ? '' : 'hidden'}"><label for="rentalPrice">Precio de alquiler por día (USD)</label><input id="rentalPrice" name="rentalPrice" ${isCosplay ? 'required' : ''} ${lock} min="0" step="0.01" type="number" value="${escapeHTML(product.rentalPrice ?? '')}"><small class="field-help">Disponible para productos de Cosplay.</small></div>
    <div class="field full"><span class="eyebrow image-section-label">Fotos del producto</span><small class="field-help">Haz clic en cada imagen para abrir el selector y elegir archivo o enlace.</small></div>
    ${[0,1,2,3].map((index) => { const slot=index+1, current=images[index] || (index===0 ? product.image || '' : ''); return `<div class="field full product-image-slot"><div class="product-image-slot-head"><div><strong>${index===0?'Imagen principal':`Imagen ${slot}`}</strong><small>${current ? 'Imagen cargada' : 'Sin imagen · puedes agregarla después'}</small></div><button type="button" class="button secondary small" data-open-image-picker="${slot}" ${lock}>${current ? 'Cambiar imagen' : '+ Agregar imagen'}</button></div><input type="hidden" id="image${index===0?'':slot}" name="image${index===0?'':slot}" value="${escapeHTML(current)}"><div class="product-image-slot-preview ${current?'has-image':''}"><img id="productImagePreview${slot}" data-fallback src="${escapeHTML(current || placeholder)}" alt="Imagen ${slot}"><span>${current ? '' : 'SIN IMAGEN'}</span></div></div>`; }).join('')}
    <div class="field full rich-description-field"><label for="descriptionEditor">Descripción completa</label><div class="rich-editor" data-rich-editor ${locked ? 'aria-disabled="true"' : ''}><div class="rich-editor-toolbar" role="toolbar" aria-label="Formato de descripción"><button type="button" class="rich-tool rich-tool-heading" data-rich-command="formatBlock" data-rich-value="h2" title="Título (H2) · activar/desactivar" aria-label="Título" ${locked ? 'disabled' : ''}><strong>Título</strong></button><span class="rich-tool-separator" aria-hidden="true"></span><button type="button" class="rich-tool" data-rich-command="bold" title="Negrita" aria-label="Negrita" ${locked ? 'disabled' : ''}><strong>B</strong></button><button type="button" class="rich-tool" data-rich-command="italic" title="Cursiva" aria-label="Cursiva" ${locked ? 'disabled' : ''}><em>I</em></button><button type="button" class="rich-tool" data-rich-command="underline" title="Subrayado" aria-label="Subrayado" ${locked ? 'disabled' : ''}><u>U</u></button><span class="rich-tool-separator" aria-hidden="true"></span><button type="button" class="rich-tool rich-tool-list" data-rich-command="insertUnorderedList" title="Lista con viñetas" aria-label="Lista con viñetas" ${locked ? 'disabled' : ''}>• Lista</button><button type="button" class="rich-tool rich-tool-list" data-rich-command="insertOrderedList" title="Lista numerada" aria-label="Lista numerada" ${locked ? 'disabled' : ''}>1. Lista</button><span class="rich-tool-separator" aria-hidden="true"></span><button type="button" class="rich-tool rich-tool-wide" data-rich-command="removeFormat" title="Quitar formato" ${locked ? 'disabled' : ''}>Limpiar</button></div><div id="descriptionEditor" class="rich-editor-content" contenteditable="${locked ? 'false' : 'true'}" role="textbox" aria-multiline="true" aria-label="Descripción completa">${richDescriptionHTML(product.description || '')}</div></div><textarea id="description" name="description" required maxlength="2000" rows="9" ${lock} hidden>${escapeHTML(product.description || '')}</textarea><small class="field-help">Escribe como en Word: <strong>negrita</strong>, <em>cursiva</em>, subrayado, títulos, viñetas y saltos de línea.</small></div>
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
  const statuses = ['Pendiente', 'Confirmado', 'Preparado', 'Enviado', 'Entregado', 'Cancelado'];
  return `<section class="admin-panel orders-panel" id="ordersPanel">
    <div class="section-heading"><div><span class="eyebrow">Ventas</span><h2>Pedidos recibidos <small class="orders-count">${orders.length}</small></h2></div><p>Los pedidos sin vendedor quedan separados para que puedas detectar lo que falta despachar.</p></div>
    <div class="orders-toolbar">
      <div class="orders-date-range">
        <label class="order-date-filter"><input id="ordersDateFrom" type="date" aria-label="Fecha inicial"></label>
        <label class="order-date-filter"><input id="ordersDateTo" type="date" aria-label="Fecha final"></label>
        <button id="clearOrdersDate" type="button" class="button secondary small">Limpiar rango</button>
      </div>
      <select id="ordersStatusFilter"><option value="">Todos los estados</option>${statuses.map(s => `<option value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('')}</select>
      <input id="ordersSearch" type="search" placeholder="Buscar por pedido, cliente, cédula/RUC, teléfono o SKU…" autocomplete="off">
    </div>
    <div id="adminOrdersList">${ordersListMarkup(orders, { canDelete, canAssign: false, sellers: [], role: '' })}</div>
  </section>`;
}

function showYhorsConfirm(title, message, options = {}) {
  const cancelText = options.cancelText || 'Cancelar';
  const confirmText = options.confirmText || 'Aceptar';
  return new Promise(resolve => {
    const existing = document.querySelector('#yhorsConfirmModal');
    if (existing) existing.remove();
    const modal = document.createElement('div');
    modal.id = 'yhorsConfirmModal';
    modal.className = 'yhors-confirm-backdrop';
    modal.innerHTML = `
      <div class="yhors-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="yhorsConfirmTitle">
        <div class="yhors-confirm-icon">✓</div>
        <h2 id="yhorsConfirmTitle">${escapeHTML(title)}</h2>
        <p>${message}</p>
        <div class="yhors-confirm-actions">
          <button type="button" class="button secondary" data-confirm-cancel>${escapeHTML(cancelText)}</button>
          <button type="button" class="button primary" data-confirm-ok>${escapeHTML(confirmText)}</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    const cleanup = result => {
      document.removeEventListener('keydown', onKey);
      modal.remove();
      resolve(result);
    };
    const onKey = event => {
      if (event.key === 'Escape') cleanup(false);
    };
    modal.querySelector('[data-confirm-cancel]').addEventListener('click', () => cleanup(false));
    modal.querySelector('[data-confirm-ok]').addEventListener('click', () => cleanup(true));
    modal.addEventListener('click', event => { if (event.target === modal) cleanup(false); });
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => modal.querySelector('[data-confirm-ok]')?.focus());
  });
}

function ordersListMarkup(orders = [], options = {}) {
  const canDelete = options.canDelete === true;
  const canAssign = options.canAssign === true;
  const sellers = Array.isArray(options.sellers) ? options.sellers : [];
  const products = Array.isArray(options.products) ? options.products : [];
  const currentRole = options.role || '';
  const paymentByOrder = options.paymentByOrder instanceof Map ? options.paymentByOrder : new Map();
  const date = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('es-EC', { dateStyle: 'medium', timeStyle: 'short' }); };
  const shortDate = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-EC', { day:'2-digit', month:'short', year:'numeric' }); };
  const statuses = ['Pendiente', 'Confirmado', 'Preparado', 'Enviado', 'Entregado', 'Cancelado'];
  const sellerName = order => sellers.find(s => s.id === order.assignedSellerId)?.name || order.assignedSellerName || 'Sin asignar';
  const productOptionList = (selectedId = '', fallbackItem = null) => {
    const list = [...products];
    if (fallbackItem && !list.some(p => String(p.id) === String(selectedId))) {
      list.unshift({ id: selectedId, name: fallbackItem.name || 'Producto actual', sku: fallbackItem.sku || '' });
    }
    return list.map(p => `<option value="${escapeHTML(p.id)}" ${String(p.id) === String(selectedId) ? 'selected' : ''}>${escapeHTML(p.name || 'Producto')} · ${escapeHTML(p.sku || 'sin SKU')}</option>`).join('');
  };
  const itemEditorRow = (item = {}) => {
    const selectedProduct = products.find(p => String(p.id) === String(item.productId));
    const productId = item.productId || products[0]?.id || '';
    const mode = item.purchaseMode === 'rental' ? 'rental' : 'purchase';
    const days = Number(item.rentalDays || 1);
    return `<div class="order-item-editor-row" data-order-item-row>
      <select class="order-item-product" aria-label="Producto">${productOptionList(productId, selectedProduct ? null : item)}</select>
      <select class="order-item-mode" aria-label="Modalidad">
        <option value="purchase" ${mode === 'purchase' ? 'selected' : ''}>Compra</option>
        ${(selectedProduct?.category === 'cosplay' && selectedProduct?.isRental === true) || mode === 'rental' ? `<option value="rental" ${mode === 'rental' ? 'selected' : ''}>Alquiler</option>` : ''}
      </select>
      <input class="order-item-quantity" type="number" min="1" max="99" step="1" value="${escapeHTML(item.quantity || 1)}" aria-label="Cantidad">
      <input class="order-item-days" type="number" min="1" max="10" step="1" value="${escapeHTML(days)}" aria-label="Días de alquiler" ${mode === 'rental' ? '' : 'disabled'}>
      <button class="button danger small order-item-remove" type="button" title="Quitar producto">Quitar</button>
    </div>`;
  };
  if (!orders.length) return '<div class="empty">No hay pedidos que coincidan con los filtros.</div>';
  const renderOrder = order => {
    const payment = paymentByOrder.get(String(order.id)) || {};
    const totalDue = Number(order.total || 0);
    const paid = Number(payment.paid || 0);
    const balance = Math.max(0, Number(payment.balance ?? Math.max(0, totalDue - paid)));
    const paymentState = balance <= 0.001 ? 'paid' : paid > 0 ? 'partial' : 'pending';
    const paymentLabel = paymentState === 'paid' ? 'PAGADO 100%' : paymentState === 'partial' ? 'ABONO · SALDO PENDIENTE' : 'PENDIENTE DE PAGO';
    const isRentalOrder = (order.items || []).some(item => String(item.purchaseMode || '').toLowerCase() === 'rental');
    const canRefundCancelledRental = role === 'admin' && String(order.status || '').toLowerCase() === 'cancelado' && isRentalOrder && paid > 0.001;
    const responsible = order.assignedSellerName || sellerName(order) || 'Sin vendedor';
    return `<article class="admin-order admin-order-compact${order.assignedSellerId ? '' : ' admin-order-unassigned'}" data-order-id="${escapeHTML(order.id)}" data-order-search="${escapeHTML(`${order.orderNumber} ${order.customer?.name || ''} ${order.customer?.cedula || ''} ${order.customer?.phone || ''} ${order.customer?.email || ''} ${(order.items || []).map(i => `${i.sku} ${i.name}`).join(' ')}`.toLowerCase())}" data-order-status="${escapeHTML(order.status || '')}" data-order-date="${escapeHTML(String(order.createdAt || '').slice(0,10))}">
    <button type="button" class="admin-order-summary" data-order-toggle="${escapeHTML(order.id)}" aria-expanded="false">
      <span class="order-summary-date">${escapeHTML(shortDate(order.createdAt))}</span>
      <span class="order-summary-main"><strong>#${escapeHTML(order.orderNumber)}</strong><b>${escapeHTML(order.customer?.name || 'Cliente')}</b><small class="order-summary-item">${escapeHTML((order.items?.[0]?.quantity || 1) + '× ' + (order.items?.[0]?.name || 'Sin productos'))}${(order.items?.length || 0) > 1 ? ` · +${order.items.length - 1} más` : ''}</small></span>
      <span class="order-summary-total">${money(order.total)}</span>
      <span class="order-summary-status status-${statusClass(order.status || 'Pendiente')}">${escapeHTML(order.status || 'Pendiente')}</span>
      <span class="order-summary-chevron">⌄</span>
    </button>
    <div class="admin-order-details" id="orderDetails-${escapeHTML(order.id)}" hidden>
      <div class="admin-order-head"><div><span class="eyebrow">${escapeHTML(date(order.createdAt))}</span><h3>#${escapeHTML(order.orderNumber)}</h3><strong>${escapeHTML(order.customer?.name || 'Cliente')}</strong></div><div class="order-status-wrap"><label>Estado</label><select class="status-select-${statusClass(order.status || 'Pendiente')}" data-order-status="${escapeHTML(order.id)}" disabled>${statuses.map(s => `<option ${s === order.status ? 'selected' : ''} value="${escapeHTML(s)}">${escapeHTML(s)}</option>`).join('')}</select></div></div>
      <div class="admin-order-grid"><div><span class="order-label">Contacto</span><p>${escapeHTML(order.customer?.phone || '—')}${order.customer?.email ? `<br>${escapeHTML(order.customer.email)}` : ''}<br><strong>Cédula / RUC:</strong> ${escapeHTML(order.customer?.cedula || '—')}</p></div><div><span class="order-label">Entrega</span><p><strong>${escapeHTML(order.delivery?.label || '—')}</strong><br>${escapeHTML(order.customer?.city || '—')}${order.customer?.address ? ` · ${escapeHTML(order.customer.address)}` : ''}${order.customer?.mapsUrl ? `<br><a href="${escapeHTML(order.customer.mapsUrl)}" target="_blank" rel="noopener">📍 Abrir ubicación en Google Maps</a>` : ''}</p></div><div><span class="order-label">Total</span><p class="order-total">${money(order.total)}</p><small>Subtotal ${money(order.subtotal ?? order.total)} · Envío ${money(order.shippingCost ?? 0)}</small></div></div>
      <div class="order-payment-card ${paymentState}"><div class="order-payment-main"><div><span class="order-label">CONTROL DE PAGO</span><strong>${paymentLabel}</strong><small>Responsable: ${escapeHTML(responsible)}</small></div><span class="order-payment-badge">${paymentState === 'paid' ? '✓' : paymentState === 'partial' ? '!' : '$'}</span></div><div class="order-payment-numbers"><div><span>FACTURA</span><strong>${money(totalDue)}</strong></div><div><span>PAGADO</span><strong>${money(paid)}</strong></div><div class="order-payment-balance"><span>SALDO</span><strong>${money(balance)}</strong></div></div><div class="order-payment-footer"><small>${balance > 0.001 ? 'No se debe entregar hasta completar el pago.' : 'Pago completo registrado · entrega habilitada.'}</small><a href="${ADMIN_PATH}/dinero" data-smooth-route>Ver / registrar dinero →</a></div></div>
      <div class="admin-order-items" data-order-items-view="${escapeHTML(order.id)}">${(order.items || []).map(item => { const isRental=item.purchaseMode==='rental'; const days=Number(item.rentalDays||1); const ids=(item.deviceIdentifiers||[]).map(entry => `${entry.type==='imei'?'IMEI':'Serie'} ${entry.unit}: ${entry.primary}${entry.secondary?` / ${entry.secondary}`:''}`).join(' · '); return `<div class="admin-order-item"><span><strong>${escapeHTML(item.quantity)}×</strong> ${escapeHTML(item.name)} <small>SKU: ${escapeHTML(item.sku || '—')} · ${isRental ? `Alquiler · ${days} día${days===1?'':'s'} · ${money(item.unitPrice)}/día` : 'Compra'}${ids ? `<br><b class="order-device-id">${escapeHTML(ids)}</b>` : ''}</small></span><strong>${money(item.subtotal)}</strong></div>`; }).join('')}</div>
      <div class="admin-order-items-actions">
        <button class="button edit-note small" type="button" data-order-items-edit="${escapeHTML(order.id)}" disabled>Editar productos</button>
      </div>
      <div class="order-items-editor-modern" data-order-items-editor="${escapeHTML(order.id)}" hidden></div>
      ${order.customer?.notes ? `<div class="order-notes"><span>Nota</span><p>${escapeHTML(order.customer.notes)}</p></div>` : ''}
      <div class="admin-order-internal-note">
        <label for="internalNote-${escapeHTML(order.id)}">Nota interna</label>
        <textarea id="internalNote-${escapeHTML(order.id)}" data-order-note="${escapeHTML(order.id)}" rows="3" maxlength="5000" placeholder="Escribe aquí cualquier comentario interno sobre este pedido…" disabled>${escapeHTML(order.internalNote || '')}</textarea>
      </div>
      <div class="order-assignment">
        <div class="order-assignment-head"><span class="order-label">Asignado a</span><small>${isSellerRole(currentRole) ? 'Vendedor asignado a este pedido' : 'Vendedor responsable'}</small></div>
        ${canAssign
          ? (() => {
              const list = [...sellers];
              if (order.assignedSellerId && !list.some(s => String(s.id) === String(order.assignedSellerId))) {
                list.unshift({ id: order.assignedSellerId, name: order.assignedSellerName || 'Vendedor asignado', username: 'asignado' });
              }
              const selected = list.find(s => String(s.id) === String(order.assignedSellerId));
              const selectedName = selected?.name || 'Sin asignar';
              const selectedUsername = selected ? `@${selected.username || 'usuario'}` : 'Puedes seleccionar un vendedor';
              const initials = selected ? (String(selected.name || selected.username || 'V').trim().split(/\s+/).slice(0,2).map(part => part[0]).join('') || 'V').toUpperCase() : '?';
              const options = list.map(s => `<option value="${escapeHTML(s.id)}" ${String(s.id) === String(order.assignedSellerId) ? 'selected' : ''}>${escapeHTML(s.name)} · @${escapeHTML(s.username || 'usuario')}</option>`).join('');
              return `<div class="order-assignment-picker">
                <select class="order-assignment-select order-assignment-picker-source" data-order-assignment="${escapeHTML(order.id)}" aria-hidden="true" tabindex="-1" disabled><option value="">Sin asignar</option>${options}</select>
                <button type="button" class="fine-person-picker-trigger order-assignment-picker-trigger" data-order-assignment-picker="${escapeHTML(order.id)}" disabled aria-haspopup="dialog" aria-controls="orderSellerPickerModal">
                  <span class="fine-person-picker-avatar">${escapeHTML(initials)}</span>
                  <span class="fine-person-picker-copy"><strong>${escapeHTML(selectedName)}</strong><small>${escapeHTML(selectedUsername)}</small></span>
                  <span class="fine-person-picker-chevron">⌄</span>
                </button>
              </div>`;
            })()
          : `<div class="order-assignment-readonly">${escapeHTML(sellerName(order))}</div>`}
      </div>
      <div class="admin-order-footer">
        <button class="button pdf-order small" type="button" data-order-pdf="${escapeHTML(order.id)}" title="Generar PDF de esta orden">PDF ORDEN</button>
        ${['Enviado','Entregado'].includes(String(order.status || '')) ? `<button class="button primary small" type="button" data-order-notify-sale="${escapeHTML(order.id)}">NOTIFICAR VENTA</button>` : ''}
        ${canRefundCancelledRental ? `<button class="button secondary small" type="button" data-order-rental-refund="${escapeHTML(order.id)}">DEVOLVER DINERO</button>` : ''}
        <button class="button success small" type="button" data-order-note-save="${escapeHTML(order.id)}" disabled>Guardar cambios</button>
        <button class="button edit-note small" type="button" data-order-note-edit="${escapeHTML(order.id)}">Editar pedido</button>
        <button class="button order-edit-cancel small" type="button" data-order-edit-cancel="${escapeHTML(order.id)}" hidden>Cancelar</button>
        ${canDelete ? `<button class="button danger small" type="button" data-order-delete="${escapeHTML(order.id)}">Eliminar pedido</button>` : ''}
      </div>
    </div>
  </article>`;
  };
  const unassigned = orders.filter(order => !order.assignedSellerId);
  const assigned = orders.filter(order => Boolean(order.assignedSellerId));
  const renderSection = (title, description, items, extraClass = '') => items.length
    ? `<section class="orders-group ${extraClass}"><div class="orders-group-head"><div><span class="eyebrow">${escapeHTML(title)}</span><h3>${items.length} pedido${items.length === 1 ? '' : 's'}</h3></div><p>${escapeHTML(description)}</p></div>${items.map(renderOrder).join('')}</section>`
    : '';
  return `${renderSection('Sin vendedor · por despachar', 'Pedidos que todavía no tienen un vendedor responsable. Revísalos y asígnalos antes de despacharlos.', unassigned, 'orders-group-unassigned')}${renderSection('Pedidos asignados', 'Pedidos que ya tienen un vendedor responsable.', assigned, 'orders-group-assigned')}`;
}


function adminSectionNav(session = {}, active = '') {
  const role = String(session?.role || '').toLowerCase();
  const limitedOperations = role === 'vendedor' || role === 'orders' || role === 'store_manager';
  const navIcons = { web:'🌐', 'buscar-productos':'⌕', inventario:'▣', compras:'▤', pedidos:'▤', 'generar-orden':'＋', 'historial-ventas':'✓', usuarios:'♙', 'series-imeis':'◉', auditoria:'◌', clientes:'♙', movimientos:'↕', reportes:'▥', backups:'◫', 'resumen-financiero':'◒', dinero:'$', 'ventas-generales':'◔', multas:'!', 'calculo-comision':'%', };
  const link = (key, href, label) => {
    const icon = navIcons[key];
    const iconMarkup = icon ? `<span class="admin-nav-icon" aria-hidden="true">${icon}</span>` : '';
    return `<a href="${href}" class="admin-section-link${active === key ? ' active' : ''}" data-smooth-route>${iconMarkup}<span class="admin-nav-label">${label}</span></a>`;
  };
  if (limitedOperations) {
    // Vendedores y jefes tienen dos áreas claras: primero agendar la venta
    // y luego las herramientas para darle seguimiento/gestión.
    const saleItems = `${link('clientes', `${ADMIN_PATH}/clientes`, 'CLIENTES')}${link('pedidos', `${ADMIN_PATH}/pedidos`, 'PEDIDOS')}${link('generar-orden', `${ADMIN_PATH}/generar-orden`, 'GENERAR ORDEN')}`;
    const managementItems = `${link('buscar-productos', `${ADMIN_PATH}/buscar-productos`, 'BUSCAR PRODUCTOS')}${link('ventas-generales', `${ADMIN_PATH}/ventas-generales`, 'VENTAS GENERALES')}${link('historial-ventas', `${ADMIN_PATH}/historial-ventas`, 'HISTORIAL DE VENTAS')}${link('dinero', `${ADMIN_PATH}/dinero`, 'DINERO · COBROS')}${role === 'vendedor' || role === 'orders' ? '' : link('series-imeis', `${ADMIN_PATH}/series-imeis`, 'SERIES / IMEIS')}`;
    const saleActive = ['clientes','pedidos','generar-orden'].includes(active);
    const managementActive = ['buscar-productos','ventas-generales','historial-ventas','dinero','series-imeis'].includes(active);
    const limitedGroup = (label, items, isActive, extraClass = '') => `<details class="admin-nav-group admin-nav-group--limited ${extraClass}${isActive ? ' has-active' : ''}"><summary><span>${label}</span>${isActive ? '<i aria-hidden="true"></i>' : ''}</summary><div class="admin-nav-group-links admin-nav-group-links--limited">${items}</div></details>`;
    return `<div class="admin-navigation-stack admin-navigation-stack--limited"><nav class="admin-section-nav admin-section-nav--limited" id="adminSectionNav" aria-label="Navegación YHORS">${limitedGroup('AGENDAR VENTA', saleItems, saleActive, 'admin-nav-group--sales')}${limitedGroup('GESTIÓN', managementItems, managementActive, 'admin-nav-group--management')}</nav></div>`;
  }
  const group = (label, activeKeys, items, open = false) => `<details class="admin-nav-group${activeKeys.includes(active) ? ' has-active' : ''}"${open ? ' open' : ''}><summary><span>${label}</span>${activeKeys.includes(active) ? '<i aria-hidden="true"></i>' : ''}</summary><div class="admin-nav-group-links">${items}</div></details>`;
  return `<div class="admin-navigation-stack">
    <nav class="admin-section-nav" id="adminSectionNav" aria-label="Administración YHORS">
      ${group('Operación', ['web','inventario','buscar-productos','pedidos','generar-orden','historial-ventas','compras'], `${link('web', `${ADMIN_PATH}/web`, 'PÁGINA WEB')}${link('buscar-productos', `${ADMIN_PATH}/buscar-productos`, 'BUSCAR PRODUCTOS')}${link('inventario', `${ADMIN_PATH}/inventario`, 'INVENTARIO')}${link('compras', `${ADMIN_PATH}/compras`, 'COMPRAS / PROVEEDORES')}${link('pedidos', `${ADMIN_PATH}/pedidos`, 'PEDIDOS')}${link('generar-orden', `${ADMIN_PATH}/generar-orden`, 'GENERAR ORDEN')}${link('historial-ventas', `${ADMIN_PATH}/historial-ventas`, 'HISTORIAL DE VENTAS')}`)}
      ${group('Gestión', ['usuarios','series-imeis','auditoria','backups'], `${link('usuarios', `${ADMIN_PATH}/usuarios`, 'USUARIOS')}${link('series-imeis', `${ADMIN_PATH}/series-imeis`, 'SERIES/IMEIS')}${link('auditoria', `${ADMIN_PATH}/auditoria`, 'AUDITORÍA')}${link('backups', `${ADMIN_PATH}/backups`, 'BACKUPS')}`)}
      ${group('Empresa', ['clientes','movimientos','reportes'], `${link('clientes', `${ADMIN_PATH}/clientes`, 'CLIENTES · FICHERO')}${link('movimientos', `${ADMIN_PATH}/movimientos`, 'MOVIMIENTOS DE INVENTARIO')}${link('reportes', `${ADMIN_PATH}/reportes`, 'REPORTES')}`)}
      ${group('Finanzas', ['resumen-financiero','ventas-generales','dinero','multas','calculo-comision'], `${link('resumen-financiero', `${ADMIN_PATH}/resumen-financiero`, 'RESUMEN FINANCIERO')}${link('dinero', `${ADMIN_PATH}/dinero`, 'DINERO · COBROS')}${link('ventas-generales', `${ADMIN_PATH}/ventas-generales`, 'VENTAS GENERALES')}${link('multas', `${ADMIN_PATH}/multas`, 'MULTAS')}${link('calculo-comision', `${ADMIN_PATH}/calculo-comision`, 'CÁLCULO DE COMISIÓN')}`)}
    </nav>
  </div>`;
}

function generateOrderNav(session) {
  return adminSectionNav(session, 'generar-orden');
}

function customerSummaryMarkup(customer = {}) {
  const delivery = customer.deliveryMethod === 'office' ? 'Retiro en oficina' : customer.deliveryMethod === 'courier' ? 'Courier' : 'Envío YHORS';
  return `<div class="generate-customer-summary">
    <div><span>NOMBRE</span><strong>${escapeHTML(customer.name || 'Sin registrar')}</strong></div>
    <div><span>CÉDULA / RUC</span><strong>${escapeHTML(customer.cedula || '—')}</strong></div>
    <div><span>CELULAR</span><strong>${escapeHTML(customer.phone || '—')}</strong></div>
    <div><span>CORREO</span><strong>${escapeHTML(customer.email || '—')}</strong></div>
    <div><span>CIUDAD</span><strong>${escapeHTML(customer.city || '—')}</strong></div>
    <div><span>ENTREGA</span><strong>${escapeHTML(delivery)}</strong></div>
    <div class="full"><span>DIRECCIÓN</span><strong>${escapeHTML(customer.address || '—')}</strong></div>
  </div>`;
}

function isTechOrderProduct(product = {}) {
  return String(product.category || '').toLowerCase() === 'tech';
}
function isImeiOrderProduct(product = {}) {
  const type = String(product.productType || '').toLowerCase();
  const name = String(product.name || '').toLowerCase();
  return type.includes('celular') || type.includes('smartphone') || type.includes('mobile') || /\biphone\b|\bandroid\b|\btelefono\b|\bteléfono\b/.test(name);
}
function deviceIdentifierRowsMarkup(line) {
  if (!isTechOrderProduct(line) || line.purchaseMode === 'rental' || line.requiresDeviceIdentifier === false) return '';
  const quantity = Math.max(1, Math.min(99, Number(line.quantity || 1)));
  const imei = isImeiOrderProduct(line);
  const values = Array.isArray(line.deviceIdentifiers) ? line.deviceIdentifiers : [];
  const rows = Array.from({length: quantity}, (_, index) => {
    const value = values[index] || {};
    return `<div class="device-id-row" data-device-row="${index}">
      <span class="device-id-unit">Unidad ${index + 1}</span>
      <input class="device-id-input" data-device-primary type="text" inputmode="${imei ? 'numeric' : 'text'}" maxlength="${imei ? '16' : '50'}" value="${escapeHTML(value.primary || '')}" placeholder="${imei ? 'IMEI 1' : 'Número de serie'}" aria-label="${imei ? 'IMEI 1' : 'Número de serie'} unidad ${index + 1}">
      ${imei ? `<input class="device-id-input" data-device-secondary type="text" inputmode="numeric" maxlength="16" value="${escapeHTML(value.secondary || '')}" placeholder="IMEI 2 (opcional)" aria-label="IMEI 2 unidad ${index + 1}">` : ''}
    </div>`;
  }).join('');
  return `<div class="device-identifiers-panel" data-device-identifiers="${escapeHTML(line.id)}"><div class="device-identifiers-head"><div><strong>${imei ? 'IMEI del equipo' : 'Serie del equipo'}</strong><small>${imei ? 'Registra el IMEI 1 y, si aplica, el IMEI 2 de cada unidad.' : 'Registra el número de serie de cada unidad.'}</small></div><span>${imei ? 'CONTROL IMEI' : 'CONTROL DE SERIE'}</span></div><div class="device-identifiers-list">${rows}</div></div>`;
}
function syncDeviceIdentifiersFromDom(lines = []) {
  document.querySelectorAll('[data-device-identifiers]').forEach(panel => {
    const id = panel.dataset.deviceIdentifiers;
    const line = lines.find(item => item.id === id);
    if (!line) return;
    line.deviceIdentifiers = [...panel.querySelectorAll('.device-id-row')].map((row, index) => ({
      unit: index + 1,
      primary: row.querySelector('[data-device-primary]')?.value.trim() || '',
      secondary: row.querySelector('[data-device-secondary]')?.value.trim() || null,
      type: isImeiOrderProduct(line) ? 'imei' : 'serial'
    }));
  });
}

function generateOrderProductRows(lines = []) {
  if (!lines.length) return `<div class="generate-empty-state"><span>+</span><strong>Aún no hay productos</strong><small>Agrega productos desde el selector para comenzar la orden.</small></div>`;
  return lines.map(line => {
    const rental = line.purchaseMode === 'rental';
    const days = rental ? Math.max(1, Number(line.rentalDays || 1)) : 1;
    const unit = Number(line.price || 0);
    const total = unit * Number(line.quantity || 0) * (rental ? days : 1);
    const identifiers = deviceIdentifierRowsMarkup(line);
    return `<div class="generate-product-row${identifiers ? ' has-device-identifiers' : ''}" data-order-line="${escapeHTML(line.id)}">
      <div class="generate-product-info"><img src="${escapeHTML(productImages(line)[0])}" data-fallback alt=""><div><strong>${escapeHTML(line.name)}</strong><small>SKU: ${escapeHTML(line.sku || '—')} · ${rental ? `Alquiler · ${days} día${days === 1 ? '' : 's'}` : 'Compra'}</small></div></div>
      <div class="generate-qty"><button type="button" data-gen-qty="${escapeHTML(line.id)}" data-change="-1">−</button><strong>${escapeHTML(line.quantity)}</strong><button type="button" data-gen-qty="${escapeHTML(line.id)}" data-change="1">+</button>${rental ? `<select class="generate-rental-days" data-gen-days="${escapeHTML(line.id)}" aria-label="Días de alquiler">${Array.from({length:10},(_,i)=>i+1).map(day => `<option value="${day}" ${day === days ? 'selected' : ''}>${day} día${day===1?'':'s'}</option>`).join('')}</select>` : ''}</div>
      <strong class="generate-unit-price">${money(unit)}${rental ? ' / día' : ''}</strong>
      <strong class="generate-line-total">${money(total)}</strong>
      <button type="button" class="generate-remove" data-gen-remove="${escapeHTML(line.id)}" aria-label="Quitar producto">×</button>
      ${identifiers}
    </div>`;
  }).join('');
}

async function renderAdminGenerateOrder() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated: false }));
  if (!session.authenticated) return renderLogin();
  const role = String(session.role || '').toLowerCase();
  if (!['admin', 'store_manager', 'vendedor', 'orders'].includes(role)) return renderAdminOrders();

  const products = await request('/api/admin/order-products').catch(() => []);
  const sellers = await request('/api/admin/order-sellers').catch(() => []);
  let customer = {};
  let customerId = '';
  let customers = await request(`/api/admin/clientes?_=${Date.now()}`).catch(() => []);
  customers = await recoverCustomersFromLocalCache(Array.isArray(customers) ? customers : []);
  let lines = [];
  let saving = false;

  app.innerHTML = `<main class="admin-shell generate-order-shell"><div class="admin-wrap">
    <div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route aria-label="YHORS · Panel Administrativo · Ir a YHORS Inteligente"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></a><h1 class="admin-title">Generar orden</h1><p class="admin-subtitle">Facturación interna · crea una orden desde YHORS Administración</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>
    ${generateOrderNav(session)}
    <section class="generate-order-page">
      <div class="generate-order-header"><div><span class="eyebrow">Nueva orden</span><h2>Orden de venta</h2><p>Registra al cliente, selecciona sus productos y asigna el vendedor responsable.</p></div><div class="generate-doc-badge"><span>DOCUMENTO</span><strong>ORDEN DE PEDIDO</strong><small>YHORS · ${new Date().toLocaleDateString('es-EC')}</small></div></div>
      <div class="generate-top-grid">
        <section class="generate-card customer-card"><div class="generate-card-head"><div><span class="generate-card-kicker">01 · Cliente</span><h3>Información del cliente</h3></div><div class="customer-card-actions"><button type="button" class="button secondary small" id="editSelectedCustomer" ${customer.id ? "" : "disabled"}>Editar cliente</button><button type="button" class="button secondary small" id="openCustomerModal">Cambiar cliente →</button></div></div><div id="customerSummary">${customerSummaryMarkup(customer)}</div></section>
        <section class="generate-card seller-card"><div class="generate-card-kicker">02 · Responsable</div><h3>Vendedor</h3><p>Define quién queda responsable de esta orden.</p><div class="fine-person-field generate-seller-field"><span>Vendedor asignado</span><button type="button" class="fine-person-picker-trigger" id="generateSellerPickerOpen" aria-haspopup="dialog" aria-controls="generateSellerPickerModal"><span class="fine-person-picker-avatar" id="generateSellerAvatar">?</span><span class="fine-person-picker-copy"><strong id="generateSellerName">Sin asignar</strong><small id="generateSellerUsername">Puedes buscar y seleccionar un vendedor</small></span><span class="fine-person-picker-chevron">⌄</span></button><input type="hidden" id="generateSeller" value="${sellers.some(s => s.id === session.accountId) ? escapeHTML(session.accountId) : ''}"></div><small class="generate-field-note">${role === 'vendedor' || role === 'orders' ? 'Puedes generar la orden con tu usuario o asignarla a otro vendedor.' : 'Puedes cambiar el vendedor antes de generar la orden.'}</small></section>
      </div>
      <section class="generate-card generate-products-card"><div class="generate-card-head"><div><span class="generate-card-kicker">03 · Productos</span><h3>Detalle de la orden</h3></div><button type="button" class="button primary small" id="openProductPicker">+ Agregar productos</button></div><div class="generate-products-table-head"><span>Producto</span><span>Cant.</span><span>Precio</span><span>Total</span><span></span></div><div id="generateOrderLines">${generateOrderProductRows(lines)}</div></section>
      <section class="generate-bottom-grid">
        <section class="generate-card delivery-card"><div class="generate-card-kicker">04 · Entrega</div><h3>Forma de entrega</h3><div class="generate-delivery-options"><label><input type="radio" name="generateDelivery" value="office" checked><span><strong>Retiro en oficina</strong><small>Sin costo</small></span></label><label><input type="radio" name="generateDelivery" value="local"><span><strong>Envío YHORS</strong><small>$3,00</small></span></label><label><input type="radio" name="generateDelivery" value="courier"><span><strong>Courier</strong><small>$5,00</small></span></label></div><label class="generate-field"><span>Notas de la orden</span><textarea id="generateNotes" rows="4" maxlength="500" placeholder="Referencia, horario u otra indicación"></textarea></label></section>
        <section class="generate-card totals-card"><div class="generate-card-kicker">Resumen</div><div class="generate-total-line"><span>Subtotal</span><strong id="generateSubtotal">$0,00</strong></div><div class="generate-total-line"><span>Envío</span><strong id="generateShipping">$0,00</strong></div><div class="generate-grand-total"><span>Total</span><strong id="generateTotal">$0,00</strong></div><div id="generateMessage" class="message" hidden></div><button type="button" class="button generate-submit" id="generateOrderSubmit">Generar orden <span>→</span></button></section>
      </section>
    </section>
    <div class="generate-modal" id="customerModal" hidden><div class="generate-modal-backdrop" data-close-generate-modal="customerModal"></div><div class="generate-modal-dialog generate-customer-picker" role="dialog" aria-modal="true" aria-labelledby="customerModalTitle"><div class="generate-modal-head"><div><span class="eyebrow">Fichero de clientes</span><h2 id="customerModalTitle">Seleccionar cliente</h2><p class="generate-customer-modal-subtitle">Busca por nombre, cédula o teléfono. Si no existe, puedes registrarlo una sola vez.</p></div><button type="button" class="generate-modal-close" data-close-generate-modal="customerModal">×</button></div><div id="customerPickerView"><div class="generate-customer-searchbar"><span aria-hidden="true">⌕</span><input id="generateCustomerSearch" type="search" placeholder="Buscar nombre, cédula o teléfono…" autocomplete="off"><button type="button" class="button secondary small" id="generateNewCustomer">+ Nuevo cliente</button></div><div class="generate-customer-picker-count" id="generateCustomerPickerCount"></div><div class="generate-customer-picker-list" id="generateCustomerPickerList"></div></div><form id="generateCustomerForm" class="generate-new-customer-form" hidden><div class="generate-new-customer-head"><button type="button" class="button secondary small" id="backToCustomerSearch">← Volver a buscar</button><span class="eyebrow">Nuevo expediente</span></div><div class="form-grid"><div class="field full"><label for="genCustomerName">Nombre completo</label><input id="genCustomerName" required maxlength="100" placeholder="Nombre del cliente"></div><div class="field"><label for="genCustomerCedula">Cédula / RUC</label><input id="genCustomerCedula" required inputmode="numeric" maxlength="13" placeholder="0102030405"></div><div class="field"><label for="genCustomerPhone">Celular</label><input id="genCustomerPhone" required maxlength="40" placeholder="099 999 9999"></div><div class="field"><label for="genCustomerEmail">Correo</label><input id="genCustomerEmail" type="email" maxlength="120" placeholder="cliente@correo.com"></div><div class="field"><label for="genCustomerCity">Ciudad</label><input id="genCustomerCity" required maxlength="80" placeholder="Quito"></div><div class="field full"><label for="genCustomerAddress">Dirección</label><input id="genCustomerAddress" maxlength="240" placeholder="Dirección de entrega"></div><div class="field full"><label for="genCustomerMaps">Google Maps (opcional)</label><input id="genCustomerMaps" type="url" maxlength="500" placeholder="https://maps.google.com/..."></div></div><div class="generate-modal-actions"><button type="button" class="button secondary" id="cancelNewCustomer">Cancelar</button><button type="submit" class="button primary">Guardar y seleccionar</button></div><div id="generateCustomerMessage" class="message" hidden></div></form></div></div></div>
    <div class="generate-modal" id="productPickerModal" hidden><div class="generate-modal-backdrop" data-close-generate-modal="productPickerModal"></div><div class="generate-modal-dialog generate-product-picker" role="dialog" aria-modal="true" aria-labelledby="productPickerTitle"><div class="generate-modal-head"><div><span class="eyebrow">Catálogo YHORS</span><h2 id="productPickerTitle">Agregar productos</h2></div><button type="button" class="generate-modal-close" data-close-generate-modal="productPickerModal">×</button></div><div class="generate-picker-toolbar"><input id="generateProductSearch" type="search" placeholder="Buscar por nombre, SKU, marca…"><select id="generateProductCategory"><option value="">Todas las categorías</option><option value="elegant">Elegante</option><option value="sports">Deportes</option><option value="tech">Tech</option><option value="cosplay">Cosplay</option><option value="pets">Mascotas</option><option value="details">Details</option><option value="collectibles">Coleccionables</option></select></div><div class="generate-picker-list" id="generatePickerList"></div><div class="generate-modal-actions"><span class="generate-picker-hint">Puedes agregar varios productos y cantidades antes de cerrar.</span><button type="button" class="button primary" data-close-generate-modal="productPickerModal">Listo</button></div></div></div></div>
    <div class="generate-modal fine-person-modal" id="generateSellerPickerModal" hidden><div class="generate-modal-backdrop" data-close-generate-seller></div><div class="generate-modal-dialog fine-person-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="generateSellerPickerTitle"><div class="generate-modal-head"><div><span class="eyebrow">Nueva orden · Responsable</span><h2 id="generateSellerPickerTitle">Seleccionar vendedor</h2><p class="fine-person-picker-subtitle">Busca al vendedor que quedará responsable de esta orden.</p></div><button type="button" class="generate-modal-close" data-close-generate-seller aria-label="Cerrar">×</button></div><div class="fine-person-picker-toolbar"><input id="generateSellerSearch" type="search" placeholder="Buscar por nombre o usuario…" autocomplete="off"></div><div class="fine-person-picker-count" id="generateSellerPickerCount"></div><div class="fine-person-picker-list" id="generateSellerPickerList"></div></div></div></div>
  </div></main>`;

  const openModal = id => { const modal = document.getElementById(id); if (!modal) return; modal.hidden = false; requestAnimationFrame(() => modal.classList.add('is-open')); document.body.classList.add('generate-modal-open'); };
  const closeModal = id => { const modal = document.getElementById(id); if (!modal) return; modal.classList.remove('is-open'); setTimeout(() => { modal.hidden = true; if (!document.querySelector('.generate-modal.is-open')) document.body.classList.remove('generate-modal-open'); }, 180); };
  document.querySelectorAll('[data-close-generate-modal]').forEach(el => el.addEventListener('click', () => closeModal(el.dataset.closeGenerateModal)));
  document.querySelector('#openProductPicker')?.addEventListener('click', () => { drawPicker(); openModal('productPickerModal'); });

  const generateSellerModal = document.querySelector('#generateSellerPickerModal');
  const generateSellerSearch = document.querySelector('#generateSellerSearch');
  const generateSellerList = document.querySelector('#generateSellerPickerList');
  const generateSellerCount = document.querySelector('#generateSellerPickerCount');
  const generateSellerInput = document.querySelector('#generateSeller');
  const generateSellerName = document.querySelector('#generateSellerName');
  const generateSellerUsername = document.querySelector('#generateSellerUsername');
  const generateSellerAvatar = document.querySelector('#generateSellerAvatar');
  const sellerInitials = name => (String(name || 'V').trim().split(/\s+/).slice(0,2).map(part => part[0]).join('') || 'V').toUpperCase();
  const updateGenerateSellerDisplay = () => {
    const selected = sellers.find(s => String(s.id) === String(generateSellerInput?.value || ''));
    if (!selected) {
      if (generateSellerName) generateSellerName.textContent = 'Sin asignar';
      if (generateSellerUsername) generateSellerUsername.textContent = 'Puedes buscar y seleccionar un vendedor';
      if (generateSellerAvatar) generateSellerAvatar.textContent = '?';
      return;
    }
    if (generateSellerName) generateSellerName.textContent = selected.name || selected.username || 'Vendedor';
    if (generateSellerUsername) generateSellerUsername.textContent = `@${selected.username || 'usuario'}`;
    if (generateSellerAvatar) generateSellerAvatar.textContent = sellerInitials(selected.name || selected.username);
  };
  const renderGenerateSellerPicker = () => {
    if (!generateSellerList) return;
    const query = (generateSellerSearch?.value || '').trim().toLowerCase();
    const filtered = sellers.filter(s => `${s.name || ''} ${s.username || ''}`.toLowerCase().includes(query));
    if (generateSellerCount) generateSellerCount.textContent = `${filtered.length} vendedor${filtered.length === 1 ? '' : 'es'} disponible${filtered.length === 1 ? '' : 's'}`;
    generateSellerList.innerHTML = filtered.length ? filtered.map(s => {
      const selected = String(generateSellerInput?.value || '') === String(s.id);
      return `<button type="button" class="fine-person-option${selected ? ' is-selected' : ''}" data-select-generate-seller="${escapeHTML(s.id)}"><span class="fine-person-option-avatar">${escapeHTML(sellerInitials(s.name || s.username))}</span><span class="fine-person-option-copy"><strong>${escapeHTML(s.name || s.username || 'Vendedor')}</strong><small>@${escapeHTML(s.username || 'usuario')} · Vendedor</small></span><span class="fine-person-option-check">${selected ? '✓' : '›'}</span></button>`;
    }).join('') : `<div class="fine-person-empty"><span>⌕</span><strong>No encontramos a ese vendedor</strong><small>Prueba con otro nombre o usuario.</small></div>`;
  };
  const openGenerateSellerPicker = () => {
    if (!generateSellerModal) return;
    generateSellerModal.hidden = false;
    document.body.classList.add('generate-modal-open');
    requestAnimationFrame(() => { generateSellerModal.classList.add('is-open'); generateSellerSearch?.focus(); });
    renderGenerateSellerPicker();
  };
  const closeGenerateSellerPicker = () => {
    if (!generateSellerModal) return;
    generateSellerModal.classList.remove('is-open');
    setTimeout(() => { if (generateSellerModal) generateSellerModal.hidden = true; if (!document.querySelector('.generate-modal.is-open')) document.body.classList.remove('generate-modal-open'); }, 180);
  };
  document.querySelector('#generateSellerPickerOpen')?.addEventListener('click', openGenerateSellerPicker);
  generateSellerSearch?.addEventListener('input', renderGenerateSellerPicker);
  generateSellerModal?.querySelectorAll('[data-close-generate-seller]').forEach(el => el.addEventListener('click', closeGenerateSellerPicker));
  generateSellerModal?.addEventListener('click', event => {
    const option = event.target.closest('[data-select-generate-seller]');
    if (!option) return;
    if (generateSellerInput) generateSellerInput.value = option.dataset.selectGenerateSeller || '';
    updateGenerateSellerDisplay();
    closeGenerateSellerPicker();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && generateSellerModal?.classList.contains('is-open')) closeGenerateSellerPicker(); });
  updateGenerateSellerDisplay();

  function fillCustomerForm() {
    document.querySelector('#genCustomerName').value = customer.name || '';
    document.querySelector('#genCustomerCedula').value = customer.cedula || '';
    document.querySelector('#genCustomerPhone').value = customer.phone || '';
    document.querySelector('#genCustomerEmail').value = customer.email || '';
    document.querySelector('#genCustomerCity').value = customer.city || '';
    document.querySelector('#genCustomerAddress').value = customer.address || '';
    document.querySelector('#genCustomerMaps').value = customer.mapsUrl || '';
  }
  function drawCustomer() {
    customer.deliveryMethod = document.querySelector('input[name="generateDelivery"]:checked')?.value || 'office';
    document.querySelector('#customerSummary').innerHTML = customerSummaryMarkup(customer);
    document.querySelector('#openCustomerModal').textContent = `${customer.name ? 'Cambiar cliente' : 'Buscar / seleccionar'} →`;
    const editSelected = document.querySelector('#editSelectedCustomer');
    if (editSelected) editSelected.disabled = !customer.id;
  }
  const customerLabel = c => `${c.name || 'Sin nombre'} ${c.cedula || ''} ${c.phone || ''} ${c.email || ''} ${c.city || ''}`.toLowerCase();
  const renderGenerateCustomerPicker = () => {
    const q = (document.querySelector('#generateCustomerSearch')?.value || '').trim().toLowerCase();
    const rows = customers.filter(c => !q || customerLabel(c).includes(q));
    const count = document.querySelector('#generateCustomerPickerCount');
    if (count) count.textContent = `${rows.length} cliente${rows.length === 1 ? '' : 's'}${q ? ' encontrados' : ''}`;
    const list = document.querySelector('#generateCustomerPickerList');
    if (!list) return;
    list.innerHTML = rows.length ? rows.map(c => `<button type="button" class="generate-customer-option${String(c.id) === String(customerId) ? ' is-selected' : ''}" data-select-generate-customer="${escapeHTML(c.id)}"><span class="generate-customer-option-avatar">${escapeHTML((c.name || 'C').trim().slice(0,1).toUpperCase())}</span><span class="generate-customer-option-copy"><strong>${escapeHTML(c.name || 'Sin nombre')}</strong><small>${escapeHTML(c.cedula || 'Sin cédula')} · ${escapeHTML(c.phone || 'Sin teléfono')}</small></span><span class="generate-customer-option-check">${String(c.id) === String(customerId) ? '✓' : '›'}</span></button>`).join('') : '<div class="generate-customer-empty"><span>⌕</span><strong>No encontramos ese cliente</strong><small>Prueba con otro dato o registra un cliente nuevo.</small></div>';
  };
  const openCustomerPicker = async () => {
    document.querySelector('#customerPickerView')?.removeAttribute('hidden');
    document.querySelector('#generateCustomerForm')?.setAttribute('hidden','');
    document.querySelector('#generateCustomerMessage')?.setAttribute('hidden','');
    const input = document.querySelector('#generateCustomerSearch');
    if (input) input.value = '';
    try { customers = await request(`/api/admin/clientes?_=${Date.now()}`); } catch {}
    customers = await recoverCustomersFromLocalCache(Array.isArray(customers) ? customers : []);
    renderGenerateCustomerPicker();
    openModal('customerModal');
    requestAnimationFrame(() => input?.focus());
  };
  document.querySelector('#generateCustomerSearch')?.addEventListener('input', renderGenerateCustomerPicker);
  const openGenerateCustomerEdit = (selected) => {
    if (!selected) return;
    document.querySelector('#customerPickerView')?.setAttribute('hidden','');
    document.querySelector('#generateCustomerForm')?.removeAttribute('hidden');
    document.querySelector('#generateCustomerMessage')?.setAttribute('hidden','');
    const form = document.querySelector('#generateCustomerForm');
    form.dataset.editCustomerId = String(selected.id);
    const head = form.querySelector('.generate-new-customer-head');
    if (head) head.innerHTML = `<button type="button" class="button secondary small" id="backToCustomerSearch">← Volver a buscar</button><span class="eyebrow">EDITAR EXPEDIENTE</span>`;
    form.querySelector('#genCustomerName').value = selected.name || '';
    form.querySelector('#genCustomerCedula').value = selected.cedula || '';
    form.querySelector('#genCustomerPhone').value = selected.phone || '';
    form.querySelector('#genCustomerEmail').value = selected.email || '';
    form.querySelector('#genCustomerCity').value = selected.city || '';
    form.querySelector('#genCustomerAddress').value = selected.address || '';
    form.querySelector('#genCustomerMaps').value = selected.mapsUrl || '';
    const submit = form.querySelector('button[type="submit"]');
    if (submit) submit.textContent = 'Guardar cambios';
    form.querySelector('#cancelNewCustomer').textContent = 'Cancelar';
    form.querySelector('#backToCustomerSearch')?.addEventListener('click', () => {
      form.dataset.editCustomerId = '';
      if (submit) submit.textContent = 'Guardar y seleccionar';
      document.querySelector('#generateCustomerForm')?.setAttribute('hidden','');
      document.querySelector('#customerPickerView')?.removeAttribute('hidden');
      renderGenerateCustomerPicker();
      document.querySelector('#generateCustomerSearch')?.focus();
    }, { once: true });
    form.querySelector('#genCustomerName')?.focus();
    openModal('customerModal');
  };
  document.querySelector('#editSelectedCustomer')?.addEventListener('click', () => {
    if (!customer?.id) return;
    openGenerateCustomerEdit(customer);
  });
  document.querySelector('#generateCustomerPickerList')?.addEventListener('click', event => {
    const button = event.target.closest('[data-select-generate-customer]');
    if (!button) return;
    const selected = customers.find(c => String(c.id) === String(button.dataset.selectGenerateCustomer));
    if (!selected) return;
    customerId = selected.id;
    customer = { ...selected };
    drawCustomer();
    closeModal('customerModal');
  });
  document.querySelector('#generateNewCustomer')?.addEventListener('click', () => {
    const form = document.querySelector('#generateCustomerForm');
    form?.removeAttribute('data-edit-customer-id');
    const head = form?.querySelector('.generate-new-customer-head');
    if (head) head.innerHTML = `<button type="button" class="button secondary small" id="backToCustomerSearch">← Volver a buscar</button><span class="eyebrow">NUEVO EXPEDIENTE</span>`;
    const submit = form?.querySelector('button[type="submit"]');
    if (submit) submit.textContent = 'Guardar y seleccionar';
    form?.querySelector('#backToCustomerSearch')?.addEventListener('click', () => {
      form.setAttribute('hidden','');
      document.querySelector('#customerPickerView')?.removeAttribute('hidden');
      renderGenerateCustomerPicker();
      document.querySelector('#generateCustomerSearch')?.focus();
    }, { once: true });
    document.querySelector('#customerPickerView')?.setAttribute('hidden','');
    form?.removeAttribute('hidden');
    document.querySelector('#generateCustomerMessage')?.setAttribute('hidden','');
    fillCustomerForm();
    document.querySelector('#genCustomerName')?.focus();
  });
  document.querySelector('#backToCustomerSearch')?.addEventListener('click', () => {
    const form = document.querySelector('#generateCustomerForm');
    form?.removeAttribute('data-edit-customer-id');
    const submit = form?.querySelector('button[type="submit"]');
    if (submit) submit.textContent = 'Guardar y seleccionar';
    document.querySelector('#generateCustomerForm')?.setAttribute('hidden','');
    document.querySelector('#customerPickerView')?.removeAttribute('hidden');
    renderGenerateCustomerPicker();
    document.querySelector('#generateCustomerSearch')?.focus();
  });
  document.querySelector('#cancelNewCustomer')?.addEventListener('click', () => closeModal('customerModal'));
  document.querySelector('#openCustomerModal')?.addEventListener('click', openCustomerPicker);
  function drawLines() { document.querySelector('#generateOrderLines').innerHTML = generateOrderProductRows(lines); wireImageFallback(document.querySelector('#generateOrderLines')); updateTotals(); }
  function updateTotals() { const subtotal = lines.reduce((sum, line) => sum + Number(line.price || 0) * Number(line.quantity || 0) * (line.purchaseMode === 'rental' ? Math.max(1, Number(line.rentalDays || 1)) : 1), 0); const delivery = document.querySelector('input[name="generateDelivery"]:checked')?.value || 'office'; const shipping = delivery === 'local' ? 3 : delivery === 'courier' ? 5 : 0; document.querySelector('#generateSubtotal').textContent = money(subtotal); document.querySelector('#generateShipping').textContent = money(shipping); document.querySelector('#generateTotal').textContent = money(subtotal + shipping); customer.deliveryMethod = delivery; document.querySelector('#customerSummary') && drawCustomer(); }
  function addProduct(product, mode='purchase') { const rental = mode === 'rental'; if (rental && !(product.category === 'cosplay' && product.isRental === true && Number.isFinite(Number(product.rentalPrice)))) return; const id = `${product.id}::${mode}`; const existing = lines.find(line => line.id === id); if (existing) existing.quantity = Math.min(99, Number(existing.quantity || 0) + 1); else lines.push({ ...product, id, productId: product.id, requiresDeviceIdentifier: product.requiresDeviceIdentifier !== false, price: Number(rental ? product.rentalPrice : (product.salePrice ?? product.price)), purchaseMode: mode, rentalDays: rental ? 1 : null, quantity: 1 }); drawLines(); }
  function drawPicker() { const query = (document.querySelector('#generateProductSearch')?.value || '').trim().toLowerCase(); const category = document.querySelector('#generateProductCategory')?.value || ''; const filtered = products.filter(product => { const hay = `${product.name || ''} ${product.sku || ''} ${product.brand || ''} ${product.productType || ''}`.toLowerCase(); return (!query || hay.includes(query)) && (!category || product.category === category); }); const list = document.querySelector('#generatePickerList'); list.innerHTML = filtered.length ? filtered.map(product => { const stock = Number(product.stock || 0); const rental = product.category === 'cosplay' && product.isRental === true && Number.isFinite(Number(product.rentalPrice)); return `<article class="generate-picker-product"><img src="${escapeHTML(productImages(product)[0])}" data-fallback alt=""><div class="generate-picker-info"><strong>${escapeHTML(product.name)}</strong><small>SKU: ${escapeHTML(product.sku || '—')} · ${escapeHTML(categories[product.category] || product.category || 'Producto')}</small><b>${money(product.salePrice ?? product.price ?? 0)} · Stock ${stock}</b></div><div class="generate-picker-actions"><button type="button" class="button primary small" data-add-generate="${escapeHTML(product.id)}" data-mode="purchase">Agregar</button>${rental ? `<button type="button" class="button secondary small" data-add-generate="${escapeHTML(product.id)}" data-mode="rental">Alquiler</button>` : ''}</div></article>`; }).join('') : '<div class="generate-empty-state"><span>⌕</span><strong>No encontramos productos</strong><small>Prueba con otro nombre, SKU o categoría.</small></div>'; wireImageFallback(list); list.querySelectorAll('[data-add-generate]').forEach(button => button.addEventListener('click', () => { const product = products.find(item => item.id === button.dataset.addGenerate); if (product) addProduct(product, button.dataset.mode); })); }
  document.querySelector('#generateProductSearch')?.addEventListener('input', drawPicker); document.querySelector('#generateProductCategory')?.addEventListener('change', drawPicker);
  document.querySelector('#generateCustomerForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const message = document.querySelector('#generateCustomerMessage');
    const form = event.currentTarget;
    const editingId = form.dataset.editCustomerId || '';

    const cedula = document.querySelector('#genCustomerCedula').value.replace(/\D/g, '');
    if (!/^\d{10,13}$/.test(cedula)) { message.hidden = false; message.className = 'message error'; message.textContent = 'La cédula/RUC debe tener entre 10 y 13 dígitos.'; return; }
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    submit.disabled = true;
    const payload = {
      name: document.querySelector('#genCustomerName').value.trim(),
      cedula,
      phone: document.querySelector('#genCustomerPhone').value.trim(),
      email: document.querySelector('#genCustomerEmail').value.trim(),
      city: document.querySelector('#genCustomerCity').value.trim(),
      address: document.querySelector('#genCustomerAddress').value.trim(),
      mapsUrl: document.querySelector('#genCustomerMaps').value.trim()
    };
    try {
      if (editingId) {
        const saved = await request(`/api/admin/clientes/${encodeURIComponent(editingId)}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
        customers = [saved, ...customers.filter(item => String(item.id) !== String(saved.id))];
        writeLocalCustomerCache(customers);
        customerId = saved.id;
        customer = { ...saved, deliveryMethod: document.querySelector('input[name="generateDelivery"]:checked')?.value || 'office' };
        drawCustomer();
        closeModal('customerModal');
        return;
      }
      const created = await request('/api/admin/clientes', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
      customerId = created.id;
      customer = { ...created, deliveryMethod: document.querySelector('input[name="generateDelivery"]:checked')?.value || 'office' };
      customers = [created, ...customers.filter(item => String(item.id) !== String(created.id))];
      writeLocalCustomerCache(customers);
      drawCustomer();
      closeModal('customerModal');
    } catch (error) {
      const existing = error?.data?.customer || error?.customer;
      if (existing) {
        try { customers = await request(`/api/admin/clientes?_=${Date.now()}`); } catch {}
        customers = await recoverCustomersFromLocalCache(Array.isArray(customers) ? customers : []);
        const selected = customers.find(item => String(item.id) === String(existing.id)) || existing;
        customerId = selected.id;
        customer = { ...selected, deliveryMethod: document.querySelector('input[name="generateDelivery"]:checked')?.value || 'office' };
        customers = [selected, ...customers.filter(item => String(item.id) !== String(selected.id))];
        drawCustomer();
        closeModal('customerModal');
      } else {
        message.hidden = false; message.className = 'message error'; message.textContent = error.message || 'No se pudo guardar el cliente.';
        submit.disabled = false;
      }
    }
  });
  document.querySelector('#generateOrderLines')?.addEventListener('input', event => { if (event.target.closest('[data-device-identifiers]')) syncDeviceIdentifiersFromDom(lines); });
  document.querySelector('#generateOrderLines')?.addEventListener('click', event => { syncDeviceIdentifiersFromDom(lines); const qtyButton = event.target.closest('[data-gen-qty]'); if (qtyButton) { const line = lines.find(item => item.id === qtyButton.dataset.genQty); if (!line) return; line.quantity = Math.max(1, Math.min(99, Number(line.quantity || 1) + Number(qtyButton.dataset.change || 0))); drawLines(); return; } const remove = event.target.closest('[data-gen-remove]'); if (remove) { lines = lines.filter(item => item.id !== remove.dataset.genRemove); drawLines(); } });
  document.querySelector('#generateOrderLines')?.addEventListener('change', event => { const select = event.target.closest('[data-gen-days]'); if (!select) return; const line = lines.find(item => item.id === select.dataset.genDays); if (!line) return; line.rentalDays = Math.max(1, Math.min(10, Number(select.value) || 1)); drawLines(); });
  document.querySelectorAll('input[name="generateDelivery"]').forEach(input => input.addEventListener('change', updateTotals));
  document.querySelector('#generateOrderSubmit')?.addEventListener('click', async () => { if (saving) return; const message = document.querySelector('#generateMessage'); message.hidden = true; if (!customer.name || !customer.phone || !customer.cedula || !customer.city) { message.hidden = false; message.className = 'message error'; message.textContent = 'Completa los datos del cliente antes de generar la orden.'; openModal('customerModal'); return; } if (!lines.length) { message.hidden = false; message.className = 'message error'; message.textContent = 'Agrega al menos un producto a la orden.'; openModal('productPickerModal'); return; } const deliveryMethod = document.querySelector('input[name="generateDelivery"]:checked')?.value || 'office'; if (deliveryMethod !== 'office' && !customer.address) { message.hidden = false; message.className = 'message error'; message.textContent = 'Ingresa la dirección del cliente para el envío seleccionado.'; openModal('customerModal'); return; } const submit = document.querySelector('#generateOrderSubmit');
    const confirmed = await showYhorsConfirm(
      '¿Deseas generar esta orden?',
      'Si continúas, la orden se registrará y se actualizará el inventario. Si eliges <strong>Cancelar</strong>, puedes seguir agregando o modificando productos.',
      { cancelText: 'Cancelar', confirmText: 'Generar orden' }
    );
    if (!confirmed) return;
    saving = true; submit.disabled = true; submit.classList.add('is-loading'); submit.innerHTML = 'Generando…'; try { const assignedSellerId = document.querySelector('#generateSeller')?.value || null; syncDeviceIdentifiersFromDom(lines); const identifierError = lines.find(line => { if (!isTechOrderProduct(line) || line.purchaseMode === 'rental' || line.requiresDeviceIdentifier === false) return false; const entries = line.deviceIdentifiers || []; if (entries.length < Number(line.quantity || 1)) return true; return entries.some(entry => isImeiOrderProduct(line) ? !/^\d{14,16}$/.test(String(entry.primary || '')) : !/^[A-Za-z0-9._\-/ ]{3,50}$/.test(String(entry.primary || ''))); }); if (identifierError) { message.hidden = false; message.className = 'message error'; message.textContent = isImeiOrderProduct(identifierError) ? `Completa correctamente el IMEI 1 de cada unidad de “${identifierError.name}” (14–16 dígitos).` : `Completa el número de serie de cada unidad de “${identifierError.name}”.`; saving = false; submit.disabled = false; submit.classList.remove('is-loading'); submit.innerHTML = 'Generar orden <span>→</span>'; return; } const payload = { customerId: customerId || null, customer: { ...customer, notes: document.querySelector('#generateNotes').value.trim() }, deliveryMethod, assignedSellerId, items: lines.map(line => ({ productId: line.productId || line.id, quantity: Number(line.quantity), purchaseMode: line.purchaseMode || 'purchase', rentalDays: line.purchaseMode === 'rental' ? Math.max(1, Number(line.rentalDays || 1)) : null, deviceIdentifiers: Array.isArray(line.deviceIdentifiers) ? line.deviceIdentifiers : [] })) }; const result = await request('/api/admin/generar-orden', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) }); app.querySelector('.generate-order-page').innerHTML = `<div class="generate-success"><span class="success-mark">✓</span><span class="eyebrow">Orden generada correctamente</span><h2>#${escapeHTML(result.orderNumber)}</h2><p>La orden quedó registrada en YHORS y el inventario se actualizó. Antes de entregar, registra el pago completo.</p><div class="generate-success-total">Total: <strong>${money(result.total)}</strong></div><div class="generate-payment-status" id="generatedPaymentStatus"><span>ESTADO DEL PAGO</span><strong>PENDIENTE</strong><small>Debes registrar el pago completo para habilitar la entrega.</small></div><div class="generate-success-actions"><button type="button" class="button primary" id="generateAnotherOrder">Nueva orden</button><a class="button secondary" href="${ADMIN_PATH}/pedidos" data-smooth-route>Ver pedidos</a>${result.orderId ? `<button type="button" class="button secondary" data-generated-pdf="${escapeHTML(result.orderId)}">PDF de orden</button><button type="button" class="button secondary generated-payment-open" data-generated-payment="${escapeHTML(result.orderId)}">REGISTRAR PAGO</button><button type="button" class="button primary generated-notify-sale" data-generated-notify-sale="${escapeHTML(result.orderId)}" disabled title="Registra el pago completo para habilitar la entrega.">NOTIFICAR VENTA · PAGO INCOMPLETO</button>` : ''}</div><div class="message" id="generatedNotifyMessage" hidden></div></div><div class="generate-payment-modal" id="generatePaymentModal" hidden><div class="generate-payment-backdrop" data-close-generate-payment></div><div class="generate-payment-dialog"><div class="generate-payment-head"><div><span class="eyebrow">INGRESO DE DINERO</span><h3>Registrar pago de la orden</h3><small>#${escapeHTML(result.orderNumber)} · ${money(result.total)}</small></div><button type="button" class="generate-payment-close" data-close-generate-payment>×</button></div><div class="generate-payment-summary" id="generatePaymentSummary"><div><span>TOTAL</span><strong>${money(result.total)}</strong></div><div><span>PAGADO</span><strong id="generatePaid">$0.00</strong></div><div class="balance"><span>SALDO</span><strong id="generateBalance">${money(result.total)}</strong></div></div><form id="generatePaymentForm"><div class="form-grid"><div class="field"><label>Forma de pago</label><select id="generatePaymentMethod"><option value="cash">Efectivo</option><option value="transfer">Transferencia</option><option value="card">Tarjeta</option></select></div><div class="field"><label>Valor</label><input id="generatePaymentAmount" type="number" min="0.01" step="0.01" value="${Number(result.total||0).toFixed(2)}" required></div><div class="field"><label>Fecha</label><input id="generatePaymentDate" type="date" value="${new Date().toLocaleDateString('en-CA',{timeZone:'America/Guayaquil'})}" required></div><div class="field"><label>Banco / caja</label><input id="generatePaymentBank" maxlength="100" placeholder="Pichincha, Guayaquil, Caja principal…" required></div><div class="field generate-payment-extra"><label>Lote <small>(opcional)</small></label><input id="generatePaymentBatch" maxlength="100" placeholder="Lote"></div><div class="field generate-payment-extra"><label>N.º de transacción</label><input id="generatePaymentTransaction" maxlength="120" placeholder="TRX-000000"></div></div><div class="message" id="generatePaymentMessage">Para efectivo no necesitas número de transacción. Transferencias y tarjetas sí deben llevarlo.</div><div class="generate-payment-actions"><button type="button" class="button secondary" data-close-generate-payment>Guardar como pendiente</button><button type="submit" class="button primary" id="generatePaymentSubmit">Registrar pago</button></div></form></div></div>`;
    const paymentModal=document.querySelector('#generatePaymentModal');
    const paymentStatus=document.querySelector('#generatedPaymentStatus');
    const notifyButton=document.querySelector('[data-generated-notify-sale]');
    const paymentOpenButtons=document.querySelectorAll('[data-generated-payment]');
    const updateGeneratedPaymentUI=async()=>{ try { const status=await request(`/api/admin/orders/${encodeURIComponent(result.orderId)}/payment-status?_=${Date.now()}`); const paid=Number(status.paid||0), balance=Number(status.balance||0), full=balance<=0.001; const paidEl=document.querySelector('#generatePaid'), balEl=document.querySelector('#generateBalance'); if(paidEl)paidEl.textContent=money(paid); if(balEl)balEl.textContent=money(balance); if(paymentStatus){paymentStatus.className=`generate-payment-status ${full?'is-paid':paid>0?'is-partial':'is-pending'}`;paymentStatus.innerHTML=`<span>ESTADO DEL PAGO</span><strong>${full?'PAGADO 100%':paid>0?'ABONO · FALTA '+money(balance):'PENDIENTE'}</strong><small>${full?'La entrega está habilitada.':`No se puede notificar la venta hasta completar ${money(balance)}.`}</small>`;} if(notifyButton){notifyButton.disabled=!full;notifyButton.textContent=full?'NOTIFICAR VENTA · PAGO COMPLETO':'NOTIFICAR VENTA · PAGO INCOMPLETO';notifyButton.classList.toggle('is-payment-ready',full);} const amount=document.querySelector('#generatePaymentAmount'); if(amount&&!document.activeElement?.matches('#generatePaymentAmount')) amount.value=balance>0?balance.toFixed(2):''; return status; } catch(e){return null;} };
    const openGeneratedPayment=async()=>{await updateGeneratedPaymentUI(); const modal=paymentModal;if(modal){modal.hidden=false;document.querySelector('#generatePaymentAmount')?.focus();}};
    const closeGeneratedPayment=()=>{if(paymentModal)paymentModal.hidden=true;};
    paymentOpenButtons.forEach(btn=>btn.addEventListener('click',openGeneratedPayment));
    document.querySelectorAll('[data-close-generate-payment]').forEach(btn=>btn.addEventListener('click',closeGeneratedPayment));
    document.querySelector('#generatePaymentMethod')?.addEventListener('change',()=>{const method=document.querySelector('#generatePaymentMethod').value;const tx=document.querySelector('#generatePaymentTransaction')?.closest('.field');const batch=document.querySelector('#generatePaymentBatch')?.closest('.field');const cash=method==='cash';if(tx)tx.hidden=cash;if(batch)batch.hidden=cash;});
    document.querySelector('#generatePaymentForm')?.addEventListener('submit',async event=>{event.preventDefault();const submit=event.currentTarget.querySelector('button[type="submit"]');const msg=document.querySelector('#generatePaymentMessage');submit.disabled=true;submit.classList.add('is-loading');try{const payload={orderId:result.orderId,method:document.querySelector('#generatePaymentMethod').value,amount:Number(document.querySelector('#generatePaymentAmount').value),date:document.querySelector('#generatePaymentDate').value,bank:document.querySelector('#generatePaymentBank').value.trim(),batch:document.querySelector('#generatePaymentBatch').value.trim(),transactionNumber:document.querySelector('#generatePaymentTransaction').value.trim()};await request('/api/admin/dinero/pagos-orden',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});await updateGeneratedPaymentUI();closeGeneratedPayment();}catch(e){msg.className='message error';msg.textContent=e.message||'No se pudo registrar el pago.';}finally{submit.disabled=false;submit.classList.remove('is-loading');}});
    document.querySelector('#generateAnotherOrder')?.addEventListener('click', () => renderAdminGenerateOrder());
    document.querySelector('[data-generated-pdf]')?.addEventListener('click', event => { const a=document.createElement('a'); a.href=`/api/admin/orders/${encodeURIComponent(event.currentTarget.dataset.generatedPdf)}/pdf?v=${Date.now()}`; a.target='_blank'; a.rel='noopener'; a.click(); });
    notifyButton?.addEventListener('click', async event => { const button=event.currentTarget; const message=document.querySelector('#generatedNotifyMessage'); const status=await updateGeneratedPaymentUI(); if(!status || Number(status.balance||0)>0.001){if(message){message.hidden=false;message.className='message error';message.textContent=`No puedes notificar la venta. Falta cobrar ${money(status?.balance||result.total)}.`;}return;} const confirmed=await showYhorsConfirm('¿Notificar esta venta?','El pago está completo. La orden cambiará automáticamente a <strong>Entregado</strong> y se registrará en <strong>Historial de ventas</strong>.', {cancelText:'Cancelar',confirmText:'Notificar venta'}); if(!confirmed)return; button.disabled=true; button.classList.add('is-loading'); button.textContent='Notificando…'; try { const sale=await request(`/api/admin/orders/${encodeURIComponent(button.dataset.generatedNotifySale)}/notificar-venta`,{method:'POST'}); app.querySelector('.generate-order-page').innerHTML=`<div class="generate-success"><span class="success-mark">✓</span><span class="eyebrow">Venta notificada correctamente</span><h2>#${escapeHTML(sale.orderNumber||result.orderNumber)}</h2><p>Pago completo confirmado. La orden cambió automáticamente a <strong>Entregado</strong> y la venta quedó registrada en Historial de Ventas.</p><div class="generate-success-total">Total: <strong>${money(sale.total||result.total)}</strong></div><div class="generate-success-actions"><button type="button" class="button primary" id="generateAnotherOrder">Nueva orden</button><a class="button secondary" href="${ADMIN_PATH}/historial-ventas" data-smooth-route>Ver historial de ventas</a><a class="button primary" href="${ADMIN_PATH}/dinero?sale=${encodeURIComponent(sale.id||sale.orderId)}" data-smooth-route>Ver pagos</a><button type="button" class="button secondary" data-generated-pdf="${escapeHTML(sale.orderId)}">PDF de venta</button></div></div>`; document.querySelector('#generateAnotherOrder')?.addEventListener('click', () => renderAdminGenerateOrder()); document.querySelector('[data-generated-pdf]')?.addEventListener('click', event => { const a=document.createElement('a'); a.href=`/api/admin/orders/${encodeURIComponent(event.currentTarget.dataset.generatedPdf)}/pdf?v=${Date.now()}`; a.target='_blank'; a.rel='noopener'; a.click(); }); } catch(error){ button.disabled=false; button.classList.remove('is-loading'); button.textContent='NOTIFICAR VENTA · PAGO COMPLETO'; if(message){message.hidden=false;message.className='message error';message.textContent=error.message||'No se pudo notificar la venta.';} } });
    // Abrir automáticamente el menú de pagos al generar la orden.
    setTimeout(openGeneratedPayment, 120);
 } catch (error) { message.hidden = false; message.className = 'message error'; message.textContent = error.message || 'No se pudo generar la orden.'; submit.disabled = false; submit.classList.remove('is-loading'); submit.innerHTML = 'Generar orden <span>→</span>'; saving = false; } });
  drawCustomer(); drawLines(); wireAccountMenu(); wireImageFallback(app);
}



async function renderAdminSeriesImeis() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated: false }));
  if (!session.authenticated) return renderLogin();
  const role = String(session.role || '').toLowerCase();
  if (!['admin','store_manager'].includes(role)) return renderAdminOrders();

  const isAdmin = role === 'admin';
  const isManager = role === 'admin' || role === 'store_manager';
  let config = [];
  let registered = [];
  try {
    if (isAdmin) config = await request('/api/admin/series-imeis/config');
    registered = (await request('/api/admin/series-imeis/registered')).rows || [];
  } catch (error) {
    app.innerHTML = `<main class="admin-shell"><div class="admin-wrap"><div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route aria-label="YHORS · Panel Administrativo · Ir a YHORS Inteligente"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></a><h1 class="admin-title">Series/IMEIS</h1></div></div><div class="message error">${escapeHTML(error.message || 'No se pudo cargar Series/IMEIS.')}</div></div></main>`;
    return;
  }

  const nav = adminSectionNav(session, 'series-imeis');
  app.innerHTML = `<main class="admin-shell series-imeis-shell"><div class="admin-wrap">
    <div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route aria-label="YHORS · Panel Administrativo · Ir a YHORS Inteligente"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></a><h1 class="admin-title">SERIES/IMEIS</h1><p class="admin-subtitle">Control de identificación de productos TEC y gestión de series e IMEIs registrados.</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>
    ${nav}
    <div class="users-module-switch" role="tablist" aria-label="Series e IMEIs">
      ${isAdmin ? '<button type="button" class="users-module-tab is-active" data-series-tab="gestor">GESTOR DE SERIES</button>' : ''}
      <button type="button" class="users-module-tab${isAdmin ? '' : ' is-active'}" data-series-tab="registrados">SERIES / IMEIS REGISTRADOS</button>
    </div>
    ${isAdmin ? `<section class="admin-panel series-tab-panel series-config-panel" data-series-panel="gestor">
      <div class="series-config-hero">
        <div class="series-config-hero-copy"><span class="eyebrow">Configuración</span><h2>Gestor de series</h2><p>Activa o desactiva la solicitud de serie/IMEI por producto TEC. Los cambios se aplican a las nuevas órdenes.</p></div>
        <div class="series-config-hero-mark" aria-hidden="true">S/I</div>
      </div>
      <div class="series-config-actions-top">
        <div class="series-config-save-state"><span class="series-config-dot"></span><span id="seriesConfigSaveState">Sin cambios pendientes</span></div>
        <div class="series-config-actions-buttons"><button type="button" class="button secondary" id="seriesConfigReset">Descartar cambios</button><button type="button" class="button primary" id="seriesConfigSave"${isAdmin ? '' : ' disabled'}>Guardar cambios</button></div>
      </div>
      <div class="series-config-toolbar">
        <input id="seriesConfigSearch" type="search" placeholder="Buscar producto, SKU, marca o tipo…" autocomplete="off">
        <select id="seriesConfigStatus" aria-label="Estado de configuración"><option value="">Todos</option><option value="active">Activo</option><option value="inactive">Desactivado</option></select>
        <button type="button" class="button secondary small" id="seriesConfigClear">Limpiar</button>
      </div>
      <div class="series-config-note">Los productos TEC existentes conservan la configuración actual. Si un producto está en <strong>NO SOLICITAR</strong>, Generar orden no pedirá serie/IMEI para ese producto.</div>
      <div id="seriesConfigList"></div>
      ${!isAdmin ? '<div class="message">Solo el Administrador puede modificar qué productos solicitan serie/IMEI.</div>' : ''}
    </section>` : ''}
    <section class="admin-panel series-tab-panel" data-series-panel="registrados"${isAdmin ? ' hidden' : ''}>
      <div class="section-heading"><div><span class="eyebrow">Historial</span><h2>Series / IMEIS registrados <small id="seriesRegisteredCount"></small></h2></div><p>Consulta, agrega y modifica identificadores registrados en los pedidos.</p></div>
      <div class="orders-toolbar series-registered-toolbar">
        <label class="series-date-filter"><span>DESDE</span><input id="seriesFrom" type="date"></label>
        <label class="series-date-filter"><span>HASTA</span><input id="seriesTo" type="date"></label>
        <select id="seriesType"><option value="">Serie e IMEI</option><option value="serial">Series</option><option value="imei">IMEIS</option></select>
        <select id="seriesStatus"><option value="">Todos los estados</option><option>Pendiente</option><option>Confirmado</option><option>Preparado</option><option>Enviado</option><option>Entregado</option><option>Cancelado</option></select>
        <input id="seriesSearch" type="search" placeholder="Buscar por pedido, cliente, producto, SKU, serie o IMEI…" autocomplete="off">
        <button type="button" class="button secondary small" id="seriesClearFilters">Limpiar filtros</button>
      </div>
      <div id="seriesRegisteredList"></div>
    </section>
  </div></main>`;

  let configState = config.map(item => ({ ...item, original: Boolean(item.requiresDeviceIdentifier) }));
  const configList = document.querySelector('#seriesConfigList');
  const renderConfig = () => {
    const q = String(document.querySelector('#seriesConfigSearch')?.value || '').trim().toLocaleLowerCase('es-EC');
    const filterStatus = document.querySelector('#seriesConfigStatus')?.value || '';
    const pendingChanges = configState.filter(item => Boolean(item.requiresDeviceIdentifier) !== Boolean(item.original)).length;
    const state = document.querySelector('#seriesConfigSaveState');
    if (state) state.textContent = pendingChanges ? `${pendingChanges} cambio${pendingChanges === 1 ? '' : 's'} pendiente${pendingChanges === 1 ? '' : 's'}` : 'Sin cambios pendientes';
    const filtered = configState.filter(item => {
      const hay = `${item.name} ${item.sku} ${item.productType}`.toLocaleLowerCase('es-EC');
      const matchesSearch = !q || hay.includes(q);
      const matchesStatus = !filterStatus || (filterStatus === 'active' ? Boolean(item.requiresDeviceIdentifier) : !Boolean(item.requiresDeviceIdentifier));
      return matchesSearch && matchesStatus;
    });
    configList.innerHTML = filtered.length ? filtered.map(item => `<div class="series-config-row" data-series-config-search="${escapeHTML(`${item.name} ${item.sku} ${item.productType}`)}"><div><strong>${escapeHTML(item.name)}</strong><small>SKU: ${escapeHTML(item.sku || '—')} · ${escapeHTML(item.productType || 'Tecnología')} · Stock ${Number(item.stock || 0)}</small></div><label class="series-switch"><input type="checkbox" data-series-toggle="${escapeHTML(item.id)}" ${item.requiresDeviceIdentifier ? 'checked' : ''}${isAdmin ? '' : ' disabled'}><span></span><b>${item.requiresDeviceIdentifier ? 'SOLICITAR' : 'NO SOLICITAR'}</b></label></div>`).join('') : '<div class="series-empty">No encontramos productos TEC con esa búsqueda.</div>';
    configList.querySelectorAll('[data-series-toggle]').forEach(toggle => toggle.addEventListener('change', () => {
      const item = configState.find(entry => entry.id === toggle.dataset.seriesToggle); if (!item) return;
      item.requiresDeviceIdentifier = toggle.checked;
      const label = toggle.closest('.series-switch')?.querySelector('b'); if (label) label.textContent = toggle.checked ? 'SOLICITAR' : 'NO SOLICITAR';
      const pendingChanges = configState.filter(entry => Boolean(entry.requiresDeviceIdentifier) !== Boolean(entry.original)).length;
      const state = document.querySelector('#seriesConfigSaveState'); if (state) state.textContent = pendingChanges ? `${pendingChanges} cambio${pendingChanges === 1 ? '' : 's'} pendiente${pendingChanges === 1 ? '' : 's'}` : 'Sin cambios pendientes';
    }));
  };
  renderConfig();
  document.querySelector('#seriesConfigSearch')?.addEventListener('input', renderConfig);
  document.querySelector('#seriesConfigStatus')?.addEventListener('change', renderConfig);
  document.querySelector('#seriesConfigClear')?.addEventListener('click', () => { document.querySelector('#seriesConfigSearch').value=''; document.querySelector('#seriesConfigStatus').value=''; renderConfig(); });
  document.querySelector('#seriesConfigReset')?.addEventListener('click', () => { configState = config.map(item => ({ ...item, original: Boolean(item.requiresDeviceIdentifier) })); renderConfig(); });
  document.querySelector('#seriesConfigSave')?.addEventListener('click', async () => {
    if (!isAdmin) return;
    const changes = configState.filter(item => Boolean(item.requiresDeviceIdentifier) !== Boolean(item.original)).map(item => ({ id: item.id, requiresDeviceIdentifier: Boolean(item.requiresDeviceIdentifier) }));
    if (!changes.length) { alert('No hay cambios para guardar.'); return; }
    const confirmed = await showYhorsConfirm('¿Guardar configuración de series/IMEIS?', `Se actualizarán ${changes.length} producto(s). Esta configuración se aplicará a las próximas órdenes.`, { cancelText:'Cancelar', confirmText:'Guardar cambios' });
    if (!confirmed) return;
    try { config = await request('/api/admin/series-imeis/config', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ changes }) }); configState = config.map(item => ({ ...item, original: Boolean(item.requiresDeviceIdentifier) })); renderConfig(); } catch (error) { alert(error.message); }
  });

  let registeredState = registered;
  const registeredList = document.querySelector('#seriesRegisteredList');
  const renderRegistered = () => {
    const q = String(document.querySelector('#seriesSearch')?.value || '').trim().toLocaleLowerCase('es-EC');
    const from = document.querySelector('#seriesFrom')?.value || '';
    const to = document.querySelector('#seriesTo')?.value || '';
    const type = document.querySelector('#seriesType')?.value || '';
    const status = document.querySelector('#seriesStatus')?.value || '';
    const rows = registeredState.filter(row => {
      const hay = `${row.orderNumber} ${row.customerName} ${row.productName} ${row.sku} ${row.primary} ${row.secondary || ''} ${row.sellerName}`.toLocaleLowerCase('es-EC');
      if (q && !hay.includes(q)) return false;
      const day = row.createdAt ? new Intl.DateTimeFormat('en-CA', { timeZone:'America/Guayaquil' }).format(new Date(row.createdAt)) : '';
      if (from && day < from) return false; if (to && day > to) return false;
      if (type && row.type !== type) return false; if (status && row.status !== status) return false;
      return true;
    });
    const count = document.querySelector('#seriesRegisteredCount'); if (count) count.textContent = `${rows.length}`;
    registeredList.innerHTML = rows.length ? `<div class="series-registered-table-wrap"><table class="series-registered-table"><thead><tr><th>FECHA</th><th>PEDIDO</th><th>PRODUCTO</th><th>IDENTIFICACIÓN</th><th>CLIENTE</th><th>ESTADO</th><th>ACCIÓN</th></tr></thead><tbody>${rows.map(row => `<tr><td>${escapeHTML(row.createdAt ? new Intl.DateTimeFormat('es-EC',{timeZone:'America/Guayaquil',day:'2-digit',month:'2-digit',year:'numeric'}).format(new Date(row.createdAt)) : '—')}</td><td><strong>${escapeHTML(row.orderNumber)}</strong><small>${escapeHTML(row.sellerName || 'Sin vendedor')}</small></td><td><strong>${escapeHTML(row.productName)}</strong><small>${escapeHTML(row.sku || '—')} · Unidad ${row.unit}</small></td><td><span class="series-type-badge">${row.type === 'imei' ? 'IMEI' : 'SERIE'}</span>${row.pending ? '<strong class="series-pending">PENDIENTE</strong>' : `<strong>${escapeHTML(row.primary)}</strong>${row.secondary ? `<small>IMEI 2: ${escapeHTML(row.secondary)}</small>` : ''}`}</td><td>${escapeHTML(row.customerName || '—')}</td><td>${escapeHTML(row.status || '—')}</td><td>${isManager ? `<button type="button" class="button secondary small" data-edit-series="${escapeHTML(`${row.orderId}|${row.itemIndex}|${row.unit}`)}">${row.pending ? 'AGREGAR' : 'EDITAR'}</button>` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="series-empty"><strong>No hay series/IMEIS que coincidan.</strong><small>Prueba otro período o término de búsqueda.</small></div>';
    registeredList.querySelectorAll('[data-edit-series]').forEach(button => button.addEventListener('click', () => {
      const [orderId,itemIndex,unit] = button.dataset.editSeries.split('|'); const row = rows.find(item => item.orderId === orderId && String(item.itemIndex) === itemIndex && String(item.unit) === unit); if (row) openSeriesEdit(row);
    }));
  };
  const openSeriesEdit = async row => {
    const existing = document.querySelector('#seriesEditModal'); if (existing) existing.remove();
    const imei = row.type === 'imei';
    const modal = document.createElement('div'); modal.id='seriesEditModal'; modal.className='yhors-confirm-backdrop';
    modal.innerHTML = `<div class="yhors-confirm-dialog series-edit-dialog" role="dialog" aria-modal="true"><div class="yhors-confirm-icon">${imei ? 'I' : 'S'}</div><h2>Editar ${imei ? 'IMEI' : 'serie'}</h2><p><strong>${escapeHTML(row.productName)}</strong><br>${escapeHTML(row.orderNumber)} · Unidad ${row.unit}</p><label class="series-edit-field">${imei ? 'IMEI 1' : 'Número de serie'}<input id="seriesEditPrimary" value="${escapeHTML(row.primary)}" maxlength="${imei ? 16 : 50}"></label>${imei ? `<label class="series-edit-field">IMEI 2 <span>(opcional)</span><input id="seriesEditSecondary" value="${escapeHTML(row.secondary || '')}" maxlength="16"></label>` : ''}<div class="yhors-confirm-actions"><button type="button" class="button secondary" data-series-cancel>Cancelar</button><button type="button" class="button primary" data-series-save>Guardar</button></div></div>`;
    document.body.appendChild(modal);
    modal.querySelector('[data-series-cancel]').onclick=()=>modal.remove();
    modal.querySelector('[data-series-save]').onclick=async()=>{
      const primary=modal.querySelector('#seriesEditPrimary').value.trim(); const secondary=modal.querySelector('#seriesEditSecondary')?.value.trim() || '';
      const ok=await showYhorsConfirm('¿Guardar cambios?', `Se actualizará la identificación de ${escapeHTML(row.productName)} en ${escapeHTML(row.orderNumber)}.`, {cancelText:'Cancelar',confirmText:'Guardar'}); if(!ok)return;
      try { await request('/api/admin/series-imeis/registered',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:row.orderId,itemIndex:row.itemIndex,unit:row.unit,primary,secondary})}); modal.remove(); registeredState=(await request('/api/admin/series-imeis/registered')).rows||[]; renderRegistered(); } catch(error){ alert(error.message); }
    };
  };
  ['seriesSearch','seriesFrom','seriesTo','seriesType','seriesStatus'].forEach(id=>document.querySelector(`#${id}`)?.addEventListener(id.includes('Search')?'input':'change',renderRegistered));
  document.querySelector('#seriesClearFilters')?.addEventListener('click',()=>{['seriesSearch','seriesFrom','seriesTo'].forEach(id=>document.querySelector(`#${id}`).value=''); document.querySelector('#seriesType').value=''; document.querySelector('#seriesStatus').value=''; renderRegistered();});
  document.querySelectorAll('[data-series-tab]').forEach(tab=>tab.addEventListener('click',()=>{ document.querySelectorAll('[data-series-tab]').forEach(item=>item.classList.toggle('is-active',item===tab)); document.querySelectorAll('[data-series-panel]').forEach(panel=>panel.hidden=panel.dataset.seriesPanel!==tab.dataset.seriesTab); }));
  wireAccountMenu();
  renderRegistered();
}


async function renderAdminFines() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated: false }));
  if (!session.authenticated) return renderLogin();
  if (String(session.role || '').toLowerCase() !== 'admin') return renderAdminOrders();

  const localToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
  const today = localToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  const nav = adminSectionNav(session, 'multas');

  app.innerHTML = `<main class="admin-shell fines-shell"><div class="admin-wrap">
    <div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route aria-label="YHORS · Panel Administrativo · Ir a YHORS Inteligente"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></a><h1 class="admin-title">Multas</h1><p class="admin-subtitle">Descuentos que se aplican directamente a la comisión del vendedor o Jefe de Tienda.</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>
    ${nav}
    <section class="admin-panel fines-panel">
      <div class="section-heading"><div><span class="eyebrow" id="fineFormEyebrow">Finanzas · Control</span><h2 id="fineFormTitle">Registrar multa</h2></div><p id="fineFormHelp">La multa se descuenta automáticamente de la comisión del período en el que esté registrada.</p></div>
      <input type="hidden" id="fineEditId" value="">
      <div class="fines-form-grid">
        <div class="fine-person-field">
          <span>Vendedor / Jefe de Tienda</span>
          <input type="hidden" id="fineUser" value="">
          <button type="button" class="fine-person-picker-trigger" id="finePersonPickerOpen" aria-haspopup="dialog">
            <span class="fine-person-picker-avatar" id="finePersonAvatar">?</span>
            <span class="fine-person-picker-copy"><strong id="finePersonName">Selecciona una persona</strong><small id="finePersonRole">Vendedor o Jefe de Tienda</small></span>
            <span class="fine-person-picker-chevron">⌄</span>
          </button>
        </div>
        <label><span>Valor</span><input id="fineAmount" type="number" min="0.01" step="0.01" placeholder="0,00"></label>
        <label><span>Fecha</span><input id="fineDate" type="date" value="${today}"></label>
        <label class="fines-reason"><span>Motivo</span><textarea id="fineReason" rows="3" maxlength="500" placeholder="¿Por qué se aplica la multa?"></textarea></label>
      </div>
      <div class="fines-actions"><button type="button" class="button primary small" id="saveFine">Guardar multa</button><button type="button" class="button small" id="cancelFineEdit" hidden>Cancelar edición</button><span class="message" id="fineMessage" hidden></span></div>
    </section>

    <section class="admin-panel fines-panel">
      <div class="section-heading"><div><span class="eyebrow">Historial</span><h2>Multas registradas</h2></div><p>Estas multas son las que se toman en cuenta para calcular las comisiones.</p></div>
      <div class="commission-toolbar fines-toolbar">
        <div class="commission-date-range"><label class="commission-date-filter"><span>Desde</span><input id="fineFrom" type="date" value="${monthStart}"></label><label class="commission-date-filter"><span>Hasta</span><input id="fineTo" type="date" value="${today}"></label></div>
        <div class="fines-history-filters">
          <label><span>Persona</span><select id="fineFilterUser"><option value="">Todos</option></select></label>
          <label class="fines-search"><span>Buscar</span><input id="fineSearch" type="search" placeholder="Nombre, usuario o motivo…"></label>
        </div>
        <button type="button" class="button small" id="fineRefresh">Actualizar</button>
      </div>
      <div class="fines-summary" id="finesSummary"></div>
      <div class="fines-list" id="finesList"><div class="commission-loading">Cargando multas…</div></div>
    </section>

    <div class="generate-modal fine-person-modal" id="finePersonPickerModal" hidden>
      <div class="generate-modal-backdrop" data-close-fine-person-picker></div>
      <div class="generate-modal-dialog fine-person-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="finePersonPickerTitle">
        <div class="generate-modal-head">
          <div><span class="eyebrow">Finanzas · Personal</span><h2 id="finePersonPickerTitle">Seleccionar persona</h2><p class="fine-person-picker-subtitle">Busca a quién se aplicará la multa.</p></div>
          <button type="button" class="generate-modal-close" data-close-fine-person-picker aria-label="Cerrar">×</button>
        </div>
        <div class="fine-person-picker-toolbar">
          <input id="finePersonSearch" type="search" placeholder="Buscar por nombre o usuario…" autocomplete="off">
          <div class="fine-person-picker-tabs" role="tablist" aria-label="Tipo de persona">
            <button type="button" class="fine-person-tab is-active" data-person-role="all">Todos</button>
            <button type="button" class="fine-person-tab" data-person-role="vendedor">Vendedores</button>
            <button type="button" class="fine-person-tab" data-person-role="store_manager">Jefes de Tienda</button>
          </div>
        </div>
        <div class="fine-person-picker-count" id="finePersonPickerCount"></div>
        <div class="fine-person-picker-list" id="finePersonPickerList"></div>
      </div>
    </div>
  </div></main>`;

  const message = document.querySelector('#fineMessage');
  let eligibleUsers = [];
  try {
    const users = await request('/api/admin/users');
    const list = Array.isArray(users?.users) ? users.users : (Array.isArray(users) ? users : []);
    eligibleUsers = list.filter(user => user.active !== false && ['vendedor','store_manager'].includes(String(user.role || '').toLowerCase()));
  } catch (error) {
    try {
      const users = await request('/api/admin/usuarios');
      const list = Array.isArray(users?.users) ? users.users : (Array.isArray(users) ? users : []);
      eligibleUsers = list.filter(user => user.active !== false && ['vendedor','store_manager'].includes(String(user.role || '').toLowerCase()));
    } catch (fallbackError) {
      eligibleUsers = [];
    }
  }

  const finePersonModal = document.querySelector('#finePersonPickerModal');
  const finePersonSearch = document.querySelector('#finePersonSearch');
  const finePersonList = document.querySelector('#finePersonPickerList');
  const finePersonCount = document.querySelector('#finePersonPickerCount');
  const finePersonInput = document.querySelector('#fineUser');
  const finePersonName = document.querySelector('#finePersonName');
  const finePersonRole = document.querySelector('#finePersonRole');
  const finePersonAvatar = document.querySelector('#finePersonAvatar');
  let finePersonRoleFilter = 'all';

  const roleLabel = user => String(user?.role || '').toLowerCase() === 'store_manager' ? 'Jefe de Tienda' : 'Vendedor';
  const userDisplayName = user => user?.name || user?.username || 'Usuario';
  const initials = name => (String(name || 'U').trim().split(/\s+/).slice(0,2).map(part => part[0]).join('') || 'U').toUpperCase();

  const renderFinePersonPicker = () => {
    if (!finePersonList) return;
    const query = (finePersonSearch?.value || '').trim().toLowerCase();
    const filtered = eligibleUsers.filter(user => {
      const role = String(user.role || '').toLowerCase();
      if (finePersonRoleFilter !== 'all' && role !== finePersonRoleFilter) return false;
      const hay = `${userDisplayName(user)} ${user.username || ''}`.toLowerCase();
      return !query || hay.includes(query);
    });
    if (finePersonCount) finePersonCount.textContent = `${filtered.length} persona${filtered.length === 1 ? '' : 's'} disponible${filtered.length === 1 ? '' : 's'}`;
    finePersonList.innerHTML = filtered.length ? filtered.map(user => {
      const role = roleLabel(user);
      const selected = String(finePersonInput?.value || '') === String(user.id);
      return `<button type="button" class="fine-person-option${selected ? ' is-selected' : ''}" data-select-fine-person="${escapeHTML(user.id)}">
        <span class="fine-person-option-avatar">${escapeHTML(initials(userDisplayName(user)))}</span>
        <span class="fine-person-option-copy"><strong>${escapeHTML(userDisplayName(user))}</strong><small>@${escapeHTML(user.username || 'usuario')} · ${role}</small></span>
        <span class="fine-person-option-check">${selected ? '✓' : '›'}</span>
      </button>`;
    }).join('') : `<div class="fine-person-empty"><span>⌕</span><strong>No encontramos a esa persona</strong><small>Prueba con otro nombre, usuario o cambia el tipo de persona.</small></div>`;
  };

  const openFinePersonPicker = () => {
    if (!finePersonModal) return;
    finePersonModal.hidden = false;
    document.body.classList.add('generate-modal-open');
    requestAnimationFrame(() => { finePersonModal.classList.add('is-open'); finePersonSearch?.focus(); });
    renderFinePersonPicker();
  };
  const closeFinePersonPicker = () => {
    if (!finePersonModal) return;
    finePersonModal.classList.remove('is-open');
    setTimeout(() => { if (finePersonModal) finePersonModal.hidden = true; if (!document.querySelector('.generate-modal.is-open')) document.body.classList.remove('generate-modal-open'); }, 180);
  };
  const updateFinePersonDisplay = () => {
    const selected = eligibleUsers.find(user => String(user.id) === String(finePersonInput?.value || ''));
    if (!selected) {
      if (finePersonName) finePersonName.textContent = 'Selecciona una persona';
      if (finePersonRole) finePersonRole.textContent = 'Vendedor o Jefe de Tienda';
      if (finePersonAvatar) finePersonAvatar.textContent = '?';
      return;
    }
    if (finePersonName) finePersonName.textContent = userDisplayName(selected);
    if (finePersonRole) finePersonRole.textContent = `${roleLabel(selected)} · @${selected.username || 'usuario'}`;
    if (finePersonAvatar) finePersonAvatar.textContent = initials(userDisplayName(selected));
  };
  document.querySelector('#finePersonPickerOpen')?.addEventListener('click', openFinePersonPicker);
  finePersonModal?.querySelectorAll('[data-close-fine-person-picker]').forEach(el => el.addEventListener('click', closeFinePersonPicker));
  finePersonSearch?.addEventListener('input', renderFinePersonPicker);
  finePersonModal?.addEventListener('click', event => {
    const tab = event.target.closest('[data-person-role]');
    if (tab) {
      finePersonRoleFilter = tab.dataset.personRole || 'all';
      finePersonModal.querySelectorAll('[data-person-role]').forEach(button => button.classList.toggle('is-active', button === tab));
      renderFinePersonPicker();
      return;
    }
    const option = event.target.closest('[data-select-fine-person]');
    if (option) {
      if (finePersonInput) finePersonInput.value = option.dataset.selectFinePerson;
      updateFinePersonDisplay();
      closeFinePersonPicker();
    }
  });
  const finePersonEscapeHandler = event => { if (event.key === 'Escape' && finePersonModal?.classList.contains('is-open')) closeFinePersonPicker(); };
  document.addEventListener('keydown', finePersonEscapeHandler);

  const filterUser = document.querySelector('#fineFilterUser');

  if (filterUser) {
    filterUser.innerHTML = '<option value="">Todos</option>' + eligibleUsers.map(user => {
      const role = roleLabel(user);
      return `<option value="${escapeHTML(user.id)}">${escapeHTML(userDisplayName(user))} · ${role}</option>`;
    }).join('');
  }
  updateFinePersonDisplay();

  const renderFines = async () => {
    const from = document.querySelector('#fineFrom')?.value || '';
    const to = document.querySelector('#fineTo')?.value || '';
    const filterUserId = document.querySelector('#fineFilterUser')?.value || '';
    const search = (document.querySelector('#fineSearch')?.value || '').trim().toLowerCase();
    const list = document.querySelector('#finesList');
    const summary = document.querySelector('#finesSummary');
    if (!list) return;
    if (from && to && from > to) {
      list.innerHTML = '<div class="commission-empty">La fecha inicial no puede ser posterior a la fecha final.</div>';
      if (summary) summary.innerHTML = '';
      return;
    }
    list.innerHTML = '<div class="commission-loading">Cargando multas…</div>';
    try {
      const result = await request(`/api/admin/multas?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const allFines = Array.isArray(result.fines) ? result.fines : [];
      const fines = allFines.filter(fine => {
        if (filterUserId && String(fine.userId) !== String(filterUserId)) return false;
        if (search) {
          const haystack = `${fine.userName || ''} ${fine.username || ''} ${fine.reason || ''} ${fine.userRole || ''}`.toLowerCase();
          if (!haystack.includes(search)) return false;
        }
        return true;
      });
      const filteredTotal = fines.reduce((sum, fine) => sum + Number(fine.amount || 0), 0);
      if (summary) summary.innerHTML = `<div><span>PERÍODO</span><strong>${escapeHTML(from || 'Todo')} → ${escapeHTML(to || 'Todo')}</strong></div><div><span>MULTAS</span><strong>${fines.length}${fines.length !== allFines.length ? ` <small class="fines-count-note">de ${allFines.length}</small>` : ''}</strong></div><div><span>TOTAL DESCONTADO</span><strong>${money(filteredTotal)}</strong></div>`;
      list.innerHTML = fines.length ? fines.map(fine => {
        const role = fine.userRole === 'store_manager' ? 'Jefe de Tienda' : 'Vendedor';
        return `<article class="fine-row">
          <div class="fine-row-main"><div><strong>${escapeHTML(fine.userName || 'Usuario')}</strong><small>@${escapeHTML(fine.username || '')} · ${role}</small></div><time>${escapeHTML(fine.date || '')}</time></div>
          <p>${escapeHTML(fine.reason || 'Sin motivo')}</p>
          <div class="fine-row-footer"><strong>${money(fine.amount || 0)}</strong><div class="fine-row-actions"><button type="button" class="button secondary small" data-edit-fine="${escapeHTML(fine.id)}">Editar</button><button type="button" class="button danger small" data-delete-fine="${escapeHTML(fine.id)}">Eliminar</button></div></div>
        </article>`;
      }).join('') : '<div class="commission-empty">No hay multas registradas en este período.</div>';
    } catch (error) {
      list.innerHTML = `<div class="commission-empty">${escapeHTML(error.message || 'No se pudieron cargar las multas.')}</div>`;
    }
  };

  document.querySelector('#fineRefresh')?.addEventListener('click', renderFines);
  document.querySelector('#fineFrom')?.addEventListener('change', renderFines);
  document.querySelector('#fineTo')?.addEventListener('change', renderFines);
  document.querySelector('#fineFilterUser')?.addEventListener('change', renderFines);
  document.querySelector('#fineSearch')?.addEventListener('input', renderFines);

  const fineEditId = document.querySelector('#fineEditId');
  const fineFormTitle = document.querySelector('#fineFormTitle');
  const fineFormEyebrow = document.querySelector('#fineFormEyebrow');
  const fineFormHelp = document.querySelector('#fineFormHelp');
  const cancelFineEdit = document.querySelector('#cancelFineEdit');
  const resetFineForm = () => {
    if (fineEditId) fineEditId.value = '';
    if (fineFormTitle) fineFormTitle.textContent = 'Registrar multa';
    if (fineFormEyebrow) fineFormEyebrow.textContent = 'Finanzas · Control';
    if (fineFormHelp) fineFormHelp.textContent = 'La multa se descuenta automáticamente de la comisión del período en el que esté registrada.';
    if (document.querySelector('#saveFine')) document.querySelector('#saveFine').textContent = 'Guardar multa';
    if (cancelFineEdit) cancelFineEdit.hidden = true;
    if (finePersonInput) finePersonInput.value = '';
    updateFinePersonDisplay();
    if (document.querySelector('#fineAmount')) document.querySelector('#fineAmount').value = '';
    if (document.querySelector('#fineDate')) document.querySelector('#fineDate').value = today;
    if (document.querySelector('#fineReason')) document.querySelector('#fineReason').value = '';
  };
  cancelFineEdit?.addEventListener('click', resetFineForm);

  document.querySelector('#saveFine')?.addEventListener('click', async () => {
    const button = document.querySelector('#saveFine');
    const editId = fineEditId?.value || '';
    const userId = finePersonInput?.value || '';
    const amount = Number(document.querySelector('#fineAmount')?.value || 0);
    const date = document.querySelector('#fineDate')?.value || '';
    const reason = document.querySelector('#fineReason')?.value?.trim() || '';
    if (!userId || !amount || amount <= 0 || !date || !reason) {
      if (message) { message.hidden = false; message.className = 'message error'; message.textContent = 'Completa la persona, valor, fecha y motivo.'; }
      return;
    }
    const selectedUser = eligibleUsers.find(user => String(user.id) === String(userId));
    const userLabel = selectedUser ? `${userDisplayName(selectedUser)} · ${roleLabel(selectedUser)}` : 'usuario';
    const confirmed = await showYhorsConfirm(editId ? '¿Guardar cambios de esta multa?' : '¿Seguro que quieres guardar esta multa?', editId ? `Se actualizará la multa de ${escapeHTML(userLabel)} a ${money(amount)}.` : `Se registrará ${money(amount)} a ${escapeHTML(userLabel)} y se descontará de su comisión.`);
    if (!confirmed) return;
    button.disabled = true;
    try {
      const endpoint = editId ? `/api/admin/multas/${encodeURIComponent(editId)}` : '/api/admin/multas';
      await request(endpoint, { method: editId ? 'PUT' : 'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ userId, amount, date, reason }) });
      resetFineForm();
      if (message) { message.hidden = false; message.className = 'message success'; message.textContent = editId ? 'Multa actualizada correctamente.' : 'Multa registrada correctamente.'; }
      await renderFines();
    } catch (error) {
      if (message) { message.hidden = false; message.className = 'message error'; message.textContent = error.message || (editId ? 'No se pudo actualizar la multa.' : 'No se pudo registrar la multa.'); }
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector('#finesList')?.addEventListener('click', async event => {
    const editButton = event.target.closest('[data-edit-fine]');
    if (editButton) {
      try {
        const result = await request(`/api/admin/multas?from=&to=`);
        const fine = (result.fines || []).find(item => String(item.id) === String(editButton.dataset.editFine));
        if (!fine) throw new Error('No se encontró la multa para editar.');
        if (fineEditId) fineEditId.value = fine.id;
        if (fineFormTitle) fineFormTitle.textContent = 'Editar multa';
        if (fineFormEyebrow) fineFormEyebrow.textContent = 'Finanzas · Edición';
        if (fineFormHelp) fineFormHelp.textContent = 'Puedes cambiar la persona, monto, fecha o motivo. El cambio se reflejará en su comisión.';
        if (document.querySelector('#fineAmount')) document.querySelector('#fineAmount').value = Number(fine.amount || 0).toFixed(2);
        if (document.querySelector('#fineDate')) document.querySelector('#fineDate').value = fine.date || today;
        if (document.querySelector('#fineReason')) document.querySelector('#fineReason').value = fine.reason || '';
        if (finePersonInput) finePersonInput.value = fine.userId || '';
        updateFinePersonDisplay();
        if (document.querySelector('#saveFine')) document.querySelector('#saveFine').textContent = 'Guardar cambios';
        if (cancelFineEdit) cancelFineEdit.hidden = false;
        document.querySelector('#fineAmount')?.focus();
        document.querySelector('.fines-shell')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (error) {
        alert(error.message || 'No se pudo abrir la multa.');
      }
      return;
    }

    const button = event.target.closest('[data-delete-fine]');
    if (!button) return;
    const confirmed = await showYhorsConfirm('¿Eliminar esta multa?', 'Al eliminarla dejará de descontarse de la comisión del período correspondiente.');
    if (!confirmed) return;
    button.disabled = true;
    try {
      await request(`/api/admin/multas/${encodeURIComponent(button.dataset.deleteFine)}`, { method:'DELETE' });
      if (fineEditId?.value === button.dataset.deleteFine) resetFineForm();
      await renderFines();
    } catch (error) {
      button.disabled = false;
      alert(error.message || 'No se pudo eliminar la multa.');
    }
  });

  await renderFines();
  wireAccountMenu();
}

async function renderAdminCommission() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated: false }));
  if (!session.authenticated) return renderLogin();
  if (String(session.role || '').toLowerCase() !== 'admin') return renderAdminOrders();

  const localToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
  const today = localToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  const nav = adminSectionNav(session, 'calculo-comision');

  app.innerHTML = `<main class="admin-shell commission-shell"><div class="admin-wrap"><div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route aria-label="YHORS · Panel Administrativo · Ir a YHORS Inteligente"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></a><h1 class="admin-title">Cálculo de comisión</h1><p class="admin-subtitle">Comisiones para vendedores y Jefe de Tienda · acceso exclusivo de Administración</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>${nav}
    <section class="admin-panel commission-panel">
      <div class="section-heading commission-heading"><div><span class="eyebrow">Comisiones</span><h2>Pago de comisiones</h2></div><p>Solo se toman ventas con estado <strong>Enviado</strong> y <strong>Entregado</strong>. El porcentaje se puede definir individualmente antes de pagar.</p></div>
      <div class="commission-toolbar">
        <div class="commission-date-range"><label class="commission-date-filter"><span>Desde</span><input id="commissionDateFrom" type="date" value="${monthStart}" aria-label="Fecha inicial"></label><label class="commission-date-filter"><span>Hasta</span><input id="commissionDateTo" type="date" value="${today}" aria-label="Fecha final"></label></div>
        <button type="button" class="button primary small" id="commissionRefresh">Actualizar</button>
      </div>
      <div class="commission-message" id="commissionMessage" hidden></div>
      <div class="commission-summary" id="commissionSummary"></div>
      <div class="commission-table-wrap"><table class="commission-table"><thead><tr><th>USUARIO</th><th>ROL</th><th>PEDIDOS</th><th>VENTAS COMISIONABLES</th><th>% COMISIÓN</th><th>MULTAS</th><th>COMISIÓN NETA</th><th>ACCIÓN</th></tr></thead><tbody id="commissionTableBody"><tr><td colspan="8" class="commission-loading">Calculando…</td></tr></tbody></table></div>
      <div class="commission-note"><strong>Importante:</strong> al pulsar <strong>Pagar comisión</strong>, el valor se registra automáticamente en <strong>Resumen Financiero → Gastos</strong> como un gasto normal, con su concepto, fecha y detalle.</div>
    </section>
  </div></main>`;

  const moneyCell = value => money(Number(value || 0));
  const message = document.querySelector('#commissionMessage');

  const loadCommissions = async () => {
    const from = document.querySelector('#commissionDateFrom')?.value || '';
    const to = document.querySelector('#commissionDateTo')?.value || '';
    const body = document.querySelector('#commissionTableBody');
    const summary = document.querySelector('#commissionSummary');
    if (!body) return;
    if (from && to && from > to) {
      body.innerHTML = '<tr><td colspan="8" class="commission-empty">La fecha inicial no puede ser posterior a la fecha final.</td></tr>';
      if (summary) summary.innerHTML = '';
      return;
    }
    if (message) message.hidden = true;
    body.innerHTML = '<tr><td colspan="8" class="commission-loading">Calculando comisiones…</td></tr>';
    try {
      const result = await request(`/api/admin/calculo-comision?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const rows = Array.isArray(result.rows) ? result.rows : [];
      const totals = result.totals || {};
      if (summary) summary.innerHTML = `<div><span>PERÍODO</span><strong>${escapeHTML(from || 'Todo')} → ${escapeHTML(to || 'Todo')}</strong></div><div><span>ESTADOS</span><strong>Enviado + Entregado</strong></div><div><span>VENTAS COMISIONABLES</span><strong>${moneyCell(totals.sales)}</strong></div><div><span>JEFE DE TIENDA</span><strong>${moneyCell(totals.managerSales)}</strong></div>`;

      body.innerHTML = rows.length ? rows.map(row => {
        const roleLabel = row.role === 'store_manager' ? 'Jefe de Tienda' : 'Vendedor';
        const defaultRate = row.paid ? Number(row.paidRate || 0) : 0;
        const amount = row.paid ? Number(row.paidAmount || 0) : 0;
        const gross = row.paid ? Number(row.paidGrossAmount || 0) : 0;
        const fines = Number(row.fines || 0);
        return `<tr class="${row.role === 'store_manager' ? 'commission-manager-row' : ''}">
          <td><strong>${escapeHTML(row.name || 'Sin nombre')}</strong><small>${escapeHTML(row.username ? '@' + row.username : '')}</small></td>
          <td>${escapeHTML(roleLabel)}</td>
          <td>${Number(row.orderCount || 0)}</td>
          <td><strong>${moneyCell(row.sales)}</strong></td>
          <td><div class="commission-rate-wrap"><input type="number" min="0.01" max="100" step="0.01" value="${defaultRate || ''}" data-commission-rate="${escapeHTML(String(row.userId))}" ${row.paid ? 'disabled' : ''}><span>%</span></div></td>
          <td><strong class="${fines > 0 ? 'commission-fine-amount' : ''}" data-commission-fines="${escapeHTML(String(row.userId))}">${moneyCell(fines)}</strong></td>
          <td><strong data-commission-amount="${escapeHTML(String(row.userId))}">${row.paid ? moneyCell(amount) : moneyCell(0)}</strong>${row.paid ? `<small class="commission-gross-detail">Bruta ${moneyCell(gross)} · multas ${moneyCell(fines)}</small>` : ''}</td>
          <td>${row.paid
            ? `<span class="commission-paid">Pagada · ${Number(row.paidRate || 0).toFixed(2)}%</span>`
            : `<button type="button" class="button primary small commission-pay-button" data-pay-commission="${escapeHTML(String(row.userId))}" ${Number(row.sales || 0) <= 0 ? 'disabled' : ''}>Pagar comisión</button>`}</td>
        </tr>`;
      }).join('') : '<tr><td colspan="8" class="commission-empty">No hay vendedores o Jefe de Tienda disponibles.</td></tr>';

      body.querySelectorAll('[data-commission-rate]').forEach(input => {
        const update = () => {
          const rate = Number(input.value || 0);
          const row = rows.find(item => String(item.userId) === String(input.dataset.commissionRate));
          const gross = row ? Number(row.sales || 0) * Math.max(0, Math.min(100, rate)) / 100 : 0;
          const fineAmount = row ? Number(row.fines || 0) : 0;
          const amount = Math.max(0, gross - fineAmount);
          const target = body.querySelector(`[data-commission-amount="${CSS.escape(String(input.dataset.commissionRate))}"]`);
          if (target) target.textContent = moneyCell(amount);
        };
        input.addEventListener('input', update);
        update();
      });
    } catch (error) {
      if (message) { message.hidden = false; message.className = 'commission-message error'; message.textContent = error.message || 'No se pudo calcular las comisiones.'; }
      body.innerHTML = '<tr><td colspan="8" class="commission-empty">No se pudo cargar la información.</td></tr>';
    }
  };

  document.querySelector('#commissionRefresh')?.addEventListener('click', loadCommissions);
  document.querySelector('#commissionDateFrom')?.addEventListener('change', loadCommissions);
  document.querySelector('#commissionDateTo')?.addEventListener('change', loadCommissions);

  document.querySelector('#commissionTableBody')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-pay-commission]');
    if (!button) return;
    const userId = button.dataset.payCommission;
    const input = document.querySelector(`[data-commission-rate="${CSS.escape(userId)}"]`);
    const rate = Number(input?.value || 0);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 100) {
      alert('Ingresa un porcentaje válido entre 0,01% y 100%.');
      input?.focus();
      return;
    }
    const from = document.querySelector('#commissionDateFrom')?.value || '';
    const to = document.querySelector('#commissionDateTo')?.value || '';
    const amountEl = document.querySelector(`[data-commission-amount="${CSS.escape(userId)}"]`);
    const amountText = amountEl?.textContent || '$0,00';
    if (!confirm(`¿Pagar la comisión de ${rate}% (${amountText}) para el período ${from} → ${to}?\n\nSe agregará automáticamente a Gastos del Resumen Financiero.`)) return;
    button.disabled = true;
    button.textContent = 'Pagando…';
    try {
      await request('/api/admin/calculo-comision/pagar', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ userId, from, to, rate }) });
      await loadCommissions();
    } catch (error) {
      alert(error.message || 'No se pudo registrar la comisión.');
      button.disabled = false;
      button.textContent = 'Pagar comisión';
    }
  });

  await loadCommissions();
  wireAccountMenu();
}

async function renderAdminFinancial() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated: false }));
  if (!session.authenticated) return renderLogin();
  if (String(session.role || '').toLowerCase() !== 'admin') return renderAdminOrders();

  const localToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
  const today = localToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  const nav = adminSectionNav(session, 'resumen-financiero');

  app.innerHTML = `<main class="admin-shell financial-shell"><div class="admin-wrap"><div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route aria-label="YHORS · Panel Administrativo · Ir a YHORS Inteligente"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></a><h1 class="admin-title">Resumen Financiero</h1><p class="admin-subtitle">Ventas, costos, gastos y ganancias de YHORS · acceso exclusivo de Administración</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>${nav}
    <section class="admin-panel financial-panel">
      <div class="section-heading financial-heading"><div><span class="eyebrow">Finanzas</span><h2>Resumen del período</h2></div><p>Calcula el resultado del período usando las ventas activas, el precio de compra registrado en cada producto y los gastos del negocio.</p></div>
      <div class="financial-toolbar">
        <div class="financial-date-range"><label class="financial-date-filter"><span>Desde</span><input id="financialDateFrom" type="date" value="${monthStart}" aria-label="Fecha inicial"></label><label class="financial-date-filter"><span>Hasta</span><input id="financialDateTo" type="date" value="${today}" aria-label="Fecha final"></label></div>
        <button type="button" class="button primary small" id="financialRefresh">Actualizar resumen</button><button type="button" class="button secondary small" id="financialPdf">PDF detallado</button>
      </div>
      <div class="financial-message" id="financialMessage" hidden></div>
      <div class="financial-summary" id="financialSummary"><div class="financial-loading">Calculando resumen…</div></div>
      <div class="financial-profit-banner" id="financialProfit"></div>
      <div class="financial-grid">
        <section class="financial-card"><div class="financial-card-head"><div><span class="eyebrow">Gastos</span><h3>Gastos del período</h3></div><button type="button" class="button primary small" id="openExpenseModal">+ Agregar gasto</button></div><div class="financial-expense-breakdown" id="financialExpenseBreakdown"></div><div class="financial-expenses-table-wrap"><table class="financial-expenses-table"><thead><tr><th>FECHA</th><th>CONCEPTO</th><th>TIPO</th><th>VALOR</th><th></th></tr></thead><tbody id="financialExpensesBody"><tr><td colspan="5" class="financial-loading">Cargando…</td></tr></tbody></table></div></section>
        <section class="financial-card"><div class="financial-card-head"><div><span class="eyebrow">Ventas</span><h3>Ventas por vendedor</h3></div></div><div class="financial-sellers-table-wrap"><table class="financial-sellers-table"><thead><tr><th>VENDEDOR</th><th>PEDIDOS</th><th>VENDIDO</th></tr></thead><tbody id="financialSellersBody"><tr><td colspan="3" class="financial-loading">Cargando…</td></tr></tbody></table></div><div class="financial-card-note">Las ventas canceladas no forman parte del resumen financiero.</div></section>
      </div>
    </section>
  </div></main>
  <div class="financial-modal" id="expenseModal" hidden><div class="financial-modal-backdrop" data-close-financial-modal></div><div class="financial-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="expenseModalTitle"><div class="financial-modal-head"><div><span class="eyebrow">Control de gastos</span><h2 id="expenseModalTitle">Agregar gasto</h2><input type="hidden" id="expenseId" value=""></div><button type="button" class="financial-modal-close" data-close-financial-modal>×</button></div><form id="expenseForm"><div class="form-grid"><div class="field"><label for="expenseDate">Fecha</label><input id="expenseDate" type="date" value="${today}" required></div><div class="field"><label for="expenseAmount">Valor</label><input id="expenseAmount" type="number" min="0.01" max="100000000" step="0.01" placeholder="0,00" required></div><div class="field full"><label for="expenseDescription">Concepto</label><input id="expenseDescription" maxlength="120" placeholder="Internet, luz, publicidad, transporte…" required></div><div class="field full"><label for="expenseNote">Detalle (opcional)</label><textarea id="expenseNote" rows="3" maxlength="500" placeholder="Observación o referencia del gasto"></textarea></div></div><div class="form-actions"><button type="button" class="button secondary" data-close-financial-modal>Cancelar</button><button type="submit" class="button primary" id="saveExpense">Guardar gasto</button><span class="message" id="expenseMessage"></span></div></form></div></div></div>`;

  const moneyCell = value => money(Number(value || 0));
  const modal = document.querySelector('#expenseModal');
  let financialExpenseRows = [];
  const resetExpenseForm = () => {
    document.querySelector('#expenseForm')?.reset();
    document.querySelector('#expenseId').value = '';
    document.querySelector('#expenseModalTitle').textContent = 'Agregar gasto';
    document.querySelector('#saveExpense').textContent = 'Guardar gasto';
    document.querySelector('#expenseDate').value = document.querySelector('#financialDateTo')?.value || today;
    document.querySelector('#expenseMessage').textContent = '';
  };
  const closeModal = () => { if (modal) modal.hidden = true; document.querySelector('#expenseMessage')?.replaceChildren(); };
  document.querySelectorAll('[data-close-financial-modal]').forEach(button => button.addEventListener('click', closeModal));
  document.querySelector('#openExpenseModal')?.addEventListener('click', () => {
    resetExpenseForm();
    modal.hidden = false;
    document.querySelector('#expenseDescription')?.focus();
  });

  const renderFinancial = async () => {
    const from = document.querySelector('#financialDateFrom')?.value || '';
    const to = document.querySelector('#financialDateTo')?.value || '';
    const summary = document.querySelector('#financialSummary');
    const profit = document.querySelector('#financialProfit');
    const expensesBody = document.querySelector('#financialExpensesBody');
    const breakdown = document.querySelector('#financialExpenseBreakdown');
    const sellersBody = document.querySelector('#financialSellersBody');
    const message = document.querySelector('#financialMessage');
    if (from && to && from > to) { if (message) { message.hidden = false; message.className = 'financial-message error'; message.textContent = 'La fecha inicial no puede ser posterior a la fecha final.'; } return; }
    if (message) message.hidden = true;
    if (summary) summary.innerHTML = '<div class="financial-loading">Calculando resumen…</div>';
    try {
      const result = await request(`/api/admin/resumen-financiero?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
      const totals = result.totals || {};
      if (summary) summary.innerHTML = `<article class="financial-metric sales"><span>VENTAS TOTALES</span><strong>${moneyCell(totals.sales)}</strong><small>${Number(totals.orderCount || 0)} pedido(s) activo(s)</small></article><article class="financial-metric purchases"><span>TOTAL COMPRAS</span><strong>${moneyCell(totals.purchases)}</strong><small>Costo de compra de productos vendidos</small></article><article class="financial-metric profit"><span>GANANCIAS NETAS</span><strong>${moneyCell(totals.profit)}</strong><small>Ventas − compras − gastos</small></article><article class="financial-metric expenses"><span>TOTAL GASTOS</span><strong>${moneyCell(totals.expenses)}</strong><small>Envíos + gastos registrados</small></article><article class="financial-metric money-in"><span>DINERO INGRESADO</span><strong>${moneyCell(totals.moneyIn?.total || 0)}</strong><small>Efectivo ${moneyCell(totals.moneyIn?.cash||0)} · Transfer. ${moneyCell(totals.moneyIn?.transfer||0)} · Tarjeta ${moneyCell(totals.moneyIn?.card||0)}</small></article><article class="financial-metric receivable"><span>POR COBRAR</span><strong>${moneyCell(totals.receivable || 0)}</strong><small>Saldo pendiente de ventas del período</small></article>`;
      const positive = Number(totals.profit || 0) >= 0;
      if (profit) profit.innerHTML = `<div class="${positive ? 'positive' : 'negative'}"><span>Resultado neto</span><strong>${moneyCell(totals.profit)}</strong><small>Margen: ${Number(totals.margin || 0).toFixed(2)}% · Período: ${escapeHTML(from || 'Todo')} → ${escapeHTML(to || 'Todo')}</small></div>`;
      if (breakdown) breakdown.innerHTML = `<div><span>Envíos por factura</span><strong>${moneyCell(totals.shipping)}</strong></div><div><span>Otros gastos</span><strong>${moneyCell(totals.manualExpenses)}</strong></div><div class="total"><span>Total gastos</span><strong>${moneyCell(totals.expenses)}</strong></div>`;
      const expenseRows = Array.isArray(result.expenses) ? result.expenses : [];
      financialExpenseRows = expenseRows;
      if (expensesBody) expensesBody.innerHTML = expenseRows.length ? expenseRows.map(expense => `<tr><td>${escapeHTML(expense.date)}</td><td><strong>${escapeHTML(expense.description)}</strong>${expense.note ? `<small>${escapeHTML(expense.note)}</small>` : ''}</td><td>Manual</td><td><strong>${moneyCell(expense.amount)}</strong></td><td><div class="financial-expense-actions"><button type="button" class="financial-edit-expense" data-edit-expense="${escapeHTML(expense.id)}" title="Editar gasto">Editar</button><button type="button" class="financial-delete-expense" data-delete-expense="${escapeHTML(expense.id)}" title="Eliminar gasto">×</button></div></td></tr>`).join('') : '<tr><td colspan="5" class="financial-empty">No hay gastos manuales registrados en este período.</td></tr>';
      const sellerRows = Array.isArray(result.salesBySeller) ? result.salesBySeller : [];
      if (sellersBody) sellersBody.innerHTML = sellerRows.length ? sellerRows.map(row => `<tr><td><strong>${escapeHTML(row.sellerName || 'Sin vendedor')}</strong></td><td>${Number(row.orders || 0)}</td><td><strong>${moneyCell(row.total)}</strong></td></tr>`).join('') : '<tr><td colspan="3" class="financial-empty">No hay ventas para este período.</td></tr>';
    } catch (error) {
      if (message) { message.hidden = false; message.className = 'financial-message error'; message.textContent = error.message || 'No se pudo calcular el resumen financiero.'; }
      if (summary) summary.innerHTML = '<div class="financial-loading">No se pudo cargar el resumen.</div>';
    }
  };

  document.querySelector('#financialRefresh')?.addEventListener('click', renderFinancial);
  document.querySelector('#financialPdf')?.addEventListener('click', () => {
    const from = document.querySelector('#financialDateFrom')?.value || '';
    const to = document.querySelector('#financialDateTo')?.value || '';
    if (from && to && from > to) {
      alert('La fecha inicial no puede ser posterior a la fecha final.');
      return;
    }
    const url = `/api/admin/resumen-financiero/pdf?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&t=${Date.now()}`;
    window.open(url, '_blank', 'noopener');
  });
  document.querySelector('#financialDateFrom')?.addEventListener('change', renderFinancial);
  document.querySelector('#financialDateTo')?.addEventListener('change', renderFinancial);
  document.querySelector('#financialExpensesBody')?.addEventListener('click', event => {
    const button = event.target.closest('[data-edit-expense]');
    if (!button) return;
    const expense = financialExpenseRows.find(item => String(item.id) === String(button.dataset.editExpense));
    if (!expense) return;
    document.querySelector('#expenseId').value = expense.id;
    document.querySelector('#expenseModalTitle').textContent = 'Editar gasto';
    document.querySelector('#saveExpense').textContent = 'Guardar cambios';
    document.querySelector('#expenseDate').value = expense.date || today;
    document.querySelector('#expenseAmount').value = Number(expense.amount || 0).toFixed(2);
    document.querySelector('#expenseDescription').value = expense.description || '';
    document.querySelector('#expenseNote').value = expense.note || '';
    document.querySelector('#expenseMessage').textContent = '';
    modal.hidden = false;
    document.querySelector('#expenseDescription')?.focus();
  });

  document.querySelector('#financialExpensesBody')?.addEventListener('click', async event => {
    const button = event.target.closest('[data-delete-expense]');
    if (!button) return;
    if (!confirm('¿Eliminar este gasto del resumen financiero?')) return;
    button.disabled = true;
    try { await request(`/api/admin/gastos/${encodeURIComponent(button.dataset.deleteExpense)}`, { method: 'DELETE' }); await renderFinancial(); } catch (error) { alert(error.message || 'No se pudo eliminar el gasto.'); button.disabled = false; }
  });
  document.querySelector('#expenseForm')?.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = document.querySelector('#saveExpense');
    const message = document.querySelector('#expenseMessage');
    const expenseId = document.querySelector('#expenseId')?.value || '';
    const payload = { date: document.querySelector('#expenseDate').value, description: document.querySelector('#expenseDescription').value.trim(), amount: Number(document.querySelector('#expenseAmount').value), note: document.querySelector('#expenseNote').value.trim() };
    submit.disabled = true; submit.textContent = expenseId ? 'Guardando cambios…' : 'Guardando…'; if (message) message.textContent = '';
    try {
      await request(expenseId ? `/api/admin/gastos/${encodeURIComponent(expenseId)}` : '/api/admin/gastos', {
        method: expenseId ? 'PUT' : 'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify(payload)
      });
      resetExpenseForm();
      closeModal();
      await renderFinancial();
    } catch (error) {
      if (message) message.textContent = error.message || 'No se pudo guardar el gasto.';
    } finally {
      submit.disabled = false;
      submit.textContent = 'Guardar gasto';
    }
  });

  wireAccountMenu();
  await renderFinancial();
}


async function renderAdminMoney() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated:false }));
  if (!session.authenticated) return renderLogin();
  const role=String(session.role||'').toLowerCase();
  if (!['admin','store_manager','vendedor','orders'].includes(role)) return renderAdmin();
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Guayaquil'});
  const sellers=await request('/api/admin/order-sellers').catch(()=>[]);
  const moneyCustomers=await request(`/api/admin/clientes?_=${Date.now()}`).catch(()=>[]);
  const canManageAll=['admin','store_manager'].includes(role);
  const canEditPayment=role==='admin';
  const sellerFilter=canManageAll?`<label class="money-filter"><span>Vendedor</span><select id="moneySeller"><option value="">Todos los vendedores</option>${sellers.map(s=>`<option value="${escapeHTML(s.id)}">${escapeHTML(s.name)}</option>`).join('')}</select></label>`:`<div class="money-my-sales"><span class="money-dot"></span><div><small>${role==='store_manager'?'Jefe de tienda':'Vendedor'}</small><strong>${role==='store_manager'?'Todos los cobros':'Mis cobros'}</strong></div></div>`;
  const nav=adminSectionNav(session,'dinero');
  app.innerHTML=`<main class="admin-shell money-shell"><div class="admin-wrap"><div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route aria-label="YHORS · Panel Administrativo"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></a><h1 class="admin-title">Dinero</h1><p class="admin-subtitle">Cobros, cuentas por cobrar y trazabilidad del dinero que realmente ingresó a YHORS.</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>${nav}<section class="admin-panel money-panel"><div class="section-heading"><div><span class="eyebrow">CONTROL DE DINERO</span><h2>Ingresos y cuentas por cobrar</h2></div><div class="money-heading-actions"><p>Cada ingreso queda ligado a una venta, una orden o directamente al expediente del cliente.</p><button type="button" class="button primary small" id="openCustomerCredit">+ INGRESAR DINERO A CLIENTE</button></div></div><div class="money-tabs" role="tablist"><button class="money-tab active" data-money-tab="cobros">COBROS</button><button class="money-tab" data-money-tab="cxc">CUENTAS POR COBRAR</button><button class="money-tab" data-money-tab="movimientos">MOVIMIENTOS</button></div><div class="money-filters"><div class="money-date-range"><label class="money-filter"><span>Desde</span><input id="moneyFrom" type="date" value="${today}"></label><label class="money-filter"><span>Hasta</span><input id="moneyTo" type="date" value="${today}"></label></div>${sellerFilter}<label class="money-filter money-search"><span>Buscar</span><div class="money-search-box"><span>⌕</span><input id="moneySearch" type="search" autocomplete="off" placeholder="Venta, cliente, transacción, banco…"><button type="button" id="moneySearchClear" hidden>×</button></div></label><button type="button" class="button primary small" id="moneyRefresh">Actualizar</button><button type="button" class="button secondary small" id="moneyClear">Limpiar</button></div><div id="moneySummary" class="money-summary"></div><div id="moneyContent"></div></section></div></main><div class="money-modal" id="paymentModal" hidden><div class="money-modal-backdrop" data-close-payment></div><div class="money-modal-dialog" role="dialog" aria-modal="true" aria-labelledby="paymentModalTitle"><div class="money-modal-head"><div><span class="eyebrow">INGRESO DE DINERO</span><h2 id="paymentModalTitle">Registrar pago</h2><small id="paymentSaleContext"></small></div><button type="button" class="money-modal-close" data-close-payment>×</button></div><form id="paymentForm"><input type="hidden" id="paymentId"><input type="hidden" id="paymentSaleId"><input type="hidden" id="paymentOrderId"><input type="hidden" id="paymentCustomerId"><div class="payment-sale-summary" id="paymentSaleSummary"></div><div class="form-grid"><div class="field full" id="paymentCustomerField" hidden><label>Cliente</label><input type="hidden" id="paymentCustomer"><button type="button" class="money-customer-picker-trigger" id="openMoneyCustomerPicker"><span class="money-customer-picker-copy"><strong id="selectedMoneyCustomerName">Selecciona un cliente…</strong><small id="selectedMoneyCustomerMeta">Busca por nombre, cédula o teléfono</small></span><span class="money-customer-picker-arrow">⌄</span></button></div><div class="field"><label for="paymentMethod">Forma de pago</label><select id="paymentMethod" required><option value="cash">Efectivo</option><option value="transfer">Transferencia</option><option value="card">Tarjeta</option></select></div><div class="field"><label for="paymentAmount">Valor</label><input id="paymentAmount" type="number" min="0.01" step="0.01" required></div><div class="field"><label for="paymentDate">Fecha</label><input id="paymentDate" type="date" value="${today}" required></div><div class="field"><label for="paymentBank">Banco / caja</label><input id="paymentBank" maxlength="100" placeholder="Pichincha, Guayaquil, Caja principal…" required></div><div class="field payment-extra"><label for="paymentBatch">Lote <small>(opcional)</small></label><input id="paymentBatch" maxlength="100" placeholder="Lote de depósito / voucher"></div><div class="field payment-extra"><label for="paymentTransaction">N.º de transacción</label><input id="paymentTransaction" maxlength="120" placeholder="TRX-000000"></div><div class="field full"><label for="paymentNote">Detalle / nota del pago <small>(opcional)</small></label><input id="paymentNote" maxlength="500" placeholder="Ej. Abono final, anticipo, pago en efectivo…"></div></div><div class="message" id="paymentHelp">Para efectivo no necesitas número de transacción. Transferencias y tarjetas sí deben llevarlo.</div><div class="form-actions"><button type="button" class="button secondary" data-close-payment>Cancelar</button><button type="button" class="button secondary" id="registerAnotherPayment" hidden>+ Registrar otro pago</button><button type="submit" class="button primary" id="savePayment">Registrar pago</button><span class="message" id="paymentMessage"></span></div></form></div></div></div><div class="generate-modal money-customer-picker-modal" id="moneyCustomerPickerModal" hidden><div class="generate-modal-backdrop" data-close-money-customer-picker></div><div class="generate-modal-dialog generate-customer-modal" role="dialog" aria-modal="true" aria-labelledby="moneyCustomerPickerTitle"><div class="generate-modal-head"><div><span class="eyebrow">FICHERO DE CLIENTES</span><h2 id="moneyCustomerPickerTitle">Seleccionar cliente</h2><p class="generate-customer-modal-subtitle">Busca entre todos tus clientes por nombre, cédula, RUC, teléfono o correo.</p></div><button type="button" class="generate-modal-close" data-close-money-customer-picker>×</button></div><div class="generate-customer-searchbar"><span aria-hidden="true">⌕</span><input id="moneyCustomerSearch" type="search" placeholder="Escribe nombre, cédula, teléfono o correo…" autocomplete="off"><button type="button" class="button secondary small" id="clearMoneyCustomerSearch">Limpiar</button></div><div class="generate-customer-picker-count" id="moneyCustomerPickerCount"></div><div class="generate-customer-picker-list" id="moneyCustomerPickerList"></div></div></div></div>`;
  wireAccountMenu();
  let currentRows=[]; let activeTab='cobros';
  const modal=document.querySelector('#paymentModal');
  const moneySummary=document.querySelector('#moneySummary'); const content=document.querySelector('#moneyContent');
  const fmtDate=v=>{const d=new Date(`${v}T12:00:00`);return Number.isNaN(d.getTime())?'—':d.toLocaleDateString('es-EC',{day:'2-digit',month:'2-digit',year:'numeric',timeZone:'America/Guayaquil'});};
  const closePayment=()=>{if(modal)modal.hidden=true;document.querySelector('#paymentMessage').textContent='';};
  document.querySelectorAll('[data-close-payment]').forEach(b=>b.addEventListener('click',closePayment));
  const updateMethodFields=()=>{const method=document.querySelector('#paymentMethod')?.value;const transaction=document.querySelector('#paymentTransaction');const batch=document.querySelector('#paymentBatch');const batchField=batch?.closest('.field');const transactionField=transaction?.closest('.field');[batchField,transactionField].forEach(x=>x?.classList.toggle('is-cash',method==='cash'));if(batchField)batchField.hidden=method==='cash';if(transactionField)transactionField.hidden=method==='cash';if(transaction){transaction.required=method!=='cash';transaction.disabled=method==='cash';if(method==='cash')transaction.value='';}if(batch&&method==='cash')batch.value='';document.querySelector('#paymentHelp').textContent=method==='cash'?'Efectivo: fecha, banco/caja y valor. La fecha inicia automáticamente en hoy.':'Transferencia y tarjeta: fecha, banco, valor, número de transacción y lote opcional.';};
  document.querySelector('#paymentMethod')?.addEventListener('change',updateMethodFields); updateMethodFields();
  const openPayment=async row=>{const receivable=(currentRows.receivables||[]).find(r=>(row.saleId&&String(r.saleId)===String(row.saleId))||(row.orderId&&String(r.orderId)===String(row.orderId)));const base=receivable||row;const related=(currentRows.payments||[]).filter(p=>(row.saleId&&String(p.saleId)===String(row.saleId))||(!row.saleId&&row.orderId&&String(p.orderId)===String(row.orderId)));const totalPaid=Math.round(related.reduce((sum,p)=>sum+Number(p.amount||0),0)*100)/100;const totalDue=Number(base.totalSale||row.totalSale||0);const realBalance=Math.max(0,Math.round((totalDue-totalPaid)*100)/100);document.querySelector('#paymentForm')?.reset();document.querySelector('#paymentId').value=row.paymentId||'';document.querySelector('#paymentSaleId').value=row.saleId||'';document.querySelector('#paymentOrderId').value=row.orderId||'';document.querySelector('#paymentCustomerId').value='';document.querySelector('#paymentCustomerField').hidden=true;document.querySelector('#paymentModalTitle').textContent=row.paymentId?'Editar pago':'Registrar pago';document.querySelector('#paymentSaleContext').textContent=`${base.saleNumber||row.saleNumber||'Venta'} · ${base.customerName||row.customerName||'Cliente'}`;document.querySelector('#paymentSaleSummary').innerHTML=`<div><span>TOTAL VENTA</span><strong>${money(totalDue)}</strong></div><div><span>PAGADO</span><strong>${money(totalPaid)}</strong></div><div class="balance"><span>SALDO REAL</span><strong>${money(realBalance)}</strong></div>`;document.querySelector('#paymentAmount').value=row.paymentId?Number(row.amount||0).toFixed(2):realBalance.toFixed(2);document.querySelector('#paymentDate').value=row.paymentId?(row.date||today):today;document.querySelector('#paymentBank').value=row.paymentId?(row.bank||''):'';document.querySelector('#paymentBatch').value=row.paymentId?(row.batch||''):'';document.querySelector('#paymentTransaction').value=row.paymentId?(row.transactionNumber||''):'';document.querySelector('#paymentNote').value=row.paymentId?(row.note||''):'';document.querySelector('#paymentMethod').value=row.paymentId?(row.method||'cash'):'cash';const another=document.querySelector('#registerAnotherPayment');if(another){another.hidden=realBalance<=0.001;another.onclick=()=>openPayment({...base,paymentId:'',amount:realBalance});}updateMethodFields();modal.hidden=false;document.querySelector('#paymentAmount')?.focus();};
  const moneyCustomerPicker=document.querySelector('#moneyCustomerPickerModal');
  const moneyCustomerSearch=document.querySelector('#moneyCustomerSearch');
  const moneyCustomerList=document.querySelector('#moneyCustomerPickerList');
  const moneyCustomerCount=document.querySelector('#moneyCustomerPickerCount');
  const selectedCustomerName=document.querySelector('#selectedMoneyCustomerName');
  const selectedCustomerMeta=document.querySelector('#selectedMoneyCustomerMeta');
  const selectedCustomerButton=document.querySelector('#openMoneyCustomerPicker');
  const closeMoneyCustomerPicker=()=>{if(moneyCustomerPicker){moneyCustomerPicker.classList.remove('is-open');moneyCustomerPicker.hidden=true;}};
  document.querySelectorAll('[data-close-money-customer-picker]').forEach(b=>b.addEventListener('click',closeMoneyCustomerPicker));
  const selectedMoneyCustomer=()=>{const id=document.querySelector('#paymentCustomerId')?.value||'';return (Array.isArray(moneyCustomers)?moneyCustomers:[]).find(c=>String(c.id)===String(id));};
  const renderMoneyCustomerPicker=()=>{const q=String(moneyCustomerSearch?.value||'').trim().toLowerCase();const all=Array.isArray(moneyCustomers)?moneyCustomers:[];const rows=all.filter(c=>{if(!q)return true;return [c.name,c.cedula,c.phone,c.email,c.city].some(v=>String(v||'').toLowerCase().includes(q));});const visible=rows.slice(0,80);if(moneyCustomerCount)moneyCustomerCount.textContent=`${rows.length} cliente${rows.length===1?'':'s'}${q?' encontrados':''}${rows.length>80?' · mostrando los primeros 80':''}`;if(moneyCustomerList)moneyCustomerList.innerHTML=visible.length?visible.map(c=>`<button type="button" class="generate-customer-option${String(c.id)===String(document.querySelector('#paymentCustomerId')?.value||'')?' is-selected':''}" data-select-money-customer="${escapeHTML(c.id)}"><span class="generate-customer-option-avatar">${escapeHTML((c.name||'C').trim().slice(0,1).toUpperCase())}</span><span class="generate-customer-option-copy"><strong>${escapeHTML(c.name||'Sin nombre')}</strong><small>${escapeHTML(c.cedula||'Sin cédula')} · ${escapeHTML(c.phone||'Sin teléfono')}${c.email?` · ${escapeHTML(c.email)}`:''}</small></span><span class="generate-customer-option-check">${String(c.id)===String(document.querySelector('#paymentCustomerId')?.value||'')?'✓':'›'}</span></button>`).join(''):'<div class="generate-customer-empty"><span>⌕</span><strong>No encontramos ese cliente</strong><small>Prueba con nombre, cédula, teléfono o correo.</small></div>';};
  const syncSelectedMoneyCustomer=()=>{const c=selectedMoneyCustomer();if(selectedCustomerName)selectedCustomerName.textContent=c?.name||'Selecciona un cliente…';if(selectedCustomerMeta)selectedCustomerMeta.textContent=c?[`${c.cedula||'Sin cédula'}`,`${c.phone||'Sin teléfono'}`].join(' · '):'Busca por nombre, cédula o teléfono';selectedCustomerButton?.classList.toggle('has-selection',!!c);};
  const openMoneyCustomerPicker=()=>{if(!moneyCustomerPicker)return;moneyCustomerSearch.value='';renderMoneyCustomerPicker();moneyCustomerPicker.hidden=false;requestAnimationFrame(()=>moneyCustomerPicker.classList.add('is-open'));setTimeout(()=>moneyCustomerSearch?.focus(),50);};
  document.querySelector('#openMoneyCustomerPicker')?.addEventListener('click',openMoneyCustomerPicker);
  document.querySelector('#clearMoneyCustomerSearch')?.addEventListener('click',()=>{moneyCustomerSearch.value='';renderMoneyCustomerPicker();moneyCustomerSearch.focus();});
  moneyCustomerSearch?.addEventListener('input',renderMoneyCustomerPicker);
  moneyCustomerList?.addEventListener('click',e=>{const option=e.target.closest('[data-select-money-customer]');if(!option)return;const id=option.dataset.selectMoneyCustomer||'';document.querySelector('#paymentCustomerId').value=id;document.querySelector('#paymentCustomer').value=id;syncSelectedMoneyCustomer();closeMoneyCustomerPicker();});
  const openCustomerCredit=(row=null)=>{document.querySelector('#paymentForm')?.reset();document.querySelector('#paymentId').value=row?.paymentId||'';document.querySelector('#paymentSaleId').value='';document.querySelector('#paymentOrderId').value='';document.querySelector('#paymentCustomerId').value=row?.customerId||'';document.querySelector('#paymentCustomerField').hidden=false;document.querySelector('#paymentCustomer').value=row?.customerId||'';document.querySelector('#paymentModalTitle').textContent=row?.paymentId?'Editar ingreso de cliente':'Ingresar dinero a cliente';document.querySelector('#paymentSaleContext').textContent=row?.paymentId?'Ingreso conservado en el expediente del cliente':'Anticipo / saldo a favor · no requiere una factura abierta';document.querySelector('#paymentSaleSummary').innerHTML='<div><span>TIPO</span><strong>ANTICIPO</strong></div><div><span>DESTINO</span><strong>Expediente del cliente</strong></div><div class="balance"><span>ESTADO</span><strong>Saldo a favor</strong></div>';document.querySelector('#paymentAmount').value=row?.paymentId?Number(row.amount||0).toFixed(2):'';document.querySelector('#paymentDate').value=row?.paymentId?(row.date||today):today;document.querySelector('#paymentBank').value=row?.paymentId?(row.bank||''):'';document.querySelector('#paymentBatch').value=row?.paymentId?(row.batch||''):'';document.querySelector('#paymentTransaction').value=row?.paymentId?(row.transactionNumber||''):'';document.querySelector('#paymentNote').value=row?.paymentId?(row.note||''):'';document.querySelector('#paymentMethod').value=row?.paymentId?(row.method||'cash'):'cash';document.querySelector('#registerAnotherPayment').hidden=true;syncSelectedMoneyCustomer();updateMethodFields();modal.hidden=false;};
  document.querySelector('#openCustomerCredit')?.addEventListener('click',openCustomerCredit);
  const load=async()=>{const from=document.querySelector('#moneyFrom')?.value||today,to=document.querySelector('#moneyTo')?.value||today,q=document.querySelector('#moneySearch')?.value||'',sellerId=document.querySelector('#moneySeller')?.value||''; if(from&&to&&from>to){moneySummary.innerHTML='<div class="money-empty">La fecha inicial no puede ser posterior a la fecha final.</div>';content.innerHTML='';return;} moneySummary.innerHTML='<div class="money-loading">Consultando movimientos de dinero…</div>';try{const params=new URLSearchParams({from,to,q,sellerId,showPaid:'true'});const result=await request(`/api/admin/dinero/resumen?${params}`);currentRows=result;const t=result.totals||{};const rt=result.receivableTotals||{};moneySummary.innerHTML=`<article class="money-metric money-total"><span>INGRESADO</span><strong>${money(t.total)}</strong><small>${fmtDate(from)} → ${fmtDate(to)}</small></article><article class="money-metric"><span>EFECTIVO</span><strong>${money(t.cash)}</strong><small>Caja / efectivo</small></article><article class="money-metric"><span>TRANSFERENCIAS</span><strong>${money(t.transfer)}</strong><small>Con banco y transacción</small></article><article class="money-metric"><span>TARJETAS</span><strong>${money(t.card)}</strong><small>Con banco y transacción</small></article><article class="money-metric money-due"><span>POR COBRAR</span><strong>${money(rt.balance)}</strong><small>${result.receivables?.filter(r=>r.balance>0).length||0} cuenta(s) pendiente(s)</small></article>`;renderTab(result); }catch(e){moneySummary.innerHTML=`<div class="money-empty error">${escapeHTML(e.message||'No se pudo cargar el dinero.')}</div>`;content.innerHTML='';}};
  const renderTab=result=>{if(activeTab==='cobros'){const rows=Array.isArray(result.payments)?result.payments:[];content.innerHTML=rows.length?`<div class="money-table-wrap"><table class="money-table"><thead><tr><th>FECHA</th><th>VENTA</th><th>CLIENTE</th><th>FORMA</th><th>BANCO / CAJA</th><th>LOTE</th><th>TRANSACCIÓN</th><th>VALOR</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td>${fmtDate(r.date)}</td><td><strong>${r.sourceType==='cliente'?'SALDO A FAVOR':'#'+escapeHTML(r.saleNumber)}</strong></td><td>${escapeHTML(r.customerName)}<small>${escapeHTML(r.sellerName)}</small></td><td><span class="payment-method payment-${escapeHTML(r.method)}">${escapeHTML(r.methodLabel)}</span></td><td>${escapeHTML(r.bank||'—')}</td><td>${escapeHTML(r.batch||'—')}</td><td>${escapeHTML(r.transactionNumber||'—')}</td><td><strong>${money(r.amount)}</strong></td><td>${canEditPayment?`<div class="money-actions"><button class="button secondary small" data-edit-payment="${escapeHTML(r.id)}">Editar</button><button class="button danger small" data-delete-payment="${escapeHTML(r.id)}">Eliminar</button></div>`:''}</td></tr>`).join('')}</tbody></table></div>`:'<div class="money-empty">No hay ingresos registrados con estos filtros.</div>';}else if(activeTab==='cxc'){const rows=(result.receivables||[]).filter(r=>r.balance>0);content.innerHTML=rows.length?`<div class="money-table-wrap"><table class="money-table"><thead><tr><th>VENTA</th><th>CLIENTE</th><th>FECHA</th><th>RESPONSABLE</th><th>TOTAL</th><th>PAGADO</th><th>SALDO</th><th>ESTADO</th><th></th></tr></thead><tbody>${rows.map(r=>`<tr><td><strong>#${escapeHTML(r.saleNumber)}</strong><small>${r.sourceType==='orden'?'Orden pendiente':'Venta confirmada'}</small></td><td>${escapeHTML(r.customerName)}<small>${escapeHTML(r.sellerName)}</small></td><td>${fmtDate(r.date)}<small>${Number(r.ageDays||0)} día(s)</small></td><td>${escapeHTML(r.responsibleName||r.sellerName||'Sin vendedor')}</td><td>${money(r.totalSale)}</td><td>${money(r.paid)}</td><td><strong class="money-balance">${money(r.balance)}</strong></td><td><span class="receivable-status ${r.status==='ABONO'?'partial':''}">${r.status}</span></td><td><button class="button primary small" data-open-payment="${escapeHTML(r.saleId||r.orderId)}" data-open-payment-type="${r.sourceType||'venta'}">Registrar pago</button></td></tr>`).join('')}</tbody></table></div>`:'<div class="money-empty">No hay cuentas por cobrar pendientes con estos filtros.</div>';}else{const rows=Array.isArray(result.payments)?result.payments:[];content.innerHTML=rows.length?`<div class="money-ledger-head"><div><span class="eyebrow">LIBRO DE INGRESOS</span><h3>Movimientos de dinero</h3></div><p>Cada fila representa dinero efectivamente ingresado.</p></div><div class="money-table-wrap"><table class="money-table"><thead><tr><th>FECHA</th><th>VENTA</th><th>CLIENTE</th><th>FORMA</th><th>BANCO / CAJA</th><th>REFERENCIA</th><th>VALOR</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${fmtDate(r.date)}</td><td>${r.sourceType==='cliente'?'SALDO A FAVOR':'#'+escapeHTML(r.saleNumber)}</td><td>${escapeHTML(r.customerName)}</td><td>${escapeHTML(r.methodLabel)}</td><td>${escapeHTML(r.bank||'—')}</td><td>${escapeHTML([r.batch,r.transactionNumber].filter(Boolean).join(' · ')||'—')}</td><td><strong>${money(r.amount)}</strong></td></tr>`).join('')}</tbody></table></div>`:'<div class="money-empty">No hay movimientos de dinero en este período.</div>'}};
  document.querySelectorAll('[data-money-tab]').forEach(tab=>tab.addEventListener('click',()=>{activeTab=tab.dataset.moneyTab;document.querySelectorAll('[data-money-tab]').forEach(x=>x.classList.toggle('active',x===tab));load();}));
  document.querySelector('#moneyRefresh')?.addEventListener('click',load);document.querySelector('#moneyFrom')?.addEventListener('change',load);document.querySelector('#moneyTo')?.addEventListener('change',load);document.querySelector('#moneySeller')?.addEventListener('change',load);document.querySelector('#moneySearch')?.addEventListener('input',()=>{const v=document.querySelector('#moneySearch').value;document.querySelector('#moneySearchClear').hidden=!v;load();});document.querySelector('#moneySearchClear')?.addEventListener('click',()=>{document.querySelector('#moneySearch').value='';document.querySelector('#moneySearchClear').hidden=true;load();});document.querySelector('#moneyClear')?.addEventListener('click',()=>{document.querySelector('#moneyFrom').value=today;document.querySelector('#moneyTo').value=today;document.querySelector('#moneySearch').value='';if(document.querySelector('#moneySeller'))document.querySelector('#moneySeller').value='';document.querySelector('#moneySearchClear').hidden=true;load();});
  content.addEventListener('click',async e=>{const open=e.target.closest('[data-open-payment]');if(open){const result=await request(`/api/admin/dinero/resumen?from=2000-01-01&to=2999-12-31&showPaid=true`);const row=(result.receivables||[]).find(r=>String((open.dataset.openPaymentType==='orden'?r.orderId:r.saleId))===String(open.dataset.openPayment));if(row)openPayment(row);return;}const edit=e.target.closest('[data-edit-payment]');if(edit){const row=(currentRows.payments||[]).find(r=>String(r.id)===String(edit.dataset.editPayment));if(row){if(row.sourceType==='cliente'&&!row.saleId&&!row.orderId){openCustomerCredit({...row,paymentId:row.id});}else{const receivable=(currentRows.receivables||[]).find(r=>(row.saleId&&String(r.saleId)===String(row.saleId))||(row.orderId&&String(r.orderId)===String(row.orderId)));openPayment({...row,...(receivable||{}),paymentId:row.id});}}return;}const del=e.target.closest('[data-delete-payment]');if(del){const ok=await showYhorsConfirm('¿Eliminar este pago?','El ingreso se quitará del estado de cuenta y el saldo pendiente se recalculará.');if(!ok)return;try{await request(`/api/admin/dinero/pagos/${encodeURIComponent(del.dataset.deletePayment)}`,{method:'DELETE'});await load();}catch(err){alert(err.message);}}});
  document.querySelector('#paymentForm')?.addEventListener('submit',async e=>{e.preventDefault();const msg=document.querySelector('#paymentMessage'),submit=document.querySelector('#savePayment');const payload={saleId:document.querySelector('#paymentSaleId').value||null,orderId:document.querySelector('#paymentOrderId').value||null,customerId:document.querySelector('#paymentCustomerId').value||null,method:document.querySelector('#paymentMethod').value,amount:Number(document.querySelector('#paymentAmount').value),date:document.querySelector('#paymentDate').value,bank:document.querySelector('#paymentBank').value.trim(),batch:document.querySelector('#paymentBatch').value.trim(),transactionNumber:document.querySelector('#paymentTransaction').value.trim(),note:document.querySelector('#paymentNote').value.trim()};submit.disabled=true;submit.classList.add('is-loading');msg.textContent='Guardando…';try{const id=document.querySelector('#paymentId').value;const endpoint=id?`/api/admin/dinero/pagos/${encodeURIComponent(id)}`:(payload.customerId?'/api/admin/dinero/pagos-cliente':payload.orderId?'/api/admin/dinero/pagos-orden':'/api/admin/dinero/pagos');await request(endpoint,{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});closePayment();await load();}catch(err){msg.className='message error';msg.textContent=err.message||'No se pudo guardar el pago.';}finally{submit.disabled=false;submit.classList.remove('is-loading');}});
  await load();
  const saleQuery=new URLSearchParams(window.location.search).get('sale');
  if(saleQuery){try{const full=await request(`/api/admin/dinero/resumen?from=2000-01-01&to=2999-12-31&showPaid=true`);const row=(full.receivables||[]).find(r=>String(r.saleId)===String(saleQuery));if(row&&Number(row.balance||0)>0)openPayment(row);}catch{}}
}

async function renderAdminSalesHistory() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated:false }));
  if (!session.authenticated) return renderLogin();
  const canDelete = String(session.role || '').trim().toLowerCase() === 'admin';
  const canEditNotes = canDelete;
  const shortDate = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-EC', { day:'2-digit', month:'short', year:'numeric', timeZone:'America/Guayaquil' }); };
  const sellers = await request('/api/admin/order-sellers').catch(() => []);
  const today = new Date().toLocaleDateString('en-CA');
  const sectionNav = adminSectionNav(session, 'historial-ventas');
  const isSeller = String(session.role || '').trim().toLowerCase() === 'vendedor' || String(session.role || '').trim().toLowerCase() === 'orders';
  const sellerFilter = isSeller
    ? `<div class="sales-my-sales-badge"><span class="sales-my-sales-dot"></span><div><small>Vendedor</small><strong>Mis ventas</strong></div></div>`
    : `<label class="sales-status-filter"><span>Vendedor</span><select id="historySeller"><option value="">Todos los vendedores</option>${sellers.map(s=>`<option value="${escapeHTML(s.id)}">${escapeHTML(s.name)}</option>`).join('')}</select></label>`;
  app.innerHTML = `<main class="admin-shell sales-shell"><div class="admin-wrap"><div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route aria-label="YHORS · Panel Administrativo · Ir a YHORS Inteligente"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></a><h1 class="admin-title">Historial de ventas</h1><p class="admin-subtitle">Ventas notificadas desde pedidos Enviados o Entregados · solo lectura después de notificarlas.</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>${sectionNav}<section class="admin-panel sales-panel"><div class="section-heading sales-heading"><div><span class="eyebrow">Ventas</span><h2>Historial de ventas</h2></div><p>${isSeller ? 'Aquí solo puedes consultar las ventas notificadas a tu usuario.' : 'Vendedores y Jefes pueden consultar el PDF. Solo Administración puede eliminar una venta del historial.'}</p></div><div class="sales-toolbar"><div class="sales-date-range"><label class="sales-date-filter"><span>Desde</span><input id="historyDateFrom" type="date" value="${today}"></label><label class="sales-date-filter"><span>Hasta</span><input id="historyDateTo" type="date" value="${today}"></label></div>${sellerFilter}<label class="sales-search"><span>Buscar</span><div class="sales-search-box"><span class="sales-search-icon" aria-hidden="true">⌕</span><input id="historySearch" type="search" autocomplete="off" placeholder="Buscar venta, cliente, cédula, producto o SKU…"><button type="button" class="sales-search-clear" id="historySearchClear" aria-label="Limpiar búsqueda" hidden>×</button></div></label><button type="button" class="button primary small" id="historyRefresh">Actualizar</button></div><div id="historySummary" class="sales-summary"></div><div id="historyList" class="sales-table-wrap"></div></section></div></main>`;
  const load = async () => {
    const from=document.querySelector('#historyDateFrom')?.value||''; const to=document.querySelector('#historyDateTo')?.value||''; const q=document.querySelector('#historySearch')?.value||''; const sellerId=document.querySelector('#historySeller')?.value||''; const list=document.querySelector('#historyList'); const summary=document.querySelector('#historySummary');
    if(from&&to&&from>to){list.innerHTML='<div class="sales-empty">La fecha inicial no puede ser posterior a la fecha final.</div>';return;}
    try {
      const params=new URLSearchParams({from,to,q,sellerId}); const rows=await request(`/api/admin/historial-ventas?${params}`);
      const historyTotal = rows.reduce((sum,r)=>sum+Number(r.total||0),0);
      summary.innerHTML=`<article class="financial-metric sales"><span>VENTAS NOTIFICADAS</span><strong>${rows.length}</strong><small>${from||'Todo'} → ${to||'Todo'}</small></article><article class="financial-metric profit"><span>TOTAL VENDIDO</span><strong>${money(historyTotal)}</strong><small>Historial de ventas</small></article>`;
      if (!rows.length) { list.innerHTML='<div class="sales-empty">No hay ventas notificadas que coincidan con los filtros.</div>'; return; }
      const body=rows.map(r=>{
        const note=String(r.internalNote||'').trim();
        const noteBlock=`<details class="history-note-details"><summary>${note ? 'Ver nota interna' : 'Sin nota interna'}</summary><div class="history-note-content">${canEditNotes ? `<textarea class="history-note-editor" data-history-note="${escapeHTML(r.id)}" maxlength="5000" rows="3" placeholder="Servientrega, guía, novedades u otra información importante…">${escapeHTML(note)}</textarea><div class="history-note-actions"><button class="button primary small" type="button" data-history-note-save="${escapeHTML(r.id)}">Guardar nota</button></div>` : `<p>${note ? escapeHTML(note).replace(/\n/g,'<br>') : 'No hay nota interna registrada.'}</p>`}</div></details>`;
        return `<tr><td>${escapeHTML(shortDate(r.notifiedAt||r.createdAt))}</td><td><strong>#${escapeHTML(r.orderNumber||'—')}</strong></td><td>${escapeHTML(r.customer?.name||'Cliente')}<small>${escapeHTML(r.customer?.cedula||'')}</small></td><td>${escapeHTML(r.assignedSellerName||'Sin vendedor')}</td><td>${escapeHTML(r.status||'—')}</td><td><strong>${money(r.total)}</strong><small class="history-payment-state">${r.paymentStatus==='PAGADO'?'PAGADO':r.paymentStatus==='ABONO'?`Abonado ${money(r.paid)} · saldo ${money(r.balance)}`:`Pendiente ${money(r.balance)}`}</small></td><td><div class="history-row-tools"><div class="history-actions"><button class="button pdf-order small" type="button" data-history-pdf="${escapeHTML(r.id)}">PDF</button>${Number(r.balance||0)>0?` <a class="button primary small" href="${ADMIN_PATH}/dinero?sale=${encodeURIComponent(r.id)}" data-smooth-route>Registrar pago</a>`:''}${canDelete ? ` <button class="button danger small" type="button" data-history-delete="${escapeHTML(r.id)}">Eliminar</button>` : ''}</div>${noteBlock}</div></td></tr>`;
      }).join('');
      list.innerHTML='<table class="sales-table"><thead><tr><th>FECHA</th><th>VENTA</th><th>CLIENTE</th><th>VENDEDOR</th><th>ESTADO</th><th>TOTAL</th><th>NOTA INTERNA / ACCIONES</th></tr></thead><tbody>'+body+'</tbody></table>';
    } catch(e) { list.innerHTML=`<div class="sales-empty">${escapeHTML(e.message||'No se pudo cargar el historial.')}</div>`; }
  };
  wireAccountMenu();
  document.querySelector('#historyRefresh')?.addEventListener('click',load); document.querySelector('#historyDateFrom')?.addEventListener('change',load); document.querySelector('#historyDateTo')?.addEventListener('change',load); document.querySelector('#historySeller')?.addEventListener('change',load); document.querySelector('#historySearch')?.addEventListener('input',event=>{const value=event.currentTarget.value;const clear=document.querySelector('#historySearchClear');if(clear)clear.hidden=!value;clearTimeout(window.__historySearchTimer);window.__historySearchTimer=setTimeout(load,180);}); document.querySelector('#historySearchClear')?.addEventListener('click',()=>{const input=document.querySelector('#historySearch');if(input){input.value='';input.focus();}const clear=document.querySelector('#historySearchClear');if(clear)clear.hidden=true;load();});
  document.querySelector('#historyList')?.addEventListener('click',async event=>{ const pdf=event.target.closest('[data-history-pdf]'); if(pdf){const a=document.createElement('a');a.href=`/api/admin/historial-ventas/${encodeURIComponent(pdf.dataset.historyPdf)}/pdf?v=${Date.now()}`;a.target='_blank';a.rel='noopener';a.click();return;} const del=event.target.closest('[data-history-delete]'); if(del){const ok=await showYhorsConfirm('¿Eliminar esta venta del historial?','Al eliminarla, el pedido volverá a PEDIDOS y podrá editarse o eliminarse nuevamente.');if(!ok)return;del.disabled=true;try{await request(`/api/admin/historial-ventas/${del.dataset.historyDelete}`,{method:'DELETE'});await load();}catch(e){del.disabled=false;alert(e.message);return;}} const saveNote=event.target.closest('[data-history-note-save]'); if(saveNote){const id=saveNote.dataset.historyNoteSave;const textarea=document.querySelector(`[data-history-note=\"${CSS.escape(id)}\"]`);if(!textarea)return;const ok=await showYhorsConfirm('¿Guardar nota interna?','La nota quedará asociada a esta venta y podrá ser consultada desde Historial de ventas.');if(!ok)return;saveNote.disabled=true;try{await request(`/api/admin/historial-ventas/${encodeURIComponent(id)}/nota`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({internalNote:textarea.value})});await load();}catch(e){saveNote.disabled=false;alert(e.message);}} });
  await load();
}

async function renderAdminSales() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated: false }));
  if (!session.authenticated) return renderLogin();
  if (!['admin', 'store_manager', 'vendedor', 'orders'].includes(String(session.role || '').toLowerCase())) return renderAdmin();

  const localToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
  const today = localToday();
  const monthStart = `${today.slice(0, 7)}-01`;
  const moneyCell = value => money(Number(value || 0));
  const nav = adminSectionNav(session, 'ventas-generales');

  app.innerHTML = `<main class="admin-shell sales-shell"><div class="admin-wrap"><div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route aria-label="YHORS · Panel Administrativo · Ir a YHORS Inteligente"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></a><h1 class="admin-title">Ventas Generales</h1><p class="admin-subtitle">Resumen de ventas por vendedor · visible para todos los usuarios operativos</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>${nav}
    <section class="admin-panel sales-panel">
      <div class="section-heading sales-heading"><div><span class="eyebrow">Ventas</span><h2>Ventas Generales</h2></div><p>Consulta cuánto ha vendido cada vendedor y el total que queda a cargo del <strong>Jefe de Tienda</strong>.</p></div>
      <div class="sales-toolbar">
        <div class="sales-date-range"><label class="sales-date-filter"><span>Desde</span><input id="salesDateFrom" type="date" value="${monthStart}" aria-label="Fecha inicial"></label><label class="sales-date-filter"><span>Hasta</span><input id="salesDateTo" type="date" value="${today}" aria-label="Fecha final"></label></div>
        <label class="sales-status-filter"><span>Estado</span><select id="salesStatusFilter"><option value="all" selected>Todas las ventas notificadas</option><option value="Pendiente">Pendiente</option><option value="Confirmado">Confirmado</option><option value="Preparado">Preparado</option><option value="Enviado">Enviado</option><option value="Entregado">Entregado</option><option value="Cancelado">Cancelado</option></select></label>
        <button type="button" class="button primary small" id="salesRefresh">Actualizar</button>
      </div>
      <div class="sales-summary" id="salesSummary"></div>
      <div class="sales-table-wrap"><table class="sales-table"><thead><tr><th>VENDEDOR</th><th>PEDIDOS</th><th>SUBTOTAL</th><th>ENVÍO</th><th>TOTAL VENDIDO</th></tr></thead><tbody id="salesTableBody"><tr><td colspan="5" class="sales-loading">Cargando ventas…</td></tr></tbody><tfoot id="salesTableFoot"></tfoot></table></div>
      <div class="sales-manager-total" id="salesManagerTotal"></div>
    </section></div></main>`;

  const loadSales = async () => {
    const from = document.querySelector('#salesDateFrom')?.value || '';
    const to = document.querySelector('#salesDateTo')?.value || '';
    const status = document.querySelector('#salesStatusFilter')?.value || 'all';
    const body = document.querySelector('#salesTableBody');
    const foot = document.querySelector('#salesTableFoot');
    const summary = document.querySelector('#salesSummary');
    const manager = document.querySelector('#salesManagerTotal');
    if (!body) return;
    if (from && to && from > to) {
      body.innerHTML = '<tr><td colspan="5" class="sales-empty">La fecha inicial no puede ser posterior a la fecha final.</td></tr>';
      if (foot) foot.innerHTML = '';
      if (summary) summary.innerHTML = '';
      if (manager) manager.innerHTML = '';
      return;
    }
    body.innerHTML = '<tr><td colspan="5" class="sales-loading">Actualizando ventas…</td></tr>';
    try {
      const result = await request(`/api/admin/ventas-generales?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&status=${encodeURIComponent(status)}`);
      const rows = Array.isArray(result.rows) ? result.rows : [];
      const totals = result.totals || {};
      const activeLabel = status === 'all' ? 'Todas las ventas notificadas' : `Estado: ${status}`;
      if (summary) summary.innerHTML = `<div><span>PERÍODO</span><strong>${escapeHTML(from || 'Todo')} → ${escapeHTML(to || 'Todo')}</strong></div><div><span>ESTADO</span><strong>${escapeHTML(activeLabel)}</strong></div><div><span>PEDIDOS</span><strong>${Number(totals.orderCount || 0)}</strong></div><div><span>TOTAL VENDIDO</span><strong>${moneyCell(totals.total)}</strong></div>`;
      body.innerHTML = rows.length ? rows.map(row => `<tr class="${row.sellerId ? '' : 'sales-unassigned-row'}"><td><div class="sales-seller"><strong>${escapeHTML(row.sellerName || 'Sin vendedor')}</strong>${row.username ? `<small>@${escapeHTML(row.username)}${row.active === false ? ' · inactivo' : ''}</small>` : '<small>Pedido sin vendedor asignado</small>'}</div></td><td>${Number(row.orderCount || 0)}</td><td>${moneyCell(row.subtotal)}</td><td>${moneyCell(row.shipping)}</td><td><strong>${moneyCell(row.total)}</strong></td></tr>`).join('') : '<tr><td colspan="5" class="sales-empty">No hay ventas para el período y estado seleccionados.</td></tr>';
      if (foot) foot.innerHTML = `<tr><th>Jefe de Tienda</th><th>${Number(totals.orderCount || 0)}</th><th>${moneyCell(totals.subtotal)}</th><th>${moneyCell(totals.shipping)}</th><th>${moneyCell(totals.total)}</th></tr>`;
      if (manager) manager.innerHTML = `<div><span>Jefe de Tienda</span><strong>${moneyCell(totals.total)}</strong><small>Total consolidado de las ventas mostradas.</small></div>`;
    } catch (error) {
      body.innerHTML = `<tr><td colspan="5" class="sales-empty">${escapeHTML(error.message || 'No se pudieron cargar las ventas.')}</td></tr>`;
      if (foot) foot.innerHTML = '';
      if (summary) summary.innerHTML = '';
      if (manager) manager.innerHTML = '';
    }
  };
  document.querySelector('#salesRefresh')?.addEventListener('click', loadSales);
  document.querySelector('#salesDateFrom')?.addEventListener('change', loadSales);
  document.querySelector('#salesDateTo')?.addEventListener('change', loadSales);
  document.querySelector('#salesStatusFilter')?.addEventListener('change', loadSales);
  wireAccountMenu();
  await loadSales();
}

async function renderAdminOrders() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated: false }));
  if (!session.authenticated) return renderLogin();
  let orders = await request('/api/admin/orders').catch(() => []);
  let orderProducts = await request('/api/admin/order-products').catch(() => []);
  const moneyOverview = await request('/api/admin/dinero/resumen?from=&to=&showPaid=true').catch(() => ({ receivables: [] }));
  let paymentByOrder = new Map((Array.isArray(moneyOverview.receivables) ? moneyOverview.receivables : []).filter(row => row.orderId).map(row => [String(row.orderId), row]));
  const canAssign = session.role === 'store_manager' || session.role === 'admin';
  const canDelete = session.role === 'store_manager' || session.role === 'admin';
  let sellers = [];
  if (canAssign) sellers = await request('/api/admin/order-sellers').catch(() => []);

  const sectionNav = adminSectionNav(session, 'pedidos');
  const title = session.role === 'vendedor' ? 'Mis pedidos asignados' : 'Gestión de pedidos';
  const subtitle = session.role === 'store_manager' ? 'Jefe de tienda · pedidos, asignaciones y control operativo' : (session.role === 'vendedor' ? 'Pedidos asignados a tu usuario · consulta y gestión operativa' : 'Gestión de YHORS STORE');
  app.innerHTML = `<main class="admin-shell"><div class="admin-wrap"><div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route aria-label="YHORS · Panel Administrativo · Ir a YHORS Inteligente"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></a><h1 class="admin-title">${title}</h1><p class="admin-subtitle">${subtitle}</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>${sectionNav}${ordersPanel(orders, canDelete)}</div></main>`;

  const editingOrders = new Set();
  const productEditorsOpen = new Set();
  const draftItems = new Map();
  const cloneOrderItems = items => (Array.isArray(items) ? items : []).map(item => ({
    productId: item.productId,
    name: item.name,
    sku: item.sku,
    purchaseMode: item.purchaseMode === 'rental' ? 'rental' : 'purchase',
    quantity: Math.max(1, Number(item.quantity || 1)),
    rentalDays: Math.max(1, Number(item.rentalDays || 1)),
    unitPrice: Number(item.unitPrice || 0),
    subtotal: Number(item.subtotal || 0),
    deviceIdentifiers: Array.isArray(item.deviceIdentifiers)
      ? item.deviceIdentifiers.map(entry => ({
          unit: Number(entry.unit || 1),
          type: entry.type === 'imei' ? 'imei' : 'serial',
          primary: String(entry.primary || ''),
          secondary: entry.secondary ? String(entry.secondary) : null
        }))
      : []
  }));
  const getDraft = order => {
    if (!draftItems.has(order.id)) draftItems.set(order.id, cloneOrderItems(order.items));
    return draftItems.get(order.id);
  };
  const productById = id => orderProducts.find(p => String(p.id) === String(id));
  const isEditorTechProduct = product => String(product?.category || '').toLowerCase() === 'tech';
  const isEditorImeiProduct = product => {
    const type = String(product?.productType || '').toLowerCase();
    const name = String(product?.name || '').toLowerCase();
    return type.includes('celular') || type.includes('smartphone') || type.includes('mobile') || /\biphone\b|\bandroid\b|\btelefono\b|\bteléfono\b/.test(name);
  };
  const ensureDraftIdentifiers = items => {
    (items || []).forEach(item => {
      const product = productById(item.productId) || item;
      const needs = item.purchaseMode !== 'rental' && isEditorTechProduct(product) && product.requiresDeviceIdentifier !== false;
      if (!needs) return;
      const qty = Math.max(1, Number(item.quantity || 1));
      const existing = Array.isArray(item.deviceIdentifiers) ? item.deviceIdentifiers : [];
      const next = [];
      for (let unit = 1; unit <= qty; unit += 1) {
        const current = existing.find(entry => Number(entry.unit) === unit) || {};
        if (isEditorImeiProduct(product)) {
          if (current.primary || current.secondary) next.push({ unit, type:'imei', primary:String(current.primary || ''), secondary:current.secondary ? String(current.secondary) : null });
        } else {
          next.push({ unit, type:'serial', primary:String(current.primary || (unit === 1 ? 'SN' : `SN-${unit}`)), secondary:null });
        }
      }
      item.deviceIdentifiers = next;
    });
    return items;
  };
  const orderEditorMarkup = (order, items) => {
    const rows = items.length ? items.map((item, index) => {
      const product = productById(item.productId) || item;
      const rental = item.purchaseMode === 'rental';
      const unit = Number(rental ? (product?.rentalPrice ?? item.unitPrice ?? 0) : (product?.salePrice ?? product?.price ?? item.unitPrice ?? 0));
      const days = Math.max(1, Number(item.rentalDays || 1));
      const total = unit * Number(item.quantity || 1) * (rental ? days : 1);
      const needsIdentifier = !rental && isEditorTechProduct(product) && product.requiresDeviceIdentifier !== false;
      const imei = needsIdentifier && isEditorImeiProduct(product);
      const identifiers = needsIdentifier ? (Array.isArray(item.deviceIdentifiers) ? item.deviceIdentifiers : []) : [];
      const identifierRows = needsIdentifier ? Array.from({length:Number(item.quantity || 1)}, (_,unitIndex) => {
        const unit = unitIndex + 1;
        const current = identifiers.find(entry => Number(entry.unit) === unit) || {};
        const primary = current.primary || (imei ? '' : (unit === 1 ? 'SN' : `SN-${unit}`));
        return `<div class="device-id-row order-edit-device-row">
          <span class="device-id-unit">Unidad ${unit}</span>
          <input class="device-id-input" data-order-device-primary="${index}" data-unit="${unit}" value="${escapeHTML(primary)}" maxlength="${imei ? 16 : 50}" placeholder="${imei ? 'IMEI 1' : 'Número de serie'}" inputmode="${imei ? 'numeric' : 'text'}">
          ${imei ? `<input class="device-id-input" data-order-device-secondary="${index}" data-unit="${unit}" value="${escapeHTML(current.secondary || '')}" maxlength="16" placeholder="IMEI 2 (opcional)" inputmode="numeric">` : '<span class="device-id-placeholder">Se puede reemplazar después</span>'}
        </div>`;
      }).join('') : '';
      return `<div class="generate-product-row order-edit-product-row${needsIdentifier ? ' has-device-identifiers' : ''}" data-order-draft-index="${index}">
        <div class="generate-product-info"><img src="${escapeHTML(productImages(product || item)[0])}" data-fallback alt=""><div><strong>${escapeHTML(product?.name || item.name || 'Producto')}</strong><small>SKU: ${escapeHTML(product?.sku || item.sku || '—')} · ${rental ? `Alquiler · ${days} día${days===1?'':'s'}` : 'Compra'}</small></div></div>
        <div class="generate-qty"><button type="button" data-order-draft-qty="${index}" data-change="-1">−</button><strong>${escapeHTML(item.quantity)}</strong><button type="button" data-order-draft-qty="${index}" data-change="1">+</button>${rental ? `<select class="generate-rental-days" data-order-draft-days="${index}" aria-label="Días de alquiler">${Array.from({length:10},(_,i)=>i+1).map(day=>`<option value="${day}" ${day===days?'selected':''}>${day} día${day===1?'':'s'}</option>`).join('')}</select>` : ''}</div>
        <strong class="generate-unit-price">${money(unit)}${rental ? ' / día' : ''}</strong>
        <strong class="generate-line-total">${money(total)}</strong>
        <button type="button" class="order-edit-remove" data-order-draft-remove="${index}" aria-label="Quitar producto">Quitar</button>
        ${needsIdentifier ? `<div class="device-identifiers-panel order-edit-identifiers-panel"><div class="device-identifiers-head"><div><strong>${imei ? 'IMEI del equipo' : 'Serie del equipo'}</strong><small>${imei ? 'Ingresa el IMEI 1 y, si aplica, el IMEI 2. Si aún no lo tienes, podrás completarlo luego.' : 'Se coloca SN como serie temporal. Puedes reemplazarla después.'}</small></div><span>${imei ? 'CONTROL IMEI' : 'CONTROL DE SERIE'}</span></div><div class="device-identifiers-list">${identifierRows}</div></div>` : ''}
      </div>`;
    }).join('') : `<div class="generate-empty-state"><span>+</span><strong>Aún no hay productos</strong><small>Agrega productos desde el catálogo.</small></div>`;
    return `<section class="generate-card generate-products-card order-edit-products-card"><div class="generate-card-head"><div><span class="generate-card-kicker">03 · Productos</span><h3>Detalle de la orden</h3></div><button type="button" class="button primary small" data-order-open-picker="${escapeHTML(order.id)}">+ Agregar productos</button></div><div class="generate-products-table-head"><span>Producto</span><span>Cant.</span><span>Precio</span><span>Total</span><span></span></div><div class="order-edit-lines">${rows}</div><div class="order-edit-products-note">Los cambios quedan pendientes hasta pulsar <strong>Guardar cambios</strong>.</div></section>`;
  };
  const drawOrders = () => {
    const list=document.querySelector('#adminOrdersList'); if(!list) return;
    const query=(document.querySelector('#ordersSearch')?.value||'').trim().toLowerCase();
    const status=document.querySelector('#ordersStatusFilter')?.value||'';
    const dateFrom=(document.querySelector('#ordersDateFrom')?.value||'');
    const dateTo=(document.querySelector('#ordersDateTo')?.value||'');
    const orderLocalDate = value => { const d=new Date(value); if(Number.isNaN(d.getTime())) return ''; return d.toLocaleDateString('en-CA',{timeZone:'America/Guayaquil'}); };
    const filtered=orders.filter(order=>{
      const orderDate=orderLocalDate(order.createdAt);
      const inRange=(!dateFrom||orderDate>=dateFrom)&&(!dateTo||orderDate<=dateTo);
      return inRange&&(!status||order.status===status)&&(!query||`${order.orderNumber} ${order.customer?.name||''} ${order.customer?.cedula||''} ${order.customer?.phone||''} ${order.customer?.email||''} ${(order.items||[]).map(i=>`${i.sku} ${i.name}`).join(' ')}`.toLowerCase().includes(query));
    });
    list.innerHTML=ordersListMarkup(filtered, { canDelete, canAssign, sellers, role: session.role, products: orderProducts, paymentByOrder });

    let updateOrderAssignmentDisplay = () => {};
    // Selector elegante de vendedor para "Pedidos → Asignado a".
    // Reutiliza el mismo lenguaje visual del selector de "Nueva orden" y "Multas".
    if (canAssign) {
      const previousOrderSellerModal = document.querySelector('#orderSellerPickerModal');
      if (previousOrderSellerModal) {
        previousOrderSellerModal.remove();
        document.body.classList.remove('generate-modal-open');
      }
      const orderSellerModal = document.createElement('div');
      orderSellerModal.className = 'generate-modal fine-person-modal';
      orderSellerModal.id = 'orderSellerPickerModal';
      orderSellerModal.hidden = true;
      orderSellerModal.innerHTML = `<div class="generate-modal-backdrop" data-close-order-seller-picker></div>
        <div class="generate-modal-dialog fine-person-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="orderSellerPickerTitle">
          <div class="generate-modal-head">
            <div><span class="eyebrow">Pedidos · Responsable</span><h2 id="orderSellerPickerTitle">Seleccionar vendedor</h2><p class="fine-person-picker-subtitle">Busca al vendedor que quedará responsable de este pedido.</p></div>
            <button type="button" class="generate-modal-close" data-close-order-seller-picker aria-label="Cerrar">×</button>
          </div>
          <div class="fine-person-picker-toolbar"><input id="orderSellerSearch" type="search" placeholder="Buscar por nombre o usuario…" autocomplete="off"></div>
          <div class="fine-person-picker-count" id="orderSellerPickerCount"></div>
          <div class="fine-person-picker-list" id="orderSellerPickerList"></div>
        </div>`;
      document.body.appendChild(orderSellerModal);

      let activeOrderSellerId = null;
      const orderSellerSearch = orderSellerModal.querySelector('#orderSellerSearch');
      const orderSellerList = orderSellerModal.querySelector('#orderSellerPickerList');
      const orderSellerCount = orderSellerModal.querySelector('#orderSellerPickerCount');
      const orderSellerInitials = name => (String(name || 'V').trim().split(/\\s+/).slice(0,2).map(part => part[0]).join('') || 'V').toUpperCase();
      const getOrderSellerOptions = id => {
        const select = list.querySelector(`[data-order-assignment="${CSS.escape(String(id))}"]`);
        const optionIds = Array.from(select?.options || []).map(option => option.value);
        const result = optionIds.map(optionId => sellers.find(s => String(s.id) === String(optionId))).filter(Boolean);
        const selectedOrder = orders.find(o => String(o.id) === String(id));
        if (selectedOrder?.assignedSellerId && !result.some(s => String(s.id) === String(selectedOrder.assignedSellerId))) {
          result.unshift({ id: selectedOrder.assignedSellerId, name: selectedOrder.assignedSellerName || 'Vendedor asignado', username: 'asignado' });
        }
        return result;
      };
      const renderOrderSellerPicker = () => {
        if (!orderSellerList || !activeOrderSellerId) return;
        const query = (orderSellerSearch?.value || '').trim().toLowerCase();
        const options = getOrderSellerOptions(activeOrderSellerId);
        const select = list.querySelector(`[data-order-assignment="${CSS.escape(String(activeOrderSellerId))}"]`);
        const currentValue = select?.value || '';
        const filteredSellers = options.filter(s => `${s.name || ''} ${s.username || ''}`.toLowerCase().includes(query));
        const totalCount = options.length;
        if (orderSellerCount) orderSellerCount.textContent = `${filteredSellers.length} de ${totalCount} vendedor${totalCount === 1 ? '' : 'es'} disponible${totalCount === 1 ? '' : 's'}`;
        orderSellerList.innerHTML = `<button type="button" class="fine-person-option${!currentValue ? ' is-selected' : ''}" data-order-select-seller="">
            <span class="fine-person-option-avatar">—</span><span class="fine-person-option-copy"><strong>Sin asignar</strong><small>Este pedido quedará pendiente de asignación</small></span><span class="fine-person-option-check">${!currentValue ? '✓' : '›'}</span>
          </button>${filteredSellers.length ? filteredSellers.map(s => {
            const selected = String(currentValue) === String(s.id);
            return `<button type="button" class="fine-person-option${selected ? ' is-selected' : ''}" data-order-select-seller="${escapeHTML(s.id)}"><span class="fine-person-option-avatar">${escapeHTML(orderSellerInitials(s.name || s.username))}</span><span class="fine-person-option-copy"><strong>${escapeHTML(s.name || s.username || 'Vendedor')}</strong><small>@${escapeHTML(s.username || 'usuario')} · Vendedor</small></span><span class="fine-person-option-check">${selected ? '✓' : '›'}</span></button>`;
          }).join('') : `<div class="fine-person-empty"><span>⌕</span><strong>No encontramos a ese vendedor</strong><small>Prueba con otro nombre o usuario.</small></div>`}`;
      };
      updateOrderAssignmentDisplay = id => {
        const select = list.querySelector(`[data-order-assignment="${CSS.escape(String(id))}"]`);
        const trigger = list.querySelector(`[data-order-assignment-picker="${CSS.escape(String(id))}"]`);
        if (!select || !trigger) return;
        const option = select.options[select.selectedIndex];
        const label = (option?.textContent || '').trim();
        const seller = sellers.find(s => String(s.id) === String(select.value));
        const name = seller?.name || (select.value ? label.split(' · @')[0] : 'Sin asignar');
        const username = seller?.username ? `@${seller.username}` : (select.value ? (label.split(' · @')[1] ? `@${label.split(' · @')[1]}` : 'Vendedor asignado') : 'Puedes seleccionar un vendedor');
        const avatar = trigger.querySelector('.fine-person-picker-avatar');
        const strong = trigger.querySelector('.fine-person-picker-copy strong');
        const small = trigger.querySelector('.fine-person-picker-copy small');
        if (avatar) avatar.textContent = select.value ? orderSellerInitials(name) : '?';
        if (strong) strong.textContent = name;
        if (small) small.textContent = username;
      };

      const openOrderSellerPicker = id => {
        const trigger = list.querySelector(`[data-order-assignment-picker="${CSS.escape(String(id))}"]`);
        if (!trigger || trigger.disabled) return;
        activeOrderSellerId = id;
        if (orderSellerSearch) orderSellerSearch.value = '';
        orderSellerModal.hidden = false;
        document.body.classList.add('generate-modal-open');
        requestAnimationFrame(() => { orderSellerModal.classList.add('is-open'); orderSellerSearch?.focus(); });
        renderOrderSellerPicker();
      };
      const closeOrderSellerPicker = () => {
        orderSellerModal.classList.remove('is-open');
        setTimeout(() => {
          orderSellerModal.hidden = true;
          if (!document.querySelector('.generate-modal.is-open')) document.body.classList.remove('generate-modal-open');
        }, 180);
        activeOrderSellerId = null;
      };
      list.querySelectorAll('[data-order-assignment-picker]').forEach(button => button.addEventListener('click', () => openOrderSellerPicker(button.dataset.orderAssignmentPicker)));
      orderSellerSearch?.addEventListener('input', renderOrderSellerPicker);
      orderSellerModal.querySelectorAll('[data-close-order-seller-picker]').forEach(el => el.addEventListener('click', closeOrderSellerPicker));
      orderSellerModal.addEventListener('click', event => {
        const option = event.target.closest('[data-order-select-seller]');
        if (!option || !activeOrderSellerId) return;
        const select = list.querySelector(`[data-order-assignment="${CSS.escape(String(activeOrderSellerId))}"]`);
        if (!select) return;
        select.value = option.dataset.orderSelectSeller || '';
        select.dataset.changed = 'true';
        updateOrderAssignmentDisplay(activeOrderSellerId);
        closeOrderSellerPicker();
      });
      orderSellerModal.addEventListener('keydown', event => { if (event.key === 'Escape' && orderSellerModal.classList.contains('is-open')) closeOrderSellerPicker(); });
      list.querySelectorAll('[data-order-assignment-picker]').forEach(button => updateOrderAssignmentDisplay(button.dataset.orderAssignmentPicker));
    }

    // Los campos del pedido permanecen bloqueados hasta pulsar "Editar pedido".
    // Los cambios de estado se guardan junto con nota y asignación.
    list.querySelectorAll('[data-order-toggle]').forEach(button=>button.addEventListener('click',()=>{ const details=document.querySelector(`#orderDetails-${button.dataset.orderToggle}`); if(!details) return; const opening=details.hidden; details.hidden=!opening; button.setAttribute('aria-expanded',String(opening)); button.closest('.admin-order')?.classList.toggle('is-open',opening); }));
    const syncOrderEditor = id => {
      const order = orders.find(o => o.id === id);
      const editor = list.querySelector(`[data-order-items-editor="${id}"]`);
      if (!order || !editor) return;
      const draft = getDraft(order);
      ensureDraftIdentifiers(draft);
      editor.innerHTML = orderEditorMarkup(order, draft);
      editor.hidden = false;
      wireImageFallback(editor);
    };

    const closeOrderEditor = id => {
      const editor = list.querySelector(`[data-order-items-editor="${id}"]`);
      if (editor) { editor.hidden = true; editor.innerHTML = ''; }
      productEditorsOpen.delete(id);
    };

    const openOrderProductPicker = id => {
      const order = orders.find(o => o.id === id);
      if (!order) return;
      const existing = document.querySelector('#orderProductPickerModal');
      if (existing) existing.remove();
      const modal = document.createElement('div');
      modal.className = 'generate-modal';
      modal.id = 'orderProductPickerModal';
      modal.innerHTML = `<div class="generate-modal-backdrop" data-order-picker-close></div><div class="generate-modal-dialog generate-product-picker" role="dialog" aria-modal="true" aria-labelledby="orderProductPickerTitle"><div class="generate-modal-head"><div><span class="eyebrow">Catálogo YHORS</span><h2 id="orderProductPickerTitle">Agregar productos</h2></div><button type="button" class="generate-modal-close" data-order-picker-close>×</button></div><div class="generate-picker-toolbar"><input id="orderProductSearch" type="search" placeholder="Buscar por nombre, SKU, marca…"><select id="orderProductCategory"><option value="">Todas las categorías</option><option value="elegant">Elegante</option><option value="sports">Deportes</option><option value="tech">Tech</option><option value="cosplay">Cosplay</option><option value="pets">Mascotas</option><option value="details">Details</option><option value="collectibles">Coleccionables</option></select></div><div class="generate-picker-list" id="orderPickerList"></div><div class="generate-modal-actions"><span class="generate-picker-hint">Puedes agregar varios productos y cantidades antes de cerrar.</span><button type="button" class="button primary" data-order-picker-close>Listo</button></div></div>`;
      document.body.appendChild(modal);
      const close = () => { modal.classList.remove('is-open'); document.body.classList.remove('generate-modal-open'); setTimeout(()=>modal.remove(),180); };
      modal.querySelectorAll('[data-order-picker-close]').forEach(el=>el.addEventListener('click',close));
      const drawPicker = () => {
        const query=(modal.querySelector('#orderProductSearch')?.value||'').trim().toLowerCase();
        const category=modal.querySelector('#orderProductCategory')?.value||'';
        const filtered=orderProducts.filter(product=>{ const hay=`${product.name||''} ${product.sku||''} ${product.brand||''} ${product.productType||''}`.toLowerCase(); return (!query||hay.includes(query))&&(!category||product.category===category); });
        const target=modal.querySelector('#orderPickerList');
        target.innerHTML=filtered.length ? filtered.map(product=>{ const stock=Number(product.stock||0); const rental=product.category==='cosplay' && product.isRental===true && product.rentalPrice!==null && product.rentalPrice!==undefined && product.rentalPrice!==''; return `<article class="generate-picker-product"><img src="${escapeHTML(productImages(product)[0])}" data-fallback alt=""><div class="generate-picker-info"><strong>${escapeHTML(product.name)}</strong><small>SKU: ${escapeHTML(product.sku||'—')} · ${escapeHTML(categories[product.category]||product.category||'Producto')}</small><b>${money(product.salePrice??product.price??0)} · Stock ${stock}</b></div><div class="generate-picker-actions"><button type="button" class="button primary small" data-order-add-product="${escapeHTML(product.id)}" data-mode="purchase">Agregar</button>${rental?`<button type="button" class="button secondary small" data-order-add-product="${escapeHTML(product.id)}" data-mode="rental">Alquiler</button>`:''}</div></article>`; }).join('') : '<div class="generate-empty-state"><span>⌕</span><strong>No encontramos productos</strong><small>Prueba con otro nombre, SKU o categoría.</small></div>';
        wireImageFallback(target);
        target.querySelectorAll('[data-order-add-product]').forEach(btn=>btn.addEventListener('click',()=>{
          const product=orderProducts.find(p=>String(p.id)===String(btn.dataset.orderAddProduct)); if(!product) return;
          const items=getDraft(order); const mode=btn.dataset.mode==='rental'?'rental':'purchase';
          const found=items.find(item=>String(item.productId)===String(product.id)&&item.purchaseMode===mode);
          if(found) found.quantity=Math.min(99,Number(found.quantity||1)+1);
          else items.push({productId:product.id,name:product.name,sku:product.sku,purchaseMode:mode,quantity:1,rentalDays:mode==='rental'?1:1,unitPrice:Number(mode==='rental'?(product.rentalPrice??0):(product.salePrice??product.price??0)),subtotal:0});
          syncOrderEditor(id);
        }));
      };
      modal.querySelector('#orderProductSearch').addEventListener('input',drawPicker); modal.querySelector('#orderProductCategory').addEventListener('change',drawPicker);
      drawPicker(); requestAnimationFrame(()=>modal.classList.add('is-open')); document.body.classList.add('generate-modal-open');
    };

    list.querySelectorAll('[data-order-items-edit]').forEach(button => button.addEventListener('click', () => {
      if (button.disabled) return;
      const id=button.dataset.orderItemsEdit; const order=orders.find(o=>o.id===id); if(!order) return;
      getDraft(order); productEditorsOpen.add(id); syncOrderEditor(id); button.hidden=true;
    }));

    // Estos listeners se delegan una sola vez sobre la lista. drawOrders()
    // puede ejecutarse muchas veces (filtros, fechas, guardados, etc.); si
    // volviéramos a registrarlos en cada redibujado, un click en "Quitar"
    // dispararía varios manejadores y mostraría el mismo aviso repetido.
    if (!list.dataset.orderEditorEventsBound) {
      list.addEventListener('click', event => {
        const open=event.target.closest('[data-order-open-picker]');
        if(open){ openOrderProductPicker(open.dataset.orderOpenPicker); return; }
        const qty=event.target.closest('[data-order-draft-qty]');
        if(qty){ const id=qty.closest('[data-order-items-editor]')?.dataset.orderItemsEditor; const order=orders.find(o=>o.id===id); if(!order)return; const items=getDraft(order); const i=Number(qty.dataset.orderDraftQty); if(!items[i])return; items[i].quantity=Math.max(1,Math.min(99,Number(items[i].quantity||1)+Number(qty.dataset.change||0))); ensureDraftIdentifiers(items); syncOrderEditor(id); return; }
        const rem=event.target.closest('[data-order-draft-remove]');
        if(rem){ const id=rem.closest('[data-order-items-editor]')?.dataset.orderItemsEditor; const order=orders.find(o=>o.id===id); if(!order)return; const items=getDraft(order); const i=Number(rem.dataset.orderDraftRemove); if(items.length<=1){alert('Un pedido debe conservar al menos un producto.');return;} items.splice(i,1); syncOrderEditor(id); return; }
        // Los días de alquiler se manejan en `change`, no en `click`.
        // Si se redibuja el editor durante el click de un <select>, el navegador
        // cierra inmediatamente el menú y obliga a mantener el mouse pulsado.
      });

      // Cambiar los días no debe reconstruir todo el editor: así el <select>
      // conserva su comportamiento nativo y el menú permanece abierto normalmente.
      list.addEventListener('input', event => {
        const primary = event.target.closest('[data-order-device-primary]');
        const secondary = event.target.closest('[data-order-device-secondary]');
        if (!primary && !secondary) return;
        const input = primary || secondary;
        const editor = input.closest('[data-order-items-editor]');
        if (!editor) return;
        const id = editor.dataset.orderItemsEditor;
        const order = orders.find(o => o.id === id);
        if (!order) return;
        const items = getDraft(order);
        const index = Number(input.dataset.orderDevicePrimary ?? input.dataset.orderDeviceSecondary);
        const unit = Number(input.dataset.unit || 1);
        const item = items[index];
        if (!item) return;
        const product = productById(item.productId) || item;
        if (!Array.isArray(item.deviceIdentifiers)) item.deviceIdentifiers = [];
        let entry = item.deviceIdentifiers.find(row => Number(row.unit) === unit);
        if (!entry) {
          entry = { unit, type: isEditorImeiProduct(product) ? 'imei' : 'serial', primary:'', secondary:null };
          item.deviceIdentifiers.push(entry);
        }
        if (primary) entry.primary = input.value.trim();
        if (secondary) entry.secondary = input.value.trim() || null;
      });
      list.addEventListener('change', event => {
      const select = event.target.closest('[data-order-draft-days]');
      if (!select) return;
      const editor = select.closest('[data-order-items-editor]');
      if (!editor) return;
      const id = editor.dataset.orderItemsEditor;
      const order = orders.find(o => o.id === id);
      if (!order) return;
      const items = getDraft(order);
      const index = Number(select.dataset.orderDraftDays);
      const item = items[index];
      if (!item) return;
      item.rentalDays = Math.max(1, Math.min(10, Number(select.value) || 1));

      const product = productById(item.productId) || item;
      const unit = Number(product?.rentalPrice ?? item.unitPrice ?? 0);
      const quantity = Math.max(1, Number(item.quantity || 1));
      const total = unit * quantity * item.rentalDays;
      const row = select.closest('.order-edit-product-row');
        if (row) {
          const info = row.querySelector('.generate-product-info small');
          const totalEl = row.querySelector('.generate-line-total');
          const unitEl = row.querySelector('.generate-unit-price');
          if (info) info.textContent = `SKU: ${product?.sku || item.sku || '—'} · Alquiler · ${item.rentalDays} día${item.rentalDays === 1 ? '' : 's'}`;
          if (unitEl) unitEl.textContent = `${money(unit)} / día`;
          if (totalEl) totalEl.textContent = money(total);
        }
      });
      list.dataset.orderEditorEventsBound = 'true';
    }

    list.querySelectorAll('[data-order-items-cancel]').forEach(button=>button.addEventListener('click',()=>{}));
    list.querySelectorAll('[data-order-note-edit]').forEach(button => button.addEventListener('click', () => {
      const id = button.dataset.orderNoteEdit;
      const textarea = list.querySelector(`[data-order-note="${id}"]`);
      const saveButton = list.querySelector(`[data-order-note-save="${id}"]`);
      const statusSelect = list.querySelector(`[data-order-status="${id}"]`);
      const assignment = list.querySelector(`[data-order-assignment="${id}"]`);
      if (!textarea || !saveButton) return;
      const order = orders.find(o => o.id === id);
      if (order) { editingOrders.add(id); draftItems.set(id, cloneOrderItems(order.items)); }
      textarea.disabled = false;
      if (statusSelect) statusSelect.disabled = false;
      if (assignment) assignment.disabled = false;
      const assignmentPicker = list.querySelector(`[data-order-assignment-picker="${id}"]`);
      if (assignmentPicker) assignmentPicker.disabled = false;
      const productsButton = list.querySelector(`[data-order-items-edit="${id}"]`);
      if (productsButton) { productsButton.disabled = false; productsButton.hidden = false; }
      textarea.focus();
      button.disabled = true;
      button.textContent = 'Editando…';
      const cancelButton = list.querySelector(`[data-order-edit-cancel="${id}"]`);
      if (cancelButton) cancelButton.hidden = false;
      saveButton.dataset.editing = 'true';
      saveButton.disabled = false;
    }));

    // Cancelar edición descarta TODO el borrador local y devuelve el pedido
    // exactamente al estado que tenía antes de pulsar "Editar pedido".
    list.querySelectorAll('[data-order-edit-cancel]').forEach(button => button.addEventListener('click', () => {
      const id = button.dataset.orderEditCancel;
      const order = orders.find(o => o.id === id);
      if (!order) return;
      const textarea = list.querySelector(`[data-order-note="${id}"]`);
      const statusSelect = list.querySelector(`[data-order-status="${id}"]`);
      const assignment = list.querySelector(`[data-order-assignment="${id}"]`);
      const saveButton = list.querySelector(`[data-order-note-save="${id}"]`);
      const editButton = list.querySelector(`[data-order-note-edit="${id}"]`);
      const productsButton = list.querySelector(`[data-order-items-edit="${id}"]`);

      if (textarea) { textarea.value = order.internalNote || ''; textarea.disabled = true; }
      if (statusSelect) { statusSelect.value = order.status || 'Pendiente'; statusSelect.disabled = true; statusSelect.className = `status-select-${statusClass(order.status || 'Pendiente')}`; }
      if (assignment) { assignment.value = order.assignedSellerId || ''; assignment.disabled = true; assignment.dataset.changed = 'false'; }
      const assignmentPicker = list.querySelector(`[data-order-assignment-picker="${id}"]`);
      if (assignmentPicker) { assignmentPicker.disabled = true; updateOrderAssignmentDisplay(id); }

      closeOrderEditor(id);
      editingOrders.delete(id);
      draftItems.delete(id);
      productEditorsOpen.delete(id);
      if (productsButton) { productsButton.disabled = true; productsButton.hidden = false; }
      if (editButton) { editButton.disabled = false; editButton.textContent = 'Editar pedido'; }
      button.hidden = true;
      if (saveButton) { delete saveButton.dataset.editing; saveButton.disabled = true; saveButton.textContent = 'Guardar cambios'; }
    }));

    const refreshOrderItemsView = order => {
      const view = list.querySelector(`[data-order-items-view="${order.id}"]`);
      if (view) {
        view.innerHTML = (order.items || []).map(item => {
          const isRental = item.purchaseMode === 'rental';
          const days = Number(item.rentalDays || 1);
          return `<div class="admin-order-item"><span><strong>${escapeHTML(item.quantity)}×</strong> ${escapeHTML(item.name)} <small>SKU: ${escapeHTML(item.sku || '—')} · ${isRental ? `Alquiler · ${days} día${days === 1 ? '' : 's'} · ${money(item.unitPrice)}/día` : 'Compra'}</small></span><strong>${money(item.subtotal)}</strong></div>`;
        }).join('');
      }

      // Mantener sincronizado el total visible del pedido sin recargar la página.
      const card = list.querySelector(`[data-order-id="${CSS.escape(String(order.id))}"]`) || list.querySelector(`.admin-order[data-order-id="${CSS.escape(String(order.id))}"]`);
      const target = card || list.querySelector(`[data-order-items-view="${order.id}"]`)?.closest('.admin-order');
      if (target) {
        const summaryTotal = target.querySelector('.order-summary-total');
        if (summaryTotal) summaryTotal.textContent = money(order.total);
        const detailTotal = target.querySelector('.order-total');
        if (detailTotal) detailTotal.textContent = money(order.total);
        const detailSmall = target.querySelector('.admin-order-grid .order-total')?.parentElement?.querySelector('small');
        if (detailSmall) detailSmall.textContent = `Subtotal ${money(order.subtotal ?? order.total)} · Envío ${money(order.shippingCost ?? 0)}`;
        const firstSummaryItem = target.querySelector('.order-summary-item');
        if (firstSummaryItem) {
          const first = order.items?.[0];
          firstSummaryItem.textContent = first ? `${first.quantity || 1}× ${first.name || 'Sin productos'}${(order.items?.length || 0) > 1 ? ` · +${order.items.length - 1} más` : ''}` : 'Sin productos';
        }
      }
    };

    const refreshOrderPaymentView = async (orderId, orderCard, orderTotal) => {
      try {
        const overview = await request('/api/admin/dinero/resumen?from=&to=&showPaid=true');
        const row = (Array.isArray(overview?.receivables) ? overview.receivables : []).find(item => String(item.orderId || '') === String(orderId));
        const totalDue = Number(orderTotal || 0);
        const paid = Number(row?.paid || 0);
        const balance = Math.max(0, Number(row?.balance ?? Math.max(0, totalDue - paid)));
        const state = balance <= 0.001 ? 'paid' : paid > 0 ? 'partial' : 'pending';
        const label = state === 'paid' ? 'PAGADO 100%' : state === 'partial' ? 'ABONO · SALDO PENDIENTE' : 'PENDIENTE DE PAGO';
        const card = orderCard || list.querySelector(`[data-order-id="${CSS.escape(String(orderId))}"]`);
        const paymentCard = card?.querySelector('.order-payment-card');
        if (!paymentCard) return;
        paymentCard.className = `order-payment-card ${state}`;
        const mainStrong = paymentCard.querySelector('.order-payment-main strong');
        const badge = paymentCard.querySelector('.order-payment-badge');
        const numberBlocks = paymentCard.querySelectorAll('.order-payment-numbers > div');
        const balanceStrong = paymentCard.querySelector('.order-payment-balance strong');
        const footerText = paymentCard.querySelector('.order-payment-footer small');
        if (mainStrong) mainStrong.textContent = label;
        if (badge) badge.textContent = state === 'paid' ? '✓' : state === 'partial' ? '!' : '$';
        if (numberBlocks[0]?.querySelector('strong')) numberBlocks[0].querySelector('strong').textContent = money(totalDue);
        if (numberBlocks[1]?.querySelector('strong')) numberBlocks[1].querySelector('strong').textContent = money(paid);
        if (balanceStrong) balanceStrong.textContent = money(balance);
        if (footerText) footerText.textContent = balance > 0.001 ? 'No se debe entregar hasta completar el pago.' : 'Pago completo registrado · entrega habilitada.';
        paymentByOrder.set(String(orderId), { ...(row || {}), orderId, totalSale: totalDue, paid, balance, status: state === 'paid' ? 'PAGADO' : state === 'partial' ? 'ABONO' : 'PENDIENTE' });
      } catch (error) {
        console.warn('No se pudo actualizar el control de pago automáticamente:', error);
      }
    };

    const syncNotifySaleButton = (order, orderCard) => {
      if (!orderCard) return;
      const footer = orderCard.querySelector('.admin-order-footer');
      if (!footer) return;
      let notify = footer.querySelector('[data-order-notify-sale]');
      const eligible = ['Enviado','Entregado'].includes(String(order.status || ''));
      if (eligible && !notify) {
        const saveButton = footer.querySelector('[data-order-note-save]');
        notify = document.createElement('button');
        notify.type = 'button';
        notify.className = 'button primary small';
        notify.dataset.orderNotifySale = order.id;
        notify.textContent = 'NOTIFICAR VENTA';
        if (saveButton) footer.insertBefore(notify, saveButton); else footer.appendChild(notify);
        wireNotifySaleButton(notify);
      } else if (!eligible && notify) {
        notify.remove();
      }
    };

    const wireNotifySaleButton = button => {
      if (!button || button.dataset.notifyWired === 'true') return;
      button.dataset.notifyWired = 'true';
      button.addEventListener('click',async()=>{
        const order=orders.find(o=>o.id===button.dataset.orderNotifySale); if(!order)return;
        const ok=await showYhorsConfirm('¿Notificar esta venta?', `El pedido #${escapeHTML(order.orderNumber)} pasará a Historial de ventas y dejará de ser editable desde Pedidos.`); if(!ok)return;
        button.disabled=true;
        try { await request(`/api/admin/orders/${order.id}/notificar-venta`,{method:'POST'}); orders=orders.filter(o=>o.id!==order.id); drawOrders(); } catch(e){button.disabled=false; alert(e.message);} 
      });
    };

    list.querySelectorAll('[data-order-note-save]').forEach(button=>button.addEventListener('click',async()=>{
      const id=button.dataset.orderNoteSave;
      const textarea=list.querySelector(`[data-order-note="${id}"]`);
      const assignment=list.querySelector(`[data-order-assignment="${id}"]`);
      const statusSelect=list.querySelector(`[data-order-status="${id}"]`);
      const editButton=list.querySelector(`[data-order-note-edit="${id}"]`);
      const order=orders.find(o=>o.id===id);
      if(!order || !textarea) return;
      if (button.dataset.editing !== 'true') return;

      const nextNote = textarea.value;
      const nextSeller = assignment ? (assignment.value || null) : (order.assignedSellerId || null);
      const nextStatus = statusSelect ? (statusSelect.value || order.status || 'Pendiente') : (order.status || 'Pendiente');
      const noteChanged = nextNote !== (order.internalNote || '');
      const assignmentChanged = String(nextSeller || '') !== String(order.assignedSellerId || '');
      const statusChanged = String(nextStatus) !== String(order.status || '');
      const originalItems = cloneOrderItems(order.items).map(item => ({productId:String(item.productId||''),purchaseMode:item.purchaseMode,quantity:Number(item.quantity||1),rentalDays:item.purchaseMode==='rental'?Number(item.rentalDays||1):null}));
      const draftForCompare = editingOrders.has(id) ? (draftItems.get(id)||[]) : originalItems;
      const currentItems = draftForCompare.map(item => ({productId:String(item.productId||''),purchaseMode:item.purchaseMode,quantity:Number(item.quantity||1),rentalDays:item.purchaseMode==='rental'?Number(item.rentalDays||1):null}));
      const itemsChanged = JSON.stringify(originalItems) !== JSON.stringify(currentItems);

      const sellerLabel = assignment
        ? (assignment.options[assignment.selectedIndex]?.textContent || 'Sin asignar').trim()
        : (order.assignedSellerName || 'Sin asignar');
      const detailParts = [];
      if (noteChanged) detailParts.push('la nota interna');
      if (assignmentChanged) detailParts.push(`el vendedor asignado a "${sellerLabel}"`);
      if (statusChanged) detailParts.push(`el estado a "${nextStatus}"`);
      if (itemsChanged) detailParts.push('los productos del pedido');
      if (!detailParts.length) detailParts.push('ningún dato (no hay cambios nuevos)');

      const confirmed = await showYhorsConfirm(
        '¿Seguro que quieres guardar este cambio?',
        `Se revisará ${detailParts.join(' y ')} del pedido #${escapeHTML(order.orderNumber)}.`
      );
      if (!confirmed) return;

      const originalText=button.textContent;
      // Si no hubo cambios, no hacemos una escritura innecesaria: simplemente
      // salimos del modo edición después de la segunda confirmación.
      if (!noteChanged && !assignmentChanged && !statusChanged && !itemsChanged) {
        textarea.value = order.internalNote || '';
        textarea.disabled = true;
        if (statusSelect) {
          statusSelect.value = order.status || 'Pendiente';
          statusSelect.disabled = true;
        }
        if (assignment) {
          assignment.value = order.assignedSellerId || '';
          assignment.disabled = true;
        }
        const assignmentPicker = list.querySelector(`[data-order-assignment-picker="${id}"]`);
        if (assignmentPicker) { assignmentPicker.disabled = true; updateOrderAssignmentDisplay(id); }
        if (editButton) {
          editButton.disabled = false;
          editButton.textContent = 'Editar pedido';
        }
        const cancelButton = list.querySelector(`[data-order-edit-cancel="${id}"]`);
        if (cancelButton) cancelButton.hidden = true;
        const productsButton = list.querySelector(`[data-order-items-edit="${id}"]`);
        if (productsButton) { productsButton.disabled = true; productsButton.hidden = false; }
        closeOrderEditor(id);
        editingOrders.delete(id); draftItems.delete(id); productEditorsOpen.delete(id);
        delete button.dataset.editing;
        button.textContent='Sin cambios';
        button.disabled=true;
        setTimeout(()=>{button.textContent='Guardar cambios';},1100);
        return;
      }

      button.disabled=true;
      try {
        const payload = {};
        if (noteChanged) payload.internalNote = nextNote;
        if (assignment && canAssign) payload.assignedSellerId = nextSeller;
        if (statusChanged && statusSelect) payload.status = nextStatus;
        if (editingOrders.has(id) && draftItems.has(id)) {
          const draft = draftItems.get(id) || [];
          ensureDraftIdentifiers(draft);
          if (!draft.length) { button.disabled=false; alert('El pedido debe tener al menos un producto.'); return; }
          if (draft.some(item => !item.productId || !Number.isInteger(Number(item.quantity)) || Number(item.quantity)<1 || Number(item.quantity)>99)) { button.disabled=false; alert('Revisa las cantidades de los productos.'); return; }
          if (draft.some(item => item.purchaseMode==='rental' && (!Number.isInteger(Number(item.rentalDays)) || Number(item.rentalDays)<1 || Number(item.rentalDays)>10))) { button.disabled=false; alert('Los alquileres deben tener entre 1 y 10 días.'); return; }
          payload.items = draft.map(item => ({ productId:item.productId, purchaseMode:item.purchaseMode, quantity:Number(item.quantity), rentalDays:item.purchaseMode==='rental'?Number(item.rentalDays||1):null, deviceIdentifiers:Array.isArray(item.deviceIdentifiers) ? item.deviceIdentifiers : [] }));
        }
        const updated=await request(`/api/admin/orders/${id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
        orders=orders.map(o=>o.id===updated.id?updated:o);
        const orderCard = button.closest('.admin-order');
        if (orderCard) {
          orderCard.dataset.orderStatus = updated.status || 'Pendiente';
          const summaryStatus = orderCard.querySelector('.order-summary-status');
          if (summaryStatus) {
            summaryStatus.textContent = updated.status || 'Pendiente';
            summaryStatus.className = `order-summary-status status-${statusClass(updated.status || 'Pendiente')}`;
          }
        }
        textarea.value = updated.internalNote || '';
        textarea.disabled = true;
        if (statusSelect) {
          statusSelect.value = updated.status || 'Pendiente';
          statusSelect.className = `status-select-${statusClass(updated.status || 'Pendiente')}`;
          statusSelect.disabled = true;
        }
        syncNotifySaleButton(updated, orderCard);
        if (assignment) {
          assignment.value = updated.assignedSellerId || '';
          assignment.dataset.changed = 'false';
          assignment.disabled = true;
        }
        const assignmentPicker = list.querySelector(`[data-order-assignment-picker="${id}"]`);
        if (assignmentPicker) { assignmentPicker.disabled = true; updateOrderAssignmentDisplay(id); }
        if (editButton) {
          editButton.disabled = false;
          editButton.textContent = 'Editar pedido';
        }
        const cancelButton = list.querySelector(`[data-order-edit-cancel="${id}"]`);
        if (cancelButton) cancelButton.hidden = true;
        const productsButton = list.querySelector(`[data-order-items-edit="${id}"]`);
        if (productsButton) { productsButton.disabled = true; productsButton.hidden = false; }
        refreshOrderItemsView(updated);
        // Después de guardar, volver a consultar el dinero del pedido para que
        // CONTROL DE PAGO refleje inmediatamente abonos, saldos y cambios de total
        // sin recargar toda la página ni perder el pedido desplegado.
        await refreshOrderPaymentView(updated.id, orderCard, updated.total);
        closeOrderEditor(id);
        editingOrders.delete(id); draftItems.delete(id); productEditorsOpen.delete(id);
        delete button.dataset.editing;
        button.textContent='Cambios guardados ✓';
        setTimeout(()=>{button.textContent='Guardar cambios'; button.disabled=true;},1400);
      } catch(e) {
        button.disabled=false;
        alert(e.message);
      }
    }));

    list.querySelectorAll('[data-order-notify-sale]').forEach(wireNotifySaleButton);

    list.querySelectorAll('[data-order-rental-refund]').forEach(button=>button.addEventListener('click',async()=>{
      const order=orders.find(o=>o.id===button.dataset.orderRentalRefund); if(!order) return;
      const payment=paymentByOrder.get(String(order.id)) || {};
      const amount=Number(payment.paid || 0);
      const ok=await showYhorsConfirm(
        '¿Devolver el dinero del alquiler?',
        `Esta acción es exclusiva de Administración. Se devolverán <strong>${money(amount)}</strong> al cliente y el movimiento quedará registrado. El inventario no cambia porque el alquiler nunca descontó stock.`,
        {cancelText:'Cancelar',confirmText:'Devolver dinero'}
      );
      if(!ok)return;
      button.disabled=true;
      try{
        await request('/api/admin/dinero/devoluciones-orden',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:order.id})});
        const refreshedMoney=await request('/api/admin/dinero/resumen?from=&to=&showPaid=true').catch(()=>({receivables:[]}));
        paymentByOrder=new Map((Array.isArray(refreshedMoney.receivables)?refreshedMoney.receivables:[]).filter(row=>row.orderId).map(row=>[String(row.orderId),row]));
        drawOrders();
      }catch(e){button.disabled=false;alert(e.message);}
    }));

    list.querySelectorAll('[data-order-delete]').forEach(button=>button.addEventListener('click',async()=>{
      const order=orders.find(o=>o.id===button.dataset.orderDelete); if(!order) return;
      if(!confirm(`¿Eliminar el pedido #${order.orderNumber}? Esta acción no se puede deshacer.`)) return;
      try { await request(`/api/admin/orders/${order.id}`,{method:'DELETE'}); orders=orders.filter(o=>o.id!==order.id); drawOrders(); } catch(e){alert(e.message);}
    }));
  };
  document.querySelector('#ordersSearch')?.addEventListener('input',drawOrders);
  document.querySelector('#ordersStatusFilter')?.addEventListener('change',drawOrders);
  document.querySelector('#ordersDateFrom')?.addEventListener('change',drawOrders);
  document.querySelector('#ordersDateTo')?.addEventListener('change',drawOrders);
  document.querySelector('#clearOrdersDate')?.addEventListener('click',()=>{
    const from=document.querySelector('#ordersDateFrom');
    const to=document.querySelector('#ordersDateTo');
    const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Guayaquil'});
    if(from) from.value=today;
    if(to) to.value=today;
    drawOrders();
  });
  const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Guayaquil'});
  const from=document.querySelector('#ordersDateFrom');
  const to=document.querySelector('#ordersDateTo');
  if(from) from.value=today;
  if(to) to.value=today;
  wireAccountMenu();
  drawOrders();
}




function securityRoleLabel(role) {
  return userRoleLabel(role);
}

function securityStatusPill(row) {
  if (row.locked) return `<span class="security-pill danger">${row.permanentLock ? 'Bloqueado permanentemente' : `Bloqueado · ${Math.ceil(Number(row.lockRemainingSeconds || 0) / 60)} min`}</span>`;
  if (!row.active) return `<span class="security-pill neutral">Cuenta desactivada</span>`;
  return `<span class="security-pill success">Acceso activo</span>`;
}

async function renderAdminSecurity(embedded = false) {
  const session = await request('/api/admin/session').catch(() => ({ authenticated: false }));
  if (!session.authenticated) return renderLogin();
  if (session.role !== 'admin') return renderAdminOrders();

  try {
    const [overview, alertsResponse] = await Promise.all([
      request('/api/admin/security/overview').catch(() => null),
      request('/api/admin/security/alerts').catch(() => ({ alerts: [], summary: { total: 0, critical: 0, high: 0, medium: 0 } }))
    ]);

    const data = overview && typeof overview === 'object' ? overview : {};
    const users = Array.isArray(data.users) ? data.users : [];
    const alertData = alertsResponse && typeof alertsResponse === 'object' ? alertsResponse : {};
    const alerts = Array.isArray(alertData.alerts) ? alertData.alerts : [];
    const totals = data.totals && typeof data.totals === 'object' ? data.totals : {};
    const fmtNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;
    const severityLabel = severity => ({ critical:'Crítica', high:'Alta', medium:'Media', low:'Baja' }[severity] || 'Aviso');
    const alertIcon = severity => ({ critical:'!', high:'!', medium:'•', low:'i' }[severity] || 'i');

    const cards = [
      ['USUARIOS ACTIVOS', fmtNumber(totals.activeUsers), 'Cuentas con acceso permitido'],
      ['SESIONES ACTIVAS', fmtNumber(totals.activeSessions), 'Sesiones en este servidor'],
      ['PASSKEYS', fmtNumber(totals.passkeys), 'Credenciales registradas'],
      ['CUENTAS BLOQUEADAS', fmtNumber(totals.lockedUsers), 'Requieren revisión'],
      ['ALERTAS ACTIVAS', fmtNumber(alertData.summary?.total), 'Patrones que requieren atención']
    ];

    const rows = users.map(row => {
      const id = escapeHTML(row?.id || '');
      const name = escapeHTML(row?.name || row?.username || 'Usuario');
      const username = escapeHTML(row?.username || '');
      const role = escapeHTML(securityRoleLabel(row?.role || ''));
      const initial = escapeHTML(String(row?.name || row?.username || '?').trim().slice(0, 1).toUpperCase());
      const activeSessions = fmtNumber(row?.activeSessions);
      const passkeyCount = fmtNumber(row?.passkeyCount);
      const failedAttempts = fmtNumber(row?.failedAttempts);
      const status = securityStatusPill({
        locked: Boolean(row?.locked),
        permanentLock: Boolean(row?.permanentLock),
        lockRemainingSeconds: fmtNumber(row?.lockRemainingSeconds),
        active: row?.active !== false
      });

      return `<article class="security-user-card" data-security-user="${id}">
        <div class="security-user-main">
          <div class="security-avatar">${initial}</div>
          <div><strong>${name}</strong><small>@${username} · ${role}</small></div>
        </div>
        <div class="security-user-status">${status}</div>
        <div class="security-user-metrics">
          <span><b>${activeSessions}</b> sesión${activeSessions === 1 ? '' : 'es'}</span>
          <span><b>${passkeyCount}</b> Passkey${passkeyCount === 1 ? '' : 's'}${row?.passkeyAllowed ? '' : ' · bloqueadas'}</span>
          <span>${failedAttempts ? `${failedAttempts} intento(s) fallido(s)` : 'Sin intentos fallidos recientes'}</span>
        </div>
        <div class="security-user-actions">
          ${row?.locked ? `<button type="button" class="button secondary small" data-security-reset="${id}">Desbloquear</button>` : ''}
          ${activeSessions ? `<button type="button" class="button secondary small" data-security-sessions="${id}">Cerrar sesiones</button>` : ''}
          ${passkeyCount ? `<button type="button" class="button secondary small" data-security-passkeys="${id}">Revocar Passkeys</button>` : ''}
        </div>
      </article>`;
    }).join('');

    const alertMarkup = alerts.length
      ? alerts.map(alert => `<article class="security-alert-card ${escapeHTML(alert?.severity || 'medium')}">
          <div class="security-alert-icon">${alertIcon(alert?.severity)}</div>
          <div class="security-alert-content">
            <div class="security-alert-top"><strong>${escapeHTML(alert?.title || 'Actividad detectada')}</strong><span>${escapeHTML(severityLabel(alert?.severity))}</span></div>
            <p>${escapeHTML(alert?.description || 'Se detectó actividad que requiere atención.')}</p>
            <small>${alert?.username ? `Usuario: ${escapeHTML(alert.username)} · ` : ''}${alert?.ip ? `IP: ${escapeHTML(alert.ip)} · ` : ''}${alert?.windowMinutes ? `Ventana: ${escapeHTML(alert.windowMinutes)} min` : ''}</small>
          </div>
        </article>`).join('')
      : `<div class="security-alert-empty"><strong>Sin alertas activas</strong><span>No se detectaron patrones anormales en la actividad reciente.</span></div>`;

    app.innerHTML = `<main class="admin-shell"><div class="admin-wrap">
      <div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route aria-label="YHORS · Panel Administrativo · Ir a YHORS Inteligente"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></a><h1 class="admin-title">${embedded ? 'Usuarios' : 'Seguridad'}</h1><p class="admin-subtitle">${embedded ? 'Cuentas, acceso y protección de YHORS' : 'Centro de control de acceso de YHORS'}</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>
      ${adminSectionNav(session, 'usuarios')}
      ${embedded ? `<div class="users-module-switch" role="tablist" aria-label="Usuarios y seguridad"><button type="button" class="users-module-tab" data-open-users>Usuarios</button><button type="button" class="users-module-tab is-active" data-open-security>Seguridad</button></div>` : ''}
      <section class="admin-panel security-panel">
        <div class="security-hero"><div><span class="eyebrow">V15.4 · PROTECCIÓN DE ACCESO</span><h2>Seguridad y sesiones</h2><p>Controla cuentas, bloqueos, Passkeys y sesiones activas desde un solo lugar.</p></div><div class="security-live"><span></span> Sistema protegido</div></div>
        <div class="security-metrics">${cards.map(([label,value,help]) => `<div class="security-metric"><span>${label}</span><strong>${value}</strong><small>${help}</small></div>`).join('')}</div>
        <div class="section-heading security-section-heading"><div><span class="eyebrow">CUENTAS</span><h3>Estado de acceso</h3></div><p>Las acciones sensibles quedan registradas automáticamente en Auditoría.</p></div>
        <div class="security-users-list">${rows || '<p class="backup-empty">No hay cuentas registradas.</p>'}</div>
        <div class="security-alerts-section"><div class="section-heading security-section-heading"><div><span class="eyebrow">V15.5 · ALERTAS</span><h3>Actividad que requiere atención</h3></div><p>${fmtNumber(alertData.summary?.total)} alerta(s) detectada(s) en la actividad reciente.</p></div><div class="security-alerts-list">${alertMarkup}</div></div>
        <div class="security-note"><strong>Protección activa</strong><span>Contraseñas con hash · sesiones del lado del servidor · límite de intentos · bloqueo progresivo · WebAuthn / Passkeys · auditoría de seguridad</span></div>
      </section>
    </div></main>`;

    wireAccountMenu();

    document.querySelectorAll('[data-security-reset]').forEach(button => button.addEventListener('click', async () => {
      if (!confirm('¿Seguro que quieres desbloquear esta cuenta?')) return;
      try { await request(`/api/admin/security/users/${encodeURIComponent(button.dataset.securityReset)}/reset-lock`, { method:'POST' }); alert('Cuenta desbloqueada.'); await renderAdminSecurity(true); }
      catch (error) { alert(error.message); }
    }));
    document.querySelectorAll('[data-security-sessions]').forEach(button => button.addEventListener('click', async () => {
      if (!confirm('¿Cerrar todas las sesiones activas de este usuario?')) return;
      try { const result = await request(`/api/admin/security/users/${encodeURIComponent(button.dataset.securitySessions)}/revoke-sessions`, { method:'POST' }); alert(`${result.sessionsRevoked || 0} sesión(es) cerrada(s).`); await renderAdminSecurity(true); }
      catch (error) { alert(error.message); }
    }));
    document.querySelectorAll('[data-security-passkeys]').forEach(button => button.addEventListener('click', async () => {
      if (!confirm('¿Seguro que quieres revocar todas las Passkeys de esta cuenta? Tendrá que volver a registrarlas.')) return;
      try { await request(`/api/admin/users/${encodeURIComponent(button.dataset.securityPasskeys)}/passkeys`, { method:'DELETE' }); alert('Passkeys revocadas.'); await renderAdminSecurity(true); }
      catch (error) { alert(error.message); }
    }));

    document.querySelectorAll('[data-open-users]').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try { history.pushState({}, '', `${ADMIN_PATH}/usuarios`); await renderAdminUsers('usuarios'); }
      catch (error) { console.error('[YHORS] No se pudo volver a Usuarios:', error); }
      finally { button.disabled = false; }
    }));
    document.querySelectorAll('[data-open-security]').forEach(button => button.addEventListener('click', async () => {
      button.disabled = true;
      try { history.pushState({}, '', `${ADMIN_PATH}/usuarios?panel=seguridad`); await renderAdminSecurity(true); }
      catch (error) { console.error('[YHORS] No se pudo actualizar Seguridad:', error); }
      finally { button.disabled = false; }
    }));
  } catch (error) {
    console.error('[YHORS] Error al renderizar Seguridad:', error);
    const username = escapeHTML(session.username || 'Usuario');
    const role = escapeHTML(userRoleLabel(session.role || ''));
    app.innerHTML = `<main class="admin-shell"><div class="admin-wrap">
      <div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route aria-label="YHORS · Panel Administrativo · Ir a YHORS Inteligente"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></a><h1 class="admin-title">Usuarios</h1><p class="admin-subtitle">Cuentas, acceso y protección de YHORS</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>
      ${adminSectionNav(session, 'usuarios')}
      <div class="users-module-switch" role="tablist" aria-label="Usuarios y seguridad"><button type="button" class="users-module-tab" data-open-users>Usuarios</button><button type="button" class="users-module-tab is-active" data-open-security>Seguridad</button></div>
      <section class="admin-panel security-panel"><div class="security-hero"><div><span class="eyebrow">V15.5 · ALERTAS</span><h2>Seguridad y sesiones</h2><p>El panel se abrió, pero algunos datos no pudieron cargarse. Puedes volver a intentarlo.</p></div><div class="security-live"><span></span> Sistema protegido</div></div>
      <div class="security-alert-empty"><strong>Centro de seguridad disponible</strong><span>Usuario: ${username} · Rol: ${role}</span><button type="button" class="button secondary small" id="securityRetry">Reintentar</button></div></section>
    </div></main>`;
    wireAccountMenu();
    document.querySelector('#securityRetry')?.addEventListener('click', () => renderAdminSecurity(true));
    document.querySelectorAll('[data-open-users]').forEach(button => button.addEventListener('click', async () => { history.pushState({}, '', `${ADMIN_PATH}/usuarios`); await renderAdminUsers('usuarios'); }));
    document.querySelectorAll('[data-open-security]').forEach(button => button.addEventListener('click', () => renderAdminSecurity(true)));
  }
}

async function renderAdminAudit() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated: false }));
  if (!session.authenticated) return renderLogin();
  if (session.role !== 'admin') return renderAdminOrders();

  const nav = adminSectionNav(session, 'auditoria');

  app.innerHTML = `<main class="admin-shell"><div class="admin-wrap">
    <div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route aria-label="YHORS · Panel Administrativo · Ir a YHORS Inteligente"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></a><h1 class="admin-title">Auditoría</h1><p class="admin-subtitle">Historial de acciones importantes de YHORS</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>
    ${nav}
    <section class="admin-panel audit-panel">
      <div class="section-heading"><div><span class="eyebrow">V15.3 · Pedidos e inventario</span><h2>Actividad del sistema</h2></div><p>Consulta quién hizo cada acción, cuándo ocurrió y qué cambió.</p></div>
      <div class="audit-filters">
        <label class="users-search-field"><span>Buscar</span><input id="auditQuery" type="search" placeholder="Pedido, usuario, producto…"></label>
        <label class="users-search-field"><span>Usuario</span><select id="auditUser"><option value="">Todos</option></select></label>
        <label class="users-search-field"><span>Módulo</span><select id="auditModule"><option value="">Todos</option></select></label>
        <label class="users-search-field"><span>Acción</span><select id="auditAction"><option value="">Todas</option></select></label>
        <label class="users-search-field"><span>Desde</span><input id="auditFrom" type="date"></label>
        <label class="users-search-field"><span>Hasta</span><input id="auditTo" type="date"></label>
        <button class="button secondary small" id="auditClear" type="button">Limpiar</button>
      </div>
      <div class="audit-summary" id="auditSummary"></div>
      <div id="auditList" class="audit-list"><div class="backup-empty">Cargando auditoría…</div></div>
    </section>
  </div></main>`;

  const esc = value => escapeHTML(value == null ? '' : String(value));
  const auditLabels = {
    username:'Usuario', accountId:'Cuenta', role:'Rol', reason:'Motivo', attemptsRemaining:'Intentos restantes', attemptsUsed:'Intentos utilizados', attemptsLimit:'Límite de intentos',
    orderId:'Pedido', orderNumber:'Número de pedido', productId:'Producto', sku:'SKU', name:'Nombre', status:'Estado', assignedSellerId:'Vendedor asignado', assignedSellerName:'Vendedor responsable',
    internalNote:'Nota interna', total:'Total', source:'Origen', stockReturned:'Inventario devuelto', active:'Activo', published:'Publicado', category:'Categoría', purchasePrice:'Precio de compra', salePrice:'Precio de venta', rentalPrice:'Precio de alquiler',
    details:'Detalle', changes:'Cambios', before:'Antes', after:'Después', items:'Productos', inventory:'Inventario', synchronized:'Sincronizado', movements:'Movimientos', direction:'Movimiento', quantity:'Cantidad', reason:'Motivo', stockReturned:'Inventario devuelto', previousStock:'Stock anterior', removedFromCatalog:'Retirado del catálogo'
  };
  const auditLabel = key => auditLabels[key] || String(key).replace(/([A-Z])/g,' $1').replace(/^./, c => c.toUpperCase());
  const auditValueText = value => {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    if (typeof value === 'number') return String(value);
    if (Array.isArray(value)) return value.map(item => typeof item === 'object' ? (item.name || item.sku || JSON.stringify(item)) : item).join(', ');
    return String(value);
  };
  const auditDetailsMarkup = details => {
    if (!details || typeof details !== 'object') return `<div class="audit-detail-row"><span>Detalle</span><strong>${esc(auditValueText(details))}</strong></div>`;
    const entries = Object.entries(details).filter(([key]) => !['userAgent','password','token','secret'].includes(key));
    return `<div class="audit-detail-grid">${entries.map(([key,value]) => {
      if (key === 'changes' && value && typeof value === 'object') {
        const changes = Object.entries(value);
        return `<div class="audit-change-block"><span class="audit-detail-label">Cambios realizados</span>${changes.length ? changes.map(([field,change]) => `<div class="audit-change"><b>${esc(auditLabel(field))}</b><span>${esc(auditValueText(change?.before))}</span><i>→</i><strong>${esc(auditValueText(change?.after))}</strong></div>`).join('') : '<small>Sin cambios registrados.</small>'}</div>`;
      }
      if (key === 'inventory' && value && typeof value === 'object') {
        const movements = Array.isArray(value.movements) ? value.movements : [];
        const movementMarkup = movements.length
          ? movements.map(move => `<div class="audit-stock-movement">
              <div><strong>${esc(move.name || move.sku || 'Producto')}</strong><small>${esc(move.sku || '')}</small></div>
              <span class="audit-stock-direction ${move.direction === 'entrada' ? 'is-in' : 'is-out'}">${move.direction === 'entrada' ? 'Entrada' : 'Salida'}</span>
              <span>${esc(String(move.before ?? '—'))} → <strong>${esc(String(move.after ?? '—'))}</strong></span>
              <span>${esc(String(move.quantity ?? '—'))} ud.</span>
              <small>${esc(move.reason || '')}</small>
            </div>`).join('')
          : '<small class="audit-muted">Sin movimientos de inventario en este evento.</small>';
        return `<div class="audit-detail-block audit-inventory-block">
          <div class="audit-detail-label">Sincronización de inventario</div>
          <div class="audit-inventory-summary"><span>Estado</span><strong>${value.synchronized === false ? 'No sincronizado' : 'Sincronizado'}</strong></div>
          ${movementMarkup}
        </div>`;
      }
      if (key === 'order' && value && typeof value === 'object') {
        return `<div class="audit-detail-block"><span class="audit-detail-label">Resumen del pedido</span><div class="audit-detail-grid nested">${Object.entries(value).filter(([k]) => k !== 'items').map(([k,v]) => `<div class="audit-detail-row"><span>${esc(auditLabel(k))}</span><strong>${esc(auditValueText(v))}</strong></div>`).join('')}</div></div>`;
      }
      return `<div class="audit-detail-row"><span>${esc(auditLabel(key))}</span><strong>${esc(auditValueText(value))}</strong></div>`;
    }).join('')}</div>`;
  };
  const localToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
  const queryEls = ['auditQuery','auditUser','auditModule','auditAction','auditFrom','auditTo'].map(id => document.getElementById(id));

  const draw = async () => {
    const [q,user,module,action,from,to] = queryEls.map(el => el?.value || '');
    const params = new URLSearchParams({ q,username:user,module,action,from,to });
    const data = await request(`/api/admin/audit?${params.toString()}`).catch(e => ({ entries: [], total: 0, error: e.message }));
    const fill = (id, values, selected) => {
      const select=document.getElementById(id); if(!select) return;
      const first=select.options[0]?.outerHTML || '';
      select.innerHTML=first+values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');
      select.value=selected || '';
    };
    fill('auditUser', data.availableUsers || [], user);
    fill('auditModule', data.availableModules || [], module);
    fill('auditAction', data.availableActions || [], action);
    const summary=document.getElementById('auditSummary');
    if(summary) summary.innerHTML=`<strong>${Number(data.total || 0)}</strong> evento(s) encontrado(s)`;
    const list=document.getElementById('auditList');
    if(!list) return;
    if(data.error){ list.innerHTML=`<div class="backup-empty">${esc(data.error)}</div>`; return; }
    if(!data.entries?.length){ list.innerHTML='<div class="backup-empty">No hay eventos que coincidan con los filtros.</div>'; return; }
    list.innerHTML=data.entries.map((entry,index)=>{
      const date=new Date(entry.createdAt);
      const when=Number.isNaN(date.getTime()) ? entry.createdAt : date.toLocaleString('es-EC',{dateStyle:'short',timeStyle:'medium'});
      const details=entry.details||{};
      return `<article class="audit-entry ${entry.result==='failure'?'audit-failure':''}">
        <button type="button" class="audit-entry-head" data-audit-open="${index}">
          <span class="audit-entry-icon">${entry.result==='failure'?'!':'✓'}</span>
          <span class="audit-entry-main"><strong>${esc(entry.action)}</strong><small>${esc(entry.module)} · ${esc(entry.username || 'Sistema')} · ${esc(when)}</small></span>
          <span class="audit-entry-arrow">›</span>
        </button>
        <div class="audit-entry-details" data-audit-details="${index}" hidden>
          <div class="audit-meta"><span><b>Usuario</b>${esc(entry.username || 'Sistema')}</span><span><b>Rol</b>${esc(userRoleLabel(entry.role || ''))}</span><span><b>IP</b>${esc(String(entry.ip || '—').replace(/^::ffff:/,''))}</span><span><b>Resultado</b>${entry.result === 'failure' ? 'Fallido' : 'Correcto'}</span><span><b>ID</b>${esc(entry.id)}</span></div>
          <div class="audit-detail-box">${auditDetailsMarkup(details)}</div>
          ${entry.userAgent ? `<details class="audit-technical"><summary>Ver información técnica</summary><small class="audit-user-agent">${esc(entry.userAgent)}</small></details>` : ''}
        </div>
      </article>`;
    }).join('');
    list.querySelectorAll('[data-audit-open]').forEach(btn=>btn.addEventListener('click',()=>{
      const details=list.querySelector(`[data-audit-details="${btn.dataset.auditOpen}"]`);
      if(details) details.hidden=!details.hidden;
      btn.closest('.audit-entry')?.classList.toggle('is-open',details && !details.hidden);
    }));
  };

  const bind=()=>queryEls.forEach(el=>el?.addEventListener(el.type==='search'?'input':'change',draw));
  document.getElementById('auditClear')?.addEventListener('click',()=>{
    ['auditQuery','auditUser','auditModule','auditAction'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
    document.getElementById('auditFrom').value='';
    document.getElementById('auditTo').value='';
    draw();
  });
  bind();
  wireAccountMenu();
  draw();
}


function userRoleLabel(role) {
  const normalized = String(role || '').toLowerCase() === 'orders' ? 'vendedor' : String(role || '').toLowerCase();
  return normalized === 'admin' ? 'Administrador' : (normalized === 'store_manager' ? 'Jefe de tienda' : 'Vendedor');
}
function isSellerRole(role) {
  return String(role || '').toLowerCase() === 'vendedor' || String(role || '').toLowerCase() === 'orders';
}
function orderBackHref(role) {
  return isSellerRole(role) || role === 'store_manager' ? `${ADMIN_PATH}/pedidos` : ADMIN_PATH;
}

function usersPanel(users = []) {
  const rows = users.map(user => `<article class="admin-user-card ${user.active ? '' : 'is-disabled'}" data-user-search="${escapeHTML(`${user.name || ''} ${user.username || ''} ${userRoleLabel(user.role)}`)}" data-user-role="${escapeHTML(user.role)}">
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
    <div class="users-module-switch" role="tablist" aria-label="Usuarios y seguridad">
      <button type="button" class="users-module-tab is-active" data-open-users role="tab" aria-selected="true">Usuarios</button>
      <button type="button" class="users-module-tab" data-open-security role="tab" aria-selected="false">Seguridad</button>
    </div>
    <div class="section-heading">
      <div><span class="eyebrow">Cuentas y acceso</span><h2>Usuarios</h2></div>
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
          <div class="field"><label for="userRole">Rol</label><select id="userRole" name="role"><option value="vendedor">Vendedor</option><option value="store_manager">Jefe de tienda</option><option value="admin">Administrador</option></select></div>
          <div class="field"><label for="userActive">Estado</label><select id="userActive" name="active"><option value="true">Activo</option><option value="false">Desactivado</option></select></div>
        </div>
        <div id="userMessage" class="message" hidden></div>
        <div class="form-actions"><button class="button primary" id="userSubmit" type="submit">Crear usuario</button></div>
      </form>
      <div class="users-list-wrap">
        <div class="users-list-head"><div><span class="eyebrow">Cuentas existentes</span><strong id="usersCount">${users.length} usuario(s)</strong></div></div>
        <div class="users-search-toolbar" aria-label="Buscar y filtrar usuarios">
          <label class="users-search-field"><span>Buscar</span><input id="usersSearch" type="search" placeholder="Nombre, usuario o rol…" autocomplete="off"></label>
          <label class="users-search-field"><span>Rol</span><select id="usersRoleFilter"><option value="">Todos los roles</option><option value="vendedor">Vendedores</option><option value="store_manager">Jefes de tienda</option><option value="admin">Administradores</option></select></label>
          <button type="button" class="button secondary small" id="usersSearchClear">Limpiar</button>
        </div>
        <div id="adminUsersList">${rows || '<p class="backup-empty">No hay usuarios registrados.</p>'}</div>
      </div>
    </div>
  </section>`;
}

async function renderAdminUsers(panel = 'usuarios') {
  const session = await request('/api/admin/session').catch(() => ({ authenticated: false }));
  if (!session.authenticated) return renderLogin();
  if (session.role !== 'admin') return renderAdminOrders();
  if (panel === 'seguridad') return renderAdminSecurity(true);

  let users = await request('/api/admin/users').catch(() => []);
  app.innerHTML = `<main class="admin-shell"><div class="admin-wrap">
    <div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route aria-label="YHORS · Panel Administrativo · Ir a YHORS Inteligente"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></a><h1 class="admin-title">Administración</h1><p class="admin-subtitle">Control de usuarios y accesos</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>
    ${adminSectionNav(session, 'usuarios')}
    ${usersPanel(users)}
  </div></main>`;

  const form = document.querySelector('#userForm');
  const message = document.querySelector('#userMessage');
  const submit = document.querySelector('#userSubmit');
  const cancel = document.querySelector('#userCancelEdit');

  const filterUsers = () => {
    const query = String(document.querySelector('#usersSearch')?.value || '').trim().toLocaleLowerCase('es');
    const role = String(document.querySelector('#usersRoleFilter')?.value || '');
    const cards = [...document.querySelectorAll('#adminUsersList .admin-user-card')];
    let visible = 0;
    cards.forEach(card => {
      const text = String(card.dataset.userSearch || '').toLocaleLowerCase('es');
      const matchesQuery = !query || text.includes(query);
      const matchesRole = !role || String(card.dataset.userRole || '') === role;
      const show = matchesQuery && matchesRole;
      card.hidden = !show;
      if (show) visible += 1;
    });
    const count = document.querySelector('#usersCount');
    if (count) count.textContent = `${visible} de ${cards.length} usuario(s)`;
  };
  document.querySelector('#usersSearch')?.addEventListener('input', filterUsers);
  document.querySelector('#usersRoleFilter')?.addEventListener('change', filterUsers);
  document.querySelector('#usersSearchClear')?.addEventListener('click', () => {
    const search = document.querySelector('#usersSearch');
    const role = document.querySelector('#usersRoleFilter');
    if (search) search.value = '';
    if (role) role.value = '';
    filterUsers();
    search?.focus();
  });

  const resetForm = () => {
    form.reset();
    document.querySelector('#userId').value = '';
    document.querySelector('#userRole').value = 'vendedor';
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

  document.querySelectorAll('[data-open-security]').forEach(button => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        history.pushState({}, '', `${ADMIN_PATH}/usuarios?panel=seguridad`);
        await renderAdminSecurity(true);
      } catch (error) {
        console.error('[YHORS] No se pudo abrir Seguridad:', error);
        alert('No se pudo abrir Seguridad. Intenta nuevamente.');
      } finally {
        button.disabled = false;
      }
    });
  });
  document.querySelectorAll('[data-open-users]').forEach(button => {
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        history.pushState({}, '', `${ADMIN_PATH}/usuarios`);
        await renderAdminUsers('usuarios');
      } catch (error) {
        console.error('[YHORS] No se pudo abrir Usuarios:', error);
        alert('No se pudo abrir Usuarios. Intenta nuevamente.');
      } finally {
        button.disabled = false;
      }
    });
  });

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
    const confirmed = await showYhorsConfirm('¿Seguro que quieres guardar este cambio?', id ? 'Se actualizarán los datos y permisos de esta cuenta.' : 'Se creará la nueva cuenta de usuario.');
    if (!confirmed) return;
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

function backupPanel(data = null, collapsed = true) {
  const persistent = data?.storageMode === 'persistent';
  const backups = Array.isArray(data?.backups) ? data.backups : [];
  const total = backups.length;
  return `<section class="admin-panel backup-panel ${collapsed ? 'is-collapsed' : ''}" id="backupPanel">
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

function inventoryPageMarkup(products = [], options = {}) {
  const inventoryReadOnly = Boolean(options.readOnly);
  const role = String(options.role || window.__yhorsSession?.role || '').toLowerCase();
  const classifications = options.classifications || { brands: {}, productTypes: {} };
  const categoryOptions = Object.entries(categories).filter(([key]) => key !== 'all');
  const allValues = (key, category = '') => {
    const source = category
      ? (classifications[key]?.[category] || [])
      : Object.values(classifications[key] || {}).flat();
    return [...new Set(source.filter(Boolean))].sort((a,b) => String(a).localeCompare(String(b), 'es', { sensitivity:'base' }));
  };
  const rows = products.length ? products.map(product => {
    const images = productImages(product).filter(src => src !== placeholder);
    const hasImages = images.length > 0;
    const profit = Number(product.salePrice ?? product.price ?? 0) - Number(product.purchasePrice ?? 0);
    const profitClass = profit >= 0 ? 'profit-positive' : 'profit-negative';
    const profitLabel = profit >= 0 ? 'Ganancia' : 'Pérdida';
    const isCosplay = product.category === 'cosplay';
    const isRental = isCosplay && product.isRental === true && product.rentalPrice !== null && product.rentalPrice !== undefined && product.rentalPrice !== '';
    const rentalValue = product.rentalPrice ?? '';
    const brands = allValues('brands', product.category);
    const types = allValues('productTypes', product.category);
    const tags = Array.isArray(product.tags) ? product.tags : [];
    const tagText = tags.join(', ');
    const stockMin = Number.isFinite(Number(product.stockMin)) ? Number(product.stockMin) : 0;
    const requiresIdentifier = product.requiresDeviceIdentifier !== false && product.category === 'tech';
    return `<article class="inventory-record inventory-record-compact" data-inventory-id="${escapeHTML(product.id)}">
      <div class="inventory-record-media">
        ${hasImages ? `<img class="inventory-main-image" src="${escapeHTML(images[0])}" alt="${escapeHTML(product.name)}" data-fallback>` : `<div class="inventory-no-image" aria-label="Producto sin imagen"><span>⚠</span><strong>SIN IMAGEN</strong><small>Completar después</small></div>`}
        ${hasImages ? `<div class="inventory-thumbs">${images.slice(0,4).map((src,index)=>`<img src="${escapeHTML(src)}" alt="${escapeHTML(product.name)} imagen ${index+1}" data-fallback>`).join('')}</div>` : ''}
      </div>
      <div class="inventory-record-info">
        <div class="inventory-record-title">
          <div>
            <span class="eyebrow">${escapeHTML(categories[product.category] || product.category || 'Producto')} · ${product.published === false ? 'SOLO INVENTARIO' : 'PUBLICADO'}</span>
            <h3>${escapeHTML(product.name)}</h3>
          </div>
          <div class="inventory-stock-wrap">
            <strong class="inventory-stock-badge">${Number(product.stock || 0)} en stock</strong>
            <strong class="inventory-profit-badge ${profitClass}" data-profit-badge>${profitLabel}: ${money(Math.abs(profit))}</strong>
          </div>
        </div>

        <div class="inventory-record-meta">
          <div><span>SKU</span><strong>${escapeHTML(product.sku || '—')}</strong></div>
          <div><span>MARCA</span><strong data-inventory-display="brand">${escapeHTML(product.brand || '—')}</strong></div>
          <div><span>TIPO</span><strong data-inventory-display="productType">${escapeHTML(product.productType || '—')}</strong></div>
        </div>

        <div class="inventory-edit-fields">
          <label><span>Precio de compra</span><div class="inventory-input-wrap"><span>$</span><input type="number" min="0" step="0.01" value="${escapeHTML(product.purchasePrice ?? 0)}" data-field="purchasePrice" disabled></div></label>
          <label><span>Precio de venta</span><div class="inventory-input-wrap"><span>$</span><input type="number" min="0" step="0.01" value="${escapeHTML(product.salePrice ?? product.price ?? 0)}" data-field="salePrice" disabled></div></label>
          <label><span>Stock disponible</span><input type="number" min="0" step="1" value="${escapeHTML(product.stock ?? 0)}" data-field="stock" disabled></label>
          <label><span>Stock mínimo</span><input type="number" min="0" step="1" value="${escapeHTML(stockMin)}" data-field="stockMin" disabled></label>
          <label><span>Categoría</span><select data-field="category" disabled>${categoryOptions.map(([key,label])=>`<option value="${escapeHTML(key)}" ${product.category===key?'selected':''}>${escapeHTML(label)}</option>`).join('')}</select></label>
          <label><span>Marca</span><select data-field="brand" disabled><option value="">Sin marca</option>${brands.map(v=>`<option value="${escapeHTML(v)}" ${product.brand===v?'selected':''}>${escapeHTML(v)}</option>`).join('')}${product.brand && !brands.includes(product.brand) ? `<option value="${escapeHTML(product.brand)}" selected>${escapeHTML(product.brand)}</option>` : ''}</select></label>
          <label><span>Tipo de producto</span><select data-field="productType" disabled><option value="">Sin clasificación</option>${types.map(v=>`<option value="${escapeHTML(v)}" ${product.productType===v?'selected':''}>${escapeHTML(v)}</option>`).join('')}${product.productType && !types.includes(product.productType) ? `<option value="${escapeHTML(product.productType)}" selected>${escapeHTML(product.productType)}</option>` : ''}</select></label>
          <label class="inventory-tags-field"><span>Etiquetas / palabras clave <small>(opcional)</small></span><input type="text" value="${escapeHTML(tagText)}" data-field="tags" placeholder="Gaming, Xiaomi, 512GB…" disabled><small class="field-help">Sirven para encontrar el producto rápidamente con el buscador. Sepáralas con comas.</small></label>
          ${isCosplay ? `<label><span>Precio alquiler / día</span><div class="inventory-input-wrap"><span>$</span><input type="number" min="0" step="0.01" value="${escapeHTML(rentalValue)}" data-field="rentalPrice" disabled></div></label>` : ''}
          ${isCosplay ? `<label><span>Días de alquiler</span><input type="number" min="1" max="10" step="1" value="${escapeHTML(product.rentalDays ?? 1)}" data-field="rentalDays" disabled></label>` : ''}
        </div>

        <div class="inventory-edit-options">
          <label><input type="checkbox" data-field="published" ${product.published !== false ? 'checked' : ''} disabled> Publicado en web</label>
          ${product.category === 'tech' ? `<label><input type="checkbox" data-field="requiresDeviceIdentifier" ${requiresIdentifier ? 'checked' : ''} disabled> Requiere Serie / IMEI</label>` : ''}
          ${isCosplay ? `<label><input type="checkbox" data-field="isRental" ${isRental ? 'checked' : ''} disabled> Disponible para alquiler</label>` : ''}
        </div>

        <div class="inventory-image-status ${hasImages ? 'has-images' : 'missing-images'}"><span>${hasImages ? '✓' : '⚠'}</span><strong>${hasImages ? `${images.length} imagen${images.length === 1 ? '' : 'es'} cargada${images.length === 1 ? '' : 's'}` : 'SIN IMAGEN'}</strong>${!hasImages ? '<small>Agrega las fotos desde la ficha del producto cuando tengas tiempo.</small>' : ''}</div>

        <div class="inventory-record-actions">${inventoryReadOnly ? '<span class="inventory-readonly-note">Solo consulta · stock disponible</span>' : '<button class="button secondary small" type="button" data-inventory-edit>Editar ficha</button><button class="button primary small" type="button" data-inventory-save disabled>Guardar cambios</button><button class="button secondary small" type="button" data-inventory-cancel disabled>Cancelar</button><span class="message" data-inventory-message></span>'}</div>
      </div>
    </article>`;
  }).join('') : '<div class="empty">No hay productos registrados.</div>';

  return `<main class="admin-shell"><div class="admin-wrap">
    <div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route aria-label="YHORS · Panel Administrativo · Ir a YHORS Inteligente"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></a><h1 class="admin-title">Inventario</h1><p class="admin-subtitle">Control de costos, precios, existencias y clasificación</p></div><div class="admin-top-actions">${accountMenu(window.__yhorsSession || {})}</div></div>
    ${adminSectionNav({ role }, 'inventario')}
    <section class="admin-panel inventory-page-panel">
      <div class="inventory-workflow-card inventory-classifications-card">
        <div><span class="eyebrow">01 · Organización</span><h2>Clasificaciones</h2><p>Administra marcas y tipos de producto sin llenar la pantalla principal de Inventario.</p></div>
        <button class="button secondary small" type="button" id="openInventoryClassifications">Abrir clasificaciones →</button>
      </div>

      <section class="inventory-workflow-card inventory-registration-card">
        <div class="section-heading inventory-page-heading"><div><span class="eyebrow">02 · Inventario</span><h2>Inventario de productos</h2></div><div class="inventory-page-heading-actions"><p>Completa costos, precios, stock y clasificación. Las imágenes pueden agregarse después.</p><button class="button primary small inventory-add-product" type="button" id="inventoryAddProduct">+ Agregar nuevo producto</button></div></div>
      </section>

      <section class="inventory-workflow-card inventory-products-card">
        <div class="inventory-products-heading"><div><span class="eyebrow">03 · Registro</span><h2>Productos ya registrados</h2></div><span class="inventory-count inventory-count-large" id="inventoryPageCount">${products.length} productos</span></div>
        <div class="inventory-toolbar inventory-toolbar-extended">
          <label class="inventory-search"><span aria-hidden="true">⌕</span><input id="inventoryPageSearch" type="search" placeholder="Buscar por nombre, SKU, marca, tipo o etiqueta…" autocomplete="off"><button id="clearInventoryPageSearch" type="button" aria-label="Limpiar búsqueda">×</button></label>
          <label class="inventory-filter"><span>Tipo de producto</span><select id="inventoryPageTypeFilter"><option value="">Todos los tipos</option>${allValues('productTypes').map(v=>`<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join('')}</select></label>
          <label class="inventory-filter"><span>Marca</span><select id="inventoryPageBrandFilter"><option value="">Todas las marcas</option>${allValues('brands').map(v=>`<option value="${escapeHTML(v)}">${escapeHTML(v)}</option>`).join('')}</select></label>
          <label class="inventory-filter"><span>Categoría</span><select id="inventoryPageCategoryFilter"><option value="">Todas las categorías</option>${categoryOptions.map(([key,label])=>`<option value="${escapeHTML(key)}">${escapeHTML(label)}</option>`).join('')}</select></label>
        </div>
        <div id="inventoryPageList">${rows}</div>
      </section>
    </section>
    <div class="inventory-classification-modal" id="inventoryClassificationModal" hidden>
      <div class="inventory-classification-backdrop" data-close-inventory-classifications></div>
      <div class="inventory-classification-dialog" role="dialog" aria-modal="true" aria-labelledby="inventoryClassificationTitle">
        <div class="inventory-classification-dialog-head"><div><span class="eyebrow">01 · Organización</span><h2 id="inventoryClassificationTitle">Clasificaciones</h2><p>Marcas y tipos de producto, organizados por universo.</p></div><button type="button" class="product-image-picker-close" data-close-inventory-classifications aria-label="Cerrar">×</button></div>
        ${classificationPanel(classifications).replace('<section class="admin-panel classification-panel" id="classificationPanel">','<section class="classification-modal-content" id="classificationPanel">')}
      </div>
    </div>
  </div></main>`;
}

function flyerDraftKey() {
  return `yhors_flyer_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function catalogProductImage(product) {
  return productImages(product)[0] || placeholder;
}

function catalogSearchProductCard(product, selected = false) {
  const stock = Number(product.stock || 0);
  const price = money(product.salePrice ?? product.price ?? 0);
  return `<article class="catalog-search-card ${selected ? 'is-selected' : ''}" data-catalog-product="${escapeHTML(product.id)}" data-search-haystack="${escapeHTML(`${product.name||''} ${product.sku||''} ${product.brand||''} ${product.productType||''} ${categories[product.category]||product.category||''}`.toLowerCase())}">
    <label class="catalog-select-box" title="Seleccionar producto"><input type="checkbox" data-catalog-select value="${escapeHTML(product.id)}" ${selected ? 'checked' : ''}><span></span></label>
    <button type="button" class="catalog-copy-button" data-copy-sku="${escapeHTML(product.sku || '')}" title="Copiar SKU" aria-label="Copiar SKU">▣</button>
    <div class="catalog-search-image"><img src="${escapeHTML(catalogProductImage(product))}" data-fallback alt="${escapeHTML(product.name)}" loading="lazy"></div>
    <div class="catalog-search-body">
      <span class="catalog-search-kicker">${escapeHTML(product.brand || categories[product.category] || 'YHORS')}</span>
      <small>${escapeHTML(product.sku || 'SIN SKU')}</small>
      <h3>${escapeHTML(product.name)}</h3>
      ${product.productType ? `<span class="catalog-product-type">${escapeHTML(product.productType)}</span>` : ''}
      <div class="catalog-search-bottom"><strong>${price}</strong><span class="catalog-stock ${stock > 0 ? 'available' : 'empty'}">${stock > 0 ? `${stock} disponibles` : 'Sin stock'}</span></div>
    </div>
  </article>`;
}

function flyerProductHighlights(product) {
  const raw = String(product?.description || '').replace(/\r/g, '');
  if (!raw) return [];
  return raw.split(/\n|•|\s+-\s+/).map(x => x.replace(/^[-–—*]\s*/, '').trim()).filter(Boolean).slice(0, 5);
}

function flyerProductPreviewCard(product, index, draft, compact = false) {
  const highlights = flyerProductHighlights(product);
  const note = draft.notes?.[product.id] || '';
  return `<article class="flyer-product ${compact ? 'flyer-product-compact' : ''}">
    <div class="flyer-product-image"><img src="${escapeHTML(catalogProductImage(product))}" alt="${escapeHTML(product.name)}" loading="lazy"><span class="flyer-index">${String(index + 1).padStart(2,'0')}</span>${note ? `<span class="flyer-promo">${escapeHTML(note)}</span>` : ''}</div>
    <div class="flyer-product-copy">
      <span class="flyer-brand">${escapeHTML(product.brand || categories[product.category] || 'YHORS')}</span>
      <h2>${escapeHTML(product.name)}</h2>
      <div class="flyer-meta-line"><span>${escapeHTML(product.productType || categories[product.category] || 'Producto')}</span><span>SKU ${escapeHTML(product.sku || '—')}</span></div>
      ${highlights.length && !compact ? `<ul class="flyer-highlights">${highlights.map(x=>`<li>${escapeHTML(x)}</li>`).join('')}</ul>` : ''}
      ${draft.showPrices ? `<div class="flyer-product-bottom"><strong class="flyer-price">${money(product.salePrice ?? product.price ?? 0)}</strong></div>` : ''}
    </div>
  </article>`;
}

function flyerPreviewDraftFromModal(modal, selected) {
  const draft = {
    ids: selected.map(p=>String(p.id)),
    title: modal.querySelector('#flyerTitle')?.value.trim() || 'Recién Llegados',
    subtitle: modal.querySelector('#flyerSubtitle')?.value.trim() || '',
    description: modal.querySelector('#flyerDescription')?.value.trim() || '',
    layout: modal.querySelector('#flyerLayout')?.value || '4',
    orientation: modal.querySelector('#flyerOrientation')?.value || 'portrait',
    showPrices: !!modal.querySelector('#flyerShowPrices')?.checked,
    theme: modal.querySelector('#flyerTheme')?.value || 'none',
    accent: modal.querySelector('#flyerAccent')?.value || '#b58a43',
    logo: modal.querySelector('#flyerLogo')?.value || 'yhors',
    contact: !!modal.querySelector('#flyerContact')?.checked,
    contactName: modal.querySelector('#flyerContactName')?.value.trim() || '',
    notes: {}
  };
  modal.querySelectorAll('[data-flyer-note-row]').forEach(row=>{
    const input=row.querySelector('input');
    if(input?.value.trim()) draft.notes[row.dataset.flyerNoteRow]=input.value.trim();
  });
  return draft;
}

function flyerMiniPreview(products, draft) {
  const layout = String(draft.layout || '4');
  const cols = Math.max(1, Math.min(4, Number(layout)));
  const orientation = draft.orientation === 'landscape' ? 'landscape' : 'portrait';
  const shown = products.slice(0, layout === '1' ? 1 : 6);
  const extra = Math.max(0, products.length - shown.length);
  const card = (p, i, featured = false) => {
    const highlights = flyerProductHighlights(p).slice(0, 5);
    const note = draft.notes?.[p.id] || '';
    const cardClass = `flyer-preview-card ${featured ? 'is-featured' : ''} layout-card-${layout}`;
    return `<article class="${cardClass}">
      <div class="flyer-preview-card-image"><img src="${escapeHTML(catalogProductImage(p))}" alt="${escapeHTML(p.name || 'Producto')}" data-fallback><span class="flyer-index">${String(i + 1).padStart(2,'0')}</span>${note ? `<span class="flyer-promo">${escapeHTML(note)}</span>` : ''}</div>
      <div class="flyer-preview-card-info">
        <span class="flyer-brand">${escapeHTML(p.brand || categories[p.category] || 'YHORS')}</span>
        <h2>${escapeHTML(p.name || 'Producto')}</h2>
        <div class="flyer-meta-line"><span>${escapeHTML(p.productType || categories[p.category] || 'Producto')}</span><span>SKU ${escapeHTML(p.sku || '—')}</span></div>
        ${highlights.length ? `<ul>${highlights.map(x=>`<li>${escapeHTML(x)}</li>`).join('')}</ul>` : '<p class="flyer-preview-empty-desc">Información comercial disponible en el catálogo.</p>'}
        ${draft.showPrices ? `<div class="flyer-preview-price-row"><strong>${money(p.salePrice ?? p.price ?? 0)}</strong></div>` : ''}
      </div>
    </article>`;
  };
  let body = '';
  if (layout === '1') {
    const p = shown[0];
    body = p ? `<div class="flyer-preview-featured">${card(p,0,true)}</div>` : '';
  } else {
    body = `<div class="flyer-preview-products flyer-preview-layout-${layout}">${shown.map((p,i)=>card(p,i)).join('')}</div>`;
  }
  return `<div class="flyer-preview-page theme-${escapeHTML(draft.theme || 'none')} orientation-${orientation} layout-${layout}" style="--flyer-accent:${escapeHTML(draft.accent || '#b58a43')};--flyer-cols:${cols}">
    <header class="flyer-preview-header">
      ${draft.logo !== 'none' ? '<div class="flyer-preview-logo">YHORS<span>STORE</span></div>' : ''}
      <div><span class="eyebrow">YHORS · SELECCIÓN COMERCIAL</span><h1>${escapeHTML(draft.title || 'Recién Llegados')}</h1>${draft.subtitle ? `<p>${escapeHTML(draft.subtitle)}</p>` : ''}${draft.description ? `<small>${escapeHTML(draft.description)}</small>` : ''}</div>
    </header>
    ${body}
    ${extra ? `<div class="flyer-preview-more">+ ${extra} producto${extra===1?'':'s'} más</div>` : ''}
    <footer><span>YHORS · más que un producto</span><span>${products.length} producto${products.length===1?'':'s'} · ${orientation === 'landscape' ? 'A4 horizontal' : 'A4 vertical'}</span></footer>
  </div>`;
}

function flyerGeneratorModal(products = [], selectedIds = [], defaultContactName = '') {
  const selected = products.filter(p => selectedIds.includes(String(p.id)));
  const notes = selected.map(p => ({ id: p.id, note: '' }));
  return `<div class="flyer-modal" id="flyerModal" role="dialog" aria-modal="true" aria-labelledby="flyerModalTitle">
    <div class="flyer-modal-backdrop" data-flyer-close></div>
    <div class="flyer-modal-dialog flyer-designer-dialog">
      <div class="flyer-modal-head"><div><span class="eyebrow">Diseñador YHORS</span><h2 id="flyerModalTitle">Crear Flyer</h2><p>Diseña y revisa tu selección antes de abrir el flyer final.</p></div><button type="button" class="flyer-close" data-flyer-close aria-label="Cerrar">×</button></div>
      <div class="flyer-designer-body">
        <section class="flyer-controls">
          <div class="flyer-section-title"><span>01</span><div><strong>Contenido</strong><small>Define el mensaje principal</small></div></div>
          <div class="flyer-form-grid">
            <label><span>Título *</span><input id="flyerTitle" maxlength="90" value="Recién Llegados" placeholder="Ej: Nuevos productos"></label>
            <label><span>Subtítulo</span><input id="flyerSubtitle" maxlength="140" placeholder="Ej: Tecnología · Accesorios · Memorias & USB"></label>
          </div>
          <label><span>Descripción</span><textarea id="flyerDescription" rows="3" maxlength="280" placeholder="Una selección pensada para destacar.">Comercial enriquecida</textarea></label>

          <div class="flyer-section-title"><span>02</span><div><strong>Composición</strong><small>Elige cómo se presentan los productos</small></div></div>
          <div class="flyer-form-grid two">
            <label><span>Layout</span><select id="flyerLayout"><option value="4">Grid 4 · catálogo compacto</option><option value="3">Grid 3 · catálogo equilibrado</option><option value="2">Grid 2 · editorial grande</option><option value="1">Producto destacado · protagonista</option></select></label>
            <label><span>Orientación</span><select id="flyerOrientation"><option value="portrait">Vertical · A4</option><option value="landscape">Horizontal · A4</option></select></label>
            <label><span>Tema</span><select id="flyerTheme"><option value="none">YHORS Minimal</option><option value="editorial">Editorial</option><option value="luxury">Luxury</option><option value="midnight">Midnight</option></select></label>
          </div>
          <div class="flyer-toggle-row"><label class="flyer-check"><input id="flyerShowPrices" type="checkbox" checked><span>Mostrar precios</span></label><label class="flyer-check"><input id="flyerContact" type="checkbox"><span>Incluir contacto</span></label></div>
          <label id="flyerContactNameWrap" class="flyer-contact-field"><span>Nombre / contacto que aparecerá en el flyer</span><input id="flyerContactName" maxlength="100" value="${escapeHTML(defaultContactName)}" placeholder="Ej.: Juan Pérez · Ventas YHORS"></label>

          <div class="flyer-section-title"><span>03</span><div><strong>Identidad</strong><small>Colores y marca YHORS</small></div></div>
          <div class="flyer-color-row"><div><span>Color de acento</span><div class="flyer-swatches"><button type="button" class="flyer-swatch active" data-flyer-accent="#b58a43" style="--swatch:#b58a43" aria-label="Dorado"></button><button type="button" class="flyer-swatch" data-flyer-accent="#171513" style="--swatch:#171513" aria-label="Negro"></button><button type="button" class="flyer-swatch" data-flyer-accent="#2f67d8" style="--swatch:#2f67d8" aria-label="Azul"></button><button type="button" class="flyer-swatch" data-flyer-accent="#8d3bd8" style="--swatch:#8d3bd8" aria-label="Violeta"></button><button type="button" class="flyer-swatch" data-flyer-accent="#e85c12" style="--swatch:#e85c12" aria-label="Naranja"></button><button type="button" class="flyer-swatch" data-flyer-accent="#1b6f45" style="--swatch:#1b6f45" aria-label="Verde"></button></div></div><input type="hidden" id="flyerAccent" value="#b58a43"></div>
          <label><span>Logo en el encabezado</span><select id="flyerLogo"><option value="yhors">YHORS · marca principal</option><option value="none">Sin logo</option></select></label>

          <details class="flyer-notes"><summary>Notas promocionales por producto</summary><p>Opcional. Ej.: “10+1 GRATIS”, “Solo por hoy”, “Hasta agotar stock”.</p><div id="flyerNotesList">${notes.map(item => { const p=products.find(x=>String(x.id)===String(item.id)); return `<label data-flyer-note-row="${escapeHTML(item.id)}"><span>${escapeHTML(p?.name || 'Producto')}</span><input type="text" maxlength="80" placeholder="Texto promocional…"></label>`; }).join('')}</div></details>
        </section>
        <section class="flyer-live-preview">
          <div class="flyer-live-head"><div><span class="eyebrow">Vista previa</span><strong>Así se verá tu flyer</strong></div><span id="flyerPreviewCount">${selected.length} productos</span></div>
          <div id="flyerLivePreview" class="flyer-live-canvas"></div>
        </section>
      </div>
      <div class="flyer-modal-foot"><span><strong>${selected.length}</strong> producto${selected.length===1?'':'s'} seleccionado${selected.length===1?'':'s'}</span><div><button type="button" class="button secondary" data-flyer-close>Cancelar</button><button type="button" class="button primary" id="generateFlyerButton">Generar PDF ↗</button></div></div>
    </div>
  </div>`;
}

async function renderAdminCatalogSearch() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated: false }));
  if (!session.authenticated) return renderLogin();
  const products = await request('/api/admin/catalog-products').catch(() => []);
  const classifications = await request('/api/admin/classifications').catch(() => ({ brands: {}, productTypes: {} }));
  const brands = [...new Set(products.map(p => p.brand).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'es'));
  const categoryEntries = Object.entries(categories).filter(([key]) => key !== 'all');
  let selectedIds = new Set();
  const roleLabel = userRoleLabel(session.role || '');

  app.innerHTML = `<main class="admin-shell catalog-search-shell"><div class="admin-wrap catalog-search-wrap">
    <div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route aria-label="YHORS · Panel Administrativo · Ir a YHORS Inteligente"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></a><h1 class="admin-title">Buscar productos</h1></div><div class="admin-top-actions">${accountMenu(session)}</div></div>
    ${adminSectionNav(session, 'buscar-productos')}
    <section class="catalog-search-hero"><div><span class="eyebrow">Catálogo interno · ${escapeHTML(roleLabel)}</span><h2>Encuentra. Consulta. Selecciona.</h2><p>Precios de venta, stock, marca y datos comerciales en una sola vista. Disponible para vendedores, jefes y administradores.</p></div><div class="catalog-search-count"><strong id="catalogResultCount">0</strong><span>productos visibles</span></div></section>
    <section class="catalog-search-toolbar"><label class="catalog-main-search"><span>⌕</span><input id="catalogMainSearch" type="search" placeholder="Buscar por código, nombre, modelo o marca…" autocomplete="off"><button id="catalogClearSearch" type="button" aria-label="Limpiar">×</button></label><select id="catalogBrandFilter"><option value="">Todas las marcas</option>${brands.map(b=>`<option value="${escapeHTML(b)}">${escapeHTML(b)}</option>`).join('')}</select><select id="catalogCategoryFilter"><option value="">Todas las categorías</option>${categoryEntries.map(([k,v])=>`<option value="${escapeHTML(k)}">${escapeHTML(v)}</option>`).join('')}</select><select id="catalogStockFilter"><option value="">Todo el stock</option><option value="available">Disponibles</option><option value="empty">Sin stock</option></select><select id="catalogSort"><option value="name">Nombre A–Z</option><option value="price-asc">Precio menor</option><option value="price-desc">Precio mayor</option><option value="stock-desc">Mayor stock</option></select><button class="button secondary catalog-invert-button" id="catalogInvertButton" type="button">⇄ Invertir</button><button class="button secondary catalog-clear-selection" id="catalogClearSelection" type="button">⌫ Olvidar</button></section>
    <section class="catalog-search-meta"><div><span class="eyebrow">Selección para flyer</span><strong id="catalogSelectionCount">0 seleccionados</strong></div><button type="button" class="button secondary small catalog-create-flyer" id="catalogGenerateFlyer" disabled><span class="flyer-create-icon" aria-hidden="true">✧</span> Crear Flyer</button></section>
    <section class="catalog-search-grid" id="catalogSearchGrid"></section>
  </div></main>`;
  wireAccountMenu();

  const grid = document.querySelector('#catalogSearchGrid');
  const count = document.querySelector('#catalogResultCount');
  const selectionCount = document.querySelector('#catalogSelectionCount');
  const flyerButton = document.querySelector('#catalogGenerateFlyer');
  const searchInput = document.querySelector('#catalogMainSearch');
  const brandFilter = document.querySelector('#catalogBrandFilter');
  const categoryFilter = document.querySelector('#catalogCategoryFilter');
  const stockFilter = document.querySelector('#catalogStockFilter');
  const sortSelect = document.querySelector('#catalogSort');

  const getFiltered = () => {
    const q = (searchInput?.value || '').trim().toLowerCase();
    const brand = brandFilter?.value || '';
    const category = categoryFilter?.value || '';
    const stock = stockFilter?.value || '';
    const rows = products.filter(p => {
      const hay = `${p.name||''} ${p.sku||''} ${p.brand||''} ${p.productType||''} ${categories[p.category]||p.category||''}`.toLowerCase();
      return (!q || hay.includes(q)) && (!brand || p.brand === brand) && (!category || p.category === category) && (!stock || (stock === 'available' ? Number(p.stock||0)>0 : Number(p.stock||0)<=0));
    });
    const sort = sortSelect?.value || 'name';
    rows.sort((a,b) => sort === 'price-asc' ? Number(a.salePrice||0)-Number(b.salePrice||0) : sort === 'price-desc' ? Number(b.salePrice||0)-Number(a.salePrice||0) : sort === 'stock-desc' ? Number(b.stock||0)-Number(a.stock||0) : String(a.name||'').localeCompare(String(b.name||''),'es',{sensitivity:'base'}));
    return rows;
  };
  const updateSelectionUi = () => { const n=selectedIds.size; selectionCount.textContent=`${n} seleccionado${n===1?'':'s'}`; flyerButton.disabled=!n; };
  const draw = () => {
    const rows=getFiltered(); count.textContent=rows.length; grid.innerHTML=rows.length ? rows.map(p=>catalogSearchProductCard(p,selectedIds.has(String(p.id)))).join('') : `<div class="catalog-search-empty"><span>⌕</span><h3>No encontramos productos</h3><p>Prueba otro código, nombre, marca o filtro.</p></div>`;
    wireImageFallback(grid); updateSelectionUi();
    grid.querySelectorAll('[data-catalog-select]').forEach(input=>input.addEventListener('change',()=>{const id=String(input.value); if(input.checked) selectedIds.add(id); else selectedIds.delete(id); input.closest('.catalog-search-card')?.classList.toggle('is-selected',input.checked); updateSelectionUi();}));
    grid.querySelectorAll('[data-copy-sku]').forEach(button=>button.addEventListener('click',async()=>{const sku=button.dataset.copySku||''; if(!sku)return; try{await navigator.clipboard.writeText(sku); button.textContent='✓'; setTimeout(()=>button.textContent='▣',700);}catch(_){}}));
  };
  const flyerImageAsDataUrl = async (url) => {
    const source = String(url || '').trim();
    if (!source || source.startsWith('data:image/')) return source || '';
    const candidates = [
      `https://wsrv.nl/?url=${encodeURIComponent(source)}&output=jpg&q=84&w=1200`,
      source
    ];
    for (const candidate of candidates) {
      try {
        const response = await fetch(candidate, { mode: 'cors', credentials: 'omit', cache: 'force-cache' });
        if (!response.ok) continue;
        const blob = await response.blob();
        if (!blob.type.startsWith('image/') || !blob.size) continue;
        const reader = new FileReader();
        const data = await new Promise((resolve, reject) => { reader.onload=()=>resolve(reader.result); reader.onerror=reject; reader.readAsDataURL(blob); });
        if (typeof data === 'string' && data.startsWith('data:image/')) return data;
      } catch (_) {}
    }
    // Last browser-native attempt: an already renderable image can sometimes be
    // read when the host explicitly permits CORS.
    try {
      const img = new Image(); img.crossOrigin = 'anonymous';
      const loaded = new Promise((resolve, reject) => { img.onload=resolve; img.onerror=reject; });
      img.src = source; await loaded;
      const max = 1200, scale = Math.min(1, max / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
      const canvas=document.createElement('canvas'); canvas.width=Math.max(1,Math.round((img.naturalWidth||1)*scale)); canvas.height=Math.max(1,Math.round((img.naturalHeight||1)*scale));
      const ctx=canvas.getContext('2d'); ctx.drawImage(img,0,0,canvas.width,canvas.height);
      return canvas.toDataURL('image/jpeg',.84);
    } catch (_) { return ''; }
  };

  const prepareFlyerImages = async (selected) => {
    const map = {};
    await Promise.all(selected.map(async p => {
      const url = catalogProductImage(p);
      const data = await flyerImageAsDataUrl(url);
      if (data) map[String(p.id)] = data;
    }));
    return map;
  };

  const openFlyer = () => {
    if (!selectedIds.size) return;
    const selected = products.filter(p=>selectedIds.has(String(p.id)));
    document.querySelector('#flyerModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', flyerGeneratorModal(products, selected.map(p=>String(p.id)), session.username || ''));
    const modal=document.querySelector('#flyerModal');
    const close=()=>{modal?.remove();document.body.classList.remove('no-scroll');};
    modal?.querySelectorAll('[data-flyer-close]').forEach(el=>el.addEventListener('click',close));
    document.body.classList.add('no-scroll');
    const refreshPreview = () => {
      const draft = flyerPreviewDraftFromModal(modal, selected);
      const preview = modal?.querySelector('#flyerLivePreview');
      if (preview) preview.innerHTML = flyerMiniPreview(selected, draft);
      const countEl = modal?.querySelector('#flyerPreviewCount');
      if (countEl) countEl.textContent = `${selected.length} producto${selected.length===1?'':'s'}`;
      const contactField = modal?.querySelector('#flyerContactNameWrap');
      if (contactField) contactField.classList.toggle('is-muted', !draft.contact);
      wireImageFallback(preview);
    };
    modal?.querySelectorAll('[data-flyer-accent]').forEach(btn=>btn.addEventListener('click',()=>{modal.querySelectorAll('.flyer-swatch').forEach(x=>x.classList.remove('active'));btn.classList.add('active');modal.querySelector('#flyerAccent').value=btn.dataset.flyerAccent;refreshPreview();}));
    modal?.querySelectorAll('input,select,textarea').forEach(el=>el.addEventListener(el.type==='text'||el.tagName==='TEXTAREA'?'input':'change',refreshPreview));
    refreshPreview();
    modal?.querySelector('#generateFlyerButton')?.addEventListener('click',async()=>{
      const button = modal.querySelector('#generateFlyerButton');
      const draft=flyerPreviewDraftFromModal(modal, selected);
      const targetName = `yhors_flyer_pdf_${Date.now()}`;
      const tab=window.open('about:blank', targetName);
      if(!tab){ alert('Permite las ventanas emergentes para abrir el PDF en una pestaña nueva.'); return; }
      // The PDF can take a few seconds because the selected product images may
      // need to be downloaded and converted. Never leave the user staring at
      // a blank about:blank tab while that work is happening.
      try {
        tab.document.open();
        tab.document.write('<!doctype html><html><head><title>YHORS · Generando PDF</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#eeece6;color:#171513;font-family:Arial,Helvetica,sans-serif}.loader{width:min(460px,calc(100vw - 40px));background:#fff;border:1px solid #ddd8cf;border-radius:18px;padding:36px;text-align:center;box-shadow:0 18px 60px rgba(30,25,20,.12)}.mark{width:58px;height:58px;margin:0 auto 20px;border:3px solid #e5e0d7;border-top-color:#b58a43;border-radius:50%;animation:spin 1s linear infinite}.eyebrow{font-size:11px;font-weight:800;letter-spacing:.18em;color:#b58a43;text-transform:uppercase}.loader h1{font-size:24px;margin:10px 0 8px}.loader p{margin:0;color:#6d675f;line-height:1.55}.status{margin-top:20px;padding-top:16px;border-top:1px solid #eee9e1;font-size:12px;color:#8a837a}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><main class="loader"><div class="mark"></div><div class="eyebrow">YHORS · FLYER</div><h1>Generando tu PDF…</h1><p>Estamos preparando las imágenes y armando el diseño. Esta pestaña permanecerá abierta mientras termina.</p><div class="status" id="status">Preparando productos…</div></main></body></html>');
        tab.document.close();
      } catch (_) {}
      button.disabled=true;
      button.innerHTML='<span class="flyer-create-icon" aria-hidden="true">◌</span> Generando PDF…';
      try {
        try { if(tab.document?.getElementById('status')) tab.document.getElementById('status').textContent='Cargando imágenes del flyer…'; } catch (_) {}
        const imageData = await prepareFlyerImages(selected);
        try { if(tab.document?.getElementById('status')) tab.document.getElementById('status').textContent='Diseñando páginas y generando PDF…'; } catch (_) {}
        const payload={...draft, ids:selected.map(p=>String(p.id)), imageData};
        const body=new URLSearchParams();
        Object.entries(payload).forEach(([key,value])=>body.set(key, typeof value==='object' ? JSON.stringify(value) : String(value ?? '')));
        const response=await fetch('/api/admin/flyers/pdf',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},body});
        if(!response.ok) {
          let message='No se pudo generar el PDF.';
          try { const data=await response.json(); message=data.error||message; } catch (_) {}
          throw new Error(message);
        }
        const blob=await response.blob();
        if(!blob.size) throw new Error('El PDF generado está vacío.');
        const url=URL.createObjectURL(blob);
        tab.location.replace(url);
        setTimeout(()=>URL.revokeObjectURL(url),120000);
        setTimeout(()=>close(),250);
      } catch(error) {
        tab.document.open();
        tab.document.write('<!doctype html><html><head><title>Error generando flyer</title><style>body{font-family:Arial,sans-serif;padding:40px;background:#f7f5f1;color:#171513}main{max-width:680px;margin:10vh auto;background:#fff;padding:32px;border-radius:16px;border:1px solid #ddd8cf}h1{margin-top:0}p{color:#625d56}</style></head><body><main><h1>No se pudo generar el PDF</h1><p>'+escapeHTML(error?.message||'Ocurrió un error inesperado.')+'</p><p>Cierra esta pestaña y vuelve a intentarlo.</p></main></body></html>');
        tab.document.close();
        button.disabled=false;
        button.innerHTML='<span class="flyer-create-icon" aria-hidden="true">✧</span> Generar PDF ↗';
      }
    });
  };
  flyerButton.addEventListener('click',openFlyer);
  document.querySelector('#catalogInvertButton')?.addEventListener('click',()=>{getFiltered().forEach(p=>{const id=String(p.id); if(selectedIds.has(id)) selectedIds.delete(id); else selectedIds.add(id);}); draw();});
  document.querySelector('#catalogClearSelection')?.addEventListener('click',()=>{selectedIds.clear(); draw();});
  [searchInput,brandFilter,categoryFilter,stockFilter,sortSelect].forEach(el=>el?.addEventListener(el===searchInput?'input':'change',draw));
  document.querySelector('#catalogClearSearch')?.addEventListener('click',()=>{searchInput.value='';draw();searchInput.focus();});
  document.addEventListener('keydown', event => { if(event.key==='Escape' && document.querySelector('#flyerModal')) document.querySelector('#flyerModal')?.remove(); });
  draw();
}

async function renderFlyerPreview() {
  const params = new URLSearchParams(window.location.search);
  const key = params.get('draft') || '';
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) {}
  if (!draft) { app.innerHTML='<main class="flyer-missing"><h1>Flyer no encontrado</h1><p>Genera nuevamente el flyer desde Buscar Productos.</p></main>'; return; }

  // The draft carries a product snapshot so the generated tab does not depend on a second API call/auth race.
  let products = Array.isArray(draft.products) ? draft.products : [];
  if (!products.length && Array.isArray(draft.ids)) {
    products = await request('/api/admin/catalog-products').catch(() => []);
    products = draft.ids.map(id => products.find(p=>String(p.id)===String(id))).filter(Boolean);
  }
  const session = draft.contact ? await request('/api/admin/session').catch(() => ({ username: '', name: '' })) : null;
  const selected = products;
  const accent = draft.accent || '#b58a43';
  const columns = Math.max(1, Math.min(4, Number(draft.layout || 4)));
  const layout = String(draft.layout || '4');
  const theme = draft.theme || 'none';
  const orientation = draft.orientation === 'landscape' ? 'landscape' : 'portrait';
  const logo = draft.logo !== 'none';
  const contact = draft.contact ? `<div class="flyer-contact"><strong>${escapeHTML(session?.name || session?.username || 'Equipo YHORS')}</strong><span>${escapeHTML(session?.username || '')}</span></div>` : '';
  const pages = [];
  let perPage = orientation === 'landscape' ? (layout === '1' ? 1 : layout === '2' ? 4 : layout === '3' ? 6 : 8) : (layout === '1' ? 1 : layout === '2' ? 4 : layout === '3' ? 6 : 8);
  if (layout === '1' && selected.length > 1) perPage = orientation === 'landscape' ? 2 : 1;
  for (let i=0;i<selected.length;i+=perPage) pages.push(selected.slice(i,i+perPage));
  if (!pages.length) pages.push([]);
  const pagesMarkup = pages.map((page,pageIndex)=>{
    let productsMarkup;
    if (layout === '1') {
      productsMarkup = page.map((p,idx)=>`<div class="flyer-featured-wrap">${flyerProductPreviewCard(p, pageIndex*perPage+idx, draft, false)}</div>`).join('');
    } else {
      productsMarkup = page.map((p,idx)=>flyerProductPreviewCard(p,pageIndex*perPage+idx,draft,false)).join('');
    }
    return `<section class="flyer-sheet orientation-${orientation} layout-${layout} ${pageIndex===0?'flyer-cover-sheet':''}">
      <header class="flyer-header">
        ${logo ? `<div class="flyer-logo">YHORS<span>STORE</span></div>` : ''}
        <div class="flyer-header-copy"><span class="eyebrow">YHORS · SELECCIÓN COMERCIAL</span><h1>${escapeHTML(draft.title || 'Recién Llegados')}</h1>${draft.subtitle ? `<p class="flyer-subtitle">${escapeHTML(draft.subtitle)}</p>` : ''}${draft.description ? `<p class="flyer-description">${escapeHTML(draft.description)}</p>` : ''}</div>
        <div class="flyer-date">${new Intl.DateTimeFormat('es-EC',{dateStyle:'medium'}).format(new Date())}<small>Página ${pageIndex+1} / ${pages.length}</small></div>
      </header>
      <div class="flyer-products flyer-products-layout-${layout}" style="--flyer-cols:${columns}">${productsMarkup}</div>
      <footer class="flyer-footer"><span>YHORS · más que un producto</span>${contact}</footer>
    </section>`;
  }).join('');

  app.innerHTML=`<main class="flyer-page theme-${escapeHTML(theme)} orientation-${orientation}" style="--flyer-accent:${escapeHTML(accent)};--flyer-cols:${columns}">
    <div class="flyer-toolbar no-print"><div><span class="eyebrow">Flyer generado</span><strong>${escapeHTML(draft.title || 'Recién Llegados')}</strong><small>${selected.length} producto${selected.length===1?'':'s'} · ${pages.length} página${pages.length===1?'':'s'} · A4 ${orientation === 'landscape' ? 'horizontal' : 'vertical'}</small></div><div><button type="button" class="button secondary" id="flyerBack">← Volver al catálogo</button><button type="button" class="button primary" id="flyerPdf">Guardar / PDF</button></div></div>
    <div class="flyer-generated-wrap">${pagesMarkup}</div>
  </main>`;
  document.querySelector('#flyerPdf')?.addEventListener('click',()=>window.print());
  document.querySelector('#flyerBack')?.addEventListener('click',()=>{ window.location.href=`${ADMIN_PATH}/buscar-productos`; });
  wireImageFallback(document.querySelector('.flyer-page'));
}

function openInventoryNewProductModal({ classifications, product = null, onSaved }) {
  document.querySelector('#inventoryNewProductModal')?.remove();
  document.querySelector('#productImagePickerModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'inventoryNewProductModal';
  modal.className = 'inventory-new-product-modal';
  const editingProduct = Boolean(product?.id);
  modal.innerHTML = `<div class="inventory-new-product-backdrop" data-inventory-new-close></div><div class="inventory-new-product-dialog" role="dialog" aria-modal="true" aria-labelledby="inventoryNewProductTitle"><div class="inventory-new-product-head"><div><span class="eyebrow">INVENTARIO · ${editingProduct ? 'EDITAR PRODUCTO' : 'NUEVO PRODUCTO'}</span><h2 id="inventoryNewProductTitle">${editingProduct ? 'Editar producto' : 'Agregar nuevo producto'}</h2><small>Completa la ficha comercial, existencias y las imágenes sin salir de Inventario.</small></div><button type="button" class="product-image-picker-close" data-inventory-new-close aria-label="Cerrar">×</button></div><div id="inventoryNewProductFormArea"></div></div>`;
  document.body.appendChild(modal);
  const area = modal.querySelector('#inventoryNewProductFormArea');
  let draft = product ? { ...product } : {};
  const close = () => { document.querySelector('#productImagePickerModal')?.remove(); modal.remove(); };
  const draw = () => {
    area.innerHTML = productForm(draft, classifications);
    wireImageFallback(area);
    area.querySelectorAll('[data-open-image-picker]').forEach(button => {
      button.disabled = false;
      button.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation();
        const slot = Number(button.dataset.openImagePicker || 1);
        const fieldId = slot === 1 ? '#image' : `#image${slot}`;
        const current = area.querySelector(fieldId)?.value || '';
        openProductImagePicker(slot, current, ({ file, url, preview }) => {
          const field = area.querySelector(fieldId); const imagePreview = area.querySelector(`#productImagePreview${slot}`);
          if (field) field.value = url || '';
          window.__yhorsPendingImageFiles ||= {};
          if (file) window.__yhorsPendingImageFiles[slot] = file; else delete window.__yhorsPendingImageFiles[slot];
          if (imagePreview) imagePreview.src = preview || placeholder;
          const box = button.closest('.product-image-slot');
          box?.querySelector('small')?.replaceChildren(document.createTextNode(file ? 'Archivo seleccionado · se subirá al guardar' : (url ? 'Imagen cargada por enlace' : 'Sin imagen · puedes agregarla después')));
          box?.querySelector('.product-image-slot-preview')?.classList.toggle('has-image', Boolean(file || url));
        });
      });
    });
    area.querySelector('#category')?.addEventListener('change', e => { draft = { ...draft, category: e.target.value }; draw(); });
    const editor = area.querySelector('#descriptionEditor');
    const hidden = area.querySelector('#description');
    // En edición, NO volvemos a serializar la descripción solo por guardar
    // precio, stock, imágenes, etc. Eso era lo que convertía las listas y
    // saltos de línea en texto corrido al volver a cargar el producto.
    const originalDescription = String(product?.description || '');
    let descriptionDirty = false;
    const markDescriptionDirty = () => {
      descriptionDirty = true;
      if (hidden && editor) hidden.value = editor.innerHTML.trim();
    };
    editor?.addEventListener('input', markDescriptionDirty);
    area.querySelectorAll('[data-rich-command]').forEach(button => button.addEventListener('click', () => {
      if (!editor || editor.getAttribute('contenteditable') !== 'true') return;
      editor.focus();
      document.execCommand(button.dataset.richCommand, false, button.dataset.richValue || null);
      markDescriptionDirty();
    }));
    // Cancelar en "Editar ficha" debe cerrar el modal, no volver a abrirlo
    // ni dejar la pantalla bloqueada.
    area.querySelector('#cancelEdit')?.addEventListener('click', event => {
      event.preventDefault();
      close();
    });
    area.querySelector('#productForm')?.addEventListener('submit', async e => {
      e.preventDefault(); const form=e.currentTarget; const msg=area.querySelector('#formMessage'); const submit=form.querySelector('[type="submit"]');
      if (!form.elements.category.value) { msg.className='message error'; msg.textContent='Selecciona una categoría antes de guardar.'; return; }
      if (!form.elements.name.value.trim() || !form.elements.sku.value.trim()) { msg.className='message error'; msg.textContent='Completa nombre y SKU.'; return; }
      const salePrice=Number(form.elements.salePrice.value), purchasePrice=Number(form.elements.purchasePrice?.value||0), stock=Number(form.elements.stock?.value||0), stockMin=Number(form.elements.stockMin?.value||0);
      if (!Number.isFinite(salePrice)||salePrice<0||!Number.isFinite(purchasePrice)||purchasePrice<0||!Number.isInteger(stock)||stock<0||!Number.isInteger(stockMin)||stockMin<0) { msg.className='message error'; msg.textContent='Revisa precios, stock y stock mínimo.'; return; }
      const confirmed=await showYhorsConfirm(editingProduct?'¿Guardar los cambios?':'¿Crear este producto?',editingProduct?`Se actualizará <strong>${escapeHTML(product.name)}</strong> con la nueva ficha e imágenes.`:'Se registrará el producto en YHORS con la ficha que acabas de completar.'); if(!confirmed)return;
      submit.disabled=true; msg.textContent='Guardando…';
      try {
        // Si la descripción existente no fue tocada, conserva exactamente
        // el HTML original guardado. Solo usamos el contenido del editor cuando
        // el usuario realmente modificó la descripción.
        if (hidden) {
          hidden.value = editingProduct && !descriptionDirty
            ? originalDescription
            : (editor?.innerHTML?.trim() || hidden.value || '');
        }
        const data=Object.fromEntries(new FormData(form).entries());
        data.published=form.elements.published?form.elements.published.checked:true; data.requiresDeviceIdentifier=form.elements.requiresDeviceIdentifier?form.elements.requiresDeviceIdentifier.checked:false; data.isRental=form.elements.isRental?form.elements.isRental.checked:false; data.featured=Boolean(product?.featured); data.hero=Boolean(product?.hero); data.price=data.salePrice; data.purchasePrice=purchasePrice; data.stock=stock; data.stockMin=stockMin; data.tags=String(form.elements.tags?.value||'').split(',').map(v=>v.trim()).filter(Boolean).slice(0,30); data.images=[data.image,data.image2,data.image3,data.image4].filter(Boolean);
        const pending=window.__yhorsPendingImageFiles||{};
        for(let slot=1;slot<=4;slot++){const file=pending[slot];if(!file)continue;const fd=new FormData();fd.append('image',file);const uploaded=await request('/api/admin/upload',{method:'POST',body:fd});const key=slot===1?'image':`image${slot}`;data[key]=uploaded.image;data.images[slot-1]=uploaded.image;}
        data.images=data.images.filter(Boolean); data.image=data.images[0]||'';
        const url=editingProduct?`/api/admin/products/${encodeURIComponent(product.id)}`:'/api/admin/products';
        const saved=await request(url,{method:editingProduct?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
        window.__yhorsPendingImageFiles={}; await onSaved?.(saved); close();
      } catch(err){submit.disabled=false;msg.className='message error';msg.textContent=err.message||'No se pudo guardar el producto.';}
    });
  };
  modal.querySelectorAll('[data-inventory-new-close]').forEach(b=>b.addEventListener('click',close));
  window.__yhorsPendingImageFiles={}; draw();
}

async function renderAdminInventory() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated: false }));
  if (!session.authenticated) return renderLogin();
  if (session.role !== 'admin') return renderAdminOrders();
  window.__yhorsSession = session;
  const inventoryReadOnly = false;
  let products = await request('/api/admin/products').catch(() => []);
  const classifications = await request('/api/admin/classifications').catch(() => ({ brands: {}, productTypes: {} }));
  const fields = ['name','sku','brand','productType','category','purchasePrice','salePrice','rentalPrice','stock','image','description','featured','hero','heroOrder'];
  const draw = () => {
    const query = (document.querySelector('#inventoryPageSearch')?.value || '').trim().toLowerCase();
    const categoryFilter = document.querySelector('#inventoryPageCategoryFilter')?.value || '';
    const typeFilter = document.querySelector('#inventoryPageTypeFilter')?.value || '';
    const brandFilter = document.querySelector('#inventoryPageBrandFilter')?.value || '';
    const matches = products.filter(p => {
      const haystack = [p.name, p.sku, p.brand, p.productType, p.category, categories[p.category], ...(Array.isArray(p.tags) ? p.tags : [])].filter(Boolean).join(' ').toLowerCase();
      const matchesQuery = !query || haystack.includes(query);
      const matchesCategory = !categoryFilter || p.category === categoryFilter;
      const matchesType = !typeFilter || p.productType === typeFilter;
      const matchesBrand = !brandFilter || p.brand === brandFilter;
      return matchesQuery && matchesCategory && matchesType && matchesBrand;
    });
    const count = document.querySelector('#inventoryPageCount');
    const filtered = Boolean(query || categoryFilter || typeFilter || brandFilter);
    if (count) count.textContent = filtered ? `${matches.length} de ${products.length} productos` : `${products.length} productos`;
    const list = document.querySelector('#inventoryPageList');
    if (!list) return;
    const inventoryMarkup = inventoryPageMarkup(matches, { readOnly: inventoryReadOnly, role: session.role, classifications });
    const inventoryTemplate = document.createElement('template');
    inventoryTemplate.innerHTML = inventoryMarkup.trim();
    const inventoryList = inventoryTemplate.content.querySelector('#inventoryPageList');
    list.innerHTML = inventoryList ? inventoryList.innerHTML : '<div class="empty">No hay productos.</div>';
    wireImageFallback(list);

    const refreshProfit = record => {
      const buy = Number(record.querySelector('[data-field="purchasePrice"]')?.value || 0);
      const sale = Number(record.querySelector('[data-field="salePrice"]')?.value || 0);
      const diff = sale - buy;
      const badge = record.querySelector('[data-profit-badge]');
      if (badge) {
        badge.classList.toggle('profit-positive', diff >= 0);
        badge.classList.toggle('profit-negative', diff < 0);
        badge.textContent = `${diff >= 0 ? 'Ganancia' : 'Pérdida'}: ${money(Math.abs(diff))}`;
      }
    };

    list.querySelectorAll('.inventory-record').forEach(record => {
      record.querySelectorAll('[data-field="purchasePrice"],[data-field="salePrice"]').forEach(input => input.addEventListener('input', () => refreshProfit(record)));
      record.querySelector('[data-inventory-edit]')?.addEventListener('click', () => {
        const product = products.find(p => p.id === record.dataset.inventoryId);
        if (!product) return;
        openInventoryNewProductModal({ classifications, product, onSaved: async updated => {
          products = products.map(p => p.id === updated.id ? updated : p);
          draw();
        }});
      });
      record.querySelector('[data-inventory-cancel]')?.addEventListener('click', () => draw());
      record.querySelector('[data-inventory-save]')?.addEventListener('click', async () => {
        const product = products.find(p => p.id === record.dataset.inventoryId);
        if (!product) return;
        const get = key => record.querySelector(`[data-field="${key}"]`);
        const purchasePrice = Number(get('purchasePrice')?.value);
        const salePrice = Number(get('salePrice')?.value);
        const nextCategory = get('category')?.value || product.category;
        const nextBrand = get('brand')?.value || '';
        const nextProductType = get('productType')?.value || '';
        const rentalRaw = get('rentalPrice')?.value;
        const rentalPrice = nextCategory === 'cosplay'
          ? (rentalRaw === '' || rentalRaw == null ? null : Number(rentalRaw))
          : null;
        const rentalDays = nextCategory === 'cosplay' ? Math.max(1, Math.min(10, Number(get('rentalDays')?.value || 1))) : null;
        const stock = Number(get('stock')?.value);
        const stockMin = Number(get('stockMin')?.value || 0);
        const tags = String(get('tags')?.value || '').split(',').map(v => v.trim()).filter(Boolean).slice(0, 30);
        const published = Boolean(get('published')?.checked);
        const requiresDeviceIdentifier = nextCategory === 'tech' ? Boolean(get('requiresDeviceIdentifier')?.checked) : false;
        const isRental = nextCategory === 'cosplay' ? Boolean(get('isRental')?.checked) : false;
        const payload = { purchasePrice, salePrice, stock, stockMin, category: nextCategory, brand: nextBrand, productType: nextProductType, tags, published, requiresDeviceIdentifier, isRental, rentalDays };
        if (nextCategory === 'cosplay') payload.rentalPrice = isRental ? rentalPrice : null;

        if (!Number.isFinite(salePrice) || salePrice < 0 ||
            !Number.isFinite(purchasePrice) || purchasePrice < 0 ||
            !Number.isInteger(stock) || stock < 0 || !Number.isInteger(stockMin) || stockMin < 0 ||
            (nextCategory === 'cosplay' && isRental && (rentalPrice === null || !Number.isFinite(rentalPrice) || rentalPrice < 0))) {
          const msg=record.querySelector('[data-inventory-message]'); msg.className='message error'; msg.textContent='Revisa precio de compra, precio de venta y stock.'; return;
        }

        const confirmed = await showYhorsConfirm(
          '¿Seguro que quieres guardar este cambio?',
          `Se actualizarán inventario, clasificación, etiquetas y publicación de <strong>${escapeHTML(product.name)}</strong>.`
        );
        if (!confirmed) return;
        const button = record.querySelector('[data-inventory-save]'); button.disabled = true;
        try {
          const updated = await request(`/api/admin/inventory/${encodeURIComponent(product.id)}`, { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload) });
          products = products.map(p => p.id === updated.id ? updated : p);
          showSaveSuccess(record.querySelector('[data-inventory-message]'), 'Cambios guardados correctamente.');
          draw();
        } catch(e) {
          button.disabled = false;
          const msg=record.querySelector('[data-inventory-message]'); msg.className='message error'; msg.textContent=e.message || 'No se pudieron guardar los cambios.';
        }
      });
    });
  };
  app.innerHTML = inventoryPageMarkup(products, { readOnly: inventoryReadOnly, role: session.role, classifications });

  const renderInventoryClassifications = () => {
    const render = (target, values, type) => {
      const container = document.querySelector(target);
      if (!container) return;
      container.innerHTML = Object.entries(values || {}).filter(([, list]) => Array.isArray(list) && list.length).map(([cat, list]) => `<div class="classification-group"><strong>${escapeHTML(categories[cat])}</strong><div class="classification-chips">${list.map((v,i)=>`<span class="classification-chip"><span class="classification-chip-text">${escapeHTML(v)}</span><button type="button" class="classification-edit" data-edit-class="${type}" data-category="${escapeHTML(cat)}" data-index="${i}" title="Editar">✎</button><button type="button" class="classification-delete" data-remove-class="${type}" data-category="${escapeHTML(cat)}" data-index="${i}" title="Eliminar">×</button></span>`).join('')}</div></div>`).join('') || '<small class="field-help">Todavía no hay clasificaciones.</small>';
      container.querySelectorAll('[data-remove-class]').forEach(btn => btn.addEventListener('click', async () => { classifications[btn.dataset.removeClass][btn.dataset.category].splice(Number(btn.dataset.index), 1); await saveInventoryClassifications(); }));
      container.querySelectorAll('[data-edit-class]').forEach(btn => btn.addEventListener('click', async () => {
        const key=btn.dataset.editClass, cat=btn.dataset.category, index=Number(btn.dataset.index), current=classifications[key]?.[cat]?.[index] || '';
        const value=window.prompt('Editar clasificación:', current); if (value === null) return;
        const clean=value.trim().slice(0,50); if (!clean) return;
        if (classifications[key][cat].some((v,i)=>i!==index && v.toLowerCase()===clean.toLowerCase())) { alert('Ya existe una clasificación con ese nombre en esta categoría.'); return; }
        classifications[key][cat][index]=clean; await saveInventoryClassifications();
      }));
    };
    render('#brandLists', classifications.brands, 'brands'); render('#typeLists', classifications.productTypes, 'productTypes');
  };
  const saveInventoryClassifications = async () => {
    const confirmed = await showYhorsConfirm('¿Seguro que quieres guardar este cambio?', 'Se actualizarán las clasificaciones del catálogo.');
    if (!confirmed) { const fresh=await request('/api/admin/classifications').catch(()=>classifications); classifications.brands=fresh.brands||{}; classifications.productTypes=fresh.productTypes||{}; renderInventoryClassifications(); return false; }
    try {
      const saved=await request('/api/admin/classifications',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(classifications)});
      classifications.brands=saved.brands||{}; classifications.productTypes=saved.productTypes||{}; renderInventoryClassifications(); draw();
      const message=document.querySelector('#classificationMessage'); if(message){message.className='message success';message.textContent='✓ Clasificaciones guardadas.';}
      return true;
    } catch(e) { const message=document.querySelector('#classificationMessage'); if(message){message.className='message error';message.textContent=e.message;} return false; }
  };
  const bindInventoryClassificationEvents = () => {
    const bind=(buttonId,inputId,selectId,key)=>document.querySelector(buttonId)?.addEventListener('click',async()=>{
      const input=document.querySelector(inputId), cat=document.querySelector(selectId)?.value, value=input?.value.trim(); if(!value||!cat)return;
      classifications[key][cat] ||= [];
      if(!classifications[key][cat].some(v=>v.toLowerCase()===value.toLowerCase())) { classifications[key][cat].push(value); if(input) input.value=''; await saveInventoryClassifications(); }
    });
    bind('#addBrand','#newBrand','#classBrandCategory','brands'); bind('#addType','#newType','#classTypeCategory','productTypes');
  };
  renderInventoryClassifications();
  bindInventoryClassificationEvents();
  const classificationModal = document.querySelector('#inventoryClassificationModal');
  const closeClassificationModal = () => { if (!classificationModal) return; classificationModal.classList.remove('is-open'); document.body.classList.remove('generate-modal-open'); setTimeout(() => { classificationModal.hidden = true; }, 180); };
  document.querySelector('#openInventoryClassifications')?.addEventListener('click', () => { if (!classificationModal) return; classificationModal.hidden = false; requestAnimationFrame(() => classificationModal.classList.add('is-open')); document.body.classList.add('generate-modal-open'); });
  classificationModal?.querySelectorAll('[data-close-inventory-classifications]').forEach(btn => btn.addEventListener('click', closeClassificationModal));
  document.querySelector('#inventoryAddProduct')?.addEventListener('click', () => openInventoryNewProductModal({ classifications, onSaved: async created => { products = [created, ...products]; draw(); } }));
  draw();
  document.querySelector('#inventoryPageSearch')?.addEventListener('input', draw);
  document.querySelector('#inventoryPageCategoryFilter')?.addEventListener('change', draw);
  document.querySelector('#inventoryPageTypeFilter')?.addEventListener('change', draw);
  document.querySelector('#inventoryPageBrandFilter')?.addEventListener('change', draw);
  wireAccountMenu();
  document.querySelector('#clearInventoryPageSearch')?.addEventListener('click', () => { const input=document.querySelector('#inventoryPageSearch'); if(input){input.value='';input.focus();draw();} });
}



async function renderAdminCompras() {
  const session=await request('/api/admin/session').catch(()=>({authenticated:false})); if(!session.authenticated)return renderLogin(); if(String(session.role||'').toLowerCase()!=='admin')return renderAdminOrders();
  const nav=adminSectionNav(session,'compras'); const products=await request('/api/admin/catalog-products'); let purchases=[];
  app.innerHTML=`<main class="admin-shell"><div class="admin-wrap"><div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route><span class="admin-brand-mark"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider"></span><small>Panel Administrativo</small></a><h1 class="admin-title">Compras</h1><p class="admin-subtitle">Proveeduría · órdenes de compra, costos y recepción de mercadería.</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>${nav}<section class="admin-panel purchases-panel"><div class="section-heading"><div><span class="eyebrow">PROVEEDURÍA</span><h2>Órdenes de compra</h2></div><p>La recepción incrementa el stock y actualiza el precio de compra del producto.</p></div><div class="purchase-create"><div class="purchase-create-head"><div><h3>Nueva compra</h3><small>Registra primero la orden y luego márcala como recibida cuando la mercadería llegue.</small></div></div><form id="purchaseForm" class="form-grid"><div class="field"><label>Proveedor</label><input name="supplier" required placeholder="Nombre del proveedor"></div><div class="field"><label>Nota</label><input name="note" placeholder="Factura, referencia, condición…"></div><div class="field full"><label>Productos</label><div id="purchaseItems"></div><button type="button" class="button small" id="addPurchaseItem">+ Agregar producto</button></div><div class="form-actions full"><button class="button primary" type="submit">Crear orden de compra</button><span class="message" id="purchaseMessage"></span></div></form></div><div class="purchase-list-head"><h3>Historial de compras</h3><button class="button small" id="refreshPurchases">Actualizar</button></div><div class="purchase-filters"><div class="field"><label>Buscar</label><input id="purchaseSearch" type="search" placeholder="Orden, proveedor, producto o SKU…"></div><div class="field"><label>Desde</label><input id="purchaseFrom" type="date"></div><div class="field"><label>Hasta</label><input id="purchaseTo" type="date"></div><button type="button" class="button secondary small" id="clearPurchaseFilters">Limpiar filtros</button></div><div id="purchaseResultsMeta" class="purchase-results-meta"></div><div id="purchaseList" class="purchase-list"></div></section></div></main>
  <div class="generate-modal" id="purchaseProductPickerModal" hidden><div class="generate-modal-backdrop" data-purchase-picker-close></div><div class="generate-modal-dialog generate-product-picker" role="dialog" aria-modal="true" aria-labelledby="purchaseProductPickerTitle"><div class="generate-modal-head"><div><span class="eyebrow">Catálogo YHORS</span><h2 id="purchaseProductPickerTitle">Seleccionar producto</h2><p class="generate-customer-modal-subtitle">Busca por nombre, SKU o marca y selecciona el producto para la compra.</p></div><button type="button" class="generate-modal-close" data-purchase-picker-close>×</button></div><div class="generate-picker-toolbar"><input id="purchaseProductSearch" type="search" placeholder="Buscar por nombre, SKU, marca…" autocomplete="off"><select id="purchaseProductCategory"><option value="">Todas las categorías</option><option value="elegant">Elegante</option><option value="sports">Deportes</option><option value="tech">Tech</option><option value="cosplay">Cosplay</option><option value="pets">Mascotas</option><option value="details">Details</option><option value="collectibles">Coleccionables</option></select></div><div class="generate-picker-list" id="purchaseProductPickerList"></div></div></div>`;
  wireAccountMenu();
  const itemsMount=document.querySelector('#purchaseItems');
  let activePurchaseRow=null;
  const pickerModal=document.querySelector('#purchaseProductPickerModal');
  const openPicker=(row)=>{activePurchaseRow=row; pickerModal.hidden=false; requestAnimationFrame(()=>pickerModal.classList.add('is-open')); document.body.classList.add('generate-modal-open'); document.querySelector('#purchaseProductSearch').value=''; document.querySelector('#purchaseProductCategory').value=''; drawProductPicker(); setTimeout(()=>document.querySelector('#purchaseProductSearch')?.focus(),30);};
  const closePicker=()=>{pickerModal.classList.remove('is-open'); document.body.classList.remove('generate-modal-open'); setTimeout(()=>pickerModal.hidden=true,180);};
  const drawProductPicker=()=>{const q=(document.querySelector('#purchaseProductSearch')?.value||'').trim().toLowerCase();const cat=document.querySelector('#purchaseProductCategory')?.value||'';const filtered=products.filter(p=>{const hay=`${p.name||''} ${p.sku||''} ${p.brand||''} ${p.productType||''}`.toLowerCase();return (!q||hay.includes(q))&&(!cat||String(p.category||'')===cat);});document.querySelector('#purchaseProductPickerList').innerHTML=filtered.length?filtered.map(product=>`<article class="generate-picker-item"><div class="generate-picker-info"><strong>${escapeHTML(product.name)}</strong><small>SKU: ${escapeHTML(product.sku||'—')} · ${escapeHTML(product.brand||product.category||'Producto')}</small><b>Compra actual: ${money(product.purchasePrice||0)} · Stock ${Number(product.stock||0)}</b></div><div class="generate-picker-actions"><button type="button" class="button primary small" data-purchase-select-product="${escapeHTML(product.id)}">Seleccionar</button></div></article>`).join(''):'<div class="generate-empty-state"><span>⌕</span><strong>No encontramos productos</strong><small>Prueba con otro nombre, SKU o categoría.</small></div>';};
  const addItem=(seed={})=>{const row=document.createElement('div');row.className='purchase-item-row';row.innerHTML=`<button type="button" class="purchase-product-trigger" data-purchase-product-trigger>${seed.productId?escapeHTML(seed.name||'Producto seleccionado'):'Seleccionar producto'}</button><input data-purchase-product-id type="hidden" value="${escapeHTML(seed.productId||'')}"><input data-purchase-qty type="number" min="1" value="${seed.quantity||1}" placeholder="Cant."><input data-purchase-cost type="number" min="0" step="0.01" value="${seed.unitCost??''}" placeholder="Costo unitario"><button type="button" class="button danger small" data-remove-purchase>×</button>`;row.querySelector('[data-remove-purchase]').addEventListener('click',()=>row.remove());row.querySelector('[data-purchase-product-trigger]').addEventListener('click',()=>openPicker(row));itemsMount.appendChild(row);};
  addItem(); document.querySelector('#addPurchaseItem').addEventListener('click',()=>addItem());
  pickerModal.addEventListener('click',e=>{if(e.target.closest('[data-purchase-picker-close]'))return closePicker();const btn=e.target.closest('[data-purchase-select-product]');if(!btn||!activePurchaseRow)return;const product=products.find(p=>String(p.id)===String(btn.dataset.purchaseSelectProduct));if(!product)return;activePurchaseRow.querySelector('[data-purchase-product-id]').value=product.id;const trigger=activePurchaseRow.querySelector('[data-purchase-product-trigger]');trigger.textContent=`${product.name}${product.sku?' · '+product.sku:''}`;trigger.classList.add('has-value');const cost=activePurchaseRow.querySelector('[data-purchase-cost]');if(cost&&!cost.value)cost.value=Number(product.purchasePrice||0);closePicker();});
  document.querySelector('#purchaseProductSearch').addEventListener('input',drawProductPicker);document.querySelector('#purchaseProductCategory').addEventListener('change',drawProductPicker);
  const dateToday=new Date().toLocaleDateString('en-CA',{timeZone:'America/Guayaquil'}); document.querySelector('#purchaseFrom').value=dateToday;document.querySelector('#purchaseTo').value=dateToday;
  const renderPurchases=()=>{const q=(document.querySelector('#purchaseSearch').value||'').trim().toLowerCase();const from=document.querySelector('#purchaseFrom').value;const to=document.querySelector('#purchaseTo').value;const filtered=purchases.filter(p=>{const day=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil'}).format(new Date(p.createdAt||0));const hay=`${p.number||''} ${p.supplier||''} ${p.note||''} ${(p.items||[]).map(i=>`${i.name||''} ${i.sku||''}`).join(' ')}`.toLowerCase();return (!q||hay.includes(q))&&(!from||day>=from)&&(!to||day<=to);});document.querySelector('#purchaseResultsMeta').textContent=`${filtered.length} de ${purchases.length} orden${purchases.length===1?'':'es'}`;document.querySelector('#purchaseList').innerHTML=filtered.length?filtered.map(p=>`<article class="purchase-card"><div><span class="eyebrow">${escapeHTML(p.number)}</span><h3>${escapeHTML(p.supplier)}</h3><small>${new Date(p.createdAt).toLocaleString('es-EC')} · ${(p.items||[]).length} productos${p.note?' · '+escapeHTML(p.note):''}</small><div class="purchase-products-preview">${(p.items||[]).map(i=>`<span>${escapeHTML(i.name)} × ${Number(i.quantity||0)}</span>`).join('')}</div></div><div class="purchase-card-total"><strong>${money(p.total)}</strong><span class="purchase-status ${String(p.status||'').toLowerCase()}">${escapeHTML(p.status)}</span></div><div class="purchase-card-actions">${p.status==='Borrador'?`<button class="button small" data-purchase-status="Ordenada" data-purchase-id="${escapeHTML(p.id)}">Marcar ordenada</button>`:''}${p.status==='Ordenada'?`<button class="button primary small" data-purchase-status="Recibida" data-purchase-id="${escapeHTML(p.id)}">Recibir mercadería</button>`:''}${p.status==='Recibida'?`<button class="button secondary small" data-purchase-status="Cancelada" data-purchase-id="${escapeHTML(p.id)}">Anular recepción</button>`:''}${p.status==='Cancelada'||!p.stockApplied?`<button class="button danger small" data-purchase-delete="${escapeHTML(p.id)}">Eliminar</button>`:''}</div></article>`).join(''):'<div class="empty">No hay órdenes que coincidan con los filtros.</div>';};
  const load=async()=>{purchases=await request('/api/admin/compras');renderPurchases();};
  document.querySelector('#purchaseSearch').addEventListener('input',renderPurchases);document.querySelector('#purchaseFrom').addEventListener('change',renderPurchases);document.querySelector('#purchaseTo').addEventListener('change',renderPurchases);document.querySelector('#clearPurchaseFilters').addEventListener('click',()=>{document.querySelector('#purchaseSearch').value='';document.querySelector('#purchaseFrom').value='';document.querySelector('#purchaseTo').value='';renderPurchases();});
  document.querySelector('#purchaseForm').addEventListener('submit',async e=>{e.preventDefault();const rows=[...itemsMount.querySelectorAll('.purchase-item-row')].map(row=>({productId:row.querySelector('[data-purchase-product-id]').value,quantity:row.querySelector('[data-purchase-qty]').value,unitCost:row.querySelector('[data-purchase-cost]').value}));if(rows.some(r=>!r.productId)){document.querySelector('#purchaseMessage').className='message error';document.querySelector('#purchaseMessage').textContent='Selecciona un producto en cada línea.';return;}const form=e.currentTarget;const payload={supplier:form.supplier.value,note:form.note.value,items:rows};const msg=document.querySelector('#purchaseMessage');try{await request('/api/admin/compras',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});if(form&&typeof form.reset==='function')form.reset();itemsMount.innerHTML='';addItem();msg.className='message success';msg.textContent='Orden de compra creada.';await load();}catch(err){msg.className='message error';msg.textContent=err.message;}});
  document.querySelector('#refreshPurchases').addEventListener('click',load);document.querySelector('#purchaseList').addEventListener('click',async e=>{const status=e.target.closest('[data-purchase-status]');if(status){status.disabled=true;try{await request(`/api/admin/compras/${encodeURIComponent(status.dataset.purchaseId)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:status.dataset.purchaseStatus})});await load();}catch(err){status.disabled=false;alert(err.message);}}const del=e.target.closest('[data-purchase-delete]');if(del){if(!confirm('¿Eliminar esta orden de compra?'))return;try{await request(`/api/admin/compras/${encodeURIComponent(del.dataset.purchaseDelete)}`,{method:'DELETE'});await load();}catch(err){alert(err.message);}}});
  await load();
}
async function renderAdminClientes() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated:false }));
  if (!session.authenticated) return renderLogin();
  if (!['admin','store_manager','vendedor','orders'].includes(String(session.role||'').toLowerCase())) return renderAdmin();
  const canEdit = ['admin','store_manager','vendedor','orders'].includes(String(session.role||'').toLowerCase());
  const nav = adminSectionNav(session, 'clientes');
  const shell = `<main class="admin-shell customers-shell"><div class="admin-wrap"><div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route aria-label="YHORS · Panel Administrativo · Ir a YHORS Inteligente"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></a><h1 class="admin-title">Clientes</h1><p class="admin-subtitle">Fichero de clientes · datos permanentes, historial y estado de cuenta.</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>${nav}<section class="admin-panel customer-panel"><div class="section-heading"><div><span class="eyebrow">FICHERO DE CLIENTES</span><h2>Directorio comercial</h2></div><p>Un solo expediente por cliente para consultar sus pedidos, ventas y actividad.</p></div><div class="customer-toolbar"><label class="customer-search-box"><span>⌕</span><input id="customerSearch" type="search" placeholder="Buscar por nombre, cédula o teléfono…" autocomplete="off"></label>${canEdit ? '<button class="button primary" id="newCustomer">+ Nuevo cliente</button>' : ''}<span class="inventory-count" id="customerCount">0 clientes</span></div><div class="customer-layout"><div id="customerList" class="customer-list"></div><section id="customerDetail" class="customer-detail"><div class="customer-detail-empty"><span>◌</span><strong>Selecciona un cliente</strong><small>Aquí verás su ficha, historial y estado de cuenta.</small></div></section></div></section></div></main>`;
  app.innerHTML = shell; wireAccountMenu();
  let customers = [];
  const list = document.querySelector('#customerList'); const detail = document.querySelector('#customerDetail');
  const renderList = () => {
    const q=(document.querySelector('#customerSearch')?.value||'').trim().toLowerCase();
    const rows=customers.filter(c=>!q||`${c.name} ${c.cedula} ${c.phone} ${c.email} ${c.city}`.toLowerCase().includes(q));
    document.querySelector('#customerCount').textContent=`${rows.length} cliente${rows.length===1?'':'s'}`;
    list.innerHTML=rows.length?rows.map(c=>`<button type="button" class="customer-row" data-customer-id="${escapeHTML(c.id)}"><span class="customer-avatar">${escapeHTML((c.name||'C').trim().slice(0,1).toUpperCase())}</span><span class="customer-row-copy"><strong>${escapeHTML(c.name||'Sin nombre')}</strong><small>${escapeHTML(c.cedula||'Sin cédula')} · ${escapeHTML(c.city||'Sin ciudad')}</small></span><span class="customer-row-meta"><b>${c.salesCount||0}</b><small>ventas</small>${Number(c.creditBalance||0)>0.001?`<em class="customer-row-paid">Saldo a favor ${money(c.creditBalance)}</em>`:Number(c.balance||0)>0.001?`<em class="customer-row-due">Por cobrar ${money(c.balance)}</em>`:`<em class="customer-row-paid">Al día</em>`}</span></button>`).join(''):'<div class="empty">No hay clientes que coincidan con la búsqueda.</div>';
  };
  list.addEventListener('click', event => {
    const row = event.target.closest('[data-customer-id]');
    if (row) showCustomer(row.dataset.customerId);
  });
  const showCustomer = async id => {
    try {
      const data=await request(`/api/admin/clientes/${encodeURIComponent(id)}`); const c=data.customer; const tx=data.transactions||[]; const statement=data.statement||[];
      const todayAccount=new Date().toLocaleDateString('en-CA',{timeZone:'America/Guayaquil'});
      detail.innerHTML=`<div class="customer-detail-head"><div><span class="eyebrow">EXPEDIENTE DEL CLIENTE</span><h2>${escapeHTML(c.name||'Sin nombre')}</h2><p>${escapeHTML(c.cedula||'')} ${c.city?`· ${escapeHTML(c.city)}`:''}</p></div><div class="customer-detail-actions">${canEdit?'<button class="button small" id="editCustomer">Editar ficha</button>':''}${String(session.role||'').toLowerCase()==='admin'?'<button class="button danger small" id="deleteCustomer">Eliminar cliente</button>':''}</div></div><div class="customer-metrics"><article><span>PEDIDOS</span><strong>${data.totals.orders}</strong></article><article><span>VENTAS</span><strong>${data.totals.sales}</strong></article><article><span>TOTAL COMPRADO</span><strong>${money(data.totals.salesTotal)}</strong></article><article class="customer-balance-metric"><span>POR COBRAR</span><strong>${money(data.totals.balance)}</strong></article>${Number(data.totals.creditBalance||0)>0.001?`<article class="customer-balance-metric"><span>SALDO A FAVOR</span><strong>${money(data.totals.creditBalance)}</strong></article>`:''}</div><div class="customer-info-grid"><div><span>CÉDULA / RUC</span><strong>${escapeHTML(c.cedula||'—')}</strong></div><div><span>CELULAR</span><strong>${escapeHTML(c.phone||'—')}</strong></div><div><span>CORREO</span><strong>${escapeHTML(c.email||'—')}</strong></div><div><span>CIUDAD</span><strong>${escapeHTML(c.city||'—')}</strong></div><div class="full"><span>DIRECCIÓN</span><strong>${escapeHTML(c.address||'—')}</strong></div><div class="full"><span>NOTAS</span><strong>${escapeHTML(c.notes||'—')}</strong></div></div><div class="customer-statement"><div class="customer-statement-head"><div><span class="eyebrow">ESTADO DE CUENTA</span><h3>Movimientos del cliente</h3></div><small>Ventas, abonos, saldos y anticipos</small></div><div class="customer-statement-filters"><label><span>Desde</span><input id="customerTxFrom" type="date" value="${todayAccount}"></label><label><span>Hasta</span><input id="customerTxTo" type="date" value="${todayAccount}"></label><button type="button" class="button secondary small" id="clearCustomerTxFilters">Limpiar</button></div><div class="customer-statement-balance"><div><span>VENDIDO</span><strong>${money(data.totals.salesTotal)}</strong></div><div><span>ABONADO</span><strong>${money(data.totals.paidTotal)}</strong></div><div><span>SALDO</span><strong>${money(data.totals.balance)}</strong></div></div><div id="customerStatementTable" class="customer-statement-table"></div></div>`;
      const renderCustomerTransactions=()=>{
        const from=document.querySelector('#customerTxFrom')?.value||'';
        const to=document.querySelector('#customerTxTo')?.value||'';
        const table=document.querySelector('#customerStatementTable');
        if(from&&to&&from>to){table.innerHTML='<div class="message error">La fecha inicial no puede ser posterior a la fecha final.</div>';return;}
        const accountDay=value=>{
          if(!value)return '';
          const raw=String(value);
          // Las fechas de pago se guardan como YYYY-MM-DD y NO deben pasar por
          // new Date(), porque JavaScript las interpreta como UTC y en Ecuador
          // pueden terminar mostrando el día anterior.
          if(/^\d{4}-\d{2}-\d{2}$/.test(raw))return raw;
          const d=new Date(value);
          return Number.isNaN(d.getTime())?'':new Intl.DateTimeFormat('en-CA',{timeZone:'America/Guayaquil'}).format(d);
        };
        const rows=statement.filter(row=>{const day=accountDay(row.date||row.payment?.date||row.timestamp);return (!from||day>=from)&&(!to||day<=to);}).sort((a,b)=>{
          // El estado de cuenta se lee como un libro: del movimiento más antiguo
          // al más reciente, dejando el último movimiento al final.
          const movementKey=row=>{
            const day=accountDay(row.date||row.payment?.date||row.timestamp)||'9999-12-31';
            const raw=String(row.timestamp||row.date||'');
            let time='00:00:00';
            const match=raw.match(/T(\d{2}:\d{2}(?::\d{2})?)/);
            if(match)time=match[1].length===5?`${match[1]}:00`:match[1];
            return `${day}T${time}`;
          };
          // Mostrar siempre el movimiento más reciente arriba y el primero abajo.
          // Así el estado de cuenta se lee como un historial: última acción arriba,
          // primera acción abajo.
          return movementKey(b).localeCompare(movementKey(a));
        });
        const formatDateTime=value=>{if(!value)return 'Fecha no registrada'; const d=new Date(value); if(Number.isNaN(d.getTime()))return 'Fecha no registrada'; return escapeHTML(d.toLocaleString('es-EC',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'America/Guayaquil'}));};
        const renderedCustomerRows=rows.map(row=>{
          const isPayment=row.kind==='abono';
          const dateLabel=formatDateTime(row.timestamp||row.date);
          if(row.kind==='devolucion'){
            const methodMap={cash:'Efectivo',transfer:'Transferencia',card:'Tarjeta'}; const methodLabel=methodMap[String(row.payment?.method||'').toLowerCase()]||'Devolución';
            return `<article class="customer-ledger-card is-purchase"><div class="customer-ledger-icon">↩</div><div class="customer-ledger-main"><span class="customer-ledger-eyebrow">DEVOLUCIÓN · ADMINISTRACIÓN</span><strong>Devolución ${methodLabel.toLowerCase()}</strong><small>${dateLabel} · ${escapeHTML(row.detail||'Devolución de dinero')}</small></div><div class="customer-ledger-amount"><span>SALIDA</span><strong>${money(row.debit)}</strong><small>${Number(row.balance||0)<-0.001?`Saldo a favor: ${money(Math.abs(row.balance))}`:`Saldo después: ${money(row.balance)}`}</small></div></article>`;
          }
          if(isPayment){
            const methodMap={cash:'Efectivo',transfer:'Transferencia',card:'Tarjeta'}; const methodLabel=methodMap[String(row.payment?.method||'').toLowerCase()]||'Ingreso de dinero';
            const method=escapeHTML(methodLabel);
            const bank=row.payment?.bank ? ` · ${escapeHTML(row.payment.bank)}` : '';
            const transaction=row.payment?.transactionNumber ? ` · TRX ${escapeHTML(row.payment.transactionNumber)}` : '';
            const note=row.detail && row.detail!=='Abono registrado' ? escapeHTML(row.detail) : 'Pago registrado';
            return `<article class="customer-ledger-card is-payment"><div class="customer-ledger-icon">$</div><div class="customer-ledger-main"><span class="customer-ledger-eyebrow">INGRESO DE DINERO</span><strong>Ingreso ${method.toLowerCase()}</strong><small>${dateLabel}${bank}${transaction} · ${note}</small></div><div class="customer-ledger-amount"><span>INGRESÓ</span><strong>${money(row.credit)}</strong><small>${Number(row.balance||0)<-0.001?`Saldo a favor: ${money(Math.abs(row.balance))}`:`Saldo después: ${money(row.balance)}`}</small></div></article>`;
          }
          const productDetail=row.source||'Producto no registrado';
          return `<article class="customer-ledger-card is-purchase"><div class="customer-ledger-icon">✓</div><div class="customer-ledger-main"><span class="customer-ledger-eyebrow">YHORS · COMPRA</span><strong>YHORS compra ${escapeHTML(productDetail)}</strong><small>Factura ${escapeHTML(row.number||'—')} · ${dateLabel}</small></div><div class="customer-ledger-amount"><span>CARGO</span><strong>${money(row.debit)}</strong><small>${Number(row.balance||0)<-0.001?`Saldo a favor: ${money(Math.abs(row.balance))}`:`Saldo después: ${money(row.balance)}`}</small></div></article>`;
        }).join('');
        table.innerHTML=rows.length?`<div class="customer-ledger-list">${renderedCustomerRows}</div>`:'<div class="empty">No hay movimientos en este período.</div>';
      };
      document.querySelector('#customerTxFrom')?.addEventListener('change',renderCustomerTransactions);
      document.querySelector('#customerTxTo')?.addEventListener('change',renderCustomerTransactions);
      document.querySelector('#clearCustomerTxFilters')?.addEventListener('click',()=>{document.querySelector('#customerTxFrom').value='';document.querySelector('#customerTxTo').value='';renderCustomerTransactions();});
      renderCustomerTransactions();
      document.querySelectorAll('.customer-row').forEach(b=>b.classList.toggle('active',b.dataset.customerId===String(id)));
      document.querySelector('#editCustomer')?.addEventListener('click',()=>openEditCustomer(c));
      document.querySelector('#deleteCustomer')?.addEventListener('click',async()=>{
        const confirmed=await showYhorsConfirm('¿Eliminar este cliente?','Solo se puede eliminar si no tiene pedidos, ventas ni pagos. Si ya existe historial, usa “Editar ficha” para corregir sus datos sin romper la trazabilidad.',{cancelText:'Cancelar',confirmText:'Eliminar cliente'});
        if(!confirmed)return;
        try{await request(`/api/admin/clientes/${encodeURIComponent(c.id)}`,{method:'DELETE'});customers=customers.filter(item=>String(item.id)!==String(c.id));writeLocalCustomerCache(customers);renderList();detail.innerHTML='<div class="customer-detail-empty"><span>✓</span><strong>Cliente eliminado</strong><small>El expediente fue retirado del fichero.</small></div>';}catch(err){await showYhorsConfirm('No se puede eliminar',''+(err.message||'Este cliente tiene historial y debe corregirse mediante “Editar ficha”.'),{cancelText:'Cerrar',confirmText:'Entendido'});}
      });
    }catch(e){detail.innerHTML=`<div class="message error">${escapeHTML(e.message)}</div>`;}
  };
  const openEditCustomer = c => {
    detail.innerHTML=`<div class="customer-detail-head"><div><span class="eyebrow">FICHA DEL CLIENTE</span><h2>Editar datos</h2></div></div><form id="customerEditForm" class="form-grid customer-edit-form"><div class="field"><label>Nombre</label><input name="name" value="${escapeHTML(c.name||'')}" required></div><div class="field"><label>Cédula / RUC</label><input name="cedula" value="${escapeHTML(c.cedula||'')}" required></div><div class="field"><label>Teléfono</label><input name="phone" value="${escapeHTML(c.phone||'')}"></div><div class="field"><label>Correo</label><input name="email" type="email" value="${escapeHTML(c.email||'')}"></div><div class="field"><label>Ciudad</label><input name="city" value="${escapeHTML(c.city||'')}"></div><div class="field full"><label>Dirección</label><input name="address" value="${escapeHTML(c.address||'')}"></div><div class="field full"><label>Google Maps</label><input name="mapsUrl" value="${escapeHTML(c.mapsUrl||'')}"></div><div class="field full"><label>Notas internas</label><textarea name="notes" rows="4">${escapeHTML(c.notes||'')}</textarea></div><div class="form-actions full"><button class="button primary" type="submit">Guardar ficha</button><button class="button secondary" type="button" id="cancelCustomerEdit">Cancelar</button><span class="message" id="customerEditMessage"></span></div></form>`;
    document.querySelector('#cancelCustomerEdit')?.addEventListener('click',()=>showCustomer(c.id));
    document.querySelector('#customerEditForm')?.addEventListener('submit',async e=>{e.preventDefault();const msg=document.querySelector('#customerEditMessage');try{const saved=await request(`/api/admin/clientes/${encodeURIComponent(c.id)}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});customers=customers.map(x=>x.id===saved.id?{...x,...saved}:x);writeLocalCustomerCache(customers);renderList();await showCustomer(saved.id);msg.className='message success';msg.textContent='Ficha actualizada.';}catch(err){msg.className='message error';msg.textContent=err.message;}});
  };
  const load = async()=>{
    let remote=[];
    let remoteError=null;
    try { remote=await request(`/api/admin/clientes?_=${Date.now()}`); } catch (error) { remoteError=error; }
    customers=await recoverCustomersFromLocalCache(Array.isArray(remote)?remote:[]);
    writeLocalCustomerCache(customers);
    renderList();
    if(customers[0]) await showCustomer(customers[0].id);
    else if(remoteError){
      list.innerHTML=`<div class="empty"><strong>No se pudo cargar el fichero de clientes.</strong><br><small>${escapeHTML(remoteError.message||'Error del servidor')}</small><br><button type="button" class="button secondary small" id="retryCustomers">Reintentar</button></div>`;
      document.querySelector('#retryCustomers')?.addEventListener('click',load);
    }
  };
  document.querySelector('#customerSearch')?.addEventListener('input',renderList);
  // Alta manual, separada para no sobrecargar el flujo de consulta.
  document.querySelector('#newCustomer')?.addEventListener('click',()=>{detail.innerHTML=`<div class="customer-detail-head"><div><span class="eyebrow">FICHA DEL CLIENTE</span><h2>Nuevo cliente</h2></div></div><form id="newCustomerForm" class="form-grid customer-edit-form"><div class="field"><label>Nombre</label><input name="name" required></div><div class="field"><label>Cédula / RUC</label><input name="cedula" required></div><div class="field"><label>Teléfono</label><input name="phone"></div><div class="field"><label>Correo</label><input name="email" type="email"></div><div class="field"><label>Ciudad</label><input name="city"></div><div class="field full"><label>Dirección</label><input name="address"></div><div class="field full"><label>Notas internas</label><textarea name="notes" rows="4"></textarea></div><div class="form-actions full"><button class="button primary" type="submit">Crear cliente</button><span class="message" id="newCustomerMessage"></span></div></form>`;document.querySelector('#newCustomerForm')?.addEventListener('submit',async e=>{e.preventDefault();try{const created=await request('/api/admin/clientes',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(e.currentTarget)))});customers.unshift(created);writeLocalCustomerCache(customers);renderList();await showCustomer(created.id);}catch(err){document.querySelector('#newCustomerMessage').className='message error';document.querySelector('#newCustomerMessage').textContent=err.message;}});});
  await load();
}

async function renderAdminInventoryMovements() {
  const session=await request('/api/admin/session').catch(()=>({authenticated:false})); if(!session.authenticated)return renderLogin(); if(String(session.role||'').toLowerCase()!=='admin')return renderAdminOrders();
  const nav=adminSectionNav(session,'movimientos');
  app.innerHTML=`<main class="admin-shell"><div class="admin-wrap"><div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route><span class="admin-brand-mark"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider"></span><small>Panel Administrativo</small></a><h1 class="admin-title">Movimientos de inventario</h1><p class="admin-subtitle">Kardex operativo · entradas, salidas, reservas y devoluciones.</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>${nav}<section class="admin-panel movement-panel"><div class="section-heading"><div><span class="eyebrow">INVENTARIO</span><h2>Kardex YHORS</h2></div><p>Cada cambio de stock queda vinculado a la acción que lo produjo.</p></div><div class="movement-toolbar"><input id="movementSearch" placeholder="Producto, SKU o motivo…"><input id="movementFrom" type="date"><input id="movementTo" type="date"><select id="movementDirection"><option value="">Todos</option><option value="entrada">Entradas</option><option value="salida">Salidas</option></select><button class="button primary small" id="movementRefresh">Actualizar</button></div><div id="movementList" class="movement-table"></div></section></div></main>`;wireAccountMenu();
  const load=async()=>{const p=new URLSearchParams();const q=document.querySelector('#movementSearch').value.trim();const f=document.querySelector('#movementFrom').value;const t=document.querySelector('#movementTo').value;const d=document.querySelector('#movementDirection').value;if(q)p.set('q',q);if(f)p.set('from',f);if(t)p.set('to',t);if(d)p.set('direction',d);const data=await request(`/api/admin/inventory-movements?${p}`);document.querySelector('#movementList').innerHTML=data.rows.length?data.rows.map(r=>`<div class="movement-row"><span>${new Date(r.date).toLocaleString('es-EC')}</span><span><strong>${escapeHTML(r.name)}</strong><small>${escapeHTML(r.sku)}</small></span><span class="movement-direction ${r.direction}">${r.direction==='entrada'?'+':'−'}${r.quantity}</span><span>${r.before} → ${r.after}</span><span>${escapeHTML(r.reason)}</span><span>${escapeHTML(r.user)}</span></div>`).join(''):'<div class="empty">No hay movimientos para los filtros seleccionados.</div>';};
  document.querySelector('#movementRefresh').addEventListener('click',load);document.querySelector('#movementSearch').addEventListener('keydown',e=>{if(e.key==='Enter')load()});await load();
}

async function renderAdminReports() {
  const session=await request('/api/admin/session').catch(()=>({authenticated:false})); if(!session.authenticated)return renderLogin(); if(String(session.role||'').toLowerCase()!=='admin')return renderAdminOrders();
  const nav=adminSectionNav(session,'reportes'); const today=new Date().toLocaleDateString('en-CA',{timeZone:'America/Guayaquil'});
  const [orders,sales,products,customers]=await Promise.all([request('/api/admin/orders').catch(()=>[]),request(`/api/admin/historial-ventas?from=2000-01-01&to=${today}`).catch(()=>[]),request('/api/admin/catalog-products').catch(()=>[]),request(`/api/admin/clientes?_=${Date.now()}`).catch(()=>[])]);
  const salesTotal=sales.reduce((a,x)=>a+Number(x.total||0),0); const stockUnits=products.reduce((a,x)=>a+Number(x.stock||0),0); const low=products.filter(x=>Number(x.stock||0)<=3).length;
  app.innerHTML=`<main class="admin-shell"><div class="admin-wrap"><div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route><span class="admin-brand-mark"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider"></span><small>Panel Administrativo</small></a><h1 class="admin-title">Reportes</h1><p class="admin-subtitle">Información de gestión para tomar decisiones sin depender de Excel.</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>${nav}<section class="admin-panel reports-panel"><div class="report-grid"><article><span>VENTAS REGISTRADAS</span><strong>${money(salesTotal)}</strong><small>${sales.length} ventas</small></article><article><span>PEDIDOS ACTIVOS</span><strong>${orders.length}</strong><small>Operación pendiente</small></article><article><span>UNIDADES EN STOCK</span><strong>${stockUnits}</strong><small>${products.length} productos</small></article><article><span>STOCK BAJO</span><strong>${low}</strong><small>3 unidades o menos</small></article><article><span>CLIENTES</span><strong>${customers.length}</strong><small>Fichero comercial</small></article></div><div class="report-actions"><button class="button primary" id="exportSalesCsv">Exportar ventas CSV</button><button class="button" id="exportInventoryCsv">Exportar inventario CSV</button><a class="button secondary" href="${ADMIN_PATH}/movimientos" data-smooth-route>Ver kardex de inventario →</a><a class="button secondary" href="${ADMIN_PATH}/resumen-financiero" data-smooth-route>Resumen financiero →</a></div></section></div></main>`;wireAccountMenu();
  const downloadCsv=(name,rows)=>{if(!rows.length)return;const headers=Object.keys(rows[0]);const csv=[headers.join(','),...rows.map(row=>headers.map(h=>`"${String(row[h]??'').replace(/"/g,'""')}"`).join(','))].join('\n');const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();URL.revokeObjectURL(a.href);};
  document.querySelector('#exportSalesCsv').addEventListener('click',()=>downloadCsv(`YHORS-ventas-${today}.csv`,sales.map(s=>({fecha:s.notifiedAt||s.createdAt,venta:s.orderNumber,cliente:s.customer?.name||'',vendedor:s.assignedSellerName||'',estado:s.status,total:s.total}))));
  document.querySelector('#exportInventoryCsv').addEventListener('click',()=>downloadCsv(`YHORS-inventario-${today}.csv`,products.map(p=>({sku:p.sku||'',producto:p.name||'',categoria:p.category||'',stock:p.stock||0,precioCompra:p.purchasePrice||0,precioVenta:p.salePrice||0,ganancia:Number(p.salePrice||0)-Number(p.purchasePrice||0)}))));
}

async function renderYhorsInteligente() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated: false }));
  if (!session.authenticated) return renderLogin();
  const role = String(session.role || '').toLowerCase();
  if (!['admin', 'store_manager', 'vendedor', 'orders'].includes(role)) return renderAdmin();

  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Guayaquil' });
  const [orders, sales, products, customers, moneyOverview] = await Promise.all([
    request('/api/admin/orders').catch(() => []),
    request(`/api/admin/historial-ventas?from=${today}&to=${today}`).catch(() => []),
    request('/api/admin/catalog-products').catch(() => []),
    request(`/api/admin/clientes?_=${Date.now()}`).catch(() => []),
    request('/api/admin/dinero/resumen?from=&to=&showPaid=true').catch(() => ({ payments: [], receivables: [], receivableTotals: {} }))
  ]);

  const activeOrders = Array.isArray(orders) ? orders : [];
  const confirmedSales = Array.isArray(sales) ? sales : [];
  const catalog = Array.isArray(products) ? products : [];
  const customerList = Array.isArray(customers) ? customers : [];
  const pending = activeOrders.filter(order => !['Enviado', 'Entregado', 'Cancelado'].includes(String(order.status || '')));
  const readyToShip = activeOrders.filter(order => ['Pendiente', 'Confirmado', 'Preparado'].includes(String(order.status || '')));
  const preparing = activeOrders.filter(order => String(order.status || '') === 'Preparado');
  const unassigned = activeOrders.filter(order => !order.assignedSellerId);
  const lowStock = catalog.filter(product => product.published !== false && Number(product.stock || 0) <= 3);
  const salesTotal = confirmedSales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
  const commissionEligible = confirmedSales.filter(sale => ['Enviado', 'Entregado'].includes(String(sale.status || ''))).length;
  const receivables = Array.isArray(moneyOverview?.receivables) ? moneyOverview.receivables.filter(row => Number(row.balance || 0) > 0) : [];
  const receivableBalance = receivables.reduce((sum, row) => sum + Number(row.balance || 0), 0);
  const todayPayments = (Array.isArray(moneyOverview?.payments) ? moneyOverview.payments : []).filter(row => String(row.date || '').slice(0,10) === today);
  const todayMoneyIn = todayPayments.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const urgentReceivables = receivables.filter(row => Number(row.ageDays || 0) >= 1).length;
  const recentActivity = [
    ...confirmedSales.slice(0, 4).map(sale => ({ date: sale.notifiedAt || sale.createdAt, type: 'sale', text: `Venta #${sale.orderNumber || '—'} · ${sale.status || 'Confirmada'}`, amount: sale.total })),
    ...activeOrders.slice(0, 5).map(order => ({ date: order.updatedAt || order.createdAt, type: 'order', text: `Orden #${order.orderNumber || '—'} · ${order.status || 'Pendiente'}` }))
  ].filter(item => item.date).sort((a,b) => new Date(b.date) - new Date(a.date)).slice(0, 6);

  const canSeeFinancial = role === 'admin';
  const nav = adminSectionNav(session, 'inteligente');
  const cardLink = (href, title, label, value, detail, cls = '') => `<a class="yh-intel-card ${cls}" href="${href}" data-smooth-route><div class="yh-intel-card-head"><span>${label}</span><span class="yh-intel-arrow">↗</span></div><strong>${value}</strong><small>${detail}</small><h3>${title}</h3></a>`;
  const moneyValue = money(salesTotal);
  const salesCard = canSeeFinancial
    ? cardLink(`${ADMIN_PATH}/historial-ventas`, 'Ventas confirmadas', 'HOY', moneyValue, `${confirmedSales.length} venta${confirmedSales.length === 1 ? '' : 's'} en Historial de Ventas`, 'is-large is-sales')
    : cardLink(`${ADMIN_PATH}/historial-ventas`, 'Mis ventas confirmadas', 'HOY', String(confirmedSales.length), `${money(salesTotal)} vendidos hoy`, 'is-large is-sales');

  app.innerHTML = `<main class="admin-shell yh-intelligent-shell"><div class="admin-wrap">
    <div class="admin-top yh-intelligent-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route aria-label="YHORS · Panel Administrativo · Ir a YHORS Inteligente"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></a><h1 class="admin-title">YHORS Inteligente</h1><p class="admin-subtitle">Tu centro de control para saber qué está pasando hoy en YHORS.</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>
    ${nav}
    <section class="yh-intelligent-hero"><div><span class="eyebrow">CENTRO INTELIGENTE · ${today}</span><h2>Buenos días, ${escapeHTML(session.name || session.username || 'equipo')} <span aria-hidden="true">👋</span></h2><p>Todo lo importante de hoy, organizado en bloques. Cada indicador te lleva directamente al lugar donde puedes actuar.</p></div><div class="yh-intelligent-hero-meta"><span class="yh-intelligent-status"><span class="yh-status-dot"></span><span>YHORS operativo</span></span><small>Actualizado al abrir esta pantalla</small></div></section>
    <section class="yh-intelligent-grid" aria-label="Resumen inteligente">
      ${salesCard}
      ${cardLink(`${ADMIN_PATH}/pedidos`, 'Pedidos pendientes', 'OPERACIÓN', pending.length, `${readyToShip.length} listos para avanzar`, 'is-orders')}
      ${cardLink(`${ADMIN_PATH}/pedidos`, 'Por enviar', 'LOGÍSTICA', readyToShip.length, `${preparing.length} en Preparado`, 'is-shipping')}
      ${cardLink(`${ADMIN_PATH}/pedidos`, 'Sin vendedor', 'ATENCIÓN', unassigned.length, unassigned.length ? 'Requieren asignación' : 'Todo asignado', unassigned.length ? 'is-alert' : 'is-ok')}
      ${cardLink(`${ADMIN_PATH}/inventario`, 'Stock bajo', 'INVENTARIO', lowStock.length, lowStock.length ? 'Productos con 3 o menos unidades' : 'Sin alertas de stock', lowStock.length ? 'is-alert' : 'is-ok')}
      ${cardLink(`${ADMIN_PATH}/pedidos`, 'En preparación', 'BODEGA', preparing.length, 'Órdenes con estado Preparado', 'is-prep')}
      ${cardLink(`${ADMIN_PATH}/clientes`, 'Clientes', 'EMPRESA', customerList.length, 'Fichero comercial de YHORS', 'is-customers')}
      ${cardLink(`${ADMIN_PATH}/dinero`, 'Cobros pendientes', 'DINERO · ATENCIÓN', money(receivableBalance), `${receivables.length} cuenta${receivables.length === 1 ? '' : 's'} con saldo${urgentReceivables ? ` · ${urgentReceivables} con antigüedad` : ''}`, receivables.length ? 'is-alert is-receivable' : 'is-ok is-receivable')}
      ${cardLink(`${ADMIN_PATH}/dinero`, 'Dinero ingresado hoy', 'DINERO · HOY', money(todayMoneyIn), `${todayPayments.length} ingreso${todayPayments.length === 1 ? '' : 's'} registrado${todayPayments.length === 1 ? '' : 's'}`, 'is-money-in')}
    </section>
    <section class="yh-intelligent-lower">
      <article class="yh-intel-panel yh-intel-activity"><div class="yh-intel-panel-title"><div><span class="eyebrow">SEGUIMIENTO</span><h2>Actividad reciente</h2></div><a href="${ADMIN_PATH}/pedidos" data-smooth-route>Ver pedidos →</a></div>
        ${recentActivity.length ? `<div class="yh-intel-timeline">${recentActivity.map(item => `<div class="yh-intel-activity-row"><span class="yh-activity-icon ${item.type}">${item.type === 'sale' ? '✓' : '↗'}</span><div><strong>${escapeHTML(item.text)}</strong><small>${new Date(item.date).toLocaleString('es-EC',{dateStyle:'short',timeStyle:'short'})}${item.amount !== undefined ? ` · ${money(item.amount)}` : ''}</small></div></div>`).join('')}</div>` : '<div class="yh-intel-empty">Todavía no hay actividad reciente para mostrar.</div>'}
      </article>
      <article class="yh-intel-panel yh-intel-actions"><div class="yh-intel-panel-title"><div><span class="eyebrow">ACCESOS RÁPIDOS</span><h2>¿Qué quieres hacer?</h2></div></div><div class="yh-intel-action-grid">
        <a href="${ADMIN_PATH}/generar-orden" data-smooth-route><span>＋</span><strong>Generar orden</strong><small>Nueva orden de venta</small></a>
        <a href="${ADMIN_PATH}/pedidos" data-smooth-route><span>▣</span><strong>Ver pedidos</strong><small>Revisar estados y asignaciones</small></a>
        <a href="${ADMIN_PATH}/inventario" data-smooth-route><span>⌂</span><strong>Inventario</strong><small>Consultar stock</small></a>
        <a href="${ADMIN_PATH}/historial-ventas" data-smooth-route><span>✓</span><strong>Historial de ventas</strong><small>Ventas notificadas</small></a>
        <a href="${ADMIN_PATH}/clientes" data-smooth-route><span>♙</span><strong>Clientes</strong><small>Fichero y estado de cuenta</small></a>
        <a href="${ADMIN_PATH}/dinero" data-smooth-route><span>$</span><strong>Registrar dinero</strong><small>Registrar cobros y revisar saldos</small></a>
      </div></article>
    </section>
    <section class="yh-intel-note"><span>💡</span><div><strong>El estado manda</strong><p>Las órdenes pasan a Historial de Ventas cuando se notifican estando <b>Enviado</b> o <b>Entregado</b>. El Dashboard solo resume ese flujo; no modifica tus pedidos.</p></div></section>
  </div></main>`;
  wireAccountMenu();
}

async function renderAdminBackups() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated: false }));
  if (!session.authenticated) return renderLogin();
  if (session.role !== 'admin') return renderAdminOrders();
  const backupState = await request('/api/admin/backups').catch(() => ({ storageMode: 'local', backups: [], retention: 30 }));
  app.innerHTML = `<main class="admin-shell"><div class="admin-wrap">
    <div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route aria-label="YHORS · Panel Administrativo · Ir a YHORS Inteligente"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></a><h1 class="admin-title">Backups</h1><p class="admin-subtitle">Seguridad de datos y respaldos de YHORS.</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>
    ${adminSectionNav(session, 'backups')}
    ${backupPanel(backupState, false)}
  </div></main>`;
  bindBackupEvents();
  wireAccountMenu();
}

async function renderAdmin() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated: false })); if (!session.authenticated) return renderLogin(); if (isSellerRole(session.role) || session.role === 'store_manager') return renderAdminOrders();
  let products = await request('/api/admin/products').catch(() => []); let classifications = await request('/api/admin/classifications').catch(() => ({ brands: {}, productTypes: {} })); let settings = await request('/api/admin/storefront').catch(() => ({ heroProductIds: [], featuredProductIds: [] })); let editing = null;
  document.documentElement.style.minHeight='0'; document.body.style.minHeight='0'; document.body.style.height='auto'; document.body.style.overflowY='auto'; app.style.minHeight='0'; app.style.height='auto';
  app.innerHTML = `<main class="admin-shell admin-web-shell"><div class="admin-wrap"><div class="admin-top"><div><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route aria-label="YHORS · Panel Administrativo · Ir a YHORS Inteligente"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></a><h1 class="admin-title">Administración · Página Web</h1><p class="admin-subtitle">Gestiona la portada y productos destacados de la página pública de YHORS.</p></div><div class="admin-top-actions">${accountMenu(session)}</div></div>${adminSectionNav(session, 'web')}<div id="selectionPanelMount">${selectionPanel(products, settings)}</div></div></main>`;
  const formArea = document.querySelector('#formArea'); const listArea = document.querySelector('#adminProducts');
  function drawList() {
    const categoryKeys = Object.keys(categories).filter(k => k !== 'all');
    const query = (document.querySelector('#inventorySearch')?.value || '').trim().toLowerCase();
    const categoryFilter = document.querySelector('#inventoryCategoryFilter')?.value || '';
    const matches = products.filter(p => {
      const matchesQuery = !query || [p.name, p.sku, p.brand, p.productType, p.category, categories[p.category], productMeta(p)].filter(Boolean).some(value => String(value).toLowerCase().includes(query));
      const matchesCategory = !categoryFilter || p.category === categoryFilter;
      return matchesQuery && matchesCategory;
    });
    const count = document.querySelector('#inventoryCount');
    const filtered = Boolean(query || categoryFilter);
    if (count) count.textContent = filtered ? `${matches.length} de ${products.length} productos` : `${products.length} productos`;
    listArea.innerHTML = matches.length ? categoryKeys.map(key => {
      const group = matches.filter(p => p.category === key);
      if (!group.length) return '';
      return `<section class="admin-category-group"><div class="admin-category-heading"><span class="eyebrow">Universo</span><h3>${escapeHTML(categories[key])} <small>${group.length}</small></h3></div>${group.map(p => `<article class="admin-product"><img data-fallback src="${escapeHTML(productImages(p)[0])}" alt=""><div><h3>${escapeHTML(p.name)} ${p.published === false ? '<span class="unpublished-tag">● Solo inventario</span>' : '<span class="published-tag">● Publicado</span>'} ${p.featured ? '<span class="featured-star">★ Destacado</span>' : ''} ${p.hero ? '<span class="hero-tag">◆ Portada</span>' : ''}</h3><p><strong class="admin-sku">SKU: ${escapeHTML(p.sku || '—')}</strong> · ${escapeHTML(categories[p.category] || p.category)}${productMeta(p) ? ` · ${escapeHTML(productMeta(p))}` : ''} · Venta ${productPriceLabel(p)}${p.category === 'cosplay' && p.rentalPrice !== null && p.rentalPrice !== undefined && p.rentalPrice !== '' ? ` · Alquiler ${money(p.rentalPrice)} / día` : ''} · ${productImages(p).length} imagen(es)</p></div><div class="admin-actions"><button class="button secondary small yhors-edit-note" data-edit="${escapeHTML(p.id)}">Editar</button><button class="button danger small" data-delete="${escapeHTML(p.id)}">Eliminar</button></div></article>`).join('')}</section>`;
    }).join('') : `<div class="empty">${query ? 'No encontramos productos con esa búsqueda.' : 'No hay productos aún.'}</div>`;
    wireImageFallback(listArea);
    listArea.querySelectorAll('[data-edit]').forEach(b => b.addEventListener('click', () => { editing = products.find(p => p.id === b.dataset.edit); drawForm(); requestAnimationFrame(() => document.querySelector('#productEditorPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })); }));
    listArea.querySelectorAll('[data-delete]').forEach(b => b.addEventListener('click', async () => { const product = products.find(p => p.id === b.dataset.delete); if (!confirm(`¿Eliminar “${product.name}”? Esta acción no se puede deshacer.`)) return; try { await request(`/api/admin/products/${product.id}`, { method: 'DELETE' }); products = products.filter(p => p.id !== product.id); settings.heroProductIds = settings.heroProductIds.filter(id => id !== product.id); settings.featuredProductIds = settings.featuredProductIds.filter(id => id !== product.id); await request('/api/admin/storefront', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(settings) }); drawList(); drawSelectionPanel(); drawForm(); } catch (e) { alert(e.message); } }));
  }
  document.querySelector('#inventorySearch')?.addEventListener('input', drawList);
  document.querySelector('#inventoryCategoryFilter')?.addEventListener('change', drawList);
  document.querySelector('#clearInventorySearch')?.addEventListener('click', () => { const input = document.querySelector('#inventorySearch'); if (!input) return; input.value = ''; input.focus(); drawList(); });
  function drawSelectionPanel() { const mount = document.querySelector('#selectionPanelMount'); if (!mount) return; mount.innerHTML = selectionPanel(products, settings); bindSelectionEvents(); }
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
      const confirmed = await showYhorsConfirm('¿Seguro que quieres guardar este cambio?', 'Se actualizarán la portada y los productos destacados de la página web.');
      if (!confirmed) return;
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
    const confirmed = await showYhorsConfirm('¿Seguro que quieres guardar este cambio?', 'Se actualizarán las clasificaciones del catálogo.');
    if (!confirmed) {
      classifications = await request('/api/admin/classifications').catch(() => classifications);
      renderClassifications(); drawForm();
      return false;
    }
    try { classifications = await request('/api/admin/classifications', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify(classifications) }); renderClassifications(); drawForm(); document.querySelector('#classificationMessage').textContent='✓ Clasificaciones guardadas.'; return true; }
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
    wireImageFallback(formArea);
    document.querySelector('#formTitle').textContent = editing ? `Editar: ${editing.name}` : 'Agregar producto';
    const previewName = document.querySelector('.product-editor-preview-copy strong');
    document.querySelectorAll('[data-open-image-picker]').forEach(button => button.addEventListener('click', () => {
      const slot = Number(button.dataset.openImagePicker || 1);
      const fieldId = slot === 1 ? '#image' : `#image${slot}`;
      const current = document.querySelector(fieldId)?.value || '';
      openProductImagePicker(slot, current, ({ file, url, preview }) => {
        const field = document.querySelector(fieldId);
        const imagePreview = document.querySelector(`#productImagePreview${slot}`);
        if (field) field.value = url || '';
        window.__yhorsPendingImageFiles ||= {};
        if (file) window.__yhorsPendingImageFiles[slot] = file; else delete window.__yhorsPendingImageFiles[slot];
        if (imagePreview) imagePreview.src = preview || placeholder;
        const slotBox = button.closest('.product-image-slot');
        slotBox?.querySelector('small')?.replaceChildren(document.createTextNode(file ? 'Archivo seleccionado · se subirá al guardar' : (url ? 'Imagen cargada por enlace' : 'Sin imagen · puedes agregarla después')));
        slotBox?.querySelector('.product-image-slot-preview')?.classList.toggle('has-image', Boolean(file || url));
      });
    }));
    document.querySelectorAll('[data-open-image-picker]').forEach(button => button.disabled = false);
    document.querySelector('#name')?.addEventListener('input', e => { if (previewName) previewName.textContent = e.target.value.trim() || 'Nuevo producto'; });
    document.querySelector('#cancelEdit')?.addEventListener('click', () => { editing = null; drawForm(); });
    document.querySelector('#category')?.addEventListener('change', event => drawForm({ ...(editing || {}), category: event.target.value }));
    const descriptionEditor = document.querySelector('#descriptionEditor');
    const descriptionField = document.querySelector('#description');
    const richButtons = [...document.querySelectorAll('[data-rich-command]')];
    // No reserializamos una descripción existente si el usuario no la editó.
    // Esto evita que contenteditable/execCommand convierta accidentalmente una
    // descripción rica (listas, negritas y saltos) en texto plano al editar
    // solamente precio, stock, imágenes, etc.
    let descriptionDirty = false;
    const originalDescription = String(editing?.description || '');
    const syncDescription = () => {
      if (descriptionEditor && descriptionField) descriptionField.value = descriptionEditor.innerHTML.trim();
    };
    const markDescriptionDirty = () => {
      descriptionDirty = true;
      syncDescription();
    };
    const updateRichToolbar = () => {
      if (!descriptionEditor) return;
      const commandState = command => { try { return document.queryCommandState(command); } catch { return false; } };
      richButtons.forEach(button => {
        const command = button.dataset.richCommand;
        let active = false;
        if (command === 'bold' || command === 'italic' || command === 'underline' || command === 'insertUnorderedList' || command === 'insertOrderedList') active = commandState(command);
        if (command === 'formatBlock') {
          const selection = window.getSelection();
          const node = selection?.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null;
          const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
          const block = element?.closest?.('h2,h3');
          active = Boolean(block);
        }
        button.classList.toggle('is-active', active);
        button.setAttribute('aria-pressed', String(active));
      });
    };
    const execRichCommand = button => {
      if (!descriptionEditor || descriptionEditor.getAttribute('contenteditable') !== 'true') return;
      descriptionEditor.focus();
      const command = button.dataset.richCommand;
      let value = button.dataset.richValue || null;
      if (command === 'formatBlock') {
        // "Título" funciona como interruptor: al pulsarlo sobre un H2 vuelve a texto normal.
        const selection = window.getSelection();
        const node = selection?.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null;
        const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
        const activeHeading = element?.closest?.('h2,h3');
        value = activeHeading ? 'p' : 'h2';
      }
      document.execCommand(command, false, value);
      markDescriptionDirty();
      updateRichToolbar();
    };
    descriptionEditor?.addEventListener('keydown', event => {
      if (event.key !== 'Enter' || event.ctrlKey || event.metaKey || event.altKey) return;
      const selection = window.getSelection();
      const node = selection?.rangeCount ? selection.getRangeAt(0).commonAncestorContainer : null;
      const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
      const block = element?.closest?.('h2,h3');
      const listItem = element?.closest?.('li');
      if (!descriptionEditor.contains(element || descriptionEditor)) return;

      // En listas dejamos el comportamiento nativo: Enter crea otra viñeta
      // y Enter dos veces sale de la lista como en Word.
      if (listItem) return;

      // El navegador no se comporta igual en todos los contenteditable cuando
      // se usa white-space: pre-wrap. Interceptamos Enter para garantizar que
      // SIEMPRE cree una nueva línea y que quede guardada como HTML.
      event.preventDefault();

      if (block) {
        // Al salir de un título, Enter crea una línea de texto normal.
        const paragraph = document.createElement('p');
        paragraph.appendChild(document.createElement('br'));
        block.parentNode.insertBefore(paragraph, block.nextSibling);
        const range = document.createRange();
        range.setStart(paragraph, 0);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      } else {
        // En texto normal usamos un párrafo real. Si el navegador no soporta
        // insertParagraph correctamente, insertLineBreak deja al menos el
        // salto visible y conserva el formato actual.
        const before = descriptionEditor.innerHTML;
        try { document.execCommand('insertParagraph', false, null); } catch {}
        if (descriptionEditor.innerHTML === before) {
          try { document.execCommand('insertLineBreak', false, null); } catch {}
        }
        if (descriptionEditor.innerHTML === before) {
          try { document.execCommand('insertHTML', false, '<br>'); } catch {}
        }
      }
      markDescriptionDirty();
      updateRichToolbar();
    });
    descriptionEditor?.addEventListener('input', () => { markDescriptionDirty(); updateRichToolbar(); });
    descriptionEditor?.addEventListener('keyup', updateRichToolbar);
    descriptionEditor?.addEventListener('mouseup', updateRichToolbar);
    descriptionEditor?.addEventListener('focus', updateRichToolbar);
    descriptionEditor?.addEventListener('paste', () => setTimeout(() => { markDescriptionDirty(); updateRichToolbar(); }, 0));
    document.querySelectorAll('[data-rich-command]').forEach(button => button.addEventListener('mousedown', event => event.preventDefault()));
    richButtons.forEach(button => button.addEventListener('click', () => execRichCommand(button)));
    if (window.__yhorsRichSelectionHandler) document.removeEventListener('selectionchange', window.__yhorsRichSelectionHandler);
    window.__yhorsRichSelectionHandler = updateRichToolbar;
    document.addEventListener('selectionchange', window.__yhorsRichSelectionHandler);
    updateRichToolbar();
    document.querySelector('#productForm').addEventListener('submit', async event => {
      event.preventDefault(); const form = event.currentTarget; const submit = form.querySelector('[type="submit"]'); const message = document.querySelector('#formMessage');
      if (!form.elements.category.value) { message.className='message error'; message.textContent='Selecciona una categoría antes de guardar el producto.'; form.elements.category.focus(); return; }
      const confirmed = await showYhorsConfirm('¿Seguro que quieres guardar este cambio?', editing ? `Se actualizará el producto <strong>${escapeHTML(editing.name)}</strong>.` : 'Se creará este nuevo producto en el catálogo.');
      if (!confirmed) return;
      submit.disabled = true; message.textContent = 'Guardando…';
      try {
        const data = Object.fromEntries(new FormData(form).entries());
        // La descripción es HTML rico. Si el usuario NO tocó el editor, enviamos
        // exactamente la versión original y jamás una serialización accidental
        // del contenteditable. Si sí la editó, usamos el HTML actual del editor.
        if (editing && !descriptionDirty) {
          data.description = originalDescription;
        } else {
          syncDescription();
          data.description = descriptionField?.value || '';
        }
        delete data.heroOrder; data.published = form.elements.published ? form.elements.published.checked : true; data.featured = form.elements.featured.checked; data.hero = form.elements.hero.checked; data.price = data.salePrice; data.images = [data.image, data.image2, data.image3, data.image4].filter(Boolean);
        const pendingImages = window.__yhorsPendingImageFiles || {};
        for (let slot = 1; slot <= 4; slot++) {
          const file = pendingImages[slot];
          if (!file) continue;
          const uploadData = new FormData(); uploadData.append('image', file);
          const uploaded = await request('/api/admin/upload', { method: 'POST', body: uploadData });
          const urlField = slot === 1 ? 'image' : `image${slot}`;
          data[urlField] = uploaded.image;
          data.images[slot - 1] = uploaded.image;
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
  bindSelectionEvents();
  if (new URLSearchParams(location.search).get('nuevo') === '1') {
    setTimeout(() => {
      document.querySelector('#productEditorPanel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      document.querySelector('#category')?.focus();
    }, 80);
  }
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
  return { ok: true };
}

async function loginWithPasskey() {
  const options = await request('/api/passkey/options');
  const assertion = await nativeStartAuthentication(options);
  await request('/api/passkey/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(assertion) });
  const session = await request('/api/admin/session');
  hideLoginLoading();
  await renderAdminAfterLogin(session);
}

async function renderMyAccount() {
  const me = await request('/api/me').catch(() => null); if (!me) return renderLogin();
  const passkeys = me.passkeys || [];
  app.innerHTML = `<main class="admin-shell"><div class="admin-wrap">
    <header class="account-page-top"><div class="account-page-heading"><a class="brand admin-brand" href="${ADMIN_PATH}/inteligente" data-smooth-route aria-label="YHORS · Panel Administrativo · Ir a YHORS Inteligente"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></a><h1 class="admin-title">Mi cuenta</h1><p class="admin-subtitle">Datos y métodos de inicio de sesión</p></div><div class="account-page-actions"><button class="account-back-button" id="accountBackButton" type="button" aria-label="Volver a la pantalla anterior">← Volver</button>${accountMenu(me)}</div></header>
    <section class="admin-panel users-panel"><div class="section-heading"><div><span class="eyebrow">Cuenta</span><h2>${escapeHTML(me.name)}</h2></div><p>@${escapeHTML(me.username)} · ${escapeHTML(userRoleLabel(me.role))}</p></div>
      <div class="form-grid account-readonly"><div class="field"><label>Nombre</label><input value="${escapeHTML(me.name)}" disabled></div><div class="field"><label>Usuario</label><input value="${escapeHTML(me.username)}" disabled></div><div class="field"><label>Rol</label><input value="${escapeHTML(userRoleLabel(me.role))}" disabled></div><div class="field"><label>Estado</label><input value="Activo" disabled></div></div>
      <hr><div class="section-heading"><div><span class="eyebrow">Inicio de sesión moderno</span><h2>Passkeys</h2></div><p>Windows Hello, huella, Face ID o el método seguro compatible con tu dispositivo.</p></div>
      <div id="myPasskeys">${passkeys.length ? passkeys.map(pk => `<div class="admin-user-card"><div><strong>🔐 ${escapeHTML(pk.name || 'Passkey')}</strong><small>Registrada ${escapeHTML(new Date(pk.createdAt).toLocaleString())}${pk.lastUsedAt ? ` · Último uso ${escapeHTML(new Date(pk.lastUsedAt).toLocaleString())}` : ''}</small></div><button class="button danger small" data-delete-passkey="${escapeHTML(pk.id)}" type="button">Revocar</button></div>`).join('') : '<p class="backup-empty">No tienes Passkeys registradas.</p>'}</div>
      <div class="form-actions"><button class="button primary" id="addPasskey" type="button" ${me.passkeyAllowed ? '' : 'disabled'}>+ Registrar Passkey</button><span class="message" id="passkeyMessage">${me.passkeyAllowed ? 'Permitido en esta cuenta.' : 'El administrador ha bloqueado el inicio con Passkey para esta cuenta.'}</span></div>
    </section></div></main>`;
  wireAccountMenu();
  document.querySelector('#accountBackButton')?.addEventListener('click', () => {
    if (window.history.length > 1) window.history.back();
    else navigateToRoute(`${ADMIN_PATH}/inteligente`, { replace: true });
  });
  document.querySelector('#addPasskey').addEventListener('click', async () => {
    const button = document.querySelector('#addPasskey');
    const message = document.querySelector('#passkeyMessage');
    button.disabled = true;
    message.className = 'message';
    message.textContent = 'Esperando la confirmación de tu dispositivo…';
    try {
      await registerMyPasskey();
      message.className = 'message success';
      message.textContent = '✓ Passkey registrada correctamente.';
      setTimeout(() => renderMyAccount(), 700);
    } catch (e) {
      message.className = e.code === 'PASSKEY_CANCELLED' ? 'message' : 'message error';
      message.textContent = e.message;
      button.disabled = !me.passkeyAllowed;
    }
  });
  document.querySelectorAll('[data-delete-passkey]').forEach(btn => btn.addEventListener('click', async () => { if (!confirm('¿Revocar esta Passkey?')) return; try { await request(`/api/me/passkeys/${encodeURIComponent(btn.dataset.deletePasskey)}`, { method: 'DELETE' }); await renderMyAccount(); } catch (e) { alert(e.message); } }));
}

function showLoginLoading(message = 'Iniciando sesión…') {
  const overlay = document.querySelector('#loginLoadingOverlay');
  if (!overlay) return;
  const text = overlay.querySelector('[data-login-loading-text]');
  if (text) text.textContent = message;
  overlay.hidden = false;
  document.body.classList.add('login-loading-active');
}
function hideLoginLoading() {
  const overlay = document.querySelector('#loginLoadingOverlay');
  if (overlay) overlay.hidden = true;
  document.body.classList.remove('login-loading-active');
}
function loginRequestWithTimeout(url, options, ms = 20000) {
  return Promise.race([
    request(url, options),
    new Promise((_, reject) => setTimeout(() => { const error = new Error('La conexión está tardando demasiado. Revisa tu conexión e inténtalo nuevamente.'); error.code = 'LOGIN_TIMEOUT'; reject(error); }, ms))
  ]);
}

function renderLogin() {
  app.innerHTML = `<main class="login-page"><section class="login-card"><div class="brand admin-brand login-brand" aria-label="YHORS · Panel Administrativo"><span class="admin-brand-mark" aria-hidden="true"><img src="/favicon.svg" alt=""></span><span class="admin-brand-word">YHORS</span><span class="admin-brand-divider" aria-hidden="true"></span><small>Panel Administrativo</small></div><div class="login-private-label">Panel Privado</div><h1>Acceso a YHORS</h1><p>Ingresa con tu cuenta autorizada.</p><form id="loginForm" class="form-grid"><div class="field full"><label for="username">Usuario</label><input id="username" name="username" autocomplete="username webauthn" required></div><div class="field full"><label for="password">Contraseña</label><input id="password" name="password" type="password" autocomplete="current-password" required></div><div class="login-attempts" id="loginAttempts" aria-live="polite"></div><div class="form-actions"><button class="button" id="loginSubmit" type="submit">Iniciar sesión</button><button class="button secondary" id="passkeyLogin" type="button">🔐 Iniciar con Passkey</button><span class="message" id="loginMessage"></span></div></form></section><div class="login-loading-overlay" id="loginLoadingOverlay" hidden role="status" aria-live="polite"><div class="login-loading-card"><div class="login-loading-spinner"></div><strong data-login-loading-text>Iniciando sesión…</strong><small>Estamos preparando YHORS Inteligente</small><div class="login-loading-dots"><i></i><i></i><i></i></div></div></div></main>`;
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
    const total = Math.max(1, Number(seconds || 1));
    const paint = () => {
      const mins = Math.floor(remaining / 60); const secs = remaining % 60;
      const percent = Math.max(0, Math.min(100, (remaining / total) * 100));
      attemptsBox.innerHTML = `<span class="login-countdown-label">Acceso bloqueado por seguridad · <strong>${mins}:${String(secs).padStart(2,'0')}</strong></span><span class="login-countdown-track"><span style="width:${percent}%"></span></span>`;
      attemptsBox.className = 'login-attempts locked countdown';
      submitButton.disabled = true; passkeyButton.disabled = true;
      if (remaining <= 0) { clearInterval(loginLockTimer); attemptsBox.textContent = 'Puedes volver a intentarlo.'; attemptsBox.className = 'login-attempts'; submitButton.disabled = false; passkeyButton.disabled = false; message.textContent = ''; }
      remaining -= 1;
    };
    paint(); loginLockTimer = setInterval(paint, 1000);
  };
  document.querySelector('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      showLoginLoading('Verificando tus credenciales…');
      const result = await loginRequestWithTimeout('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))) });
      const session = await loginRequestWithTimeout('/api/admin/session', undefined, 12000);
      hideLoginLoading();
      await renderAdminAfterLogin(session);
    } catch (error) {
      hideLoginLoading();
      message.className = 'message error';
      if (error.data?.permanentLock) { setLockedUI(0, true); message.textContent = error.message; return; }
      if (error.data?.lockoutSeconds) { setLockedUI(error.data.lockoutSeconds); message.textContent = error.message; return; }
      if (typeof error.data?.attemptsRemaining === 'number') {
        const left = error.data.attemptsRemaining;
        attemptsBox.textContent = left > 0 ? `Intentos restantes: ${left} de 4` : 'El 4.º intento incorrecto bloqueará el acceso durante 1 minuto.';
        attemptsBox.className = 'login-attempts warning';
      }
      message.textContent = error.message;
    }
  });
  passkeyButton.addEventListener('click', async () => { showLoginLoading('Esperando tu Passkey…'); try { await loginWithPasskey(); } catch (error) { hideLoginLoading(); message.className = error.code === 'PASSKEY_CANCELLED' ? 'message' : 'message error'; message.textContent = error.message; } });
}

document.addEventListener('click', event => {
  const link = event.target.closest('a[data-smooth-route]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const href = link.getAttribute('href');
  if (!href) return;
  document.querySelectorAll('.admin-nav-group[open]').forEach(group => { group.open = false; });
  const target = new URL(href, window.location.origin);
  if (target.origin !== window.location.origin) return;
  event.preventDefault();
  // La navegación administrativa se mantiene dentro de la SPA y siempre
  // espera a que la vista destino termine de renderizarse.
  void navigateToRoute(`${target.pathname}${target.search}${target.hash}`).catch(error => {
    console.error('[YHORS] Error de navegación:', error);
    // Si una vista falla por una sesión recién creada o por una respuesta
    // incompleta, un segundo intento controlado evita dejar la pestaña congelada.
    setTimeout(() => renderCurrentRoute(), 0);
  });
});

// El header YHORS mantiene un solo menú de navegación abierto a la vez.
document.addEventListener('click', event => {
  const summary = event.target.closest('.admin-nav-group > summary');
  if (!summary) return;
  const current = summary.closest('.admin-nav-group');
  document.querySelectorAll('.admin-nav-group[open]').forEach(group => {
    if (group !== current) group.open = false;
  });
});

window.addEventListener('popstate', () => renderCurrentRoute());
renderCurrentRoute();

document.addEventListener('change', e => { const file=e.target.closest('input[type=file][id^=\"imageFile\"]'); if(!file)return; const num=file.id==='imageFile'?1:Number(file.id.replace('imageFile','')); const preview=document.querySelector(`#productImagePreview${num}`); if(preview&&file.files?.[0]){const r=new FileReader();r.onload=()=>preview.src=r.result;r.readAsDataURL(file.files[0]);}});
document.addEventListener('input', e => { const input=e.target.closest('input[type=url][id^=\"image\"]'); if(!input)return; const num=input.id==='image'?1:Number(input.id.replace('image','')); const preview=document.querySelector(`#productImagePreview${num}`); if(preview&&input.value.trim())preview.src=input.value.trim();});

/* V14.16 inventory save normalization */
document.addEventListener('click', async function(e){
  const btn=e.target.closest('[data-inventory-save]');
  if(!btn || btn.dataset.v1416Handled) return;
  const card=btn.closest('[data-inventory-id]');
  if(!card) return;
  const get=(name)=>card.querySelector(`[data-field="${name}"]`);
  const stockEl=get('stock');
  if(!stockEl) return;
  const stock=Number(stockEl.value);
  if(Number.isInteger(stock) && stock>=0){
    stockEl.setCustomValidity('');
  }
}, true);

/* V14.23 inventory sync event */
document.addEventListener('orders:stock-synced', async () => {
  try {
    if (typeof loadProducts === 'function') await loadProducts();
    if (typeof renderInventory === 'function') renderInventory();
    if (typeof drawInventory === 'function') drawInventory();
  } catch (_) {}
});

/* YHORS — PDF de una orden específica */
document.addEventListener('click', (event) => {
  const button = event.target.closest('[data-order-pdf]');
  if (!button) return;

  const id = button.getAttribute('data-order-pdf');
  if (!id) return;

  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'GENERANDO…';

  const pdfUrl = `/api/admin/orders/${encodeURIComponent(id)}/pdf?v=${Date.now()}`;
  const pdfLink = document.createElement('a');
  pdfLink.href = pdfUrl;
  pdfLink.target = '_blank';
  pdfLink.rel = 'noopener noreferrer';
  pdfLink.style.display = 'none';
  document.body.appendChild(pdfLink);
  pdfLink.click();
  pdfLink.remove();

  setTimeout(() => {
    button.disabled = false;
    button.textContent = originalText;
  }, 800);
});
