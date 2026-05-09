/* ============================================
   FASTCO CART DRAWER — AJAX HANDLER
   File: assets/fastco-cart-ajax.js
   Purpose: intercept add-to-cart, fetch /cart endpoints,
            manage drawer open/close, qty updates, remove items
   Loaded globally from layout/theme.liquid
   ============================================ */

(function () {
  'use strict';

  // ============================================
  // STATE & SELECTORS
  // ============================================
  const SELECTORS = {
    drawer: '#fastco-cart-drawer',
    panel: '.fastco-cart-drawer-panel',
    closeButtons: '[data-cart-drawer-close]',
    itemsContainer: '[data-cart-items]',
    cartCount: '[data-cart-count]',
    cartSubtotal: '[data-cart-subtotal]',
    cartFooter: '[data-cart-footer]',
    shippingMessage: '[data-shipping-message]',
    shippingFill: '[data-shipping-fill]',
    qtyDecrease: '[data-qty-decrease]',
    qtyIncrease: '[data-qty-increase]',
    qtyInput: '[data-qty-input]',
    qtyRemove: '[data-qty-remove]',
    cartItem: '[data-cart-item]',
  };

  const FOCUSABLE_SELECTOR =
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  let drawerEl = null;
  let panelEl = null;
  let lastFocusedElement = null;
  let freeShippingThreshold = 3500;
  let qtyDebounceTimer = null;

  // ============================================
  // INIT
  // ============================================
  function init() {
    drawerEl = document.querySelector(SELECTORS.drawer);
    if (!drawerEl) {
      console.warn('[fastco cart] Drawer not found in DOM. Skipping init.');
      return;
    }

    panelEl = drawerEl.querySelector(SELECTORS.panel);
    freeShippingThreshold = parseInt(drawerEl.dataset.freeShippingThreshold, 10) || 3500;

    bindAddToCartForms();
    bindDrawerControls();
    bindItemControls();

    // expose API for manual control
    window.fastcoCart = {
      open: openDrawer,
      close: closeDrawer,
      refresh: refreshCart,
    };
  }

  // ============================================
  // INTERCEPT ADD-TO-CART FORMS
  // ============================================
  function bindAddToCartForms() {
    document.addEventListener('submit', async function (event) {
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;

      const action = form.getAttribute('action') || '';
      const isCartAddForm =
        action.includes('/cart/add') ||
        form.querySelector('button[name="add"], input[name="add"]');

      if (!isCartAddForm) return;

      event.preventDefault();
      await handleAddToCart(form);
    });
  }

  async function handleAddToCart(form) {
    const submitBtn = form.querySelector('[name="add"], [type="submit"]');
    const originalBtnText = submitBtn ? submitBtn.innerHTML : null;

    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.setAttribute('aria-busy', 'true');
      submitBtn.innerHTML = 'Agregando...';
    }

    try {
      const formData = new FormData(form);
      const response = await fetch('/cart/add.js', {
        method: 'POST',
        body: formData,
        headers: {
          'Accept': 'application/javascript',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.description || 'No se pudo agregar al carrito.');
      }

      await refreshCart();
      openDrawer();
    } catch (error) {
      console.error('[fastco cart] Error adding to cart:', error);
      alert(error.message || 'Hubo un error al agregar el producto. Intenta de nuevo.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.removeAttribute('aria-busy');
        if (originalBtnText !== null) submitBtn.innerHTML = originalBtnText;
      }
    }
  }

  // ============================================
  // DRAWER OPEN / CLOSE
  // ============================================
  function bindDrawerControls() {
    drawerEl.addEventListener('click', function (event) {
      if (event.target.closest(SELECTORS.closeButtons)) {
        closeDrawer();
      }
    });

    document.addEventListener('keydown', function (event) {
      if (drawerEl.getAttribute('aria-hidden') === 'false') {
        if (event.key === 'Escape') closeDrawer();
        if (event.key === 'Tab') trapFocus(event);
      }
    });

    // Allow header cart icon (or any element with [data-cart-drawer-open]) to open drawer
    document.addEventListener('click', function (event) {
      const opener = event.target.closest('[data-cart-drawer-open]');
      if (opener) {
        event.preventDefault();
        openDrawer();
      }

      // Header cart link patterns: /cart link or .header__icon--cart
      const cartLink = event.target.closest('a[href="/cart"], a[href$="/cart"]');
      if (cartLink && !cartLink.hasAttribute('data-cart-drawer-bypass')) {
        event.preventDefault();
        openDrawer();
      }
    });
  }

  function openDrawer() {
    if (!drawerEl) return;
    lastFocusedElement = document.activeElement;
    drawerEl.setAttribute('aria-hidden', 'false');
    document.body.classList.add('fastco-cart-drawer-open');

    // focus the close button after animation
    setTimeout(() => {
      const closeBtn = drawerEl.querySelector('.fastco-cart-drawer-close');
      if (closeBtn) closeBtn.focus();
    }, 300);
  }

  function closeDrawer() {
    if (!drawerEl) return;
    drawerEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('fastco-cart-drawer-open');

    if (lastFocusedElement && typeof lastFocusedElement.focus === 'function') {
      lastFocusedElement.focus();
    }
  }

  function trapFocus(event) {
    const focusable = panelEl.querySelectorAll(FOCUSABLE_SELECTOR);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  // ============================================
  // ITEM QTY CONTROLS (delegated)
  // ============================================
  function bindItemControls() {
    drawerEl.addEventListener('click', function (event) {
      const decBtn = event.target.closest(SELECTORS.qtyDecrease);
      const incBtn = event.target.closest(SELECTORS.qtyIncrease);
      const removeBtn = event.target.closest(SELECTORS.qtyRemove);

      if (decBtn) {
        const lineIndex = parseInt(decBtn.dataset.lineIndex, 10);
        adjustQty(lineIndex, -1);
      } else if (incBtn) {
        const lineIndex = parseInt(incBtn.dataset.lineIndex, 10);
        adjustQty(lineIndex, +1);
      } else if (removeBtn) {
        const lineIndex = parseInt(removeBtn.dataset.lineIndex, 10);
        changeQty(lineIndex, 0);
      }
    });

    drawerEl.addEventListener('change', function (event) {
      const input = event.target.closest(SELECTORS.qtyInput);
      if (!input) return;
      const lineIndex = parseInt(input.dataset.lineIndex, 10);
      const newQty = Math.max(0, parseInt(input.value, 10) || 0);
      input.value = newQty;
      changeQty(lineIndex, newQty);
    });
  }

  function adjustQty(lineIndex, delta) {
    const input = drawerEl.querySelector(
      `${SELECTORS.qtyInput}[data-line-index="${lineIndex}"]`
    );
    if (!input) return;

    const current = parseInt(input.value, 10) || 0;
    const next = Math.max(0, current + delta);
    input.value = next;

    // optimistic UI: dim the row
    const itemRow = drawerEl.querySelector(
      `${SELECTORS.cartItem}[data-line-index="${lineIndex}"]`
    );
    if (itemRow) itemRow.classList.add('is-loading');

    // debounce rapid clicks before sending request
    clearTimeout(qtyDebounceTimer);
    qtyDebounceTimer = setTimeout(() => changeQty(lineIndex, next), 250);
  }

  async function changeQty(lineIndex, quantity) {
    const itemRow = drawerEl.querySelector(
      `${SELECTORS.cartItem}[data-line-index="${lineIndex}"]`
    );
    if (itemRow) itemRow.classList.add('is-loading');

    try {
      const response = await fetch('/cart/change.js', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ line: lineIndex, quantity: quantity }),
      });

      if (!response.ok) {
        throw new Error('No se pudo actualizar el carrito.');
      }

      await refreshCart();
    } catch (error) {
      console.error('[fastco cart] Error updating qty:', error);
      if (itemRow) itemRow.classList.remove('is-loading');
      alert(error.message || 'Hubo un error al actualizar la cantidad.');
    }
  }

  // ============================================
  // REFRESH (re-fetch and re-render)
  // ============================================
  async function refreshCart() {
    try {
      const response = await fetch('/cart.js', {
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
      });

      if (!response.ok) throw new Error('No se pudo obtener el carrito.');

      const cart = await response.json();
      renderCart(cart);
      updateHeaderCartCount(cart.item_count);
    } catch (error) {
      console.error('[fastco cart] Error refreshing cart:', error);
    }
  }

  function renderCart(cart) {
    // count badge
    const countEl = drawerEl.querySelector(SELECTORS.cartCount);
    if (countEl) countEl.textContent = cart.item_count;

    // subtotal
    const subtotalEl = drawerEl.querySelector(SELECTORS.cartSubtotal);
    if (subtotalEl) subtotalEl.textContent = formatMoney(cart.total_price);

    // shipping bar message + fill
    renderShippingBar(cart.total_price / 100);

    // items list
    renderItems(cart.items);

    // footer visibility
    const footerEl = drawerEl.querySelector(SELECTORS.cartFooter);
    if (footerEl) footerEl.style.display = cart.item_count > 0 ? '' : 'none';
  }

  function renderShippingBar(totalInPesos) {
    const messageEl = drawerEl.querySelector(SELECTORS.shippingMessage);
    const fillEl = drawerEl.querySelector(SELECTORS.shippingFill);
    if (!messageEl || !fillEl) return;

    let message;
    let fillPercent;

    if (totalInPesos === 0) {
      message = `Pedidos de $${freeShippingThreshold} MXN o más: <strong>envío gratis</strong> en CDMX y zona metropolitana.`;
      fillPercent = 0;
    } else if (totalInPesos >= freeShippingThreshold) {
      message = `🎉 <strong>Envío gratis activado</strong> en CDMX y zona metropolitana.`;
      fillPercent = 100;
    } else {
      const remaining = (freeShippingThreshold - totalInPesos).toFixed(0);
      message = `Te faltan <strong>$${remaining} MXN</strong> para envío gratis en CDMX.`;
      fillPercent = Math.round((totalInPesos / freeShippingThreshold) * 100);
    }

    messageEl.innerHTML = message;
    fillEl.style.width = `${fillPercent}%`;
  }

  function renderItems(items) {
    const container = drawerEl.querySelector(SELECTORS.itemsContainer);
    if (!container) return;

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="fastco-cart-drawer-empty" data-cart-empty>
          <p class="fastco-cart-drawer-empty-title">Tu carrito está vacío.</p>
          <p class="fastco-cart-drawer-empty-text">Empieza a abastecer tu operación.</p>
          <a href="/collections/all" class="fastco-cart-drawer-empty-cta" data-cart-drawer-close>Ver catálogo</a>
        </div>
      `;
      return;
    }

    container.innerHTML = items.map((item, idx) => renderItem(item, idx + 1)).join('');
  }

  function renderItem(item, lineIndex) {
    const imageHtml = item.image
      ? `<img src="${item.image.replace(/(\.[^.]+)$/, '_160x$1')}" alt="${escapeHtml(item.product_title)}" loading="lazy" width="80" height="80">`
      : `<div class="fastco-cart-drawer-item-image-placeholder"></div>`;

    const variantTitle =
      item.variant_title && !item.variant_title.includes('Default')
        ? `<p class="fastco-cart-drawer-item-variant">${escapeHtml(item.variant_title)}</p>`
        : '';

    return `
      <div class="fastco-cart-drawer-item" data-cart-item data-line-key="${item.key}" data-line-index="${lineIndex}">
        <a href="${item.url}" class="fastco-cart-drawer-item-image">
          ${imageHtml}
        </a>
        <div class="fastco-cart-drawer-item-info">
          <a href="${item.url}" class="fastco-cart-drawer-item-title">${escapeHtml(item.product_title)}</a>
          ${variantTitle}
          <div class="fastco-cart-drawer-item-bottom">
            <div class="fastco-cart-drawer-qty">
              <button type="button" class="fastco-cart-drawer-qty-btn" aria-label="Disminuir cantidad" data-qty-decrease data-line-index="${lineIndex}">−</button>
              <input type="number" class="fastco-cart-drawer-qty-input" value="${item.quantity}" min="0" aria-label="Cantidad" data-qty-input data-line-index="${lineIndex}">
              <button type="button" class="fastco-cart-drawer-qty-btn" aria-label="Aumentar cantidad" data-qty-increase data-line-index="${lineIndex}">+</button>
            </div>
            <p class="fastco-cart-drawer-item-price">${formatMoney(item.final_line_price)}</p>
          </div>
        </div>
        <button type="button" class="fastco-cart-drawer-item-remove" aria-label="Eliminar producto" data-qty-remove data-line-index="${lineIndex}">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round">
            <path d="M3 3l8 8M11 3L3 11"/>
          </svg>
        </button>
      </div>
    `;
  }

  function updateHeaderCartCount(count) {
    // Update any header cart counter elements (theme-agnostic patterns)
    const headerCounters = document.querySelectorAll(
      '.cart-count-bubble, [data-header-cart-count], .header__cart-count, .fastco-header-cart-count'
    );
    headerCounters.forEach((el) => {
      el.textContent = count;
      if (count > 0) {
        el.removeAttribute('hidden');
      } else {
        el.setAttribute('hidden', '');
      }
    });
  }

  // ============================================
  // UTILITIES
  // ============================================
  function formatMoney(cents) {
    const amount = cents / 100;
    return '$' + amount.toLocaleString('es-MX', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }) + ' MXN';
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ============================================
  // BOOTSTRAP
  // ============================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
