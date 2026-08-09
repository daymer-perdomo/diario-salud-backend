/// Widget embebible del chatbot de inventario (ver plan
/// kind-giggling-cerf.md, Fase 5). Se incluye en el sitio WordPress de la
/// farmacia con un simple <script src=".../widget/chatbot.js">. Vanilla
/// JS, sin dependencias -- usa Shadow DOM para que el CSS de este widget
/// nunca choque con el theme de WordPress (y viceversa: el theme nunca le
/// pisa el estilo al widget).
(function () {
  'use strict';

  var CURRENT_SCRIPT = document.currentScript;
  var STORAGE_KEY = 'ecofarma_chat_conversation_id';

  function resolveApiBaseUrl() {
    if (CURRENT_SCRIPT && CURRENT_SCRIPT.dataset && CURRENT_SCRIPT.dataset.apiBaseUrl) {
      return CURRENT_SCRIPT.dataset.apiBaseUrl.replace(/\/$/, '');
    }
    if (CURRENT_SCRIPT && CURRENT_SCRIPT.src) {
      return new URL(CURRENT_SCRIPT.src).origin;
    }
    return '';
  }

  var API_BASE_URL = resolveApiBaseUrl();
  /// Ruta absoluta: el widget se embebe en el sitio de WordPress (otro
  /// origen), asi que una ruta relativa a /assets/... resolveria contra el
  /// dominio de WordPress en vez del backend (mismo bug que ya se dio con
  /// el fallback de imagen de Diario de la Salud -- ver
  /// default-article-image.util.ts).
  var AVATAR_URL = API_BASE_URL + '/assets/chatbot-avatar.png';
  var BRAND_BLUE = '#12238f';

  var STYLES = `
    :host, * { box-sizing: border-box; }
    /* bottom:20px es solo el valor de arranque -- positionAboveCart() lo
       corrige en caliente si detecta el boton flotante del carrito
       (.xoo-wsc-basket) para que el FAB quede siempre justo encima de el,
       sin importar el dispositivo o si el tema tiene una barra de
       navegacion movil debajo (ver esa funcion mas abajo). */
    .fab {
      position: fixed; bottom: 20px; right: 20px; width: 64px; height: 64px; border-radius: 50%;
      background: #fff; border: none; cursor: pointer; box-shadow: 0 6px 18px rgba(0,0,0,.2);
      display: flex; align-items: center; justify-content: center; z-index: 999999; padding: 0; overflow: hidden;
    }
    .fab:hover { box-shadow: 0 8px 22px rgba(0,0,0,.3); }
    .fab img { width: 100%; height: 100%; object-fit: contain; display: block; }
    .panel {
      position: fixed; bottom: 96px; right: 20px; width: 440px; max-width: calc(100vw - 32px);
      height: 560px; max-height: calc(100vh - 120px); background: #fff; border-radius: 14px;
      box-shadow: 0 10px 40px rgba(0,0,0,.25); display: flex; flex-direction: column; overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; z-index: 999999;
    }
    .panel.hidden { display: none; }
    .header { background: ${BRAND_BLUE}; color: #fff; padding: 14px 16px; font-size: 14px; font-weight: 600; display: flex; align-items: center; gap: 10px; }
    .header img { height: 36px; width: 36px; object-fit: contain; border-radius: 50%; background: #fff; flex-shrink: 0; }
    .header small { display: block; font-weight: 400; opacity: .85; font-size: 11px; margin-top: 2px; }
    .messages { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 8px; background: #f8fafc; }
    .msg { max-width: 85%; padding: 8px 12px; border-radius: 12px; font-size: 13px; line-height: 1.4; white-space: pre-wrap; }
    .msg.user { align-self: flex-end; background: ${BRAND_BLUE}; color: #fff; border-bottom-right-radius: 3px; }
    .msg.bot { align-self: flex-start; background: #fff; color: #1e293b; border: 1px solid #e2e8f0; border-bottom-left-radius: 3px; }
    .msg.error { align-self: flex-start; background: #fef2f2; color: #b91c1c; border: 1px solid #fecaca; }
    .msg.notice { align-self: flex-start; background: #fffbeb; color: #92400e; border: 1px solid #fde68a; }
    .typing { align-self: flex-start; font-size: 12px; color: #64748b; padding: 0 12px; }
    .composer { display: flex; gap: 8px; padding: 10px; border-top: 1px solid #e2e8f0; background: #fff; }
    .composer input {
      flex: 1; border: 1px solid #cbd5e1; border-radius: 20px; padding: 8px 14px; font-size: 13px; outline: none;
    }
    .composer input:focus { border-color: ${BRAND_BLUE}; }
    .composer button {
      background: ${BRAND_BLUE}; color: #fff; border: none; border-radius: 20px; padding: 0 16px; cursor: pointer; font-size: 13px;
    }
    .composer button:disabled { opacity: .5; cursor: default; }
    .qty-input { width: 42px; border: 1px solid #cbd5e1; border-radius: 6px; padding: 3px 4px; font-size: 12px; }
    .add-btn { background: ${BRAND_BLUE}; color: #fff; border: none; border-radius: 6px; padding: 4px 8px; font-size: 11px; cursor: pointer; white-space: nowrap; margin-top: 4px; }
    .add-btn:disabled { opacity: .5; cursor: default; }
    .store-link { color: ${BRAND_BLUE}; font-size: 11px; font-weight: 600; text-decoration: underline; white-space: nowrap; margin-top: 4px; display: inline-block; }
    .row-actions { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; }
    /* Carrusel horizontal SIEMPRE (sin importar cuantos resultados haya) --
       pedido explicito del usuario 2026-08-09, inspirado en la referencia
       del chatbot "Sommer" de Farmatodo. Reemplaza el diseno anterior
       (tarjetas para 1-2, tabla para 3+). */
    .products-carousel { align-self: stretch; display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; scroll-snap-type: x proximity; -webkit-overflow-scrolling: touch; }
    .product-card {
      flex: 0 0 132px; width: 132px; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
      overflow: hidden; display: flex; flex-direction: column; scroll-snap-align: start;
    }
    .product-card .thumb { width: 100%; height: 96px; object-fit: cover; background: #f1f5f9; display: block; }
    .product-card-body { padding: 10px; display: flex; flex-direction: column; gap: 3px; flex: 1; }
    .product-card-name { font-size: 12.5px; font-weight: 600; line-height: 1.3; }
    .product-card-lab { color: #64748b; font-size: 10.5px; }
    .product-card-price { font-size: 15px; font-weight: 700; color: ${BRAND_BLUE}; margin-top: 4px; }
    .product-card-stock { font-size: 10.5px; color: #64748b; }
    .product-card .row-actions { flex-direction: row; align-items: center; margin-top: 6px; }
    .product-card .add-btn { flex: 1; padding: 6px 8px; border-radius: 20px; font-size: 12px; }
    .cart-bar { border-top: 1px solid #e2e8f0; background: #fff; }
    .cart-bar.hidden { display: none; }
    .cart-summary { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; cursor: pointer; font-size: 12px; color: #1e293b; }
    .cart-summary strong { color: ${BRAND_BLUE}; }
    .cart-details { padding: 0 12px 10px; display: none; }
    .cart-details.open { display: block; }
    .cart-item-row { display: flex; align-items: center; justify-content: space-between; font-size: 12px; padding: 4px 0; border-bottom: 1px solid #f1f5f9; }
    .cart-item-remove { background: none; border: none; color: #b91c1c; cursor: pointer; font-size: 14px; padding: 0 4px; }
    .cart-submit-btn { width: 100%; margin-top: 8px; background: ${BRAND_BLUE}; color: #fff; border: none; border-radius: 8px; padding: 8px; font-size: 12px; cursor: pointer; }
    .cart-form { display: flex; flex-direction: column; gap: 6px; margin-top: 8px; }
    .cart-form input {
      border: 1px solid #cbd5e1; border-radius: 8px; padding: 7px 10px; font-size: 12px; outline: none;
    }
    .cart-form-actions { display: flex; gap: 6px; }
    .cart-form-actions button { flex: 1; border-radius: 8px; padding: 7px; font-size: 12px; cursor: pointer; }
    .cart-form-actions .confirm { background: ${BRAND_BLUE}; color: #fff; border: none; }
    .cart-form-actions .cancel { background: #f1f5f9; color: #334155; border: 1px solid #e2e8f0; }
    .menu-block { align-self: center; width: 82%; display: flex; flex-direction: column; gap: 8px; margin: 4px 0; }
    .menu-btn {
      width: 100%; background: #fff; border: 1px solid ${BRAND_BLUE}; color: ${BRAND_BLUE}; border-radius: 18px;
      padding: 9px 14px; font-size: 12.5px; cursor: pointer; text-align: center;
    }
    .menu-btn:hover { background: #eef1fd; }
    .menu-btn-disabled, .menu-btn-disabled:hover {
      background: #f8fafc; border-color: #cbd5e1; color: #94a3b8; cursor: not-allowed;
    }
    .composer .menu-toggle {
      background: #fff; border: 1px solid #cbd5e1; color: #334155; border-radius: 50%;
      width: 34px; height: 34px; padding: 0; font-size: 15px; cursor: pointer; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
    }
    .composer .menu-toggle:hover { background: #f1f5f9; }
    .ref-form { align-self: center; width: 82%; display: flex; gap: 6px; margin: 4px 0; }
    .ref-form input {
      flex: 1; border: 1px solid #cbd5e1; border-radius: 8px; padding: 7px 10px; font-size: 12px; outline: none;
    }
    .ref-form button { background: ${BRAND_BLUE}; color: #fff; border: none; border-radius: 8px; padding: 7px 12px; font-size: 12px; cursor: pointer; }
  `;

  function escapeHtml(value) {
    var div = document.createElement('div');
    div.textContent = value == null ? '' : String(value);
    return div.innerHTML;
  }

  function formatPrice(price) {
    if (price == null) return '—';
    return '$' + Number(price).toLocaleString('es-CO');
  }

  function createWidget() {
    var host = document.createElement('div');
    host.id = 'ecofarma-chatbot-widget';
    document.body.appendChild(host);
    var root = host.attachShadow({ mode: 'open' });

    var style = document.createElement('style');
    style.textContent = STYLES;
    root.appendChild(style);

    var fab = document.createElement('button');
    fab.className = 'fab';
    fab.setAttribute('aria-label', 'Abrir chat de inventario');
    fab.innerHTML = '<img src="' + AVATAR_URL + '" alt="Asistente EcoFarma" />';
    root.appendChild(fab);

    var panel = document.createElement('div');
    panel.className = 'panel hidden';
    panel.innerHTML =
      '<div class="header"><img src="' + AVATAR_URL + '" alt="Asistente EcoFarma" />' +
      '<div>¡Hola! ¿En qué puedo ayudarte?<small>Disponibilidad, precio y sucursales</small></div></div>' +
      '<div class="messages"></div>' +
      '<div class="cart-bar hidden"></div>' +
      '<div class="composer">' +
      '<button type="button" class="menu-toggle" title="Ver opciones" aria-label="Ver opciones">☰</button>' +
      '<input type="text" placeholder="Escribe tu pregunta..." maxlength="2000" />' +
      '<button type="button" class="send-btn">Enviar</button>' +
      '</div>';
    root.appendChild(panel);

    /// Reposiciona el FAB (y el panel, que cuelga de el) justo encima del
    /// boton flotante del carrito del tema (.xoo-wsc-basket) cuando existe
    /// -- evita superponerse con el, sin depender de un numero de pixeles
    /// fijo que varia entre desktop/movil o si el tema agrega una barra de
    /// navegacion inferior (ver conversacion con el usuario: un valor fijo
    /// quedaba bien en un dispositivo y mal en otro). GAP_ABOVE_CART es a
    /// proposito chico (12px): el pedido explicito fue "dejalo mas cerca".
    var GAP_ABOVE_CART = 12;
    var FALLBACK_BOTTOM = 20;
    function positionAboveCart() {
      var basket = document.querySelector('.xoo-wsc-basket');
      var bottom = FALLBACK_BOTTOM;
      if (basket) {
        var rect = basket.getBoundingClientRect();
        if (rect.height > 0) {
          bottom = Math.round(window.innerHeight - rect.top) + GAP_ABOVE_CART;
        }
      }
      fab.style.bottom = bottom + 'px';
      panel.style.bottom = bottom + 76 + 'px';
    }
    positionAboveCart();
    // El carrito lateral puede montarse despues de que corre este script
    // (footer vs su propio hook) -- un par de reintentos cortos alcanza
    // sin quedar reconsultando el DOM indefinidamente.
    setTimeout(positionAboveCart, 600);
    setTimeout(positionAboveCart, 1800);
    var resizeTimer;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(positionAboveCart, 200);
    });

    var messagesEl = panel.querySelector('.messages');
    var inputEl = panel.querySelector('input');
    var sendBtn = panel.querySelector('.send-btn');
    var menuToggleBtn = panel.querySelector('.menu-toggle');
    var cartBarEl = panel.querySelector('.cart-bar');

    var conversationId = null;
    try {
      conversationId = localStorage.getItem(STORAGE_KEY);
    } catch (e) {
      /* localStorage puede estar bloqueado (modo privado); la conversacion
         simplemente no persiste entre recargas, no es un error fatal. */
    }

    function appendMessage(text, cls) {
      var el = document.createElement('div');
      el.className = 'msg ' + cls;
      el.textContent = text;
      messagesEl.appendChild(el);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return el;
    }

    function setBusy(busy) {
      inputEl.disabled = busy;
      sendBtn.disabled = busy;
    }

    var greeted = false;
    // Estructura tipo lista de capacidades + disclaimer, inspirada en la
    // referencia que compartio el usuario (chatbot "Sommer" de Farmatodo,
    // 2026-08-09) -- mismo patron, redactado en la voz de EcoFarma.
    var GREETING_TEXT =
      '¡Hola! Soy el asistente virtual de EcoFarma. Puedo ayudarte a:\n' +
      '• Buscar productos específicos\n' +
      '• Consultar disponibilidad y precio\n' +
      '• Decirte en qué sucursal encontrar un producto\n\n' +
      'Soy un asistente virtual y puedo cometer errores -- para cualquier consulta sobre tu salud, consulta a un profesional.';
    function ensureGreeting() {
      if (greeted) return;
      greeted = true;
      appendMessage(GREETING_TEXT, 'bot');
      renderMenu();
    }

    // ── Menu de opciones (estilo Farmatodo) ──────────────────────────────
    // "Ver el estado de mi solicitud" y "Hablar con un farmaceutico" ya
    // funcionan (ver handleMenuOption) pero quedan deshabilitados por
    // pedido explicito del usuario 2026-07-29 para el lanzamiento inicial
    // -- se muestran igual (para que el cliente sepa que vienen) con un
    // tooltip "Disponible proximamente", sin quitar el codigo que ya
    // funciona por si se habilitan mas adelante.
    var MENU_OPTIONS = [
      { label: 'Buscar un producto', action: 'search' },
      { label: 'Ver el estado de mi solicitud', action: 'status', disabled: true },
      { label: 'Hablar con un farmacéutico', action: 'pharmacist', disabled: true },
      { label: 'Otra pregunta', action: 'other' },
    ];

    function renderMenu() {
      var wrap = document.createElement('div');
      wrap.className = 'menu-block';
      MENU_OPTIONS.forEach(function (opt) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'menu-btn' + (opt.disabled ? ' menu-btn-disabled' : '');
        btn.textContent = opt.label;
        if (opt.disabled) {
          btn.disabled = true;
          btn.title = 'Disponible próximamente';
        } else {
          btn.addEventListener('click', function () {
            wrap.remove();
            handleMenuOption(opt);
          });
        }
        wrap.appendChild(btn);
      });
      messagesEl.appendChild(wrap);
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function handleMenuOption(opt) {
      appendMessage(opt.label, 'user');
      if (opt.action === 'search') {
        appendMessage('Cuéntame qué producto buscas (nombre, principio activo, o para qué lo necesitas) y reviso disponibilidad y precio.', 'bot');
        inputEl.focus();
      } else if (opt.action === 'pharmacist') {
        appendMessage(
          'Nuestro personal farmacéutico te puede asesorar directamente en sucursal o por teléfono. ' +
            'Si mientras tanto quieres que revise disponibilidad, precio o alternativas de algún producto, dime cuál y con gusto te ayudo.',
          'bot',
        );
      } else if (opt.action === 'other') {
        appendMessage('Claro, cuéntame en qué te ayudo.', 'bot');
        inputEl.focus();
      } else if (opt.action === 'status') {
        appendMessage('Indícame el número de referencia de tu solicitud (el que te dimos al enviarla, ej. AEA5DCBE).', 'bot');
        renderReferenceForm();
      }
    }

    function renderReferenceForm() {
      var wrap = document.createElement('div');
      wrap.className = 'ref-form';
      var input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'Número de referencia';
      input.maxLength = 12;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Consultar';
      var submit = async function () {
        var ref = input.value.trim();
        if (!ref) return;
        wrap.remove();
        appendMessage(ref, 'user');
        await checkOrderStatus(ref);
      };
      btn.addEventListener('click', submit);
      input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') submit();
      });
      wrap.appendChild(input);
      wrap.appendChild(btn);
      messagesEl.appendChild(wrap);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      input.focus();
    }

    var ORDER_STATUS_LABELS = { PENDIENTE: 'Pendiente de confirmación', CONFIRMADO: 'Confirmada', CANCELADO: 'Cancelada' };

    async function checkOrderStatus(reference) {
      try {
        var res = await fetch(API_BASE_URL + '/chatbot/cart/status/' + encodeURIComponent(reference));
        if (res.status === 404) {
          appendMessage('No encontramos una solicitud con ese número de referencia -- verifica que esté completo.', 'error');
          return;
        }
        if (!res.ok) {
          appendMessage('No se pudo consultar el estado en este momento.', 'error');
          return;
        }
        var body = await res.json();
        var statusLabel = ORDER_STATUS_LABELS[body.status] || body.status;
        var itemsText = body.items.map(function (i) { return i.quantity + 'x ' + i.name; }).join(', ');
        appendMessage(
          'Solicitud #' + body.reference + ': ' + statusLabel + '.\nProductos: ' + itemsText + '\nTotal: ' + formatPrice(body.total),
          'bot',
        );
      } catch (e) {
        appendMessage('No se pudo conectar para consultar el estado.', 'error');
      }
    }

    // ── Carrito / solicitud de pedido ────────────────────────────────────
    // 100% determinista contra /chatbot/cart/* -- el LLM nunca participa
    // en cantidades/precios (ver ChatCartService en el backend).
    var cartDetailsOpen = false;
    var cartFormOpen = false;
    var lastCart = { items: [], total: 0, notices: [] };

    function renderCartBar() {
      if (!conversationId || lastCart.items.length === 0) {
        cartBarEl.classList.add('hidden');
        cartBarEl.innerHTML = '';
        return;
      }
      cartBarEl.classList.remove('hidden');

      var itemsHtml = lastCart.items
        .map(function (item) {
          return (
            '<div class="cart-item-row">' +
            '<span>' + escapeHtml(item.quantity) + 'x ' + escapeHtml(item.name) + '</span>' +
            '<span><button class="cart-item-remove" data-sku="' + escapeHtml(item.sku) + '" title="Quitar">✕</button></span>' +
            '</div>'
          );
        })
        .join('');

      var formHtml = cartFormOpen
        ? '<div class="cart-form">' +
          '<input type="text" class="cf-name" placeholder="Tu nombre" maxlength="120" />' +
          '<input type="tel" class="cf-phone" placeholder="Tu teléfono de contacto" maxlength="30" />' +
          '<div class="cart-form-actions">' +
          '<button type="button" class="confirm cf-confirm">Confirmar solicitud</button>' +
          '<button type="button" class="cancel cf-cancel">Cancelar</button>' +
          '</div></div>'
        : '<button type="button" class="cart-submit-btn cf-open">Enviar solicitud de pedido</button>';

      cartBarEl.innerHTML =
        '<div class="cart-summary cs-toggle">' +
        '<span>🛒 ' + lastCart.items.length + ' producto' + (lastCart.items.length === 1 ? '' : 's') + '</span>' +
        '<strong>' + formatPrice(lastCart.total) + '</strong>' +
        '</div>' +
        '<div class="cart-details' + (cartDetailsOpen ? ' open' : '') + '">' + itemsHtml + formHtml + '</div>';

      cartBarEl.querySelector('.cs-toggle').addEventListener('click', function () {
        cartDetailsOpen = !cartDetailsOpen;
        renderCartBar();
      });
      cartBarEl.querySelectorAll('.cart-item-remove').forEach(function (btn) {
        btn.addEventListener('click', function () {
          addToCart(btn.getAttribute('data-sku'), 0);
        });
      });
      var openBtn = cartBarEl.querySelector('.cf-open');
      if (openBtn) {
        openBtn.addEventListener('click', function () {
          cartFormOpen = true;
          renderCartBar();
        });
      }
      var cancelBtn = cartBarEl.querySelector('.cf-cancel');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
          cartFormOpen = false;
          renderCartBar();
        });
      }
      var confirmBtn = cartBarEl.querySelector('.cf-confirm');
      if (confirmBtn) {
        confirmBtn.addEventListener('click', submitCart);
      }
    }

    async function refreshCart() {
      if (!conversationId) return;
      try {
        var res = await fetch(API_BASE_URL + '/chatbot/cart?conversationId=' + encodeURIComponent(conversationId));
        if (!res.ok) return;
        lastCart = await res.json();
        renderCartBar();
      } catch (e) {
        /* si falla, el carrito simplemente no se actualiza visualmente --
           no es una accion que el usuario disparo, no hace falta alertarlo. */
      }
    }

    async function addToCart(sku, quantity, productName) {
      if (!conversationId) return;
      try {
        var res = await fetch(API_BASE_URL + '/chatbot/cart/items', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: conversationId, sku: sku, quantity: quantity }),
        });
        if (res.status === 429) {
          appendMessage('Demasiadas acciones seguidas -- espera un momento e intenta de nuevo.', 'error');
          return;
        }
        if (!res.ok) {
          var errBody = await res.json().catch(function () { return {}; });
          appendMessage(errBody.message || 'No se pudo actualizar el carrito.', 'error');
          return;
        }
        lastCart = await res.json();
        if (quantity > 0) {
          appendMessage((productName ? 'Agregaste ' + quantity + 'x ' + productName : 'Producto agregado') + ' a tu solicitud.', 'bot');
          lastCart.notices.forEach(function (n) {
            appendMessage(n, 'notice');
          });
        }
        renderCartBar();
      } catch (e) {
        appendMessage('No se pudo conectar con el asistente para actualizar el carrito.', 'error');
      }
    }

    async function submitCart() {
      var nameEl = cartBarEl.querySelector('.cf-name');
      var phoneEl = cartBarEl.querySelector('.cf-phone');
      var name = nameEl ? nameEl.value.trim() : '';
      var phone = phoneEl ? phoneEl.value.trim() : '';
      if (!name || !phone) {
        appendMessage('Necesito tu nombre y un teléfono de contacto para enviar la solicitud.', 'error');
        return;
      }
      try {
        var res = await fetch(API_BASE_URL + '/chatbot/cart/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: conversationId, customerName: name, customerPhone: phone }),
        });
        if (!res.ok) {
          var errBody = await res.json().catch(function () { return {}; });
          appendMessage((errBody.message && errBody.message[0]) || errBody.message || 'No se pudo enviar la solicitud.', 'error');
          return;
        }
        var body = await res.json();
        appendMessage('¡Listo! Tu solicitud #' + body.reference + ' quedó registrada. Nuestro personal te contactará para confirmar.', 'bot');
        lastCart = { items: [], total: 0, notices: [] };
        cartFormOpen = false;
        cartDetailsOpen = false;
        renderCartBar();
      } catch (e) {
        appendMessage('No se pudo enviar la solicitud. Intenta de nuevo en un momento.', 'error');
      }
    }

    // Carrusel horizontal SIEMPRE, sin importar cuantos resultados haya --
    // reemplaza el diseno anterior (tarjetas para 1-2, tabla para 3+),
    // pedido explicito del usuario 2026-08-09 inspirado en la referencia
    // del chatbot "Sommer" de Farmatodo (misma logica, estilos de EcoFarma).
    function renderProductsCarousel(products) {
      var wrap = document.createElement('div');
      wrap.className = 'products-carousel';

      products.forEach(function (p) {
        var card = document.createElement('div');
        card.className = 'product-card';

        var thumb = document.createElement('img');
        thumb.className = 'thumb';
        thumb.src = p.imageUrl;
        thumb.alt = '';
        thumb.loading = 'lazy';
        card.appendChild(thumb);

        var body = document.createElement('div');
        body.className = 'product-card-body';
        body.innerHTML =
          '<div class="product-card-name">' + escapeHtml(p.name) + '</div>' +
          (p.labName ? '<div class="product-card-lab">' + escapeHtml(p.labName) + '</div>' : '') +
          (p.requiresPrescription ? '<div class="rx">Requiere receta</div>' : '') +
          '<div class="product-card-price">' + formatPrice(p.price) + '</div>' +
          // Stock fisico solo tiene sentido si se puede pedir por el chat
          // (canOrder) -- si no, mostrar "Stock: 0" seria enganoso (puede
          // estar disponible en linea sin cruce con el inventario fisico).
          (p.canOrder ? '<div class="product-card-stock">Stock: ' + escapeHtml(p.stock) + '</div>' : '');

        if (p.canOrder && p.stock > 0) {
          var qtyInput = document.createElement('input');
          qtyInput.type = 'number';
          qtyInput.className = 'qty-input';
          qtyInput.min = '1';
          qtyInput.max = String(p.stock);
          qtyInput.value = '1';

          var addBtn = document.createElement('button');
          addBtn.type = 'button';
          addBtn.className = 'add-btn';
          addBtn.textContent = 'Agregar';
          addBtn.addEventListener('click', function () {
            var qty = parseInt(qtyInput.value, 10);
            if (!qty || qty < 1) qty = 1;
            addToCart(p.sku, qty, p.name);
          });

          var actionsWrap = document.createElement('div');
          actionsWrap.className = 'row-actions';
          actionsWrap.appendChild(qtyInput);
          actionsWrap.appendChild(addBtn);
          body.appendChild(actionsWrap);
        } else if (p.permalink) {
          // Sin contraparte en el catalogo interno (o agotado): no se puede
          // armar un pedido por este chat (el personal despacha de
          // inventario fisico real, ver ChatCartService.addItem) -- se
          // ofrece el link directo a la tienda en vez de "Agregar".
          var storeLink = document.createElement('a');
          storeLink.className = 'store-link';
          storeLink.href = p.permalink;
          storeLink.target = '_blank';
          storeLink.rel = 'noopener noreferrer';
          storeLink.textContent = 'Ver en la tienda';
          body.appendChild(storeLink);
        }

        card.appendChild(body);
        wrap.appendChild(card);
      });

      return wrap;
    }

    async function sendMessage() {
      var text = inputEl.value.trim();
      if (!text) return;
      appendMessage(text, 'user');
      inputEl.value = '';
      setBusy(true);
      var typingEl = document.createElement('div');
      typingEl.className = 'typing';
      typingEl.textContent = 'Escribiendo...';
      messagesEl.appendChild(typingEl);
      messagesEl.scrollTop = messagesEl.scrollHeight;

      try {
        var res = await fetch(API_BASE_URL + '/chatbot/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ conversationId: conversationId || undefined, message: text }),
        });
        typingEl.remove();

        if (res.status === 429) {
          appendMessage('Estamos recibiendo muchos mensajes en este momento -- intenta de nuevo en un rato.', 'error');
          return;
        }
        if (!res.ok) {
          appendMessage('No se pudo enviar tu mensaje. Intenta de nuevo en un momento.', 'error');
          return;
        }

        var body = await res.json();
        var isNewConversation = conversationId !== body.conversationId;
        conversationId = body.conversationId;
        try {
          localStorage.setItem(STORAGE_KEY, conversationId);
        } catch (e) {}
        appendMessage(body.reply, 'bot');
        if (Array.isArray(body.products) && body.products.length > 0) {
          messagesEl.appendChild(renderProductsCarousel(body.products));
          messagesEl.scrollTop = messagesEl.scrollHeight;
        }
        if (isNewConversation) refreshCart();
      } catch (e) {
        typingEl.remove();
        appendMessage('No se pudo conectar con el asistente. Revisa tu conexión e intenta de nuevo.', 'error');
      } finally {
        setBusy(false);
        inputEl.focus();
      }
    }

    fab.addEventListener('click', function () {
      var willOpen = panel.classList.contains('hidden');
      panel.classList.toggle('hidden');
      if (willOpen) {
        ensureGreeting();
        refreshCart();
        inputEl.focus();
      }
    });
    sendBtn.addEventListener('click', sendMessage);
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') sendMessage();
    });
    menuToggleBtn.addEventListener('click', renderMenu);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createWidget);
  } else {
    createWidget();
  }
})();
