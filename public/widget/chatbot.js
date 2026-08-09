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
  /// Pedido explicito del usuario 2026-08-09 (2da vuelta): recargar el
  /// navegador no debe borrar visualmente la conversacion. Antes solo se
  /// guardaba el conversationId (el backend si tenia el historial, pero la
  /// UI quedaba vacia tras un F5). Guarda los mensajes/carruseles ya
  /// renderizados, capados a los ultimos HISTORY_LIMIT, para reconstruir
  /// la UI sin volver a pedirle nada al backend.
  var HISTORY_KEY = 'ecofarma_chat_history';
  var HISTORY_LIMIT = 30;

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
    /* Carrusel horizontal SIEMPRE (sin importar cuantos resultados haya) --
       pedido explicito del usuario 2026-08-09, inspirado en la referencia
       del chatbot "Sommer" de Farmatodo. Reemplaza el diseno anterior
       (tarjetas para 1-2, tabla para 3+).
       flex-shrink:0 es obligatorio, no cosmetico: .messages es flex-column
       y overflow-x:auto aca fuerza a que el navegador calcule tambien
       overflow-y:auto (regla CSS: si un eje es "visible" y el otro no, el
       visible pasa a auto) -- eso activa el caso especial de flexbox donde
       min-height:auto se vuelve min-height:0 para items con overflow
       distinto de visible. Sin flex-shrink:0, en cuanto el historial del
       chat excede el alto visible del panel, el algoritmo de flex aplasta
       este carrusel a ~2px en vez de dejarlo con su alto de contenido
       (bug real, confirmado inspeccionando getBoundingClientRect en
       produccion: alto 2px pese a fotos/texto reportando su alto real). */
    /* align-items:flex-start -- sin esto, al expandir el detalle de UNA
       tarjeta (click en "Ver producto"), el "stretch" por defecto de flex
       estira TODAS las tarjetas del carrusel a la altura de la mas alta. */
    .products-carousel { align-self: stretch; align-items: flex-start; flex-shrink: 0; display: flex; gap: 10px; overflow-x: auto; padding-bottom: 4px; scroll-snap-type: x proximity; -webkit-overflow-scrolling: touch; }
    /* Ancho/alto pensados para que la tarjeta por defecto (sin el detalle
       expandido) se vea compacta y proporcionada -- pedido explicito del
       usuario 2026-08-09 (2da vuelta): la version anterior, con el precio,
       stock y controles de cantidad siempre visibles, se veia "alargada". */
    .product-card {
      flex: 0 0 148px; width: 148px; background: #fff; border: 1px solid #e2e8f0; border-radius: 14px;
      overflow: hidden; display: flex; flex-direction: column; scroll-snap-align: start;
    }
    .product-card .thumb { width: 100%; height: 84px; object-fit: cover; background: #f1f5f9; display: block; }
    .product-card-body { padding: 10px; display: flex; flex-direction: column; gap: 3px; }
    .product-card-name { font-size: 12.5px; font-weight: 600; line-height: 1.3; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .product-card-lab { color: #64748b; font-size: 10.5px; }
    .product-card-price { font-size: 15px; font-weight: 700; color: ${BRAND_BLUE}; margin-top: 4px; }
    .view-btn {
      background: #fff; color: ${BRAND_BLUE}; border: 1px solid ${BRAND_BLUE}; border-radius: 20px;
      padding: 5px 8px; font-size: 11px; cursor: pointer; margin-top: 6px; width: 100%;
    }
    .view-btn:hover { background: #eef1fd; }
    /* Overlay de detalle ("Ver producto") -- cubre el panel completo
       (incl. header/composer) con su propio boton de cerrar, mismo
       espiritu visual que la referencia de Farmatodo compartida por el
       usuario 2026-08-09 (2da vuelta). position:relative en .panel es lo
       que ancla el inset:0 de aca. */
    .overlay { position: absolute; inset: 0; background: #fff; display: flex; flex-direction: column; z-index: 10; }
    .overlay.hidden { display: none; }
    .overlay-header { display: flex; align-items: center; justify-content: flex-end; padding: 10px 12px; border-bottom: 1px solid #e2e8f0; flex-shrink: 0; }
    .overlay-close { background: none; border: none; font-size: 18px; line-height: 1; cursor: pointer; color: #334155; padding: 4px 8px; }
    .overlay-body { flex: 1; overflow-y: auto; padding: 4px 20px 20px; display: flex; flex-direction: column; gap: 10px; }
    .overlay-img { width: 100%; height: 200px; object-fit: contain; background: #f1f5f9; border-radius: 10px; }
    .overlay-name { font-size: 16px; font-weight: 700; color: #1e293b; line-height: 1.3; }
    .overlay-lab { font-size: 12px; color: #64748b; }
    .overlay-price { font-size: 22px; font-weight: 800; color: ${BRAND_BLUE}; }
    .overlay-rx { font-size: 12px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 8px 10px; }
    .overlay-add-btn { width: 100%; background: ${BRAND_BLUE}; color: #fff; border: none; border-radius: 10px; padding: 13px; font-size: 14px; font-weight: 600; cursor: pointer; margin-top: 6px; }
    .overlay-add-btn:disabled { opacity: .6; cursor: default; }
    .overlay-store-link { text-align: center; color: ${BRAND_BLUE}; font-size: 12.5px; font-weight: 600; text-decoration: underline; }
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
      '<div class="composer">' +
      '<button type="button" class="menu-toggle" title="Ver opciones" aria-label="Ver opciones">☰</button>' +
      '<input type="text" placeholder="Escribe tu pregunta..." maxlength="2000" />' +
      '<button type="button" class="send-btn">Enviar</button>' +
      '</div>' +
      '<div class="overlay hidden"></div>';
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
    var overlayEl = panel.querySelector('.overlay');

    var conversationId = null;
    var history = [];
    try {
      conversationId = localStorage.getItem(STORAGE_KEY);
      var rawHistory = localStorage.getItem(HISTORY_KEY);
      if (rawHistory) {
        var parsed = JSON.parse(rawHistory);
        if (Array.isArray(parsed)) history = parsed;
      }
    } catch (e) {
      /* localStorage puede estar bloqueado (modo privado) o el JSON
         guardado puede estar corrupto -- la conversacion simplemente no
         persiste entre recargas, no es un error fatal. */
      history = [];
    }

    function saveHistory() {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      } catch (e) {}
    }

    // `record=true` solo en los turnos reales de la conversacion (eco del
    // usuario, respuesta del bot) -- el saludo/menu inicial y los mensajes
    // de error/typing no se persisten, se recrean solos cuando no hay
    // historial guardado (ver ensureGreeting).
    function recordEntry(entry) {
      history.push(entry);
      if (history.length > HISTORY_LIMIT) history = history.slice(history.length - HISTORY_LIMIT);
      saveHistory();
    }

    function appendMessage(text, cls, record) {
      var el = document.createElement('div');
      el.className = 'msg ' + cls;
      el.textContent = text;
      messagesEl.appendChild(el);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      if (record) recordEntry({ type: 'msg', text: text, cls: cls });
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
      if (conversationId && history.length > 0) {
        replayHistory();
      } else {
        appendMessage(GREETING_TEXT, 'bot');
        renderMenu();
      }
    }

    // Reconstruye la conversacion ya renderizada a partir de HISTORY_KEY --
    // se usa en vez del saludo+menu cuando ya existe una conversacion (F5
    // del navegador no debe borrarla, pedido explicito del usuario
    // 2026-08-09, 2da vuelta). `record` se omite a proposito en cada
    // appendMessage/renderProductsCarousel de aca para no re-grabar lo que
    // ya esta guardado.
    function replayHistory() {
      history.forEach(function (entry) {
        if (entry.type === 'msg') {
          appendMessage(entry.text, entry.cls);
        } else if (entry.type === 'products' && Array.isArray(entry.products)) {
          messagesEl.appendChild(renderProductsCarousel(entry.products));
        }
      });
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // ── Menu de opciones (estilo Farmatodo) ──────────────────────────────
    // "Hablar con un farmaceutico" ya funciona (ver handleMenuOption) pero
    // queda deshabilitado por pedido explicito del usuario 2026-07-29 para
    // el lanzamiento inicial -- se muestra igual (para que el cliente sepa
    // que viene) con un tooltip "Disponible proximamente", sin quitar el
    // codigo que ya funciona por si se habilita mas adelante.
    //
    // "Ver el estado de mi solicitud" se elimino 2026-08-09 (2da vuelta)
    // junto con Pedidos/OrderRequest -- "Agregar producto" ahora agrega de
    // verdad al carrito nativo de WooCommerce (ver addToWooCommerceCart),
    // no hay una solicitud interna cuyo estado consultar.
    var MENU_OPTIONS = [
      { label: 'Buscar un producto', action: 'search' },
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
      appendMessage(opt.label, 'user', true);
      if (opt.action === 'search') {
        appendMessage('Cuéntame qué producto buscas (nombre, principio activo, o para qué lo necesitas) y reviso disponibilidad y precio.', 'bot', true);
        inputEl.focus();
      } else if (opt.action === 'pharmacist') {
        appendMessage(
          'Nuestro personal farmacéutico te puede asesorar directamente en sucursal o por teléfono. ' +
            'Si mientras tanto quieres que revise disponibilidad, precio o alternativas de algún producto, dime cuál y con gusto te ayudo.',
          'bot',
          true,
        );
      } else if (opt.action === 'other') {
        appendMessage('Claro, cuéntame en qué te ayudo.', 'bot', true);
        inputEl.focus();
      }
    }

    // ── Carrito nativo de WooCommerce ────────────────────────────────────
    // 2026-08-09 (2da vuelta): "Agregar producto" ya no crea una solicitud
    // interna (OrderRequest, eliminado) -- agrega de verdad al carrito real
    // de la tienda (el mismo /carrito/ de ecofarma.co), usando el mecanismo
    // AJAX nativo que WooCommerce core ya carga en el tema
    // (window.wc_add_to_cart_params). Verificado en vivo: un <a> creado
    // dinamicamente con las clases/atributos estandar y un .click() SI
    // dispara el flujo AJAX nativo (delegacion de eventos de WooCommerce no
    // depende de que el elemento ya estuviera en la pagina), confirmado con
    // .xoo-wsc-items-count subiendo y el producto apareciendo en /carrito/.
    //
    // Como esto corre en el navegador del cliente (no en nuestro backend),
    // no aplica el bloqueo de Cloudflare que si afecta backend→WordPress en
    // las otras integraciones -- es trafico normal del navegador al mismo
    // sitio.
    function addToWooCommerceCart(product, btn) {
      if (!window.wc_add_to_cart_params) {
        // Defensivo: no deberia pasar en ecofarma.co real (el tema siempre
        // carga el script core de WooCommerce). Si pasa (ej. la consola de
        // prueba interna, que vive en nuestro propio dominio y nunca tiene
        // este objeto), cae al mismo camino que ya usaba "Ver en la tienda".
        window.open(product.permalink, '_blank', 'noopener,noreferrer');
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Agregando...';
      var settled = false;

      function onAdded() {
        finish();
      }
      if (window.jQuery) {
        window.jQuery(document.body).on('added_to_cart', onAdded);
      }

      function finish() {
        if (settled) return;
        settled = true;
        if (window.jQuery) window.jQuery(document.body).off('added_to_cart', onAdded);
        btn.disabled = false;
        btn.textContent = 'Agregado al carrito ✓';
        // Minimiza el widget despues de agregar -- pedido explicito del
        // usuario 2026-08-09 (3ra vuelta): tras agregar, el cliente quiere
        // ver el carrito/la tienda normal (el badge del carrito nativo, el
        // side cart si el tema lo abre solo) en vez de quedar atrapado
        // dentro del chat. El delay es solo para que alcance a ver el
        // check de confirmacion antes de que el panel se cierre.
        setTimeout(function () {
          hideProductOverlay();
          panel.classList.add('hidden');
        }, 900);
      }

      var link = document.createElement('a');
      link.href = '?add-to-cart=' + product.id;
      link.className = 'add_to_cart_button ajax_add_to_cart';
      link.setAttribute('data-product_id', String(product.id));
      link.setAttribute('data-quantity', '1');
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      setTimeout(function () {
        link.remove();
      }, 100);

      // Respaldo: si por lo que sea el evento added_to_cart nunca llega
      // (ej. jQuery no cargo todavia), no dejamos el boton colgado.
      setTimeout(finish, 1500);
    }

    // ── Vista de detalle ("Ver producto") ────────────────────────────────
    // Overlay a pantalla completa dentro del panel -- pedido explicito del
    // usuario 2026-08-09 (2da vuelta), inspirado en la referencia de
    // Farmatodo: imagen grande, precio y un boton prominente de "Agregar
    // producto" en vez del pequeno detalle inline de la version anterior.
    function hideProductOverlay() {
      overlayEl.classList.add('hidden');
      overlayEl.innerHTML = '';
    }

    function showProductOverlay(product) {
      overlayEl.innerHTML = '';

      var header = document.createElement('div');
      header.className = 'overlay-header';
      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.className = 'overlay-close';
      closeBtn.setAttribute('aria-label', 'Cerrar');
      closeBtn.textContent = '✕';
      closeBtn.addEventListener('click', hideProductOverlay);
      header.appendChild(closeBtn);
      overlayEl.appendChild(header);

      var body = document.createElement('div');
      body.className = 'overlay-body';

      var img = document.createElement('img');
      img.className = 'overlay-img';
      img.src = product.imageUrl;
      img.alt = '';
      body.appendChild(img);

      var name = document.createElement('div');
      name.className = 'overlay-name';
      name.textContent = product.name;
      body.appendChild(name);

      if (product.labName) {
        var lab = document.createElement('div');
        lab.className = 'overlay-lab';
        lab.textContent = product.labName;
        body.appendChild(lab);
      }

      var price = document.createElement('div');
      price.className = 'overlay-price';
      price.textContent = formatPrice(product.price);
      body.appendChild(price);

      if (product.requiresPrescription === true) {
        var rx = document.createElement('div');
        rx.className = 'overlay-rx';
        rx.textContent = 'Este producto requiere fórmula médica.';
        body.appendChild(rx);
      } else if (product.requiresPrescription === null) {
        var rxUnknown = document.createElement('div');
        rxUnknown.className = 'overlay-rx';
        rxUnknown.textContent = '¿Requiere receta? Confírmalo en sucursal.';
        body.appendChild(rxUnknown);
      }

      var addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'overlay-add-btn';
      addBtn.textContent = 'Agregar producto';
      addBtn.addEventListener('click', function () {
        addToWooCommerceCart(product, addBtn);
      });
      body.appendChild(addBtn);

      if (product.permalink) {
        var storeLink = document.createElement('a');
        storeLink.className = 'overlay-store-link';
        storeLink.href = product.permalink;
        storeLink.target = '_blank';
        storeLink.rel = 'noopener noreferrer';
        storeLink.textContent = 'Ver en la tienda';
        body.appendChild(storeLink);
      }

      overlayEl.appendChild(body);
      overlayEl.classList.remove('hidden');
    }

    // Carrusel horizontal SIEMPRE, sin importar cuantos resultados haya --
    // reemplaza el diseno anterior (tarjetas para 1-2, tabla para 3+),
    // pedido explicito del usuario 2026-08-09 inspirado en la referencia
    // del chatbot "Sommer" de Farmatodo (misma logica, estilos de EcoFarma).
    //
    // La tarjeta es SOLO imagen+nombre+precio+"Ver producto" -- el detalle
    // completo (receta, boton de agregar al carrito real) vive en el
    // overlay de showProductOverlay, ya no en un bloque inline dentro de
    // la tarjeta (pedido explicito del usuario 2026-08-09, 2da vuelta).
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
          '<div class="product-card-price">' + formatPrice(p.price) + '</div>';

        var viewBtn = document.createElement('button');
        viewBtn.type = 'button';
        viewBtn.className = 'view-btn';
        viewBtn.textContent = 'Ver producto';
        viewBtn.addEventListener('click', function () {
          showProductOverlay(p);
        });

        body.appendChild(viewBtn);
        card.appendChild(body);
        wrap.appendChild(card);
      });

      return wrap;
    }

    async function sendMessage() {
      var text = inputEl.value.trim();
      if (!text) return;
      appendMessage(text, 'user', true);
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
        conversationId = body.conversationId;
        try {
          localStorage.setItem(STORAGE_KEY, conversationId);
        } catch (e) {}
        appendMessage(body.reply, 'bot', true);
        if (Array.isArray(body.products) && body.products.length > 0) {
          messagesEl.appendChild(renderProductsCarousel(body.products));
          messagesEl.scrollTop = messagesEl.scrollHeight;
          recordEntry({ type: 'products', products: body.products });
        }
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
