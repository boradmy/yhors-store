/* YHORS STORE · Arranque visible compatible con la CSP del servidor.
 * No usar un <script> inline: la CSP activa es script-src 'self'.
 * Mantener este archivo como script sin async/defer, antes del <body>.
 */
(function () {
  'use strict';
  document.documentElement.classList.add('yh-store-booting');
  var finished = false;
  var slowTimer = 0;
  var recoveryTimer = 0;
  var $ = function (id) { return document.getElementById(id); };

  function removeBoot() {
    if (finished) return;
    finished = true;
    window.clearTimeout(slowTimer);
    window.clearTimeout(recoveryTimer);
    var screen = $('yhBootScreen');
    if (screen) {
      screen.classList.add('yh-boot-finished');
      screen.setAttribute('aria-hidden','true');
      screen.style.pointerEvents = 'none';
    }
    document.documentElement.classList.remove('yh-store-booting');
    if (screen) window.setTimeout(function () { screen.remove(); }, 550);
  }

  function offerRecovery(message) {
    if (finished) return;
    var status = $('yhBootStatus');
    if (status && message) status.textContent = message;
    var recovery = $('yhBootRecovery');
    if (recovery) recovery.hidden = false;
  }

  window.yhorsBootComplete = removeBoot;
  window.yhorsBootFailed = function () {
    offerRecovery('No pudimos completar la carga del catálogo.');
  };
  window.yhorsBootShowCatalog = removeBoot;

  document.addEventListener('DOMContentLoaded', function () {
    var retry = $('yhBootRetry');
    var basic = $('yhBootBasicCatalog');
    if (retry) retry.addEventListener('click', function () { window.location.reload(); });
    if (basic) basic.addEventListener('click', removeBoot);

    slowTimer = window.setTimeout(function () {
      if (finished) return;
      var status = $('yhBootStatus');
      if (status) status.textContent = 'Preparando tus productos y promociones…';
    }, 6500);

    recoveryTimer = window.setTimeout(function () {
      offerRecovery('La conexión está tardando. Puedes reintentar o abrir el catálogo básico.');
    }, 18000);
  });

  window.addEventListener('error', function (event) {
    if (event.target && event.target.tagName === 'SCRIPT' && /\/app\.js/.test(event.target.src || '')) {
      offerRecovery('No se pudo cargar la tienda. Prueba a actualizar la página.');
    }
  }, true);

  // Mantener el registro del SW fuera del HTML para respetar la CSP.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('/store-sw.js', { scope:'/' }).catch(function () {});
    });
  }
}());
