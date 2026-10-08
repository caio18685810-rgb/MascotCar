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

  // Filtros ativos (padrão: categoria 'active' conforme Etapa 3N.4.2 e período 'all' na 3S.2)
  const currentFilters = {
    search: '',
    category: 'active',
    status: 'all',
    period: 'all', // 'all' | 'today' | '7days' | '30days' | 'custom'
    dateStart: '', // 'YYYY-MM-DD'
    dateEnd: ''    // 'YYYY-MM-DD'
  };

  // Pedido atualmente aberto no modal de detalhes
  let currentDetailOrder = null;

  // Intervalo do timer de atualização visual das reservas
  let reservationTimerInterval = null;

  // Polling automático e silencioso (Etapa 3N.4.4)
  const POLLING_INTERVAL_MS = 30000; // 30 segundos
  let ordersPollingInterval = null;
  let isPollingRunning = false;

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
   * Sanitiza o número de telefone brasileiro para o formato internacional aceito pelo WhatsApp (DDI 55 + DDD + Número).
   * @param {string|null} phoneStr
   * @returns {string|null} Retorna os dígitos com DDI 55 ou null se inválido/ausente.
   */
  function sanitizeBrazilianPhoneNumber(phoneStr) {
    if (!phoneStr) return null;
    let digits = String(phoneStr).replace(/\D/g, '');
    if (!digits) return null;

    // Se já começar com 55 e tiver tamanho compatível (ex: 55 + 10 ou 11 dígitos = 12 ou 13 dígitos)
    if (digits.startsWith('55') && (digits.length === 12 || digits.length === 13)) {
      return digits;
    }

    // Se for número nacional com DDD (10 dígitos para fixo ou 11 dígitos para celular)
    if (digits.length === 10 || digits.length === 11) {
      return `55${digits}`;
    }

    return null;
  }

  /**
   * Constrói o link oficial do WhatsApp com mensagem contextualizada para atendimento do lojista (Etapa 3N.4.5).
   * @param {Object} order
   * @returns {string|null} Retorna a URL https://wa.me/... ou null se o telefone for ausente/inválido.
   */
  function buildAdminOrderWhatsAppLink(order) {
    if (!order) return null;
    const sanitizedPhone = sanitizeBrazilianPhoneNumber(order.customer_phone);
    if (!sanitizedPhone) return null;

    const customerName = (order.customer_name || 'Cliente').trim();
    const orderCode = order.order_code || '—';
    const statusMeta = getStatusMeta(order.status);
    const totalItems = order.total_items || 0;
    const totalAmount = formatCurrency(order.total_amount || 0);

    let statusContextMsg = '';
    switch (order.status) {
      case 'received':
        statusContextMsg = 'Recebemos seu pedido e ele está aguardando confirmação.';
        break;
      case 'confirmed':
        statusContextMsg = 'Seu pedido foi confirmado e está aguardando preparação.';
        break;
      case 'preparing':
        statusContextMsg = 'Seu pedido está sendo preparado.';
        break;
      case 'ready':
        statusContextMsg = 'Seu pedido está pronto para retirada!';
        break;
      case 'completed':
        statusContextMsg = 'Seu pedido foi concluído. Agradecemos pela preferência!';
        break;
      case 'cancelled':
        statusContextMsg = 'Seu pedido foi cancelado. Se precisar de ajuda, estamos à disposição.';
        break;
      case 'expired':
        statusContextMsg = 'A reserva do seu pedido expirou. Se precisar de ajuda para realizar um novo pedido, estamos à disposição.';
        break;
      default:
        statusContextMsg = 'Estamos à disposição para ajudar com o seu pedido.';
        break;
    }

    let msg = `Olá, ${customerName}! Aqui é da MascotCar. Estou entrando em contato sobre o seu pedido ${orderCode}.\n\n`;
    msg += `Status atual: ${statusMeta.label}.\n\n`;
    msg += `Quantidade de itens: ${totalItems} (${totalItems === 1 ? 'item' : 'itens'}).\n`;
    msg += `Valor total: ${totalAmount}.\n\n`;
    msg += statusContextMsg;

    return `https://wa.me/${sanitizedPhone}?text=${encodeURIComponent(msg)}`;
  }

  /**
   * Renderiza a área de telefone e o botão de WhatsApp no modal de detalhes.
   * @param {Object} order
   */
  function renderCustomerPhoneField(order) {
    const phoneEl = UI.modalCustomerPhone();
    if (!phoneEl) return;

    const rawPhone = order.customer_phone ? String(order.customer_phone).trim() : '';
    if (!rawPhone) {
      phoneEl.innerHTML = `<span style="color: var(--text-dim);">Não informado (WhatsApp indisponível)</span>`;
      return;
    }

    const waUrl = buildAdminOrderWhatsAppLink(order);

    if (waUrl) {
      phoneEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.35rem; align-items: flex-start;">
          <span style="font-weight: 600; color: var(--text-main);">📱 ${escapeHtml(rawPhone)}</span>
          <a
            href="${escapeHtml(waUrl)}"
            target="_blank"
            rel="noopener noreferrer"
            class="btn-order-whatsapp"
            title="Abrir WhatsApp com mensagem predefinida sobre o pedido"
          >
            <span>💬</span> Enviar mensagem pelo WhatsApp
          </a>
        </div>
      `;
    } else {
      // Telefone com formato inválido/incompatível
      phoneEl.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.2rem; align-items: flex-start;">
          <span style="font-weight: 600; color: var(--text-main);">📱 ${escapeHtml(rawPhone)}</span>
          <span style="font-size: 0.75rem; color: #fca5a5;">⚠️ Número fora do padrão nacional (WhatsApp indisponível)</span>
        </div>
      `;
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
    periodFilter: () => document.getElementById('orders-period-filter'),
    customDateWrap: () => document.getElementById('orders-custom-date-wrap'),
    dateStartInput: () => document.getElementById('orders-date-start'),
    dateEndInput: () => document.getElementById('orders-date-end'),
    exportCsvBtn: () => document.getElementById('orders-export-csv-btn'),
    resetBtn: () => document.getElementById('orders-reset-filters-btn'),
    refreshBtn: () => document.getElementById('orders-refresh-btn'),
    retryBtn: () => document.getElementById('orders-retry-btn'),
    navOrdersBadge: () => document.getElementById('nav-orders-pending-badge'),

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
   * Avalia se um pedido está contido na janela temporal selecionada (Etapa 3S.2).
   * Respeita estritamente as regras de timezone e janelas:
   * - 'all': sem restrição temporal
   * - 'today': do início do dia civil atual (00:00:00.000) até o momento atual
   * - '7days': janela móvel dos últimos 7 x 24h até o momento atual
   * - '30days': janela móvel dos últimos 30 x 24h até o momento atual
   * - 'custom': data inicial às 00:00:00.000 e data final às 23:59:59.999 no timezone local
   *
   * @param {string} createdAtIso
   * @param {string} period
   * @param {string} dateStartStr
   * @param {string} dateEndStr
   * @returns {boolean}
   */
  function isOrderInPeriod(createdAtIso, period, dateStartStr, dateEndStr) {
    if (!period || period === 'all') return true;
    if (!createdAtIso) return false;

    const orderTime = new Date(createdAtIso).getTime();
    if (isNaN(orderTime)) return false;

    const now = Date.now();

    if (period === 'today') {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      return orderTime >= todayStart.getTime() && orderTime <= now;
    }

    if (period === '7days') {
      const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
      return orderTime >= sevenDaysAgo && orderTime <= now;
    }

    if (period === '30days') {
      const thirtyDaysAgo = now - (30 * 24 * 60 * 60 * 1000);
      return orderTime >= thirtyDaysAgo && orderTime <= now;
    }

    if (period === 'custom') {
      let startLimit = -Infinity;
      let endLimit = Infinity;

      if (dateStartStr) {
        const [sYear, sMonth, sDay] = dateStartStr.split('-').map(Number);
        const dStart = new Date(sYear, sMonth - 1, sDay, 0, 0, 0, 0);
        if (!isNaN(dStart.getTime())) {
          startLimit = dStart.getTime();
        }
      }

      if (dateEndStr) {
        const [eYear, eMonth, eDay] = dateEndStr.split('-').map(Number);
        const dEnd = new Date(eYear, eMonth - 1, eDay, 23, 59, 59, 999);
        if (!isNaN(dEnd.getTime())) {
          endLimit = dEnd.getTime();
        }
      }

      // Se ambas as datas forem fornecidas e startLimit > endLimit, período é inválido
      if (dateStartStr && dateEndStr && startLimit > endLimit) {
        return false;
      }

      return orderTime >= startLimit && orderTime <= endLimit;
    }

    return true;
  }

  /**
   * Aplica filtros de período, categoria, status específico e busca em memória sobre a lista de pedidos.
   * @returns {Array}
   */
  function getFilteredOrders() {
    const search = currentFilters.search.trim().toLowerCase();
    const category = currentFilters.category || 'active';
    const status = currentFilters.status;
    const period = currentFilters.period || 'all';
    const dateStart = currentFilters.dateStart;
    const dateEnd = currentFilters.dateEnd;

    return loadedOrders.filter((order) => {
      // 1. Filtro Temporal (Etapa 3S.2)
      if (!isOrderInPeriod(order.created_at, period, dateStart, dateEnd)) {
        return false;
      }
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

    // Atualiza o badge numérico de pedidos pendentes na navegação principal (Etapa 3N.4.6)
    updatePendingOrdersBadge();

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
      const hasActiveFilter = (
        currentFilters.search !== '' ||
        currentFilters.status !== 'all' ||
        currentFilters.category !== 'active' ||
        currentFilters.period !== 'all' ||
        currentFilters.dateStart !== '' ||
        currentFilters.dateEnd !== ''
      );
      resetBtn.style.display = hasActiveFilter ? 'inline-flex' : 'none';
    }

    const exportBtn = UI.exportCsvBtn();
    if (exportBtn) {
      exportBtn.disabled = totalFiltered === 0;
      exportBtn.title = totalFiltered === 0
        ? 'Nenhum pedido filtrado para exportar'
        : `Exportar ${totalFiltered} ${totalFiltered === 1 ? 'pedido filtrado' : 'pedidos filtrados'} em CSV`;
    }
  }

  /**
   * Atualiza o badge numérico no botão de navegação "Pedidos dos Clientes" (#tab-nav-orders).
   * Conta pedidos com status = 'received' E reserva ainda válida (reservation_expires_at > agora).
   * Se houver algum pedido com reserva urgente (< 10 minutos), adiciona destaque urgente.
   */
  function updatePendingOrdersBadge() {
    const badgeEl = UI.navOrdersBadge();
    if (!badgeEl) return;

    const now = Date.now();
    let pendingCount = 0;
    let hasUrgent = false;

    loadedOrders.forEach((order) => {
      if (order.status === 'received' && order.reservation_expires_at) {
        const expiresTime = new Date(order.reservation_expires_at).getTime();
        const diffMs = expiresTime - now;
        if (diffMs > 0) {
          pendingCount++;
          if (diffMs < 10 * 60 * 1000) {
            hasUrgent = true;
          }
        }
      }
    });

    if (pendingCount > 0) {
      badgeEl.textContent = pendingCount;
      badgeEl.style.display = 'inline-flex';
      badgeEl.setAttribute('aria-label', `${pendingCount} ${pendingCount === 1 ? 'pedido aguardando confirmação' : 'pedidos aguardando confirmação'}`);
      if (hasUrgent) {
        badgeEl.classList.add('nav-tab-badge--urgent');
        badgeEl.title = `${pendingCount} pedido(s) aguardando confirmação (reserva próxima de expirar)`;
      } else {
        badgeEl.classList.remove('nav-tab-badge--urgent');
        badgeEl.title = `${pendingCount} pedido(s) aguardando confirmação`;
      }
    } else {
      badgeEl.textContent = '0';
      badgeEl.style.display = 'none';
      badgeEl.classList.remove('nav-tab-badge--urgent');
      badgeEl.removeAttribute('title');
    }
  }

  /**
   * Retorna mensagem e ícone de estado vazio conforme a categoria selecionada.
   * @param {string} category
   * @param {boolean} hasSearch
   * @returns {{icon: string, message: string}}
   */
  function getEmptyStateInfo(category, hasSearch, hasPeriodOrStatus) {
    if (hasSearch) {
      return {
        icon: '🔍',
        message: 'Nenhum pedido encontrado para o termo pesquisado.'
      };
    }

    if (hasPeriodOrStatus) {
      return {
        icon: '📅',
        message: 'Nenhum pedido encontrado para os filtros e período selecionados.'
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
      const hasPeriodOrStatus = currentFilters.period !== 'all' || currentFilters.status !== 'all' || currentFilters.dateStart !== '' || currentFilters.dateEnd !== '';
      const emptyInfo = getEmptyStateInfo(currentFilters.category, hasSearch, hasPeriodOrStatus);

      tableBody.innerHTML = `
        <tr>
          <td colspan="7" class="table-empty-row">
            <div class="table-empty-box">
              <span style="font-size: 2rem;">${emptyInfo.icon}</span>
              <p style="margin: 0; font-weight: 500;">${emptyInfo.message}</p>
              ${hasSearch || hasPeriodOrStatus ? `
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

      // 3. Mantém o badge de pedidos pendentes sincronizado com o passar do tempo
      updatePendingOrdersBadge();
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
    renderCustomerPhoneField(order);
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
    const canPrint = ['confirmed', 'preparing', 'ready', 'completed'].includes(order.status);
    let buttonsHtml = '';

    const printButtonHtml = canPrint
      ? `<button type="button" class="btn btn-secondary btn-sm" id="btn-action-print" style="width: auto;">🖨️ Imprimir Pedido</button>`
      : '';

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
          <div style="display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap;">
            <button type="button" class="btn btn-outline-danger btn-sm" id="btn-action-cancel" style="width: auto;">
              ✕ Cancelar Pedido
            </button>
            ${printButtonHtml}
          </div>
          <div style="display: flex; gap: 0.5rem; align-items: center;">
            <button type="button" class="btn btn-secondary btn-sm" id="btn-action-next-status" data-next="${nextStatus}" style="width: auto;">
              ${nextActionLabel}
            </button>
          </div>
        </div>
      `;
    } else if (isTerminal) {
      buttonsHtml = `
        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; flex-wrap: wrap; gap: 0.5rem;">
          <div style="display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap;">
            <span style="font-size: 0.85rem; color: var(--text-muted);">
              Status terminal (${getStatusMeta(order.status).label}). Nenhuma ação de alteração permitida.
            </span>
            ${printButtonHtml}
          </div>
          <button type="button" class="btn btn-secondary btn-sm" id="btn-close-order-modal-secondary" style="width: auto;">
            Fechar
          </button>
        </div>
      `;
    }

    container.innerHTML = buttonsHtml;

    // Conecta listeners dos botões dinâmicos
    const printBtn = container.querySelector('#btn-action-print');
    if (printBtn) {
      printBtn.addEventListener('click', () => {
        window.print();
      });
    }

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
   * Sanitiza e escapa um valor textual para conformidade estrita com RFC 4180
   * e protege contra CSV Formula Injection no Excel/LibreOffice.
   * @param {any} val
   * @returns {string}
   */
  function sanitizeCsvCell(val) {
    if (val === null || val === undefined) return '""';
    let str = String(val).trim();

    // Proteção contra CSV Formula Injection:
    // Se o valor começar com =, +, -, @ ou tabulação, prefixa com apóstrofo
    if (/^[=+\-@\t\r]/.test(str)) {
      str = `'${str}`;
    }

    // Se contiver aspas duplas, vírgula, ponto e vírgula ou quebra de linha, encapsula em aspas e duplica aspas internas
    if (/[",;\n\r]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }

    return `"${str}"`;
  }

  /**
   * Exporta os pedidos visíveis atualmente (resultado exato de getFilteredOrders)
   * em formato CSV compatível com RFC 4180 e Excel com BOM UTF-8 (Etapa 3S.2).
   */
  function exportOrdersToCSV() {
    const ordersToExport = getFilteredOrders();

    if (!ordersToExport || ordersToExport.length === 0) {
      window.alert('Não há pedidos visíveis para exportar com os filtros atuais.');
      return;
    }

    const headers = [
      'Código do Pedido',
      'Data/Hora',
      'Nome do Cliente',
      'Telefone',
      'Status',
      'Quantidade de Itens',
      'Valor Total (R$)',
      'Observações'
    ];

    const rows = ordersToExport.map((order) => {
      const meta = getStatusMeta(order.status);
      const totalAmountFormatted = Number(order.total_amount || 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });

      return [
        sanitizeCsvCell(order.order_code || '—'),
        sanitizeCsvCell(formatDateTime(order.created_at)),
        sanitizeCsvCell(order.customer_name || 'Cliente'),
        sanitizeCsvCell(order.customer_phone || 'Não informado'),
        sanitizeCsvCell(meta.label || order.status),
        sanitizeCsvCell(order.total_items || 0),
        sanitizeCsvCell(totalAmountFormatted),
        sanitizeCsvCell(order.notes || '')
      ].join(';');
    });

    // Ponto e vírgula (;) é o separador padrão de CSV para sistemas e Excel em português (pt-BR)
    const headerRow = headers.map((h) => sanitizeCsvCell(h)).join(';');
    const csvString = `${headerRow}\r\n${rows.join('\r\n')}`;

    // Prefixo BOM UTF-8 (\uFEFF) para garantir renderização correta de acentos no Excel
    const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const dateStamp = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0')
    ].join('-');

    const a = document.createElement('a');
    a.href = url;
    a.download = `pedidos-mascotcar-${dateStamp}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Redefine todos os filtros de busca, período e status para o padrão (Ativos e Todo o período).
   */
  function resetFilters() {
    currentFilters.search = '';
    currentFilters.category = 'active';
    currentFilters.status = 'all';
    currentFilters.period = 'all';
    currentFilters.dateStart = '';
    currentFilters.dateEnd = '';

    const searchInput = UI.searchInput();
    if (searchInput) searchInput.value = '';

    const statusFilter = UI.statusFilter();
    if (statusFilter) statusFilter.value = 'all';

    const periodFilter = UI.periodFilter();
    if (periodFilter) periodFilter.value = 'all';

    const customWrap = UI.customDateWrap();
    if (customWrap) customWrap.style.display = 'none';

    const startInput = UI.dateStartInput();
    if (startInput) startInput.value = '';

    const endInput = UI.dateEndInput();
    if (endInput) endInput.value = '';

    renderOrdersTable();
  }

  /**
   * Executa uma rodada de polling inteligente e silenciosa dos pedidos.
   */
  async function executeSilentOrdersPolling() {
    // 1. Evita requests sobrepostos se uma rodada anterior ainda estiver em andamento
    if (isPollingRunning) return;

    // 2. Não executa polling se a aba do navegador estiver em background
    if (typeof document !== 'undefined' && document.hidden) return;

    // 3. Não executa polling se a seção de pedidos não estiver visível na tela
    const secOrders = document.getElementById('orders-section');
    if (!secOrders || secOrders.style.display === 'none') return;

    // 4. Não executa polling se uma requisição operacional (confirmar/cancelar/transição) estiver em andamento
    const actionsBox = UI.modalActionsContainer();
    if (actionsBox && actionsBox.querySelector('button[disabled]')) {
      const isOperating = actionsBox.textContent.includes('Confirmando...') ||
                          actionsBox.textContent.includes('Cancelando...') ||
                          actionsBox.textContent.includes('Salvando...');
      if (isOperating) return;
    }

    isPollingRunning = true;
    try {
      // Reutiliza a consulta padrão sem disparar loading visual intrusivo
      const result = await fetchOrders();
      if (result.success && Array.isArray(result.data)) {
        loadedOrders = result.data;
        renderOrdersTable();

        // Se o modal de detalhes estiver aberto, atualiza silenciosamente os dados básicos do pedido
        if (currentDetailOrder && currentDetailOrder.id) {
          const freshOrder = loadedOrders.find((o) => o.id === currentDetailOrder.id);
          if (freshOrder) {
            currentDetailOrder = freshOrder;
            const badgeEl = UI.modalStatusBadge();
            const resTimerEl = UI.modalReservationTimer();
            const resBoxEl = UI.modalReservationBox();

            if (badgeEl) {
              const meta = getStatusMeta(freshOrder.status);
              badgeEl.className = `order-badge ${meta.className}`;
              badgeEl.innerHTML = `<span class="order-badge__dot"></span> ${meta.label}`;
            }

            if (freshOrder.status === 'received' && freshOrder.reservation_expires_at) {
              if (resBoxEl) resBoxEl.style.display = 'flex';
              const timeInfo = calculateReservationTime(freshOrder.reservation_expires_at);
              if (resTimerEl) resTimerEl.textContent = timeInfo.text;
            } else {
              if (resBoxEl) resBoxEl.style.display = 'none';
            }

            // Atualiza link de WhatsApp com a mensagem contextualizada para o novo status
            renderCustomerPhoneField(freshOrder);
          }
        }
      }
    } catch (err) {
      console.warn('⚠️ [MascotCar Orders] Falha silenciosa no polling:', err);
    } finally {
      isPollingRunning = false;
    }
  }

  /**
   * Inicia o polling periódico silencioso dos pedidos.
   */
  function startOrdersPolling() {
    stopOrdersPolling();
    ordersPollingInterval = setInterval(executeSilentOrdersPolling, POLLING_INTERVAL_MS);
  }

  /**
   * Interrompe o polling dos pedidos garantindo referência única.
   */
  function stopOrdersPolling() {
    if (ordersPollingInterval) {
      clearInterval(ordersPollingInterval);
      ordersPollingInterval = null;
    }
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
        startOrdersPolling();
      } else {
        if (navProducts) navProducts.classList.add('active');
        if (navOrders) navOrders.classList.remove('active');
        if (secProducts) secProducts.style.display = 'block';
        if (secOrders) secOrders.style.display = 'none';
        stopOrdersPolling();
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

    // Gerencia visibilidade da aba do navegador para pausar/retomar polling
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopOrdersPolling();
      } else {
        if (secOrders && secOrders.style.display === 'block') {
          // Ao retornar ao primeiro plano, atualiza imediatamente e reinicia o ciclo
          executeSilentOrdersPolling();
          startOrdersPolling();
        }
      }
    });

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

    // Filtro por Período (Etapa 3S.2)
    const periodFilter = UI.periodFilter();
    const customDateWrap = UI.customDateWrap();
    if (periodFilter) {
      periodFilter.addEventListener('change', (e) => {
        const val = e.target.value;
        currentFilters.period = val;

        if (customDateWrap) {
          customDateWrap.style.display = val === 'custom' ? 'inline-flex' : 'none';
        }

        renderOrdersTable();
      });
    }

    // Datas personalizadas (Etapa 3S.2)
    const dateStartInput = UI.dateStartInput();
    if (dateStartInput) {
      dateStartInput.addEventListener('change', (e) => {
        currentFilters.dateStart = e.target.value;
        renderOrdersTable();
      });
    }

    const dateEndInput = UI.dateEndInput();
    if (dateEndInput) {
      dateEndInput.addEventListener('change', (e) => {
        currentFilters.dateEnd = e.target.value;
        renderOrdersTable();
      });
    }

    // Botão de Exportação CSV (Etapa 3S.2)
    const exportCsvBtn = UI.exportCsvBtn();
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener('click', () => {
        exportOrdersToCSV();
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
  async function init() {
    initNavigationTabs();
    initEvents();

    // Carrega dados iniciais em segundo plano para preencher o badge de pendências
    // mesmo que o painel inicie visualmente na aba de Catálogo de Produtos.
    const result = await fetchOrders();
    if (result.success && Array.isArray(result.data)) {
      loadedOrders = result.data;
      updatePendingOrdersBadge();
    }
  }

  // Expõe API pública do módulo de pedidos
  window.MascotCarOrders = {
    init,
    refreshOrders,
    openOrderDetailModal,
    closeOrderDetailModal,
    resetFilters,
    exportOrdersToCSV,
    getFilteredOrders,
    startPolling: startOrdersPolling,
    stopPolling: stopOrdersPolling,
    getLoadedOrders: () => [...loadedOrders]
  };
})();
