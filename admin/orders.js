/**
 * MascotCar — Gestão e Acompanhamento de Pedidos no Painel Administrativo
 * Responsável por:
 * - Consultar pedidos da tabela public.orders
 * - Filtrar por status (Todos, Recebidos, Confirmados, Em preparação, Prontos, Concluídos, Cancelados, Expirados)
 * - Buscar por código (MC-XXXXX), nome e telefone do cliente
 * - Exibir contadores dinâmicos e tempo restante de reserva para pedidos recebidos
 * - Abrir modal de detalhes do pedido com dados do cliente, itens congelados e histórico auditável
 * - Executar ações seguras do fluxo de pedidos via RPCs oficiais (confirm_order, cancel_order)
 * - Proteger contra manipulação manual de estoque ou mutações diretas
 *
 * ⚠️ SEGURANÇA E PRIVACIDADE:
 * - Reutiliza a sessão autenticada de window.supabaseClient com verificação is_admin().
 * - NUNCA expõe access_token ou access_token_hash.
 * - Toda transição de estoque é governada pelo banco de dados / RPCs.
 */

'use strict';

(function () {
  // Estado local em memória dos pedidos carregados
  let loadedOrders = [];

  // Filtros ativos (padrão: categoria 'active' conforme Etapa 3N.4.2)
  const currentFilters = {
    search: '',
    category: 'active',
    status: 'all'
  };

  // Pedido atualmente aberto no modal de detalhes
  let currentDetailOrder = null;

  // Intervalo do timer de atualização visual das reservas
  let reservationTimerInterval = null;

  /**
   * Retorna a instância ativa do cliente Supabase.
   * @returns {Object|null}
   */
  function getClient() {
    if (typeof window.supabaseClient !== 'undefined' && window.supabaseClient) {
      return window.supabaseClient;
    }
    if (typeof window.MascotCarData !== 'undefined' && window.MascotCarData.client) {
      return window.MascotCarData.client;
    }
    return null;
  }

  /**
   * Sanitiza strings contra injeção de HTML (XSS).
   * @param {string|number|null} str
   * @returns {string}
   */
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Formata valor numérico em moeda BRL (R$).
   * @param {number|string} val
   * @returns {string}
   */
  function formatCurrency(val) {
    const num = Number(val);
    if (isNaN(num)) return 'R$ 0,00';
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  /**
   * Formata timestamp ISO para formato amigável brasileiro.
   * @param {string} isoString
   * @returns {string}
   */
  function formatDateTime(isoString) {
    if (!isoString) return '—';
    try {
      const d = new Date(isoString);
      if (isNaN(d.getTime())) return '—';
      return d.toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch (_) {
      return '—';
    }
  }

  /**
   * Retorna a configuração visual (rótulo, classe css e ícone) do status do pedido.
   * @param {string} status
   * @returns {{label: string, className: string, icon: string}}
   */
  function getStatusMeta(status) {
    switch (status) {
      case 'received':
        return { label: 'Recebido', className: 'order-badge--received', icon: '🟡' };
      case 'confirmed':
        return { label: 'Confirmado', className: 'order-badge--confirmed', icon: '🔵' };
      case 'preparing':
        return { label: 'Em preparação', className: 'order-badge--preparing', icon: '🟣' };
      case 'ready':
        return { label: 'Pronto para retirada', className: 'order-badge--ready', icon: '🟢' };
      case 'completed':
        return { label: 'Concluído', className: 'order-badge--completed', icon: '✅' };
      case 'cancelled':
        return { label: 'Cancelado', className: 'order-badge--cancelled', icon: '🔴' };
      case 'expired':
        return { label: 'Expirado', className: 'order-badge--expired', icon: '⚪' };
      default:
        return { label: status || 'Desconhecido', className: 'order-badge--unknown', icon: '❔' };
    }
  }

  /**
   * Calcula o tempo restante de reserva para exibição amigável.
   * @param {string} expiresAt
   * @returns {{text: string, isExpired: boolean, isUrgent: boolean}}
   */
  function calculateReservationTime(expiresAt) {
    if (!expiresAt) return { text: '—', isExpired: true, isUrgent: false };
    const diff = new Date(expiresAt).getTime() - Date.now();
    if (diff <= 0) {
      return { text: 'Reserva expirada', isExpired: true, isUrgent: true };
    }
    const totalMinutes = Math.floor(diff / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);
    const isUrgent = totalMinutes < 5;
    return {
      text: `${totalMinutes}m ${seconds.toString().padStart(2, '0')}s`,
      isExpired: false,
      isUrgent
    };
  }

  /**
   * Interface e elementos visuais da seção de pedidos.
   */
  const UI = {
    loading: () => document.getElementById('orders-loading'),
    error: () => document.getElementById('orders-error'),
    errorMessage: () => document.getElementById('orders-error-message'),
    empty: () => document.getElementById('orders-empty'),
    content: () => document.getElementById('orders-content'),
    tableBody: () => document.getElementById('orders-table-body'),
    countBadge: () => document.getElementById('orders-count-badge'),
    searchInput: () => document.getElementById('orders-search-input'),
    statusFilter: () => document.getElementById('orders-status-filter'),
    resetBtn: () => document.getElementById('orders-reset-filters-btn'),
    refreshBtn: () => document.getElementById('orders-refresh-btn'),
    retryBtn: () => document.getElementById('orders-retry-btn'),

    // Modal de detalhes
    modal: () => document.getElementById('modal-order-details'),
    modalCloseBtn: () => document.getElementById('btn-close-order-modal'),
    modalAlert: () => document.getElementById('order-modal-alert'),
    modalCode: () => document.getElementById('order-modal-code'),
    modalDate: () => document.getElementById('order-modal-date'),
    modalStatusBadge: () => document.getElementById('order-modal-status-badge'),
    modalCustomerName: () => document.getElementById('order-modal-customer-name'),
    modalCustomerPhone: () => document.getElementById('order-modal-customer-phone'),
    modalCustomerNotes: () => document.getElementById('order-modal-customer-notes'),
    modalReservationBox: () => document.getElementById('order-modal-reservation-box'),
    modalReservationTimer: () => document.getElementById('order-modal-reservation-timer'),
    modalItemsBody: () => document.getElementById('order-modal-items-body'),
    modalTotalItems: () => document.getElementById('order-modal-total-items'),
    modalTotalAmount: () => document.getElementById('order-modal-total-amount'),
    modalHistoryTimeline: () => document.getElementById('order-modal-history-timeline'),
    modalActionsContainer: () => document.getElementById('order-modal-actions'),

    showOnly(state) {
      const elLoading = this.loading();
      const elError = this.error();
      const elEmpty = this.empty();
      const elContent = this.content();

      if (elLoading) elLoading.style.display = state === 'loading' ? 'flex' : 'none';
      if (elError) elError.style.display = state === 'error' ? 'block' : 'none';
      if (elEmpty) elEmpty.style.display = state === 'empty' ? 'block' : 'none';
      if (elContent) elContent.style.display = state === 'content' ? 'block' : 'none';
    }
  };

  /**
   * Consulta os pedidos na tabela public.orders.
   * Filtra campos sensíveis (não solicita tokens).
   * @returns {Promise<{success: boolean, data?: Array, error?: any}>}
   */
  async function fetchOrders() {
    const client = getClient();
    if (!client) {
      return { success: false, error: { message: 'Cliente Supabase não inicializado.' } };
    }

    try {
      const { data, error } = await client
        .from('orders')
        .select('id, order_code, customer_name, customer_phone, notes, status, total_amount, total_items, reservation_expires_at, created_at, updated_at')
        .order('created_at', { ascending: false });

      if (error) {
        return { success: false, error };
      }
      return { success: true, data: data || [] };
    } catch (err) {
      return { success: false, error: err };
    }
  }

  /**
   * Carrega os itens congelados (snapshot) de um pedido específico.
   * @param {string} orderId
   * @returns {Promise<Array>}
   */
  async function fetchOrderItems(orderId) {
    const client = getClient();
    if (!client || !orderId) return [];

    try {
      const { data, error } = await client
        .from('order_items')
        .select('id, product_id, product_name, quantity, unit_price, subtotal, image_url')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });

      if (error) {
        console.warn('⚠️ [MascotCar Orders] Erro ao buscar itens do pedido:', error);
        return [];
      }
      return data || [];
    } catch (err) {
      console.warn('⚠️ [MascotCar Orders] Exceção ao buscar itens do pedido:', err);
      return [];
    }
  }

  /**
   * Carrega o histórico de auditoria de status de um pedido específico.
   * @param {string} orderId
   * @returns {Promise<Array>}
   */
  async function fetchOrderStatusHistory(orderId) {
    const client = getClient();
    if (!client || !orderId) return [];

    try {
      const { data, error } = await client
        .from('order_status_history')
        .select('id, status, comment, actor_type, created_at')
        .eq('order_id', orderId)
        .order('created_at', { ascending: true });

      if (error) {
        console.warn('⚠️ [MascotCar Orders] Erro ao buscar histórico do pedido:', error);
        return [];
      }
      return data || [];
    } catch (err) {
      console.warn('⚠️ [MascotCar Orders] Exceção ao buscar histórico:', err);
      return [];
    }
  }

  /**
   * Atualiza a exibição de alerta dentro do modal de detalhes.
   * @param {string} msg
   * @param {'error'|'warning'|'success'} type
   */
  function showModalAlert(msg, type = 'error') {
    const alertEl = UI.modalAlert();
    if (!alertEl) return;
    alertEl.textContent = msg;
    alertEl.className = `alert alert-${type}`;
    alertEl.style.display = 'flex';
  }

  /**
   * Oculta alerta do modal de detalhes.
   */
  function hideModalAlert() {
    const alertEl = UI.modalAlert();
    if (!alertEl) return;
    alertEl.style.display = 'none';
  }

  // Constantes de categorias e status (Etapa 3N.4.2)
  const ACTIVE_STATUSES = ['received', 'confirmed', 'preparing', 'ready'];

  /**
   * Retorna os contadores de pedidos para cada categoria.
   * @returns {{all: number, active: number, completed: number, expired: number, cancelled: number}}
   */
  function calculateCategoryCounts() {
    const counts = {
      all: loadedOrders.length,
      active: 0,
      completed: 0,
      expired: 0,
      cancelled: 0
    };

    loadedOrders.forEach((order) => {
      if (ACTIVE_STATUSES.includes(order.status)) {
        counts.active++;
      } else if (order.status === 'completed') {
        counts.completed++;
      } else if (order.status === 'expired') {
        counts.expired++;
      } else if (order.status === 'cancelled') {
        counts.cancelled++;
      }
    });

    return counts;
  }

  /**
   * Aplica filtros de categoria, status específico e busca em memória sobre a lista de pedidos.
   * @returns {Array}
   */
  function getFilteredOrders() {
    const search = currentFilters.search.trim().toLowerCase();
    const category = currentFilters.category || 'active';
    const status = currentFilters.status;

    return loadedOrders.filter((order) => {
      // 1. Filtro por Categoria principal (Etapa 3N.4.2)
      if (category === 'active') {
        if (!ACTIVE_STATUSES.includes(order.status)) return false;
      } else if (category === 'completed') {
        if (order.status !== 'completed') return false;
      } else if (category === 'expired') {
        if (order.status !== 'expired') return false;
      } else if (category === 'cancelled') {
        if (order.status !== 'cancelled') return false;
      }
      // Se category === 'all', todos os status permitidos pelo admin passam

      // 2. Filtro secundário por status específico (select)
      if (status !== 'all' && order.status !== status) {
        return false;
      }

      // 3. Filtro de texto (código, nome do cliente, telefone)
      if (search) {
        const code = (order.order_code || '').toLowerCase();
        const name = (order.customer_name || '').toLowerCase();
        const phone = (order.customer_phone || '').replace(/\D/g, '');
        const cleanSearch = search.replace(/\D/g, '');

        const matchCode = code.includes(search);
        const matchName = name.includes(search);
        const matchPhone = cleanSearch ? phone.includes(cleanSearch) : false;

        if (!matchCode && !matchName && !matchPhone) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Atualiza os contadores, as abas de categoria e botões da tela.
   * @param {number} totalFiltered
   * @param {number} totalLoaded
   */
  function updateCounters(totalFiltered, totalLoaded) {
    const badge = UI.countBadge();
    if (badge) {
      if (totalLoaded === 0) {
        badge.textContent = '0 pedidos';
      } else if (totalFiltered === totalLoaded) {
        badge.textContent = `${totalLoaded} ${totalLoaded === 1 ? 'pedido' : 'pedidos'}`;
      } else {
        badge.textContent = `${totalFiltered} de ${totalLoaded} pedidos`;
      }
    }

    // Atualiza contadores nas abas de categoria (Etapa 3N.4.2)
    const counts = calculateCategoryCounts();
    const countActiveEl = document.getElementById('count-orders-active');
    const countAllEl = document.getElementById('count-orders-all');
    const countCompletedEl = document.getElementById('count-orders-completed');
    const countExpiredEl = document.getElementById('count-orders-expired');
    const countCancelledEl = document.getElementById('count-orders-cancelled');

    if (countActiveEl) countActiveEl.textContent = counts.active;
    if (countAllEl) countAllEl.textContent = counts.all;
    if (countCompletedEl) countCompletedEl.textContent = counts.completed;
    if (countExpiredEl) countExpiredEl.textContent = counts.expired;
    if (countCancelledEl) countCancelledEl.textContent = counts.cancelled;

    // Atualiza estado ativo/selecionado das abas
    const tabs = document.querySelectorAll('.orders-category-tab');
    tabs.forEach((tab) => {
      const cat = tab.getAttribute('data-category');
      const isSelected = cat === currentFilters.category;
      tab.classList.toggle('active', isSelected);
      tab.setAttribute('aria-selected', isSelected ? 'true' : 'false');
    });

    const resetBtn = UI.resetBtn();
    if (resetBtn) {
      const hasActiveFilter = currentFilters.search !== '' || currentFilters.status !== 'all' || currentFilters.category !== 'active';
      resetBtn.style.display = hasActiveFilter ? 'inline-flex' : 'none';
    }
  }

  /**
   * Retorna mensagem e ícone de estado vazio conforme a categoria selecionada.
   * @param {string} category
   * @param {boolean} hasSearch
   * @returns {{icon: string, message: string}}
   */
  function getEmptyStateInfo(category, hasSearch) {
    if (hasSearch) {
      return {
        icon: '🔍',
        message: 'Nenhum pedido encontrado para o termo pesquisado.'
      };
    }

    switch (category) {
      case 'active':
        return { icon: '✨', message: 'Nenhum pedido ativo no momento.' };
      case 'completed':
        return { icon: '✅', message: 'Nenhum pedido finalizado.' };
      case 'expired':
        return { icon: '⚪', message: 'Nenhum pedido expirado.' };
      case 'cancelled':
        return { icon: '🔴', message: 'Nenhum pedido cancelado.' };
      case 'all':
      default:
        return { icon: '🛍️', message: 'Nenhum pedido encontrado.' };
    }
  }

  /**
   * Renderiza a tabela de pedidos no painel.
   */
  function renderOrdersTable() {
    const tableBody = UI.tableBody();
    if (!tableBody) return;

    const filtered = getFilteredOrders();
    updateCounters(filtered.length, loadedOrders.length);

    if (loadedOrders.length === 0) {
      UI.showOnly('empty');
      return;
    }

    if (filtered.length === 0) {
      UI.showOnly('content');
      const hasSearch = currentFilters.search.trim().length > 0;
      const emptyInfo = getEmptyStateInfo(currentFilters.category, hasSearch);

      tableBody.innerHTML = `
        <tr>
          <td colspan="7" class="table-empty-row">
            <div class="table-empty-box">
              <span style="font-size: 2rem;">${emptyInfo.icon}</span>
              <p style="margin: 0; font-weight: 500;">${emptyInfo.message}</p>
              ${hasSearch || currentFilters.status !== 'all' ? `
                <button type="button" class="btn btn-secondary btn-sm" onclick="window.MascotCarOrders.resetFilters()">
                  Limpar filtros de busca
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
      return;
    }

    UI.showOnly('content');

    tableBody.innerHTML = filtered.map((order) => {
      const meta = getStatusMeta(order.status);
      const isReceived = order.status === 'received';
      let timerHtml = '';

      if (isReceived) {
        const timeInfo = calculateReservationTime(order.reservation_expires_at);
        timerHtml = `
          <div class="order-timer-chip ${timeInfo.isUrgent ? 'order-timer-chip--urgent' : ''}" data-expires="${escapeHtml(order.reservation_expires_at)}">
            ⏱️ ${timeInfo.text}
          </div>
        `;
      }

      return `
        <tr data-order-id="${escapeHtml(order.id)}">
          <td class="col-code">
            <span class="order-code-badge">${escapeHtml(order.order_code || '—')}</span>
          </td>
          <td class="col-customer">
            <div class="customer-info-box">
              <span class="customer-name">${escapeHtml(order.customer_name || 'Não informado')}</span>
              <span class="customer-phone">${escapeHtml(order.customer_phone || 'Sem telefone')}</span>
            </div>
          </td>
          <td class="col-date">
            <span class="order-date-text">${escapeHtml(formatDateTime(order.created_at))}</span>
          </td>
          <td class="col-items" style="text-align: center;">
            <span class="items-count-pill">${order.total_items || 0} un.</span>
          </td>
          <td class="col-amount">
            <span class="order-amount-text">${formatCurrency(order.total_amount || 0)}</span>
          </td>
          <td class="col-status">
            <div style="display: flex; flex-direction: column; gap: 0.35rem; align-items: flex-start;">
              <span class="order-badge ${meta.className}">
                <span class="order-badge__dot"></span>
                ${meta.label}
              </span>
              ${timerHtml}
            </div>
          </td>
          <td class="col-actions" style="text-align: center;">
            <button 
              type="button" 
              class="btn btn-secondary btn-sm btn-open-order-detail" 
              data-order-id="${escapeHtml(order.id)}"
              title="Ver detalhes do pedido"
            >
              👁️ Detalhes
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  /**
   * Inicia o timer que atualiza na tela os contadores visuais de reserva.
   */
  function startReservationTicker() {
    if (reservationTimerInterval) {
      clearInterval(reservationTimerInterval);
    }

    reservationTimerInterval = setInterval(() => {
      // 1. Atualiza chips na tabela
      const chips = document.querySelectorAll('.order-timer-chip[data-expires]');
      chips.forEach((chip) => {
        const expiresAt = chip.getAttribute('data-expires');
        const timeInfo = calculateReservationTime(expiresAt);
        chip.textContent = `⏱️ ${timeInfo.text}`;
        if (timeInfo.isUrgent) {
          chip.classList.add('order-timer-chip--urgent');
        } else {
          chip.classList.remove('order-timer-chip--urgent');
        }
      });

      // 2. Atualiza o timer no modal se estiver aberto com pedido recebido
      if (currentDetailOrder && currentDetailOrder.status === 'received') {
        const timerEl = UI.modalReservationTimer();
        if (timerEl) {
          const timeInfo = calculateReservationTime(currentDetailOrder.reservation_expires_at);
          timerEl.textContent = timeInfo.text;
          if (timeInfo.isUrgent) {
            timerEl.classList.add('text-danger');
          } else {
            timerEl.classList.remove('text-danger');
          }
        }
      }
    }, 1000);
  }

  /**
   * Abre o modal com todos os detalhes e ações do pedido.
   * @param {string} orderId
   */
  async function openOrderDetailModal(orderId) {
    const order = loadedOrders.find((o) => o.id === orderId);
    if (!order) return;

    currentDetailOrder = order;
    hideModalAlert();

    const modal = UI.modal();
    if (!modal) return;

    // Preenche cabeçalho e dados básicos
    const codeEl = UI.modalCode();
    const dateEl = UI.modalDate();
    const badgeEl = UI.modalStatusBadge();
    const nameEl = UI.modalCustomerName();
    const phoneEl = UI.modalCustomerPhone();
    const notesEl = UI.modalCustomerNotes();
    const resBoxEl = UI.modalReservationBox();
    const resTimerEl = UI.modalReservationTimer();
    const itemsBodyEl = UI.modalItemsBody();
    const totalItemsEl = UI.modalTotalItems();
    const totalAmountEl = UI.modalTotalAmount();
    const timelineEl = UI.modalHistoryTimeline();
    const actionsEl = UI.modalActionsContainer();

    const meta = getStatusMeta(order.status);

    if (codeEl) codeEl.textContent = order.order_code || '—';
    if (dateEl) dateEl.textContent = `Criado em: ${formatDateTime(order.created_at)}`;
    if (badgeEl) {
      badgeEl.className = `order-badge ${meta.className}`;
      badgeEl.innerHTML = `<span class="order-badge__dot"></span> ${meta.label}`;
    }

    if (nameEl) nameEl.textContent = order.customer_name || 'Não informado';
    if (phoneEl) {
      const phone = order.customer_phone || '';
      if (phone) {
        const clean = phone.replace(/\D/g, '');
        phoneEl.innerHTML = `<a href="https://wa.me/55${clean}" target="_blank" rel="noopener noreferrer" style="color: var(--primary); text-decoration: underline;" title="Conversar no WhatsApp">📱 ${escapeHtml(phone)}</a>`;
      } else {
        phoneEl.textContent = 'Não informado';
      }
    }
    if (notesEl) notesEl.textContent = order.notes || 'Nenhuma observação informada pelo cliente.';

    // Exibição da reserva
    if (order.status === 'received' && order.reservation_expires_at) {
      if (resBoxEl) resBoxEl.style.display = 'flex';
      const timeInfo = calculateReservationTime(order.reservation_expires_at);
      if (resTimerEl) resTimerEl.textContent = timeInfo.text;
    } else {
      if (resBoxEl) resBoxEl.style.display = 'none';
    }

    if (totalItemsEl) totalItemsEl.textContent = `${order.total_items || 0} ${order.total_items === 1 ? 'item' : 'itens'}`;
    if (totalAmountEl) totalAmountEl.textContent = formatCurrency(order.total_amount || 0);

    // Estados de carregamento dos itens e histórico
    if (itemsBodyEl) {
      itemsBodyEl.innerHTML = `
        <tr>
          <td colspan="5" style="text-align: center; padding: 1.5rem; color: var(--text-muted);">
            Carregando itens congelados...
          </td>
        </tr>
      `;
    }

    if (timelineEl) {
      timelineEl.innerHTML = `
        <div style="text-align: center; padding: 1.5rem; color: var(--text-muted); font-size: 0.875rem;">
          Carregando histórico do pedido...
        </div>
      `;
    }

    renderModalActionButtons(actionsEl, order);

    // Exibe o modal
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';

    // Busca assíncrona dos itens e histórico em paralelo
    const [items, history] = await Promise.all([
      fetchOrderItems(order.id),
      fetchOrderStatusHistory(order.id)
    ]);

    // Renderiza itens
    if (itemsBodyEl) {
      if (items.length === 0) {
        itemsBodyEl.innerHTML = `
          <tr>
            <td colspan="5" style="text-align: center; padding: 1.5rem; color: var(--text-muted);">
              Nenhum item registrado neste pedido.
            </td>
          </tr>
        `;
      } else {
        itemsBodyEl.innerHTML = items.map((item) => {
          const thumbHtml = item.image_url
            ? `<img src="${escapeHtml(item.image_url)}" alt="${escapeHtml(item.product_name)}" class="order-item-thumb" onerror="this.onerror=null;this.parentElement.innerHTML='<span class=\\'thumb-placeholder\\'>📦</span>';">`
            : `<span class="thumb-placeholder">📦</span>`;

          return `
            <tr>
              <td style="width: 50px; text-align: center;">
                <div class="product-thumb" style="width: 40px; height: 40px;">
                  ${thumbHtml}
                </div>
              </td>
              <td>
                <span class="product-name" style="font-size: 0.9rem;">${escapeHtml(item.product_name)}</span>
              </td>
              <td style="text-align: right; white-space: nowrap;">
                ${formatCurrency(item.unit_price)}
              </td>
              <td style="text-align: center;">
                <span class="items-count-pill">${item.quantity}</span>
              </td>
              <td style="text-align: right; font-weight: 600; white-space: nowrap;">
                ${formatCurrency(item.subtotal)}
              </td>
            </tr>
          `;
        }).join('');
      }
    }

    // Renderiza linha do tempo de status
    if (timelineEl) {
      if (history.length === 0) {
        timelineEl.innerHTML = `
          <div class="timeline-empty" style="text-align: center; padding: 1rem; color: var(--text-muted); font-size: 0.85rem;">
            Nenhum evento registrado no histórico até o momento.
          </div>
        `;
      } else {
        timelineEl.innerHTML = history.map((entry) => {
          const sMeta = getStatusMeta(entry.status);
          const actorBadge = entry.actor_type
            ? `<span class="timeline-actor-pill timeline-actor-pill--${escapeHtml(entry.actor_type)}">${escapeHtml(entry.actor_type)}</span>`
            : '';

          return `
            <div class="timeline-entry">
              <div class="timeline-entry__marker">
                <span class="timeline-dot"></span>
              </div>
              <div class="timeline-entry__content">
                <div class="timeline-entry__header">
                  <div style="display: flex; align-items: center; gap: 0.4rem; flex-wrap: wrap;">
                    <span class="order-badge ${sMeta.className}" style="font-size: 0.72rem; padding: 0.15rem 0.5rem;">
                      ${sMeta.label}
                    </span>
                    ${actorBadge}
                  </div>
                  <span class="timeline-entry__date">${escapeHtml(formatDateTime(entry.created_at))}</span>
                </div>
                ${entry.comment ? `<p class="timeline-entry__comment">${escapeHtml(entry.comment)}</p>` : ''}
              </div>
            </div>
          `;
        }).join('');
      }
    }
  }

  /**
   * Helper para desabilitar/habilitar todos os botões de ação do modal de pedidos.
   * @param {boolean} disabled
   */
  function setModalActionsDisabled(disabled) {
    const actionsBox = UI.modalActionsContainer();
    if (!actionsBox) return;
    const buttons = actionsBox.querySelectorAll('button');
    buttons.forEach((btn) => {
      btn.disabled = disabled;
    });
  }

  /**
   * Renderiza os botões de ação permitidos no modal de acordo com o status atual.
   * @param {HTMLElement} container
   * @param {Object} order
   */
  function renderModalActionButtons(container, order) {
    if (!container) return;

    const isTerminal = ['completed', 'cancelled', 'expired'].includes(order.status);
    let buttonsHtml = '';

    if (order.status === 'received') {
      const isExpired = new Date(order.reservation_expires_at).getTime() <= Date.now();
      if (isExpired) {
        buttonsHtml = `
          <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; flex-wrap: wrap; gap: 0.5rem;">
            <span style="font-size: 0.85rem; color: var(--danger);">⚠️ Reserva expirada. Nenhuma ação operacional permitida.</span>
            <button type="button" class="btn btn-secondary btn-sm" id="btn-close-order-modal-secondary" style="width: auto;">
              Fechar
            </button>
          </div>
        `;
      } else {
        buttonsHtml = `
          <div style="display: flex; gap: 0.75rem; width: 100%; justify-content: space-between; align-items: center; flex-wrap: wrap;">
            <button type="button" class="btn btn-outline-danger btn-sm" id="btn-action-cancel" style="width: auto;">
              ✕ Cancelar Pedido
            </button>
            <button type="button" class="btn btn-primary btn-sm" id="btn-action-confirm" style="width: auto;">
              ✓ Confirmar Pedido (Deduzir Estoque)
            </button>
          </div>
        `;
      }
    } else if (['confirmed', 'preparing', 'ready'].includes(order.status)) {
      let nextActionLabel = '';
      let nextStatus = '';

      if (order.status === 'confirmed') {
        nextActionLabel = '🟣 Iniciar preparação';
        nextStatus = 'preparing';
      } else if (order.status === 'preparing') {
        nextActionLabel = '🟢 Marcar como pronto';
        nextStatus = 'ready';
      } else if (order.status === 'ready') {
        nextActionLabel = '✅ Marcar como concluído';
        nextStatus = 'completed';
      }

      buttonsHtml = `
        <div style="display: flex; gap: 0.75rem; width: 100%; justify-content: space-between; align-items: center; flex-wrap: wrap;">
          <button type="button" class="btn btn-outline-danger btn-sm" id="btn-action-cancel" style="width: auto;">
            ✕ Cancelar Pedido
          </button>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-action-next-status" data-next="${nextStatus}" style="width: auto;">
              ${nextActionLabel}
            </button>
          </div>
        </div>
      `;
    } else if (isTerminal) {
      buttonsHtml = `
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
          <span style="font-size: 0.85rem; color: var(--text-muted);">
            Status terminal (${getStatusMeta(order.status).label}). Nenhuma ação de alteração permitida.
          </span>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-close-order-modal-secondary" style="width: auto;">
            Fechar
          </button>
        </div>
      `;
    }

    container.innerHTML = buttonsHtml;

    // Conecta listeners dos botões dinâmicos
    const confirmBtn = container.querySelector('#btn-action-confirm');
    if (confirmBtn) {
      confirmBtn.addEventListener('click', () => executeConfirmOrder(order));
    }

    const cancelBtn = container.querySelector('#btn-action-cancel');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => executeCancelOrder(order));
    }

    const nextStatusBtn = container.querySelector('#btn-action-next-status');
    if (nextStatusBtn) {
      nextStatusBtn.addEventListener('click', () => {
        const next = nextStatusBtn.getAttribute('data-next');
        executeStatusTransition(order, next);
      });
    }

    const closeSecBtn = container.querySelector('#btn-close-order-modal-secondary');
    if (closeSecBtn) {
      closeSecBtn.addEventListener('click', closeOrderDetailModal);
    }
  }

  /**
   * Fecha o modal de detalhes do pedido.
   */
  function closeOrderDetailModal() {
    const modal = UI.modal();
    if (!modal) return;
    modal.style.display = 'none';
    document.body.style.overflow = '';
    currentDetailOrder = null;
  }

  /**
   * Executa a confirmação segura do pedido via RPC confirm_order.
   * @param {Object} order
   */
  async function executeConfirmOrder(order) {
    if (!order || !order.id) return;

    const confirmed = window.confirm(`Deseja realmente confirmar o pedido ${order.order_code}?\n\nEsta ação consumirá o estoque físico dos produtos definitivamente.`);
    if (!confirmed) return;

    hideModalAlert();
    const client = getClient();
    if (!client) {
      showModalAlert('Cliente Supabase não inicializado.', 'error');
      return;
    }

    // Bloqueia todos os botões de ação do modal contra ações concorrentes
    setModalActionsDisabled(true);

    const confirmBtn = document.getElementById('btn-action-confirm');
    if (confirmBtn) {
      confirmBtn.innerHTML = '<span>Confirmando...</span>';
    }

    try {
      const { data, error } = await client.rpc('confirm_order', {
        p_order_id: order.id
      });

      if (error) {
        showModalAlert(`Falha ao confirmar pedido: ${error.message}`, 'error');
        setModalActionsDisabled(false);
        if (confirmBtn) {
          confirmBtn.innerHTML = '<span>✓ Confirmar Pedido</span>';
        }
        return;
      }

      showModalAlert('Pedido confirmado com sucesso! Estoque atualizado.', 'success');
      await refreshOrders(false);
      // Atualiza também catálogo de produtos se estiver carregado
      if (window.MascotCarProducts && typeof window.MascotCarProducts.refreshCatalog === 'function') {
        window.MascotCarProducts.refreshCatalog();
      }
      setTimeout(() => {
        openOrderDetailModal(order.id);
      }, 700);
    } catch (err) {
      showModalAlert(`Erro inesperado: ${err.message || err}`, 'error');
      setModalActionsDisabled(false);
      if (confirmBtn) {
        confirmBtn.innerHTML = '<span>✓ Confirmar Pedido</span>';
      }
    }
  }

  /**
   * Executa o cancelamento seguro do pedido via RPC cancel_order.
   * @param {Object} order
   */
  async function executeCancelOrder(order) {
    if (!order || !order.id) return;

    const reason = window.prompt(`Informe o motivo do cancelamento do pedido ${order.order_code}:`, 'Cancelado pelo administrador');
    if (reason === null) return; // cancelou o prompt

    hideModalAlert();
    const client = getClient();
    if (!client) {
      showModalAlert('Cliente Supabase não inicializado.', 'error');
      return;
    }

    // Bloqueia todos os botões de ação do modal contra ações concorrentes
    setModalActionsDisabled(true);

    const cancelBtn = document.getElementById('btn-action-cancel');
    if (cancelBtn) {
      cancelBtn.innerHTML = '<span>Cancelando...</span>';
    }

    try {
      const { data, error } = await client.rpc('cancel_order', {
        p_order_id: order.id,
        p_reason: reason.trim() || 'Cancelado pelo administrador'
      });

      if (error) {
        showModalAlert(`Falha ao cancelar pedido: ${error.message}`, 'error');
        setModalActionsDisabled(false);
        if (cancelBtn) {
          cancelBtn.innerHTML = '<span>✕ Cancelar Pedido</span>';
        }
        return;
      }

      showModalAlert('Pedido cancelado com sucesso! Reserva/estoque liberados.', 'success');
      await refreshOrders(false);
      // Atualiza catálogo de produtos se estiver carregado
      if (window.MascotCarProducts && typeof window.MascotCarProducts.refreshCatalog === 'function') {
        window.MascotCarProducts.refreshCatalog();
      }
      setTimeout(() => {
        openOrderDetailModal(order.id);
      }, 700);
    } catch (err) {
      showModalAlert(`Erro inesperado: ${err.message || err}`, 'error');
      setModalActionsDisabled(false);
      if (cancelBtn) {
        cancelBtn.innerHTML = '<span>✕ Cancelar Pedido</span>';
      }
    }
  }

  /**
   * Executa transição para status intermediários (preparing, ready, completed)
   * através de transição direta autorizada por RLS para o administrador.
   * @param {Object} order
   * @param {string} nextStatus
   */
  async function executeStatusTransition(order, nextStatus) {
    if (!order || !order.id || !nextStatus) return;

    const nextMeta = getStatusMeta(nextStatus);
    const confirmMessage = nextStatus === 'completed'
      ? `Tem certeza que deseja marcar o pedido ${order.order_code} como concluído?`
      : `Deseja avançar o pedido ${order.order_code} para o status "${nextMeta.label}"?`;

    const confirmed = window.confirm(confirmMessage);
    if (!confirmed) return;

    hideModalAlert();
    const client = getClient();
    if (!client) {
      showModalAlert('Cliente Supabase não inicializado.', 'error');
      return;
    }

    // Bloqueia todos os botões de ação do modal contra ações concorrentes
    setModalActionsDisabled(true);

    const btn = document.getElementById('btn-action-next-status');
    if (btn) {
      btn.innerHTML = '<span>Salvando...</span>';
    }

    try {
      // Tenta chamar RPC administrativa segura se existir
      const { data, error: rpcError } = await client.rpc('admin_update_order_status', {
        p_order_id: order.id,
        p_new_status: nextStatus
      });

      if (rpcError) {
        showModalAlert(`Falha ao alterar status: ${rpcError.message}`, 'error');
        setModalActionsDisabled(false);
        if (btn) {
          btn.innerHTML = `<span>${nextMeta.label}</span>`;
        }
        return;
      }

      showModalAlert(`Status atualizado para "${nextMeta.label}" com sucesso!`, 'success');
      await refreshOrders(false);
      setTimeout(() => {
        openOrderDetailModal(order.id);
      }, 500);
    } catch (err) {
      showModalAlert(`Erro inesperado: ${err.message || err}`, 'error');
      setModalActionsDisabled(false);
      if (btn) {
        btn.innerHTML = `<span>${nextMeta.label}</span>`;
      }
    }
  }

  /**
   * Recarrega a lista de pedidos do Supabase.
   * @param {boolean} showLoadingUI
   */
  async function refreshOrders(showLoadingUI = true) {
    if (showLoadingUI) {
      UI.showOnly('loading');
    }

    const result = await fetchOrders();

    if (!result.success) {
      const errEl = UI.errorMessage();
      if (errEl) {
        errEl.textContent = result.error?.message || 'Falha ao buscar pedidos no Supabase.';
      }
      UI.showOnly('error');
      return;
    }

    loadedOrders = result.data || [];
    renderOrdersTable();
  }

  /**
   * Redefine todos os filtros de busca e status para o padrão (Ativos).
   */
  function resetFilters() {
    currentFilters.search = '';
    currentFilters.category = 'active';
    currentFilters.status = 'all';

    const searchInput = UI.searchInput();
    if (searchInput) searchInput.value = '';

    const statusFilter = UI.statusFilter();
    if (statusFilter) statusFilter.value = 'all';

    renderOrdersTable();
  }

  /**
   * Configura abas de navegação no painel administrativo (Produtos vs Pedidos).
   */
  function initNavigationTabs() {
    const navProducts = document.getElementById('tab-nav-products');
    const navOrders = document.getElementById('tab-nav-orders');
    const secProducts = document.getElementById('products-section');
    const secOrders = document.getElementById('orders-section');

    function setActiveTab(tab) {
      if (tab === 'orders') {
        if (navOrders) navOrders.classList.add('active');
        if (navProducts) navProducts.classList.remove('active');
        if (secOrders) secOrders.style.display = 'block';
        if (secProducts) secProducts.style.display = 'none';
        refreshOrders(true);
      } else {
        if (navProducts) navProducts.classList.add('active');
        if (navOrders) navOrders.classList.remove('active');
        if (secProducts) secProducts.style.display = 'block';
        if (secOrders) secOrders.style.display = 'none';
      }
    }

    if (navProducts) {
      navProducts.addEventListener('click', (e) => {
        e.preventDefault();
        setActiveTab('products');
      });
    }

    if (navOrders) {
      navOrders.addEventListener('click', (e) => {
        e.preventDefault();
        setActiveTab('orders');
      });
    }

    // Expõe troca de abas para chamadas externas
    window.MascotCarOrdersSwitchTab = setActiveTab;
  }

  /**
   * Inicializa eventos e listeners da seção de pedidos.
   */
  function initEvents() {
    // Abas de categorias de pedidos (Etapa 3N.4.2)
    const categoryTabsContainer = document.querySelector('.orders-category-tabs');
    if (categoryTabsContainer) {
      categoryTabsContainer.addEventListener('click', (e) => {
        const tabBtn = e.target.closest('.orders-category-tab');
        if (!tabBtn) return;
        const category = tabBtn.getAttribute('data-category');
        if (!category || category === currentFilters.category) return;

        currentFilters.category = category;
        // Ao trocar de categoria, resetamos o select de status secundário se ele conflitar
        currentFilters.status = 'all';
        const statusFilter = UI.statusFilter();
        if (statusFilter) statusFilter.value = 'all';

        renderOrdersTable();
      });
    }

    // Busca em tempo real com debounce simples
    const searchInput = UI.searchInput();
    if (searchInput) {
      let debounceTimer = null;
      searchInput.addEventListener('input', (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          currentFilters.search = e.target.value;
          renderOrdersTable();
        }, 250);
      });
    }

    // Filtro por status secundário
    const statusFilter = UI.statusFilter();
    if (statusFilter) {
      statusFilter.addEventListener('change', (e) => {
        currentFilters.status = e.target.value;
        renderOrdersTable();
      });
    }

    // Botão Limpar Filtros
    const resetBtn = UI.resetBtn();
    if (resetBtn) {
      resetBtn.addEventListener('click', resetFilters);
    }

    // Botão Atualizar
    const refreshBtn = UI.refreshBtn();
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => refreshOrders(true));
    }

    // Botão Tentar Novamente no erro
    const retryBtn = UI.retryBtn();
    if (retryBtn) {
      retryBtn.addEventListener('click', () => refreshOrders(true));
    }

    // Delegação de cliques na tabela de pedidos
    const tableBody = UI.tableBody();
    if (tableBody) {
      tableBody.addEventListener('click', (e) => {
        const detailBtn = e.target.closest('.btn-open-order-detail');
        if (detailBtn) {
          const orderId = detailBtn.getAttribute('data-order-id');
          if (orderId) openOrderDetailModal(orderId);
        }
      });
    }

    // Fechar modal pelo botão X
    const closeBtn = UI.modalCloseBtn();
    if (closeBtn) {
      closeBtn.addEventListener('click', closeOrderDetailModal);
    }

    // Fechar modal clicando no backdrop
    const modal = UI.modal();
    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) closeOrderDetailModal();
      });
    }

    // Tecla Escape para fechar modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const m = UI.modal();
        if (m && m.style.display === 'flex') {
          closeOrderDetailModal();
        }
      }
    });

    // Inicia atualização contínua dos contadores de reserva
    startReservationTicker();
  }

  /**
   * Ponto de entrada para inicialização da gestão de pedidos.
   */
  function init() {
    initNavigationTabs();
    initEvents();
  }

  // Expõe API pública do módulo de pedidos
  window.MascotCarOrders = {
    init,
    refreshOrders,
    openOrderDetailModal,
    closeOrderDetailModal,
    resetFilters,
    getLoadedOrders: () => [...loadedOrders]
  };
})();
