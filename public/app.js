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
function money(value) {
  return new Intl.NumberFormat('es-EC', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(value || 0));
}
function wireImageFallback(scope) {
  scope.querySelectorAll('img[data-fallback]').forEach(image => image.addEventListener('error', () => { image.src = placeholder; }, { once: true }));
}
function productImages(product) {
  const list = Array.isArray(product.images) ? product.images.filter(Boolean) : [];
  if (list.length) return list;
  return product.image ? [product.image] : [placeholder];
}
function getProduct(id, products) { return products.find(item => item.id === id); }
async function request(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.headers || {}) } });
  const json = response.status === 204 ? null : await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || 'No se pudo completar la operación.');
  return json;
}
function getCart() {
  try { return JSON.parse(localStorage.getItem('yhors-cart')) || []; } catch { return []; }
}
function setCart(cart) { localStorage.setItem('yhors-cart', JSON.stringify(cart)); }

async function renderStore() {
  let products = [];
  let storefront = { whatsappNumber: '' };
  try {
    [products, storefront] = await Promise.all([request('/api/products'), request('/api/storefront')]);
  } catch { /* empty state */ }

  let active = 'all';
  let cart = getCart();

  app.innerHTML = `
    <header class="site-header"><div class="bar">
      <a class="brand" href="/">YHORS</a>
      <nav class="nav"><a href="#catalogo">Catálogo</a><a href="#nosotros">La marca</a></nav>
      <button class="cart-button" id="cartButton" aria-label="Abrir carrito"><span>Carrito</span><span class="count" id="cartCount">0</span></button>
    </div></header>
    <main>
      <section class="hero">
        <div class="hero-glow"></div>
        <div class="hero-content">
          <span class="eyebrow">YHORS · Selección especial</span>
          <h1>PIEZAS QUE<br><em>CUENTAN</em> TU HISTORIA</h1>
          <p>Moda, tecnología, detalles y objetos elegidos para convertir cada compra en algo especial.</p>
          <a class="button hero-button" href="#catalogo">Explorar catálogo <span>→</span></a>
        </div>
      </section>
      <section class="section catalog-section" id="catalogo">
        <div class="section-heading">
          <div><span class="eyebrow">Nuestra selección</span><h2>Encuentra tu próxima pieza</h2></div>
          <p>Compra directa · Atención personal</p>
        </div>
        <div class="filters" id="filters"></div><div class="products" id="products"></div>
      </section>
      <section class="brand-section" id="nosotros">
        <div class="brand-section-inner">
          <span class="eyebrow">Sobre YHORS</span>
          <h2>Elegimos productos con<br><em>intención.</em></h2>
          <p>Cada producto se publica y administra directamente desde YHORS, buscando una experiencia sencilla, elegante y personal.</p>
        </div>
      </section>
    </main>
    <footer class="site-footer"><div class="footer-inner">
      <div><span class="brand">YHORS</span><p>© ${new Date().getFullYear()} YHORS. Todos los derechos reservados.</p></div>
      <p>Envíos y pedidos con atención personal.</p>
    </div></footer>
    <div class="modal-backdrop" id="backdrop"></div>
    <aside class="drawer" id="drawer" aria-label="Carrito de compra">
      <div class="drawer-head"><div><span class="eyebrow">Tu selección</span><h2>Carrito</h2></div><button class="icon-close" id="closeCart" aria-label="Cerrar">×</button></div>
      <div class="cart-items" id="cartItems"></div>
      <div class="cart-total"><span>Total</span><span id="cartTotal">$0</span></div>
      <button class="button checkout-button" id="checkout">Finalizar pedido <span>→</span></button>
      <p class="message" id="checkoutMessage"></p>
    </aside>
  `;

  const productArea = document.querySelector('#products');
  const filterArea = document.querySelector('#filters');

  function updateCartCount() {
    const total = cart.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
    document.querySelector('#cartCount').textContent = total;
  }

  function addToCart(product, button) {
    const existing = cart.find(item => item.id === product.id);
    if (existing) existing.quantity += 1;
    else cart.push({ ...product, quantity: 1 });
    setCart(cart); updateCartCount(); drawCart();

    button.disabled = true;
    const original = button.innerHTML;
    button.innerHTML = '<span class="spinner"></span><span>Añadiendo</span>';
    setTimeout(() => {
      button.innerHTML = '<span class="check">✓</span><span>Añadido</span>';
      button.classList.add('added');
      setTimeout(() => { button.innerHTML = original; button.classList.remove('added'); button.disabled = false; }, 850);
    }, 420);
  }

  function drawProducts() {
    filterArea.innerHTML = Object.entries(categories).map(([key, label]) =>
      `<button class="filter ${key === active ? 'active' : ''}" data-filter="${key}">${label}</button>`).join('');

    const visible = products.filter(product => active === 'all' || product.category === active);
    productArea.innerHTML = visible.length ? visible.map(product => {
      const image = productImages(product)[0];
      return `<article class="product" data-product="${escapeHTML(product.id)}">
        <button class="product-open" data-open="${escapeHTML(product.id)}" aria-label="Ver ${escapeHTML(product.name)}">
          <div class="product-image"><img data-fallback src="${escapeHTML(image)}" alt="${escapeHTML(product.name)}" loading="lazy"></div>
          <div class="product-info">
            <span class="product-category">${escapeHTML(categories[product.category] || product.category)}</span>
            <h3>${escapeHTML(product.name)}</h3>
            <p>${escapeHTML(product.description).replace(/\n/g, '<br>')}</p>
            <span class="detail-link">Ver detalles <span>→</span></span>
          </div>
        </button>
        <div class="product-bottom"><span class="price">${money(product.price)}</span><button class="add" data-id="${escapeHTML(product.id)}"><span>Añadir</span><span>+</span></button></div>
      </article>`;
    }).join('') : '<div class="empty">Aún no hay productos en esta categoría.</div>';

    wireImageFallback(productArea);
    filterArea.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
      active = button.dataset.filter; drawProducts();
    }));
    productArea.querySelectorAll('[data-open]').forEach(button => button.addEventListener('click', event => {
      event.preventDefault();
      openProduct(button.dataset.open);
    }));
    productArea.querySelectorAll('.add').forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      const product = getProduct(button.dataset.id, products);
      if (product) addToCart(product, button);
    }));
  }

  function drawCart() {
    const area = document.querySelector('#cartItems');
    area.innerHTML = cart.length ? cart.map(line => {
      const image = productImages(line)[0];
      return `<div class="cart-item">
        <img src="${escapeHTML(image)}" alt="">
        <div class="cart-item-main">
          <h4>${escapeHTML(line.name)}</h4>
          <p class="cart-line-price">${money(line.price)}</p>
          <div class="quantity-control" aria-label="Cantidad">
            <button type="button" data-qty="${escapeHTML(line.id)}" data-change="-1">−</button>
            <input type="number" min="1" value="${Number(line.quantity) || 1}" data-input="${escapeHTML(line.id)}" aria-label="Cantidad de ${escapeHTML(line.name)}">
            <button type="button" data-qty="${escapeHTML(line.id)}" data-change="1">+</button>
          </div>
        </div>
        <button class="remove" data-remove="${escapeHTML(line.id)}">Quitar</button>
      </div>`;
    }).join('') : '<div class="empty cart-empty">Tu carrito está vacío.<br><small>Agrega algo que te guste.</small></div>';

    document.querySelector('#cartTotal').textContent = money(cart.reduce((sum, line) => sum + Number(line.price) * Number(line.quantity), 0));

    area.querySelectorAll('[data-qty]').forEach(button => button.addEventListener('click', () => {
      const line = cart.find(item => item.id === button.dataset.qty);
      if (!line) return;
      line.quantity = Math.max(1, Number(line.quantity) + Number(button.dataset.change));
      setCart(cart); updateCartCount(); drawCart();
    }));
    area.querySelectorAll('[data-input]').forEach(input => input.addEventListener('change', () => {
      const line = cart.find(item => item.id === input.dataset.input);
      if (!line) return;
      line.quantity = Math.max(1, parseInt(input.value || '1', 10));
      setCart(cart); updateCartCount(); drawCart();
    }));
    area.querySelectorAll('[data-remove]').forEach(button => button.addEventListener('click', () => {
      cart = cart.filter(line => line.id !== button.dataset.remove);
      setCart(cart); updateCartCount(); drawCart();
    }));
  }

  function openCart() {
    document.querySelector('#drawer').classList.add('open');
    document.querySelector('#backdrop').classList.add('show');
    document.body.classList.add('no-scroll');
  }
  function closeCart() {
    document.querySelector('#drawer').classList.remove('open');
    document.querySelector('#backdrop').classList.remove('show');
    document.body.classList.remove('no-scroll');
  }
  document.querySelector('#cartButton').addEventListener('click', openCart);
  document.querySelector('#closeCart').addEventListener('click', closeCart);
  document.querySelector('#backdrop').addEventListener('click', closeCart);

  document.querySelector('#checkout').addEventListener('click', () => {
    const message = document.querySelector('#checkoutMessage');
    if (!cart.length) { message.textContent = 'Agrega al menos un producto para continuar.'; return; }
    const details = cart.map(line => `• ${line.quantity} × ${line.name} — ${money(line.price * line.quantity)}`).join('\n');
    const text = `Hola, quiero hacer este pedido de YHORS:\n${details}\n\nTotal: ${money(cart.reduce((sum, line) => sum + line.price * line.quantity, 0))}`;
    if (storefront.whatsappNumber) window.open(`https://wa.me/${storefront.whatsappNumber}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
    else { navigator.clipboard?.writeText(text); message.textContent = 'El resumen del pedido se copió. Configura WHATSAPP_NUMBER en .env para recibir pedidos por WhatsApp.'; }
  });

  function openProduct(id) {
    const product = getProduct(id, products);
    if (!product) return;
    history.pushState({ product: id }, '', `?producto=${encodeURIComponent(id)}`);
    renderProductDetail(product);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function renderProductDetail(product) {
    const images = productImages(product);
    let selected = 0;
    app.innerHTML = `
      <header class="site-header"><div class="bar">
        <a class="brand" href="/" id="detailHome">YHORS</a>
        <nav class="nav"><a href="#catalogo" id="detailCatalog">Catálogo</a><a href="#nosotros">La marca</a></nav>
        <button class="cart-button" id="cartButton" aria-label="Abrir carrito"><span>Carrito</span><span class="count" id="cartCount">0</span></button>
      </div></header>
      <main class="product-detail-page">
        <div class="breadcrumbs"><a href="/" id="backCatalog">Catálogo</a><span>/</span><span>${escapeHTML(categories[product.category] || product.category)}</span><span>/</span><strong>${escapeHTML(product.name)}</strong></div>
        <section class="detail-layout">
          <div class="detail-gallery">
            <div class="detail-main-image"><img id="detailMainImage" data-fallback src="${escapeHTML(images[0])}" alt="${escapeHTML(product.name)}"></div>
            ${images.length > 1 ? `<div class="thumbnail-row">${images.map((image, index) => `<button class="thumb ${index === 0 ? 'active' : ''}" data-image-index="${index}"><img data-fallback src="${escapeHTML(image)}" alt="Imagen ${index + 1}"></button>`).join('')}</div>` : ''}
          </div>
          <div class="detail-copy">
            <span class="eyebrow">${escapeHTML(categories[product.category] || product.category)}</span>
            <h1>${escapeHTML(product.name)}</h1>
            <div class="detail-price">${money(product.price)}</div>
            <div class="detail-divider"></div>
            <h3>Descripción</h3>
            <div class="detail-description">${escapeHTML(product.description).replace(/\n/g, '<br>')}</div>
            <div class="detail-buy">
              <button class="add detail-add" id="detailAdd"><span>Añadir al carrito</span><span>+</span></button>
              <button class="button secondary back-button" id="detailBack">← Volver al catálogo</button>
            </div>
            <div class="detail-note"><span>✓</span> Compra directa y atención personal.</div>
          </div>
        </section>
      </main>
      <div class="modal-backdrop" id="backdrop"></div>
      <aside class="drawer" id="drawer" aria-label="Carrito de compra">
        <div class="drawer-head"><div><span class="eyebrow">Tu selección</span><h2>Carrito</h2></div><button class="icon-close" id="closeCart" aria-label="Cerrar">×</button></div>
        <div class="cart-items" id="cartItems"></div>
        <div class="cart-total"><span>Total</span><span id="cartTotal">$0</span></div>
        <button class="button checkout-button" id="checkout">Finalizar pedido <span>→</span></button>
        <p class="message" id="checkoutMessage"></p>
      </aside>`;

    // La vista de detalle usa exactamente los mismos IDs/controles que el catálogo.
    // Así addToCart(), drawCart() y updateCartCount() funcionan sin depender de otra vista.
    updateCartCount();
    drawCart();

    wireImageFallback(document.querySelector('.product-detail-page'));
    document.querySelectorAll('[data-image-index]').forEach(button => button.addEventListener('click', () => {
      selected = Number(button.dataset.imageIndex);
      document.querySelector('#detailMainImage').src = images[selected];
      document.querySelectorAll('.thumb').forEach(item => item.classList.remove('active'));
      button.classList.add('active');
    }));

    document.querySelector('#detailAdd').addEventListener('click', event => {
      addToCart(product, event.currentTarget);
    });

    // Header y drawer completos dentro de cada publicación.
    document.querySelector('#cartButton').addEventListener('click', openCart);
    document.querySelector('#closeCart').addEventListener('click', closeCart);
    document.querySelector('#backdrop').addEventListener('click', closeCart);

    document.querySelector('#checkout').addEventListener('click', () => {
      const message = document.querySelector('#checkoutMessage');
      if (!cart.length) { message.textContent = 'Agrega al menos un producto para continuar.'; return; }
      const details = cart.map(line => `• ${line.quantity} × ${line.name} — ${money(line.price * line.quantity)}`).join('\\n');
      const text = `Hola, quiero hacer este pedido de YHORS:\\n${details}\\n\\nTotal: ${money(cart.reduce((sum, line) => sum + line.price * line.quantity, 0))}`;
      if (storefront.whatsappNumber) window.open(`https://wa.me/${storefront.whatsappNumber}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
      else { navigator.clipboard?.writeText(text); message.textContent = 'El resumen del pedido se copió. Configura WHATSAPP_NUMBER en .env para recibir pedidos por WhatsApp.'; }
    });

    const returnCatalog = event => {
      event?.preventDefault();
      closeCart();
      history.pushState({}, '', '/');
      renderStore();
    };
    document.querySelector('#backCatalog').addEventListener('click', returnCatalog);
    document.querySelector('#detailHome').addEventListener('click', returnCatalog);
    document.querySelector('#detailCatalog')?.addEventListener('click', returnCatalog);
    document.querySelector('#detailBack').addEventListener('click', returnCatalog);
  }

  window.addEventListener('popstate', () => renderStore());
  const productId = new URLSearchParams(location.search).get('producto');
  if (productId) {
    const product = getProduct(productId, products);
    if (product) renderProductDetail(product); else drawProducts();
  } else {
    drawProducts();
  }
  updateCartCount(); drawCart();
}

function productForm(product = {}) {
  const images = Array.isArray(product.images) && product.images.length ? product.images : (product.image ? [product.image] : []);
  return `<form id="productForm">
    <div class="form-grid">
      <div class="field"><label for="name">Nombre</label><input id="name" name="name" required maxlength="90" value="${escapeHTML(product.name || '')}"></div>
      <div class="field"><label for="price">Precio (USD)</label><input id="price" name="price" required min="0" step="0.01" type="number" value="${escapeHTML(product.price ?? '')}"></div>
      <div class="field"><label for="category">Categoría</label><select id="category" name="category" required>${Object.entries(categories).filter(([key]) => key !== 'all').map(([key, label]) => `<option value="${key}" ${product.category === key ? 'selected' : ''}>${label}</option>`).join('')}</select></div>
      <div class="field"><label for="imageFile">Subir foto principal (máx. 5 MB)</label><input id="imageFile" name="imageFile" type="file" accept="image/jpeg,image/png,image/webp,image/gif"></div>
      <div class="field full"><label for="image">URL de imagen principal</label><input id="image" name="image" type="url" placeholder="https://..." value="${escapeHTML(images[0] || product.image || '')}"></div>
      <div class="field full"><label for="image2">Imagen adicional 2 · URL</label><input id="image2" name="image2" type="url" placeholder="https://..." value="${escapeHTML(images[1] || '')}"></div>
      <div class="field full"><label for="image3">Imagen adicional 3 · URL</label><input id="image3" name="image3" type="url" placeholder="https://..." value="${escapeHTML(images[2] || '')}"></div>
      <div class="field full"><label for="image4">Imagen adicional 4 · URL</label><input id="image4" name="image4" type="url" placeholder="https://..." value="${escapeHTML(images[3] || '')}"></div>
      <div class="field full"><label for="description">Descripción completa</label><textarea id="description" name="description" required maxlength="2000" rows="9" placeholder="Escribe aquí toda la información del producto...">${escapeHTML(product.description || '')}</textarea><small class="field-help">Puedes usar saltos de línea y emojis. Se mostrarán en la página de detalle.</small></div>
      <div class="field full featured-field"><label><input id="featured" name="featured" type="checkbox" ${product.featured ? 'checked' : ''}> Mostrar como destacado</label></div>
    </div>
    <div class="form-actions"><button class="button" type="submit">${product.id ? 'Guardar cambios' : 'Crear producto'}</button><button class="button secondary ${product.id ? '' : 'hidden'}" type="button" id="cancelEdit">Cancelar</button><span class="message" id="formMessage"></span></div>
  </form>`;
}

async function renderAdmin() {
  const session = await request('/api/admin/session').catch(() => ({ authenticated: false }));
  if (!session.authenticated) return renderLogin();
  let products = await request('/api/admin/products').catch(() => []);
  let editing = null;
  app.innerHTML = `<main class="admin-shell"><div class="admin-wrap">
    <div class="admin-top"><div><a class="brand" href="/">YHORS</a><h1 class="admin-title">Administración</h1></div><button class="button secondary" id="logout">Cerrar sesión</button></div>
    <section class="admin-panel"><span class="eyebrow">Catálogo</span><h2 id="formTitle">Agregar producto</h2><div id="formArea"></div></section>
    <section class="admin-products"><div class="section-heading"><div><span class="eyebrow">Inventario</span><h2>Productos publicados (${products.length})</h2></div><p>Edita nombre, precio, categoría, imágenes y descripción.</p></div><div id="adminProducts"></div></section>
  </div></main>`;

  const formArea = document.querySelector('#formArea');
  const listArea = document.querySelector('#adminProducts');

  function drawList() {
    listArea.innerHTML = products.length ? products.map(product => {
      const image = productImages(product)[0];
      return `<article class="admin-product"><img data-fallback src="${escapeHTML(image)}" alt=""><div><h3>${escapeHTML(product.name)} ${product.featured ? '<span class="featured-star">★</span>' : ''}</h3><p>${escapeHTML(categories[product.category] || product.category)} · ${money(product.price)} · ${productImages(product).length} imagen(es)</p></div><div class="admin-actions"><button class="button secondary small" data-edit="${escapeHTML(product.id)}">Editar</button><button class="button danger small" data-delete="${escapeHTML(product.id)}">Eliminar</button></div></article>`;
    }).join('') : '<div class="empty">No hay productos aún.</div>';

    wireImageFallback(listArea);
    listArea.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => {
      editing = products.find(product => product.id === button.dataset.edit);
      drawForm(); window.scrollTo({ top: 0, behavior: 'smooth' });
    }));
    listArea.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', async () => {
      const product = products.find(item => item.id === button.dataset.delete);
      if (!confirm(`¿Eliminar “${product.name}”? Esta acción no se puede deshacer.`)) return;
      try {
        await request(`/api/admin/products/${product.id}`, { method: 'DELETE' });
        products = products.filter(item => item.id !== product.id);
        drawList(); drawForm();
      } catch (error) { alert(error.message); }
    }));
  }

  function drawForm() {
    formArea.innerHTML = productForm(editing || {});
    document.querySelector('#formTitle').textContent = editing ? `Editar: ${editing.name}` : 'Agregar producto';
    const form = document.querySelector('#productForm');
    const message = document.querySelector('#formMessage');

    document.querySelector('#cancelEdit')?.addEventListener('click', () => { editing = null; drawForm(); });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const submit = form.querySelector('[type="submit"]');
      submit.disabled = true; message.textContent = 'Guardando…';
      try {
        const data = Object.fromEntries(new FormData(form).entries());
        data.featured = form.elements.featured.checked;
        data.images = [data.image, data.image2, data.image3, data.image4].filter(Boolean);
        const file = form.elements.imageFile.files[0];
        if (file) {
          const uploadData = new FormData(); uploadData.append('image', file);
          const uploaded = await request('/api/admin/upload', { method: 'POST', body: uploadData });
          data.image = uploaded.image;
          data.images[0] = uploaded.image;
        }
        const url = editing ? `/api/admin/products/${editing.id}` : '/api/admin/products';
        const product = await request(url, {
          method: editing ? 'PUT' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        products = editing ? products.map(item => item.id === product.id ? product : item) : [product, ...products];
        editing = null; drawList(); drawForm();
      } catch (error) {
        message.className = 'message error'; message.textContent = error.message; submit.disabled = false;
      }
    });
  }

  document.querySelector('#logout').addEventListener('click', async () => {
    await request('/api/logout', { method: 'POST' }); renderLogin();
  });
  drawList(); drawForm();
}

function renderLogin() {
  app.innerHTML = `<main class="login-page"><section class="login-card"><a class="brand" href="/">YHORS</a><span class="eyebrow">Panel privado</span><h1>Acceso a YHORS</h1><p>Ingresa con la cuenta de administración para actualizar el catálogo.</p><form id="loginForm" class="form-grid"><div class="field full"><label for="username">Usuario</label><input id="username" name="username" autocomplete="username" required></div><div class="field full"><label for="password">Contraseña</label><input id="password" name="password" type="password" autocomplete="current-password" required></div><div class="form-actions"><button class="button" type="submit">Iniciar sesión</button><span class="message" id="loginMessage"></span></div></form></section></main>`;
  document.querySelector('#loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const message = document.querySelector('#loginMessage');
    const form = event.currentTarget;
    try {
      await request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(new FormData(form))) });
      renderAdmin();
    } catch (error) { message.className = 'message error'; message.textContent = error.message; }
  });
}

if (window.location.pathname === ADMIN_PATH || window.location.pathname === `${ADMIN_PATH}/`) renderAdmin();
else renderStore();
