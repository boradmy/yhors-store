const app = document.querySelector('#app');
const ADMIN_PATH = '/yhors/admin593';
const categories = {
  all: 'Todo', elegant: 'Elegant', sports: 'Sports', tech: 'Tech', cosplay: 'Cosplay',
  pets: 'Pets', details: 'Details', collectibles: 'Coleccionables'
};
const placeholder = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="800" height="800"%3E%3Crect width="100%25" height="100%25" fill="%23e8e5de"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" fill="%23706d66" font-family="Arial" font-size="32"%3EYHORS%3C/text%3E%3C/svg%3E';

function escapeHTML(value = '') {
  return String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
}
function money(value) { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value || 0)); }
function wireImageFallback(scope) { scope.querySelectorAll('img[data-fallback]').forEach(image => image.addEventListener('error', () => { image.src = placeholder; }, { once: true })); }
async function request(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.headers || {}) } });
  const json = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || 'No se pudo completar la operación.');
  return json;
}
function getCart() { try { return JSON.parse(localStorage.getItem('yhors-cart')) || []; } catch { return []; } }
function setCart(cart) { localStorage.setItem('yhors-cart', JSON.stringify(cart)); }

async function renderStore() {
  let products = [];
  let storefront = { whatsappNumber: '' };
  try { [products, storefront] = await Promise.all([request('/api/products'), request('/api/storefront')]); } catch { /* the UI below communicates the empty state */ }
  let active = 'all';
  let cart = getCart();
  app.innerHTML = `
    <header class="site-header"><div class="bar">
      <a class="brand" href="/">YHORS</a>
      <nav class="nav"><a href="#catalogo">Catálogo</a><a href="#nosotros">La marca</a></nav>
      <button class="cart-button" id="cartButton" aria-label="Abrir carrito">Carrito <span class="count" id="cartCount">0</span></button>
    </div></header>
    <main>
      <section class="hero"><div><span class="eyebrow">Piezas que cuentan tu historia</span><h1>YHORS</h1><p>Una selección cuidada de moda, tecnología, detalles y objetos que hacen la diferencia.</p><a class="button" href="#catalogo">Ver productos</a></div></section>
      <section class="section" id="catalogo"><div class="section-heading"><div><span class="eyebrow">Catálogo</span><h2>Encuentra tu próxima pieza</h2></div><p>Compra directa y atención personal.</p></div>
      <div class="filters" id="filters"></div><div class="products" id="products"></div></section>
      <section class="section" id="nosotros"><div class="section-heading"><div><span class="eyebrow">YHORS</span><h2>Selección con intención</h2></div><p>Cada producto se publica y administra directamente por la tienda.</p></div></section>
    </main>
    <footer class="site-footer"><div class="footer-inner"><div><span class="brand">YHORS</span><p>© ${new Date().getFullYear()} YHORS. Todos los derechos reservados.</p></div><p>Envíos y pedidos con atención personal.</p></div></footer>
    <div class="modal-backdrop" id="backdrop"></div>
    <aside class="drawer" id="drawer" aria-label="Carrito de compra"><div class="drawer-head"><h2>Tu carrito</h2><button class="icon-close" id="closeCart" aria-label="Cerrar">×</button></div><div class="cart-items" id="cartItems"></div><div class="cart-total"><span>Total</span><span id="cartTotal">$0</span></div><button class="button" id="checkout">Finalizar pedido</button><p class="message" id="checkoutMessage"></p></aside>`;

  const productArea = document.querySelector('#products');
  const filterArea = document.querySelector('#filters');
  function updateCartCount() { document.querySelector('#cartCount').textContent = cart.reduce((sum, line) => sum + line.quantity, 0); }
  function drawProducts() {
    filterArea.innerHTML = Object.entries(categories).map(([key, label]) => `<button class="filter ${key === active ? 'active' : ''}" data-filter="${key}">${label}</button>`).join('');
    const visible = products.filter(product => active === 'all' || product.category === active);
    productArea.innerHTML = visible.length ? visible.map(product => `<article class="product"><div class="product-image"><img data-fallback src="${escapeHTML(product.image || placeholder)}" alt="${escapeHTML(product.name)}" loading="lazy"></div><div class="product-info"><span class="product-category">${escapeHTML(categories[product.category] || product.category)}</span><h3>${escapeHTML(product.name)}</h3><p>${escapeHTML(product.description)}</p><div class="product-bottom"><span class="price">${money(product.price)}</span><button class="add" data-id="${escapeHTML(product.id)}">Añadir</button></div></div></article>`).join('') : '<div class="empty">Aún no hay productos en esta categoría.</div>';
    wireImageFallback(productArea);
    filterArea.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => { active = button.dataset.filter; drawProducts(); }));
    productArea.querySelectorAll('.add').forEach(button => button.addEventListener('click', () => {
      const product = products.find(item => item.id === button.dataset.id);
      const existing = cart.find(item => item.id === product.id);
      if (existing) existing.quantity += 1; else cart.push({ ...product, quantity: 1 });
      setCart(cart); updateCartCount(); drawCart();
    }));
  }
  function drawCart() {
    const area = document.querySelector('#cartItems');
    area.innerHTML = cart.length ? cart.map(line => `<div class="cart-item"><img src="${escapeHTML(line.image || placeholder)}" alt=""><div><h4>${escapeHTML(line.name)}</h4><p>${line.quantity} × ${money(line.price)}</p></div><button class="remove" data-remove="${escapeHTML(line.id)}">Quitar</button></div>`).join('') : '<div class="empty">Tu carrito está vacío.</div>';
    document.querySelector('#cartTotal').textContent = money(cart.reduce((sum, line) => sum + Number(line.price) * line.quantity, 0));
    area.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => { cart = cart.filter(line => line.id !== button.dataset.remove); setCart(cart); updateCartCount(); drawCart(); }));
  }
  document.querySelector('#cartButton').addEventListener('click', () => { document.querySelector('#drawer').classList.add('open'); document.querySelector('#backdrop').classList.add('show'); });
  const close = () => { document.querySelector('#drawer').classList.remove('open'); document.querySelector('#backdrop').classList.remove('show'); };
  document.querySelector('#closeCart').addEventListener('click', close); document.querySelector('#backdrop').addEventListener('click', close);
  document.querySelector('#checkout').addEventListener('click', () => {
    const message = document.querySelector('#checkoutMessage');
    if (!cart.length) { message.textContent = 'Agrega al menos un producto para continuar.'; return; }
    const details = cart.map(line => `• ${line.quantity} × ${line.name} — ${money(line.price * line.quantity)}`).join('\n');
    const text = `Hola, quiero hacer este pedido de YHORS:\n${details}\n\nTotal: ${money(cart.reduce((sum, line) => sum + line.price * line.quantity, 0))}`;
    if (storefront.whatsappNumber) window.open(`https://wa.me/${storefront.whatsappNumber}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    else { navigator.clipboard?.writeText(text); message.textContent = 'El resumen del pedido se copió. Configura WHATSAPP_NUMBER en .env para recibir pedidos por WhatsApp.'; }
  });
  drawProducts(); updateCartCount(); drawCart();
}

function productForm(product = {}) {
  return `<form id="productForm"><div class="form-grid">
    <div class="field"><label for="name">Nombre</label><input id="name" name="name" required maxlength="90" value="${escapeHTML(product.name || '')}"></div>
    <div class="field"><label for="price">Precio (USD)</label><input id="price" name="price" required min="0" step="0.01" type="number" value="${escapeHTML(product.price ?? '')}"></div>
    <div class="field"><label for="category">Categoría</label><select id="category" name="category" required>${Object.entries(categories).filter(([key]) => key !== 'all').map(([key, label]) => `<option value="${key}" ${product.category === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
    <div class="field"><label for="imageFile">Subir foto (máx. 5 MB)</label><input id="imageFile" name="imageFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></div>
    <div class="field full"><label for="image">o URL de imagen</label><input id="image" name="image" type="url" placeholder="https://..." value="${escapeHTML(product.image || '')}"></div>
    <div class="field full"><label for="description">Descripción</label><textarea id="description" name="description" required maxlength="300">${escapeHTML(product.description || '')}</textarea></div>
    <div class="field full"><label><input id="featured" name="featured" type="checkbox" ${product.featured ? 'checked' : ''}> Mostrar como destacado</label></div>
  </div><div class="form-actions"><button class="button" type="submit">${product.id ? 'Guardar cambios' : 'Crear producto'}</button><button class="button secondary ${product.id ? '' : 'hidden'}" type="button" id="cancelEdit">Cancelar</button><span class="message" id="formMessage"></span></div></form>`;
}

async function renderAdmin() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated: false }));
  if (!session.authenticated) return renderLogin();
  let products = await request('/api/admin/products').catch(() => []);
  let editing = null;
  app.innerHTML = `<main class="admin-shell"><div class="admin-wrap"><div class="admin-top"><div><a class="brand" href="/">YHORS</a><h1 class="admin-title">Administración</h1></div><button class="button secondary" id="logout">Cerrar sesión</button></div><section class="admin-panel"><span class="eyebrow">Catálogo</span><h2>${editing ? 'Editar producto' : 'Agregar producto'}</h2><div id="formArea"></div></section><section class="admin-products"><div class="section-heading"><div><span class="eyebrow">Inventario</span><h2>Productos publicados (${products.length})</h2></div></div><div id="adminProducts"></div></section></div></main>`;
  const formArea = document.querySelector('#formArea'); const listArea = document.querySelector('#adminProducts');
  function drawList() {
    listArea.innerHTML = products.length ? products.map(product => `<article class="admin-product"><img data-fallback src="${escapeHTML(product.image || placeholder)}" alt=""><div><h3>${escapeHTML(product.name)} ${product.featured ? '★' : ''}</h3><p>${escapeHTML(categories[product.category] || product.category)} · ${money(product.price)}</p></div><div class="admin-actions"><button class="button secondary small" data-edit="${escapeHTML(product.id)}">Editar</button><button class="button danger small" data-delete="${escapeHTML(product.id)}">Eliminar</button></div></article>`).join('') : '<div class="empty">No hay productos aún.</div>';
    wireImageFallback(listArea);
    listArea.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => { editing = products.find(product => product.id === button.dataset.edit); drawForm(); window.scrollTo({ top: 0, behavior: 'smooth' }); }));
    listArea.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', async () => { const product = products.find(item => item.id === button.dataset.delete); if (!confirm(`¿Eliminar “${product.name}”? Esta acción no se puede deshacer.`)) return; try { await request(`/api/admin/products/${product.id}`, { method: 'DELETE' }); products = products.filter(item => item.id !== product.id); drawList(); } catch (error) { alert(error.message); } }));
  }
  function drawForm() {
    formArea.innerHTML = productForm(editing || {});
    const form = document.querySelector('#productForm'); const message = document.querySelector('#formMessage');
    document.querySelector('#cancelEdit')?.addEventListener('click', () => { editing = null; drawForm(); });
    form.addEventListener('submit', async event => { event.preventDefault(); const submit = form.querySelector('[type="submit"]'); submit.disabled = true; message.textContent = 'Guardando…'; try { const data = Object.fromEntries(new FormData(form).entries()); data.featured = form.elements.featured.checked; const file = form.elements.imageFile.files[0]; if (file) { const uploadData = new FormData(); uploadData.append('image', file); const uploaded = await request('/api/admin/upload', { method: 'POST', body: uploadData }); data.image = uploaded.image; } const url = editing ? `/api/admin/products/${editing.id}` : '/api/admin/products'; const product = await request(url, { method: editing ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }); products = editing ? products.map(item => item.id === product.id ? product : item) : [product, ...products]; editing = null; drawList(); drawForm(); } catch (error) { message.className = 'message error'; message.textContent = error.message; submit.disabled = false; } });
  }
  document.querySelector('#logout').addEventListener('click', async () => { await request('/api/logout', { method: 'POST' }); renderLogin(); });
  drawList(); drawForm();
}

function renderLogin() {
  app.innerHTML = `<main class="login-page"><section class="login-card"><a class="brand" href="/">YHORS</a><h1>Acceso privado</h1><p>Ingresa con la cuenta de administración para actualizar el catálogo.</p><form id="loginForm" class="form-grid"><div class="field full"><label for="username">Usuario</label><input id="username" name="username" autocomplete="username" required></div><div class="field full"><label for="password">Contraseña</label><input id="password" name="password" type="password" autocomplete="current-password" required></div><div class="form-actions"><button class="button" type="submit">Iniciar sesión</button><span class="message" id="loginMessage"></span></div></form></section></main>`;
  document.querySelector('#loginForm').addEventListener('submit', async event => { event.preventDefault(); const message = document.querySelector('#loginMessage'); const form = event.currentTarget; try { await request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) }); renderAdmin(); } catch (error) { message.className = 'message error'; message.textContent = error.message; } });
}

if (window.location.pathname === ADMIN_PATH || window.location.pathname === `${ADMIN_PATH}/`) renderAdmin(); else renderStore();
