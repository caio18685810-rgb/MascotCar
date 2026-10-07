/**
 * MascotCar — Configuração e Integração com Supabase
 * Responsável pela conexão segura com a API pública do Supabase,
 * carregamento dinâmico dos produtos da tabela public.products,
 * busca em tempo real, filtros, ordenação e modal de detalhes (Etapa 3H).
 *
 * ⚠️ SEGURANÇA:
 * - Apenas a chave pública (Publishable / Anon Key) é permitida no frontend.
 * - NUNCA inclua 'service_role' ou segredos de banco de dados neste arquivo.
 * - Operações exclusivas de leitura (SELECT).
 */

'use strict';

const SUPABASE_CONFIG = {
  url: 'https://hwqnzftmdyyujfbakgay.supabase.co',
  publishableKey: 'sb_publishable_N43AhIHBpIhFk0QuKhC50g_e4ifc4KZ'
};

let supabaseClient = null;

// Inicializa o cliente quando a biblioteca Supabase estiver carregada
(function initSupabase() {
  if (typeof window.supabase !== 'undefined' && window.supabase.createClient) {
    try {
      supabaseClient = window.supabase.createClient(
        SUPABASE_CONFIG.url,
        SUPABASE_CONFIG.publishableKey,
        {
          auth: {
            persistSession: true,
            autoRefreshToken: true
          }
        }
      );
      window.supabaseClient = supabaseClient;
      console.info('⚡ [MascotCar] Supabase inicializado com sucesso.');
    } catch (err) {
      console.warn('⚠️ [MascotCar] Não foi possível inicializar o cliente Supabase:', err);
    }
  } else {
    console.warn('⚠️ [MascotCar] Biblioteca Supabase JS não encontrada no escopo global.');
  }
})();

// ----------------------------------------------------------------------------
// ESTADO DO CATÁLOGO PÚBLICO (Etapa 3H)
// ----------------------------------------------------------------------------

let publicCatalogProducts = [];
let publicCatalogCategories = [];

const publicCatalogFilters = {
  search: '',
  category: 'all',
  stock: 'all',
  sort: 'recent'
};

/**
 * Consulta a tabela public.products no Supabase via SELECT.
 * Retorna somente produtos ativos (active = true).
 *
 * @returns {Promise<{success: boolean, data?: Array, error?: any}>}
 */
async function fetchProductsFromSupabase() {
  if (!supabaseClient) {
    return { success: false, error: { message: 'Cliente Supabase não inicializado.' } };
  }

  try {
    const { data, error } = await supabaseClient
      .from('products')
      .select('*, categories(*)')
      .eq('active', true)
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
 * Consulta a tabela public.categories no Supabase via SELECT.
 * @returns {Promise<{success: boolean, data?: Array, error?: any}>}
 */
async function fetchCategoriesFromSupabase() {
  if (!supabaseClient) {
    return { success: false, error: { message: 'Cliente Supabase não inicializado.' } };
  }

  try {
    const { data, error } = await supabaseClient
      .from('categories')
      .select('*')
      .order('name');

    if (error) {
      return { success: false, error };
    }

    return { success: true, data: data || [] };
  } catch (err) {
    return { success: false, error: err };
  }
}

// ----------------------------------------------------------------------------
// FORMATAÇÃO E HELPERS
// ----------------------------------------------------------------------------

function formatCurrency(val) {
  if (typeof val === 'number') {
    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  if (val) {
    return `R$ ${val}`;
  }
  return 'R$ --,--';
}

function escapeHTML(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function normalizeSearchText(str) {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Constrói o link de contato do WhatsApp para um produto específico.
 * Se houver um número comercial configurado no futuro, pode ser inserido aqui.
 * Atualmente gera o link compartilhável com a mensagem personalizada do produto.
 */
function buildWhatsAppProductLink(product) {
  const productName = product ? product.name : 'Mascote';
  const textMsg = encodeURIComponent(`Olá! Gostaria de mais informações sobre o aromatizador "${productName}" no MascotCar.`);
  return `https://wa.me/5513991830511?text=${textMsg}`;
}

/**
 * Cria o elemento DOM seguro do placeholder de imagem do produto.
 * @returns {HTMLDivElement}
 */
function createProductPlaceholderElement() {
  const placeholder = document.createElement('div');
  placeholder.className = 'product-card__placeholder';
  const span = document.createElement('span');
  span.textContent = '🚗';
  placeholder.appendChild(span);
  return placeholder;
}

/**
 * Substitui de forma segura uma imagem quebrada pelo placeholder oficial no DOM.
 * @param {HTMLImageElement} imgElement
 */
function handleProductImageError(imgElement) {
  if (!imgElement || !imgElement.parentElement) return;
  const parent = imgElement.parentElement;
  imgElement.remove();
  parent.appendChild(createProductPlaceholderElement());
}

/**
 * Gera o markup HTML de um card de produto do catálogo público.
 * @param {Object} product
 * @returns {string}
 */
function buildProductCardHTML(product) {
  const name = escapeHTML(product.name || 'Mascote MascotCar');
  const desc = escapeHTML(product.description || 'Aromatizador veicular personalizado com fragrância duradoura.');
  const formattedPrice = formatCurrency(product.price);
  const stock = typeof product.stock === 'number' ? product.stock : 0;
  const inStock = stock > 0;

  // Categoria
  const categoryLabel = escapeHTML(
    (product.categories && product.categories.name)
      ? product.categories.name
      : (product.category || 'Geral')
  );

  const categorySlug = (product.categories && product.categories.slug)
    ? product.categories.slug
    : (product.category_id || 'geral');

  // Imagem real ou placeholder estilizado
  const imageMarkup = product.image_url
    ? `<img src="${escapeHTML(product.image_url)}" alt="${name}" class="product-card__img" loading="lazy" decoding="async" style="width:100%;height:100%;object-fit:cover;">`
    : `<div class="product-card__placeholder"><span>🚗</span></div>`;

  const waLink = buildWhatsAppProductLink(product);

  return `
    <article class="product-card" data-category="${categorySlug}" data-id="${escapeHTML(product.id)}">
      ${inStock ? `<div class="product-card__badge">Disponível</div>` : `<div class="product-card__badge" style="background:#718096;">Esgotado</div>`}
      <div class="product-card__image-wrap">
        ${imageMarkup}
      </div>
      <div class="product-card__body">
        <span class="product-card__category">${categoryLabel}</span>
        <h3 class="product-card__name">${name}</h3>
        <p class="product-card__desc">${desc}</p>
        <div class="product-card__scents">
          <span class="scent-tag">📦 Estoque: ${stock} un.</span>
        </div>
        <div class="product-card__footer">
          <span class="product-card__price">${formattedPrice}</span>
        </div>
        <div class="product-card__actions">
          <button type="button" class="btn btn--outline btn--sm btn-card-details" data-detail-id="${escapeHTML(product.id)}">
            Ver Detalhes
          </button>
          <button type="button" class="btn btn--primary btn--sm btn-card-add-cart" data-cart-id="${escapeHTML(product.id)}" ${!inStock ? 'disabled title="Produto esgotado"' : 'title="Adicionar à Minha Lista"'}>
            🛍️ Adicionar
          </button>
          <a href="${waLink}" target="_blank" rel="noopener noreferrer" class="btn-card-whatsapp" title="Consultar produto via WhatsApp" aria-label="Consultar ${name} via WhatsApp">
            💬
          </a>
        </div>
      </div>
    </article>
  `;
}

// ----------------------------------------------------------------------------
// MODAL DE DETALHES DO PRODUTO (Etapa 3H)
// ----------------------------------------------------------------------------

let lastFocusedElementBeforeModal = null;

function openProductDetailModal(productId) {
  const product = publicCatalogProducts.find((p) => p.id === productId);
  if (!product) return;

  const modalEl = document.getElementById('product-detail-modal');
  if (!modalEl) return;

  lastFocusedElementBeforeModal = document.activeElement;

  const titleEl = document.getElementById('modal-product-title');
  const catEl = document.getElementById('modal-product-category');
  const badgeEl = document.getElementById('modal-product-badge');
  const priceEl = document.getElementById('modal-product-price');
  const descEl = document.getElementById('modal-product-desc');
  const stockEl = document.getElementById('modal-product-stock');
  const mediaContainer = document.getElementById('modal-product-media-container');
  const waBtn = document.getElementById('modal-product-whatsapp');

  const name = product.name || 'Mascote MascotCar';
  const desc = product.description || 'Aromatizador veicular personalizado com fragrância agradável e alta durabilidade.';
  const stock = typeof product.stock === 'number' ? product.stock : 0;
  const inStock = stock > 0;

  const categoryName = (product.categories && product.categories.name)
    ? product.categories.name
    : 'Geral';

  if (titleEl) titleEl.textContent = name;
  if (catEl) catEl.textContent = categoryName;

  if (badgeEl) {
    badgeEl.textContent = inStock ? 'Disponível' : 'Esgotado';
    badgeEl.className = inStock ? 'product-modal-badge' : 'product-modal-badge product-modal-badge--out';
  }

  if (priceEl) priceEl.textContent = formatCurrency(product.price);
  if (descEl) descEl.textContent = desc;
  if (stockEl) stockEl.textContent = `📦 Estoque: ${stock} unidades`;

  if (mediaContainer) {
    mediaContainer.innerHTML = '';
    if (product.image_url) {
      const img = document.createElement('img');
      img.src = product.image_url;
      img.alt = name;
      img.className = 'product-modal-img';
      img.addEventListener('error', () => {
        handleProductImageError(img);
      }, { once: true });
      mediaContainer.appendChild(img);
    } else {
      mediaContainer.appendChild(createProductPlaceholderElement());
    }
  }

  if (waBtn) {
    waBtn.href = buildWhatsAppProductLink(product);
  }

  const modalAddCartBtn = document.getElementById('modal-product-add-cart');
  if (modalAddCartBtn) {
    modalAddCartBtn.setAttribute('data-cart-id', product.id);
    modalAddCartBtn.disabled = !inStock;
    modalAddCartBtn.textContent = inStock ? '🛍️ Adicionar à Minha Lista' : 'Esgotado';
  }

  modalEl.style.display = 'flex';
  requestAnimationFrame(() => {
    modalEl.classList.add('is-open');
    const closeBtn = document.getElementById('modal-product-close');
    if (closeBtn && typeof closeBtn.focus === 'function') {
      closeBtn.focus();
    }
  });
  document.body.style.overflow = 'hidden';
}

function closeProductDetailModal() {
  const modalEl = document.getElementById('product-detail-modal');
  if (!modalEl) return;

  modalEl.classList.remove('is-open');
  setTimeout(() => {
    modalEl.style.display = 'none';
    document.body.style.overflow = '';
    if (lastFocusedElementBeforeModal && typeof lastFocusedElementBeforeModal.focus === 'function') {
      lastFocusedElementBeforeModal.focus();
      lastFocusedElementBeforeModal = null;
    }
  }, 200);
}

// ----------------------------------------------------------------------------
// FILTRAGEM, BUSCA E ORDENAÇÃO (Etapa 3H)
// ----------------------------------------------------------------------------

function applyPublicCatalogFilters() {
  let filtered = [...publicCatalogProducts];

  // 1. Busca por termo (nome e descrição)
  const query = normalizeSearchText(publicCatalogFilters.search);
  if (query) {
    filtered = filtered.filter((prod) => {
      const nameNorm = normalizeSearchText(prod.name);
      const descNorm = normalizeSearchText(prod.description);
      return nameNorm.includes(query) || descNorm.includes(query);
    });
  }

  // 2. Filtro de Categoria
  if (publicCatalogFilters.category !== 'all' && publicCatalogFilters.category !== 'todos') {
    filtered = filtered.filter((prod) => {
      if (publicCatalogFilters.category === 'uncategorized') {
        return !prod.category_id;
      }
      // Se for id de categoria
      if (prod.category_id === publicCatalogFilters.category) return true;
      // Se for slug da categoria
      if (prod.categories && prod.categories.slug === publicCatalogFilters.category) return true;
      if (prod.category && prod.category.toLowerCase() === publicCatalogFilters.category.toLowerCase()) return true;
      return false;
    });
  }

  // 3. Filtro de Estoque / Disponibilidade
  if (publicCatalogFilters.stock === 'in-stock') {
    filtered = filtered.filter((prod) => (Number(prod.stock) || 0) > 0);
  } else if (publicCatalogFilters.stock === 'out-of-stock') {
    filtered = filtered.filter((prod) => (Number(prod.stock) || 0) === 0);
  }

  // 4. Ordenação
  const sort = publicCatalogFilters.sort;
  filtered.sort((a, b) => {
    switch (sort) {
      case 'name-asc':
        return (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' });
      case 'name-desc':
        return (b.name || '').localeCompare(a.name || '', 'pt-BR', { sensitivity: 'base' });
      case 'price-asc': {
        const pa = typeof a.price === 'number' ? a.price : parseFloat(a.price) || 0;
        const pb = typeof b.price === 'number' ? b.price : parseFloat(b.price) || 0;
        return pa - pb;
      }
      case 'price-desc': {
        const pa = typeof a.price === 'number' ? a.price : parseFloat(a.price) || 0;
        const pb = typeof b.price === 'number' ? b.price : parseFloat(b.price) || 0;
        return pb - pa;
      }
      case 'recent':
      default: {
        const da = a.created_at ? new Date(a.created_at).getTime() : 0;
        const db = b.created_at ? new Date(b.created_at).getTime() : 0;
        return db - da;
      }
    }
  });

  return filtered;
}

function renderPublicCatalog() {
  const grid = document.getElementById('products-grid');
  const countBadge = document.getElementById('catalog-count-badge');
  const subtitle = document.getElementById('products-subtitle');
  if (!grid) return;

  const totalLoaded = publicCatalogProducts.length;

  if (totalLoaded === 0) {
    if (countBadge) countBadge.textContent = '0 produtos';
    grid.innerHTML = `
      <div class="catalog-empty-state">
        <span class="catalog-empty-icon">📦</span>
        <h3 class="catalog-empty-title">Nenhum produto disponível no momento</h3>
        <p class="catalog-empty-desc">Nosso catálogo está sendo abastecido no Supabase. Volte em breve!</p>
      </div>
    `;
    return;
  }

  const filtered = applyPublicCatalogFilters();
  const hasActiveFilters =
    publicCatalogFilters.search.trim().length > 0 ||
    publicCatalogFilters.category !== 'all' ||
    publicCatalogFilters.stock !== 'all';

  if (countBadge) {
    if (hasActiveFilters) {
      countBadge.textContent = `Exibindo ${filtered.length} de ${totalLoaded} produto${totalLoaded !== 1 ? 's' : ''}`;
    } else {
      countBadge.textContent = `${totalLoaded} produto${totalLoaded !== 1 ? 's' : ''} disponível${totalLoaded !== 1 ? 'is' : ''}`;
    }
  }

  if (subtitle) {
    subtitle.textContent = `Catálogo oficial conectado via Supabase (${totalLoaded} produto${totalLoaded !== 1 ? 's' : ''})`;
  }

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="catalog-empty-state">
        <span class="catalog-empty-icon">🔍</span>
        <h3 class="catalog-empty-title">Nenhum produto encontrado</h3>
        <p class="catalog-empty-desc">Nenhum produto corresponde aos termos ou filtros selecionados.</p>
        <button type="button" class="btn btn--outline btn--sm btn-reset-from-empty">
          Limpar Filtros
        </button>
      </div>
    `;
    return;
  }

  grid.innerHTML = filtered.map(buildProductCardHTML).join('');

  // Anexa listeners de erro seguros nas imagens dos cards renderizados
  grid.querySelectorAll('img.product-card__img').forEach((img) => {
    img.addEventListener('error', () => {
      handleProductImageError(img);
    }, { once: true });
  });
}

function resetPublicCatalogFilters() {
  publicCatalogFilters.search = '';
  publicCatalogFilters.category = 'all';
  publicCatalogFilters.stock = 'all';
  publicCatalogFilters.sort = 'recent';

  const searchInput = document.getElementById('catalog-search-input');
  if (searchInput) searchInput.value = '';

  const clearBtn = document.getElementById('catalog-clear-search');
  if (clearBtn) clearBtn.style.display = 'none';

  const catSelect = document.getElementById('catalog-filter-category');
  if (catSelect) catSelect.value = 'all';

  const stockSelect = document.getElementById('catalog-filter-stock');
  if (stockSelect) stockSelect.value = 'all';

  const sortSelect = document.getElementById('catalog-sort');
  if (sortSelect) sortSelect.value = 'recent';

  // Sincroniza botões de categoria do topo da página
  const catButtons = document.querySelectorAll('.category-card');
  catButtons.forEach((b) => {
    b.classList.remove('category-card--active');
    const filterVal = b.getAttribute('data-filter');
    if (filterVal === 'todos' || filterVal === 'all') {
      b.classList.add('category-card--active');
    }
  });

  renderPublicCatalog();
}

function setCategoryFilter(categorySlugOrId) {
  if (!categorySlugOrId || categorySlugOrId === 'todos') {
    publicCatalogFilters.category = 'all';
  } else {
    publicCatalogFilters.category = categorySlugOrId;
  }

  const catSelect = document.getElementById('catalog-filter-category');
  if (catSelect) {
    catSelect.value = publicCatalogFilters.category;
  }

  // Sincroniza a classe ativa nos botões de categoria do topo
  const catButtons = document.querySelectorAll('.category-card');
  catButtons.forEach((b) => {
    b.classList.remove('category-card--active');
    const filterVal = b.getAttribute('data-filter');
    if (publicCatalogFilters.category === 'all' && (filterVal === 'todos' || filterVal === 'all')) {
      b.classList.add('category-card--active');
    } else if (filterVal === publicCatalogFilters.category) {
      b.classList.add('category-card--active');
    }
  });

  renderPublicCatalog();
}

function populateCategorySelect() {
  const select = document.getElementById('catalog-filter-category');
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = `<option value="all">Todas as Categorias</option>`;

  publicCatalogCategories.forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = cat.name;
    select.appendChild(opt);
  });

  const uncategorizedOpt = document.createElement('option');
  uncategorizedOpt.value = 'uncategorized';
  uncategorizedOpt.textContent = 'Sem categoria';
  select.appendChild(uncategorizedOpt);

  select.value = currentVal || 'all';
}

/**
 * Renderiza dinamicamente as categorias reais do Supabase na grade do topo (.categories__grid).
 * Preserva o botão "Todos" e calcula a contagem real de produtos ativos por categoria.
 */
function populateTopCategoriesBar() {
  const categoriesGrid = document.querySelector('.categories__grid');
  if (!categoriesGrid) return;

  const totalActive = publicCatalogProducts.length;

  // Mapa de contagem de produtos ativos por category_id
  const countByCatId = {};
  publicCatalogProducts.forEach((p) => {
    if (p.category_id) {
      countByCatId[p.category_id] = (countByCatId[p.category_id] || 0) + 1;
    }
  });

  // Ícones representativos automáticos por palavra-chave do nome da categoria
  function getCategoryEmoji(name) {
    const n = (name || '').toLowerCase();
    if (n.includes('anim')) return '🐾';
    if (n.includes('her') || n.includes('hero')) return '🦸';
    if (n.includes('esport') || n.includes('sport')) return '⚽';
    if (n.includes('gam') || n.includes('jog')) return '🎮';
    if (n.includes('custom') || n.includes('person')) return '✏️';
    if (n.includes('veic') || n.includes('auto') || n.includes('carr')) return '🏎️';
    if (n.includes('clas') || n.includes('retr')) return '🕰️';
    return '🚗';
  }

  // Se não existirem categorias cadastradas ou consulta falhou
  if (!publicCatalogCategories || publicCatalogCategories.length === 0) {
    categoriesGrid.innerHTML = `
      <button class="category-card category-card--active" data-filter="todos" type="button">
        <span class="category-card__icon">🚗</span>
        <span class="category-card__label">Todos</span>
        <span class="category-card__count">${totalActive}</span>
      </button>
    `;
    return;
  }

  let html = `
    <button class="category-card ${publicCatalogFilters.category === 'all' ? 'category-card--active' : ''}" data-filter="todos" type="button">
      <span class="category-card__icon">🚗</span>
      <span class="category-card__label">Todos</span>
      <span class="category-card__count">${totalActive}</span>
    </button>
  `;

  publicCatalogCategories.forEach((cat) => {
    const count = countByCatId[cat.id] || 0;
    const isAct = publicCatalogFilters.category === cat.id;
    const icon = getCategoryEmoji(cat.name);

    html += `
      <button class="category-card ${isAct ? 'category-card--active' : ''}" data-filter="${escapeHTML(cat.id)}" type="button">
        <span class="category-card__icon">${icon}</span>
        <span class="category-card__label">${escapeHTML(cat.name)}</span>
        <span class="category-card__count">${count}</span>
      </button>
    `;
  });

  categoriesGrid.innerHTML = html;
}

// ----------------------------------------------------------------------------
// INICIALIZAÇÃO DE EVENTOS DO CATÁLOGO PÚBLICO
// ----------------------------------------------------------------------------

function initCatalogEvents() {
  const searchInput = document.getElementById('catalog-search-input');
  const clearSearchBtn = document.getElementById('catalog-clear-search');
  let debounceTimeout = null;

  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const val = e.target.value;
      if (clearSearchBtn) {
        clearSearchBtn.style.display = val.trim().length > 0 ? 'inline-block' : 'none';
      }

      clearTimeout(debounceTimeout);
      debounceTimeout = setTimeout(() => {
        publicCatalogFilters.search = val;
        renderPublicCatalog();
      }, 150);
    });
  }

  if (clearSearchBtn) {
    clearSearchBtn.addEventListener('click', () => {
      if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
      }
      clearSearchBtn.style.display = 'none';
      publicCatalogFilters.search = '';
      renderPublicCatalog();
    });
  }

  const catSelect = document.getElementById('catalog-filter-category');
  if (catSelect) {
    catSelect.addEventListener('change', (e) => {
      publicCatalogFilters.category = e.target.value;
      renderPublicCatalog();
    });
  }

  const stockSelect = document.getElementById('catalog-filter-stock');
  if (stockSelect) {
    stockSelect.addEventListener('change', (e) => {
      publicCatalogFilters.stock = e.target.value;
      renderPublicCatalog();
    });
  }

  const sortSelect = document.getElementById('catalog-sort');
  if (sortSelect) {
    sortSelect.addEventListener('change', (e) => {
      publicCatalogFilters.sort = e.target.value;
      renderPublicCatalog();
    });
  }

  const resetBtn = document.getElementById('catalog-reset-filters');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetPublicCatalogFilters();
    });
  }

  // Cliques na grade de produtos (Abrir detalhes ou limpar filtros do estado vazio)
  const grid = document.getElementById('products-grid');
  if (grid) {
    grid.addEventListener('click', (e) => {
      const detailBtn = e.target.closest('.btn-card-details');
      if (detailBtn) {
        const id = detailBtn.getAttribute('data-detail-id');
        if (id) openProductDetailModal(id);
        return;
      }

      const resetEmptyBtn = e.target.closest('.btn-reset-from-empty');
      if (resetEmptyBtn) {
        resetPublicCatalogFilters();
        return;
      }

      const retryBtn = e.target.closest('.btn-retry-catalog');
      if (retryBtn) {
        loadCatalog();
        return;
      }
    });
  }

  // Delegação de eventos para os botões de categorias do topo (.categories__grid)
  const topCategoriesGrid = document.querySelector('.categories__grid');
  if (topCategoriesGrid) {
    topCategoriesGrid.addEventListener('click', (e) => {
      const catBtn = e.target.closest('.category-card');
      if (!catBtn) return;

      const filterVal = catBtn.getAttribute('data-filter') || 'todos';

      // Rolar suavemente para a seção de produtos se o usuário estiver acima dela
      const productsSection = document.getElementById('produtos');
      if (productsSection) {
        const rect = productsSection.getBoundingClientRect();
        if (rect.top < -200 || rect.top > 600) {
          productsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }

      setCategoryFilter(filterVal);
    });
  }

  // Modal de Detalhes
  const modalEl = document.getElementById('product-detail-modal');
  const closeBtn = document.getElementById('modal-product-close');
  const closeActionBtn = document.getElementById('modal-product-close-btn');

  if (closeBtn) closeBtn.addEventListener('click', closeProductDetailModal);
  if (closeActionBtn) closeActionBtn.addEventListener('click', closeProductDetailModal);

  if (modalEl) {
    modalEl.addEventListener('click', (e) => {
      if (e.target === modalEl) closeProductDetailModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalEl && modalEl.style.display === 'flex') {
      closeProductDetailModal();
    }
  });
}

/**
 * Carrega e renderiza os produtos reais da tabela public.products.
 * Gerencia os estados: loading -> sucesso / vazio / erro com retry (Etapa 3K).
 */
async function loadCatalog() {
  const grid = document.getElementById('products-grid');
  const countBadge = document.getElementById('catalog-count-badge');
  const subtitle = document.getElementById('products-subtitle');

  if (subtitle) subtitle.textContent = 'Carregando produtos do Supabase...';
  if (countBadge) countBadge.textContent = 'Carregando produtos...';

  // Exibe estado visual de carregamento na grade
  if (grid) {
    grid.innerHTML = `
      <div class="catalog-loading-state" id="catalog-loading-state">
        <div class="catalog-loading-spinner" aria-hidden="true"></div>
        <p class="catalog-loading-text">Carregando catálogo oficial...</p>
      </div>
    `;
  }

  const [productsRes, categoriesRes] = await Promise.all([
    fetchProductsFromSupabase(),
    fetchCategoriesFromSupabase()
  ]);

  if (categoriesRes.success) {
    publicCatalogCategories = categoriesRes.data || [];
    populateCategorySelect();
  }

  if (productsRes.success) {
    publicCatalogProducts = productsRes.data || [];
    console.info(`✅ [MascotCar] Catálogo Supabase carregado! ${publicCatalogProducts.length} produtos ativos.`);
    populateTopCategoriesBar();
    renderPublicCatalog();
    syncCartWithCatalog();
  } else {
    console.warn('⚠️ [MascotCar] Não foi possível obter os produtos de public.products:', productsRes.error?.message || productsRes.error);
    if (subtitle) {
      subtitle.textContent = '⚠️ Erro de conexão com o catálogo';
    }
    if (countBadge) {
      countBadge.textContent = 'Falha no carregamento';
    }
    if (grid) {
      grid.innerHTML = `
        <div class="catalog-error-state">
          <span class="catalog-error-icon" aria-hidden="true">⚠️</span>
          <h3 class="catalog-error-title">Não foi possível carregar os produtos</h3>
          <p class="catalog-error-desc">Verifique sua conexão com a internet e tente novamente.</p>
          <button type="button" class="btn btn--primary btn--sm catalog-btn-retry btn-retry-catalog">
            <span>🔄 Tentar Novamente</span>
          </button>
        </div>
      `;
    }
  }
}

// ============================================================================
// SISTEMA DE CARRINHO / "MINHA LISTA DE PEDIDO" (Etapa 3M)
// ============================================================================

const CART_STORAGE_KEY = 'mascotcar_cart_v1';

// Estado local em memória do carrinho: Array de { productId: string, quantity: number }
let cartItems = [];

// Estado em memória das seleções ativas no drawer: Set de productId
let selectedCartProductIds = new Set();

let lastFocusedElementBeforeCart = null;
let lastFocusedElementBeforeReview = null;
let cartToastTimeout = null;

/**
 * Exibe feedback visual moderno (Toast) não-bloqueante e acessível com aria-live.
 * @param {string} message
 * @param {'success'|'warn'|'error'} type
 */
function showCartToast(message, type = 'success') {
  const toast = document.getElementById('cart-toast');
  if (!toast) return;

  toast.textContent = message;
  toast.className = `cart-toast is-visible cart-toast--${type}`;

  if (cartToastTimeout) clearTimeout(cartToastTimeout);
  cartToastTimeout = setTimeout(() => {
    toast.classList.remove('is-visible');
  }, 3200);
}

/**
 * Carrega a lista do localStorage com tratamento de erro seguro.
 * @returns {Array<{productId: string, quantity: number}>}
 */
function loadCartFromStorage() {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Normaliza para garantir tipo e valores válidos
    return parsed
      .filter((item) => item && typeof item.productId === 'string' && typeof item.quantity === 'number')
      .map((item) => ({
        productId: item.productId,
        quantity: Math.max(1, Math.floor(item.quantity))
      }));
  } catch (err) {
    console.warn('⚠️ [MascotCar] Erro ao ler carrinho do localStorage:', err);
    return [];
  }
}

/**
 * Persiste o estado do carrinho no localStorage.
 */
function saveCartToStorage() {
  try {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cartItems));
  } catch (err) {
    console.warn('⚠️ [MascotCar] Falha ao persistir carrinho no localStorage:', err);
  }
}

/**
 * Atualiza o badge do header com o total de unidades no carrinho.
 */
function updateCartBadge() {
  const badge = document.getElementById('cart-badge-count');
  if (!badge) return;

  const totalUnits = cartItems.reduce((acc, item) => acc + item.quantity, 0);
  badge.textContent = String(totalUnits);

  badge.classList.remove('bump');
  void badge.offsetWidth; // Força reflow para reiniciar animação
  if (totalUnits > 0) {
    badge.classList.add('bump');
  }
}

/**
 * Sincroniza o carrinho com os produtos carregados do Supabase:
 * - Ajusta quantidades se o estoque diminuiu.
 * - Mantém itens no carrinho mas atualiza a interface com avisos se esgotado/inativo.
 */
function syncCartWithCatalog() {
  cartItems = loadCartFromStorage();

  // Inicializa seleções padrão: todos os itens disponíveis selecionados
  selectedCartProductIds = new Set();
  cartItems.forEach((item) => {
    const product = publicCatalogProducts.find((p) => p.id === item.productId);
    if (product && product.active && (product.stock || 0) > 0) {
      selectedCartProductIds.add(item.productId);
    }
  });

  updateCartBadge();
  renderCartDrawer();
}

/**
 * Adiciona um produto à Minha Lista de Pedido.
 * @param {string} productId
 * @param {number} qtyToAdd
 */
function addToCart(productId, qtyToAdd = 1) {
  const product = publicCatalogProducts.find((p) => p.id === productId);
  if (!product) {
    showCartToast('Produto não encontrado no catálogo.', 'error');
    return;
  }

  if (!product.active) {
    showCartToast('Este produto não está ativo no momento.', 'warn');
    return;
  }

  const stock = typeof product.stock === 'number' ? product.stock : 0;
  if (stock <= 0) {
    showCartToast('Este produto está esgotado no momento.', 'warn');
    return;
  }

  const existing = cartItems.find((item) => item.productId === productId);
  const currentQty = existing ? existing.quantity : 0;
  const newQty = currentQty + qtyToAdd;

  if (newQty > stock) {
    showCartToast(`Limite de estoque atingido (${stock} unidades disponíveis).`, 'warn');
    if (existing && existing.quantity !== stock) {
      existing.quantity = stock;
      saveCartToStorage();
      updateCartBadge();
      renderCartDrawer();
    }
    return;
  }

  if (existing) {
    existing.quantity = newQty;
  } else {
    cartItems.push({ productId, quantity: newQty });
    selectedCartProductIds.add(productId); // Seleciona automaticamente o novo item
  }

  saveCartToStorage();
  updateCartBadge();
  renderCartDrawer();
  showCartToast(`✓ "${product.name || 'Produto'}" adicionado à sua lista!`, 'success');
}

/**
 * Altera a quantidade de um item no carrinho.
 * @param {string} productId
 * @param {number} quantity
 */
function updateCartItemQuantity(productId, quantity) {
  const item = cartItems.find((i) => i.productId === productId);
  if (!item) return;

  const product = publicCatalogProducts.find((p) => p.id === productId);
  const stock = (product && typeof product.stock === 'number') ? product.stock : 0;

  if (quantity <= 0) {
    removeCartItem(productId, false);
    return;
  }

  if (quantity > stock) {
    item.quantity = stock;
    showCartToast(`Quantidade ajustada para o estoque máximo disponível (${stock} un.).`, 'warn');
  } else {
    item.quantity = quantity;
  }

  saveCartToStorage();
  updateCartBadge();
  renderCartDrawer();
}

/**
 * Remove um item da lista.
 * @param {string} productId
 * @param {boolean} notify
 */
function removeCartItem(productId, notify = true) {
  const prevCount = cartItems.length;
  cartItems = cartItems.filter((i) => i.productId !== productId);
  selectedCartProductIds.delete(productId);

  if (cartItems.length !== prevCount) {
    saveCartToStorage();
    updateCartBadge();
    renderCartDrawer();
    if (notify) {
      showCartToast('Item removido da sua lista.', 'success');
    }
  }
}

/**
 * Remove múltiplos itens selecionados com confirmação segura.
 */
function removeSelectedCartItems() {
  if (selectedCartProductIds.size === 0) return;

  const count = selectedCartProductIds.size;
  const confirmMsg = count === 1
    ? 'Deseja remover o produto selecionado da sua lista?'
    : `Deseja remover os ${count} produtos selecionados da sua lista?`;

  if (!window.confirm(confirmMsg)) return;

  cartItems = cartItems.filter((item) => !selectedCartProductIds.has(item.productId));
  selectedCartProductIds.clear();

  saveCartToStorage();
  updateCartBadge();
  renderCartDrawer();
  showCartToast('Itens selecionados removidos.', 'success');
}

/**
 * Abre o Drawer da Minha Lista de Pedido.
 */
function openCartDrawer() {
  const backdrop = document.getElementById('cart-drawer-backdrop');
  if (!backdrop) return;

  lastFocusedElementBeforeCart = document.activeElement;
  backdrop.style.display = 'block';

  requestAnimationFrame(() => {
    backdrop.classList.add('is-open');
    const closeBtn = document.getElementById('cart-drawer-close');
    if (closeBtn && typeof closeBtn.focus === 'function') {
      closeBtn.focus();
    }
  });

  document.body.style.overflow = 'hidden';
  renderCartDrawer();
}

/**
 * Fecha o Drawer da Minha Lista de Pedido.
 */
function closeCartDrawer() {
  const backdrop = document.getElementById('cart-drawer-backdrop');
  if (!backdrop) return;

  backdrop.classList.remove('is-open');
  setTimeout(() => {
    backdrop.style.display = 'none';
    document.body.style.overflow = '';
    if (lastFocusedElementBeforeCart && typeof lastFocusedElementBeforeCart.focus === 'function') {
      lastFocusedElementBeforeCart.focus();
      lastFocusedElementBeforeCart = null;
    }
  }, 250);
}

/**
 * Renderiza os itens dentro do Drawer da Minha Lista.
 */
function renderCartDrawer() {
  const bodyEl = document.getElementById('cart-drawer-body');
  const footerEl = document.getElementById('cart-drawer-footer');
  const bulkActionsEl = document.getElementById('cart-bulk-actions');
  const selectAllCheckbox = document.getElementById('cart-select-all');
  const removeSelectedBtn = document.getElementById('cart-remove-selected-btn');
  const proceedBtn = document.getElementById('cart-btn-proceed');

  if (!bodyEl) return;

  if (cartItems.length === 0) {
    if (bulkActionsEl) bulkActionsEl.style.display = 'none';
    if (footerEl) footerEl.style.display = 'none';

    bodyEl.innerHTML = `
      <div class="cart-empty-state">
        <span class="cart-empty-state__icon" aria-hidden="true">🛍️</span>
        <h3 class="cart-empty-state__title">Sua lista está vazia</h3>
        <p class="cart-empty-state__desc">Encontre seus mascotes favoritos no catálogo e adicione-os à sua lista de pedido.</p>
        <button type="button" class="btn btn--primary btn--md" id="cart-empty-go-catalog">
          Ver Produtos
        </button>
      </div>
    `;

    const goCatalogBtn = document.getElementById('cart-empty-go-catalog');
    if (goCatalogBtn) {
      goCatalogBtn.addEventListener('click', () => {
        closeCartDrawer();
        const prodSec = document.getElementById('produtos');
        if (prodSec) prodSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
    return;
  }

  if (bulkActionsEl) bulkActionsEl.style.display = 'flex';
  if (footerEl) footerEl.style.display = 'block';

  let selectedTotalUnits = 0;
  let selectedTotalPrice = 0;
  let selectableCount = 0;
  let selectedCount = 0;

  let itemsHTML = '';

  cartItems.forEach((item) => {
    const product = publicCatalogProducts.find((p) => p.id === item.productId);
    const exists = !!product;
    const isActive = exists && product.active;
    const stock = exists && typeof product.stock === 'number' ? product.stock : 0;
    const isAvailable = exists && isActive && stock > 0;

    const isSelected = isAvailable && selectedCartProductIds.has(item.productId);

    if (isAvailable) {
      selectableCount++;
      if (isSelected) {
        selectedCount++;
        const price = typeof product.price === 'number' ? product.price : 0;
        selectedTotalUnits += item.quantity;
        selectedTotalPrice += price * item.quantity;
      }
    }

    const name = escapeHTML(product ? product.name : 'Produto indisponível');
    const categoryName = escapeHTML(
      (product && product.categories && product.categories.name)
        ? product.categories.name
        : (product && product.category ? product.category : 'Mascote')
    );
    const unitPrice = formatCurrency(product ? product.price : 0);
    const subtotal = formatCurrency((product ? product.price : 0) * item.quantity);

    const imageMarkup = (product && product.image_url)
      ? `<img src="${escapeHTML(product.image_url)}" alt="${name}" class="cart-item__img" loading="lazy">`
      : `<span style="font-size:1.75rem;" aria-hidden="true">🚗</span>`;

    let warnMsg = '';
    if (!exists || !isActive) {
      warnMsg = '<span class="cart-item__warn">⚠️ Produto não está mais disponível no catálogo.</span>';
    } else if (stock <= 0) {
      warnMsg = '<span class="cart-item__warn">⚠️ Produto esgotado.</span>';
    } else if (item.quantity > stock) {
      warnMsg = `<span class="cart-item__warn">⚠️ Quantidade ajustada para o estoque (${stock} un.).</span>`;
    }

    itemsHTML += `
      <article class="cart-item ${!isSelected ? 'cart-item--unselected' : ''} ${!isAvailable ? 'cart-item--unavailable' : ''}" data-cart-item-id="${escapeHTML(item.productId)}">
        <div class="cart-item__check">
          <input
            type="checkbox"
            class="cart-checkbox cart-item-checkbox"
            data-product-id="${escapeHTML(item.productId)}"
            ${isSelected ? 'checked' : ''}
            ${!isAvailable ? 'disabled' : ''}
            aria-label="Selecionar ${name} para o pedido"
          />
        </div>
        <div class="cart-item__media">
          ${imageMarkup}
        </div>
        <div class="cart-item__info">
          <div class="cart-item__header">
            <h4 class="cart-item__name">${name}</h4>
            <button type="button" class="cart-item__btn-remove" data-remove-id="${escapeHTML(item.productId)}" title="Remover item da lista" aria-label="Remover ${name} da lista">
              ✕
            </button>
          </div>
          <span class="cart-item__category">${categoryName}</span>
          <div class="cart-item__price-unit">Unitário: ${unitPrice}</div>

          <div class="cart-item__bottom">
            <div class="cart-qty-control">
              <button type="button" class="cart-qty-btn btn-qty-minus" data-qty-action="minus" data-product-id="${escapeHTML(item.productId)}" ${!isAvailable || item.quantity <= 1 ? 'disabled' : ''} aria-label="Diminuir quantidade">−</button>
              <input type="number" class="cart-qty-input" data-product-id="${escapeHTML(item.productId)}" value="${item.quantity}" min="1" max="${stock}" ${!isAvailable ? 'disabled' : ''} aria-label="Quantidade de ${name}">
              <button type="button" class="cart-qty-btn btn-qty-plus" data-qty-action="plus" data-product-id="${escapeHTML(item.productId)}" ${!isAvailable || item.quantity >= stock ? 'disabled' : ''} aria-label="Aumentar quantidade">+</button>
            </div>
            <div class="cart-item__subtotal">${subtotal}</div>
          </div>
          ${warnMsg}
        </div>
      </article>
    `;
  });

  bodyEl.innerHTML = itemsHTML;

  // Atualiza checkbox "Selecionar todos"
  if (selectAllCheckbox) {
    selectAllCheckbox.checked = selectableCount > 0 && selectedCount === selectableCount;
    selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < selectableCount;
  }

  // Atualiza botão de remover selecionados
  if (removeSelectedBtn) {
    removeSelectedBtn.disabled = selectedCartProductIds.size === 0;
  }

  // Atualiza resumo
  const summaryCountEl = document.getElementById('cart-summary-items-count');
  const summaryTotalEl = document.getElementById('cart-summary-total-price');

  if (summaryCountEl) {
    summaryCountEl.textContent = `${selectedTotalUnits} ${selectedTotalUnits === 1 ? 'unidade' : 'unidades'} em ${selectedCount} ${selectedCount === 1 ? 'item' : 'itens'}`;
  }
  if (summaryTotalEl) {
    summaryTotalEl.textContent = formatCurrency(selectedTotalPrice);
  }

  if (proceedBtn) {
    proceedBtn.disabled = selectedCount === 0;
    proceedBtn.title = selectedCount === 0 ? 'Selecione ao menos um produto para continuar' : 'Finalizar pedido pelo WhatsApp';
  }
}

/**
 * Constrói a mensagem profissional formatada para envio pelo WhatsApp.
 * @param {Array<{product: Object, quantity: number}>} itemsToSend
 * @returns {string}
 */
function buildWhatsAppOrderMessage(itemsToSend) {
  let totalUnits = 0;
  let totalPrice = 0;

  const productsText = itemsToSend.map((entry) => {
    const p = entry.product;
    const qty = entry.quantity;
    const unitVal = typeof p.price === 'number' ? p.price : 0;
    const subtotal = unitVal * qty;

    totalUnits += qty;
    totalPrice += subtotal;

    return `• ${p.name || 'Mascote'}\n  Quantidade: ${qty}\n  Valor unitário: ${formatCurrency(unitVal)}\n  Subtotal: ${formatCurrency(subtotal)}`;
  }).join('\n\n');

  return (
    `🛍️ MINHA LISTA DE PEDIDO — MASCOTCAR\n\n` +
    `Olá! Gostaria de consultar e finalizar o seguinte pedido:\n\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `PRODUTOS\n\n` +
    `${productsText}\n\n` +
    `━━━━━━━━━━━━━━━━━━\n\n` +
    `RESUMO\n\n` +
    `Total de itens: ${totalUnits}\n` +
    `Total dos produtos: ${formatCurrency(totalPrice)}\n\n` +
    `Gostaria de confirmar a disponibilidade dos produtos e combinar os detalhes do pedido.\n\n` +
    `Obrigado!`
  );
}

/**
 * Abre o Modal de Revisão do Pedido antes de disparar o WhatsApp.
 */
function openOrderReviewModal() {
  const selectedItems = [];

  // Revalidação em tempo real dos itens selecionados
  for (const item of cartItems) {
    if (!selectedCartProductIds.has(item.productId)) continue;

    const product = publicCatalogProducts.find((p) => p.id === item.productId);
    if (!product || !product.active) {
      showCartToast('Um dos produtos selecionados não está mais ativo. A lista foi atualizada.', 'warn');
      syncCartWithCatalog();
      return;
    }

    const stock = typeof product.stock === 'number' ? product.stock : 0;
    if (stock <= 0) {
      showCartToast(`O produto "${product.name}" esgotou. A lista foi atualizada.`, 'warn');
      syncCartWithCatalog();
      return;
    }

    const validQty = Math.min(item.quantity, stock);
    if (validQty !== item.quantity) {
      item.quantity = validQty;
      saveCartToStorage();
      showCartToast(`Quantidade de "${product.name}" ajustada para o estoque disponível (${stock} un.).`, 'warn');
      syncCartWithCatalog();
      return;
    }

    selectedItems.push({ product, quantity: validQty });
  }

  if (selectedItems.length === 0) {
    showCartToast('Selecione ao menos um produto disponível para finalizar o pedido.', 'warn');
    return;
  }

  const reviewBackdrop = document.getElementById('order-review-backdrop');
  const reviewBody = document.getElementById('order-review-body');
  const feedbackEl = document.getElementById('checkout-form-feedback');

  if (!reviewBackdrop || !reviewBody) return;

  if (feedbackEl) {
    feedbackEl.style.display = 'none';
    feedbackEl.textContent = '';
  }

  lastFocusedElementBeforeReview = document.activeElement;

  // Renderiza produtos na revisão
  let totalUnits = 0;
  let totalPrice = 0;

  reviewBody.innerHTML = selectedItems.map((entry) => {
    const p = entry.product;
    const qty = entry.quantity;
    const price = typeof p.price === 'number' ? p.price : 0;
    const subtotal = price * qty;

    totalUnits += qty;
    totalPrice += subtotal;

    return `
      <div class="order-review-item">
        <div>
          <div class="order-review-item__name">${escapeHTML(p.name)}</div>
          <div class="order-review-item__meta">${qty} ${qty === 1 ? 'unidade' : 'unidades'} × ${formatCurrency(price)}</div>
        </div>
        <div class="order-review-item__subtotal">${formatCurrency(subtotal)}</div>
      </div>
    `;
  }).join('');

  closeCartDrawer();
  reviewBackdrop.style.display = 'flex';

  requestAnimationFrame(() => {
    reviewBackdrop.classList.add('is-open');
    const nameInput = document.getElementById('checkout-customer-name');
    if (nameInput) nameInput.focus();
  });

  document.body.style.overflow = 'hidden';
}

/**
 * Fecha o Modal de Revisão do Pedido.
 */
function closeOrderReviewModal() {
  const reviewBackdrop = document.getElementById('order-review-backdrop');
  if (!reviewBackdrop) return;

  reviewBackdrop.classList.remove('is-open');
  setTimeout(() => {
    reviewBackdrop.style.display = 'none';
    document.body.style.overflow = '';
    if (lastFocusedElementBeforeReview && typeof lastFocusedElementBeforeReview.focus === 'function') {
      lastFocusedElementBeforeReview.focus();
      lastFocusedElementBeforeReview = null;
    }
  }, 200);
}

// Chaves de armazenamento local da Etapa 3N.2
const CHECKOUT_PENDING_STORAGE_KEY = 'mascotcar_checkout_pending_v1';
const ORDERS_STORAGE_KEY = 'mascotcar_orders_v1';

let isSubmittingCheckout = false;
let orderTimerInterval = null;

/**
 * Obtém ou inicializa o client_request_id estável para idempotência.
 */
function getOrCreateClientRequestId() {
  try {
    const raw = localStorage.getItem(CHECKOUT_PENDING_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.requestId === 'string') {
        return parsed.requestId;
      }
    }
  } catch (e) {}

  const newId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : (function() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  })();

  try {
    localStorage.setItem(CHECKOUT_PENDING_STORAGE_KEY, JSON.stringify({
      requestId: newId,
      createdAt: new Date().toISOString()
    }));
  } catch (e) {}

  return newId;
}

/**
 * Remove o client_request_id pendente após sucesso confirmado.
 */
function clearPendingClientRequestId() {
  try {
    localStorage.removeItem(CHECKOUT_PENDING_STORAGE_KEY);
  } catch (e) {}
}

/**
 * Salva o pedido criado no histórico local do navegador para tracking.
 */
function saveOrderToLocalHistory(orderData) {
  try {
    const raw = localStorage.getItem(ORDERS_STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const existingIndex = list.findIndex(o => o.orderCode === orderData.orderCode);
    if (existingIndex >= 0) {
      list[existingIndex] = { ...list[existingIndex], ...orderData };
    } else {
      list.unshift(orderData);
    }
    localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(list.slice(0, 30)));
  } catch (e) {}
}

/**
 * Atualiza campos específicos de um pedido existente no histórico local sem sobrescrever os demais dados.
 * @param {string} orderCode
 * @param {Object} partialData
 * @returns {boolean} Retorna true se encontrou e atualizou, false caso contrário.
 */
function updateOrderInLocalHistory(orderCode, partialData) {
  if (!orderCode || !partialData) return false;
  try {
    const raw = localStorage.getItem(ORDERS_STORAGE_KEY);
    if (!raw) return false;
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return false;

    const index = list.findIndex(o => o.orderCode === orderCode);
    if (index === -1) return false;

    list[index] = { ...list[index], ...partialData };
    localStorage.setItem(ORDERS_STORAGE_KEY, JSON.stringify(list));
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Busca o access_token salvo localmente no navegador por orderCode.
 */
function getLocalAccessToken(orderCode) {
  try {
    const raw = localStorage.getItem(ORDERS_STORAGE_KEY);
    if (!raw) return null;
    const list = JSON.parse(raw);
    const found = list.find(o => o.orderCode === orderCode);
    return found ? found.accessToken : null;
  } catch (e) {
    return null;
  }
}

/**
 * Executa a submissão formal do checkout chamando exclusivamente a RPC public.create_order.
 */
async function submitOrderCheckout() {
  if (isSubmittingCheckout) return;

  const nameInput = document.getElementById('checkout-customer-name');
  const phoneInput = document.getElementById('checkout-customer-phone');
  const notesInput = document.getElementById('checkout-customer-notes');
  const feedbackEl = document.getElementById('checkout-form-feedback');
  const submitBtn = document.getElementById('order-review-btn-submit');

  if (!nameInput || !phoneInput || !submitBtn) return;

  const customerName = nameInput.value.trim();
  const customerPhone = phoneInput.value.trim();
  const notes = notesInput ? notesInput.value.trim() : '';

  if (!customerName) {
    showFormFeedback('Por favor, informe seu nome completo.', 'warn');
    nameInput.focus();
    return;
  }

  if (!customerPhone || customerPhone.replace(/\D/g, '').length < 8) {
    showFormFeedback('Por favor, informe um número de telefone/WhatsApp válido.', 'warn');
    phoneInput.focus();
    return;
  }

  // Monta lista de itens selecionados e disponíveis
  const itemsPayload = [];
  const purchasedProductIds = [];

  for (const item of cartItems) {
    if (!selectedCartProductIds.has(item.productId)) continue;
    const p = publicCatalogProducts.find(prod => prod.id === item.productId);
    if (p && p.active && (p.stock || 0) > 0) {
      itemsPayload.push({
        product_id: item.productId,
        quantity: item.quantity
      });
      purchasedProductIds.push(item.productId);
    }
  }

  if (itemsPayload.length === 0) {
    showFormFeedback('Não há produtos disponíveis selecionados para finalizar o pedido.', 'warn');
    return;
  }

  // Ativa trava de submissão e estado de loading
  isSubmittingCheckout = true;
  submitBtn.disabled = true;
  submitBtn.classList.add('btn--loading');
  submitBtn.textContent = 'Processando reserva...';
  if (feedbackEl) feedbackEl.style.display = 'none';

  const clientRequestId = getOrCreateClientRequestId();

  try {
    const { data, error } = await supabaseClient.rpc('create_order', {
      p_client_request_id: clientRequestId,
      p_customer_name: customerName,
      p_customer_phone: customerPhone,
      p_notes: notes,
      p_items: itemsPayload
    });

    if (error) {
      handleCheckoutError(error);
      return;
    }

    if (!data || !data.success) {
      showFormFeedback('Não foi possível registrar o pedido no momento. Tente novamente.', 'error');
      return;
    }

    // Sucesso confirmado pela autoridade do banco!
    clearPendingClientRequestId();

    // Limpa somente os itens que foram comprados
    cartItems = cartItems.filter(item => !purchasedProductIds.includes(item.productId));
    purchasedProductIds.forEach(id => selectedCartProductIds.delete(id));
    saveCartToStorage();
    updateCartBadge();
    renderCartDrawer();

    // Determina o access_token (original retornado ou recuperado do local storage em caso de idempotência)
    let finalToken = data.access_token;
    if (!finalToken && data.is_idempotent) {
      finalToken = getLocalAccessToken(data.order_code);
    }

    // Salva no histórico local seguro para consultas futuras
    saveOrderToLocalHistory({
      orderId: data.order_id,
      orderCode: data.order_code,
      accessToken: finalToken,
      totalAmount: data.total_amount,
      totalItems: data.total_items,
      status: data.status,
      reservationExpiresAt: data.reservation_expires_at,
      createdAt: new Date().toISOString()
    });

    // Fecha revisão e abre modal de sucesso oficial
    closeOrderReviewModal();
    openOrderSuccessModal(data, finalToken, customerName, itemsPayload);

  } catch (err) {
    showFormFeedback('Falha de conexão com o servidor. Verifique sua internet e tente novamente.', 'error');
  } finally {
    isSubmittingCheckout = false;
    submitBtn.disabled = false;
    submitBtn.classList.remove('btn--loading');
    submitBtn.textContent = '🛍️ Confirmar e Criar Pedido';
  }
}

/**
 * Mapeia e apresenta os erros retornados pela RPC create_order sem expor SQL/internos.
 */
function handleCheckoutError(error) {
  const code = error.code;
  const msg = error.message || '';

  if (code === '22023') {
    showFormFeedback('Dados incompletos ou inválidos: ' + msg, 'warn');
  } else if (code === 'P0001') {
    // Informa que o estoque/disponibilidade mudou sem forçar alteração silenciosa
    showFormFeedback('Atenção: ' + msg + ' Por favor, revise as quantidades na sua lista.', 'warn');
  } else if (code === 'P0002') {
    showFormFeedback('Um dos itens selecionados não foi encontrado no catálogo. A lista foi sincronizada.', 'warn');
    syncCartWithCatalog();
  } else {
    showFormFeedback('Ocorreu uma instabilidade temporária ao processar seu pedido. Por favor, tente novamente.', 'error');
  }
}

/**
 * Exibe feedback de validação ou erro no formulário de revisão.
 */
function showFormFeedback(message, type = 'warn') {
  const el = document.getElementById('checkout-form-feedback');
  if (!el) return;

  el.textContent = message;
  el.style.display = 'block';
  if (type === 'warn') {
    el.style.background = '#fffaf0';
    el.style.color = '#c05621';
    el.style.border = '1px solid #feebc8';
  } else {
    el.style.background = '#fff5f5';
    el.style.color = '#c53030';
    el.style.border = '1px solid #fed7d7';
  }
}

/**
 * Constrói a URL do WhatsApp para atendimento de um pedido sem expor tokens ou dados sensíveis.
 * @param {Object} params
 * @param {string} params.orderCode
 * @param {number|string} params.totalAmount
 * @param {number|string} params.totalItems
 * @param {string} [params.customerName]
 * @param {string} [params.statusLabel]
 * @returns {string}
 */
function buildOrderWhatsAppLink({ orderCode, totalAmount, totalItems, customerName, statusLabel }) {
  let msg = 'Olá! Gostaria de falar sobre meu pedido na MascotCar.\n\n';
  msg += `*Código do Pedido:* ${orderCode}\n`;
  if (statusLabel) {
    msg += `*Status:* ${statusLabel}\n`;
  }
  if (customerName) {
    msg += `*Cliente:* ${customerName}\n`;
  }
  msg += `*Total:* ${formatCurrency(totalAmount)} (${totalItems} ${totalItems === 1 ? 'item' : 'itens'})\n\n`;
  msg += 'Gostaria de confirmar os detalhes do meu pedido. Obrigado!';

  return `https://wa.me/5513991830511?text=${encodeURIComponent(msg)}`;
}

/**
 * Abre o Modal de Confirmação com timer de reserva e link seguro de WhatsApp e tracking.
 */
function openOrderSuccessModal(orderData, accessToken, customerName, items) {
  const modal = document.getElementById('order-success-backdrop');
  const codeEl = document.getElementById('order-success-code');
  const summaryEl = document.getElementById('order-success-summary');
  const timerEl = document.getElementById('order-success-timer');
  const timerFillEl = document.getElementById('order-success-timer-fill');
  const waBtn = document.getElementById('order-success-btn-whatsapp');
  const copyBtn = document.getElementById('order-success-btn-copy-link');

  if (!modal) return;

  if (codeEl) codeEl.textContent = orderData.order_code;

  if (summaryEl) {
    summaryEl.innerHTML = `
      <div style="font-size: 0.875rem; color: var(--color-text);">
        <div><strong>Total de itens:</strong> ${orderData.total_items}</div>
        <div><strong>Valor Total:</strong> ${formatCurrency(orderData.total_amount)}</div>
        <div><strong>Modalidade:</strong> Retirada / A combinar via WhatsApp</div>
      </div>
    `;
  }

  // Prepara link de tracking seguro usando fragmento (#pedido=...&token=...)
  const trackingFragment = accessToken
    ? `#pedido=${encodeURIComponent(orderData.order_code)}&token=${encodeURIComponent(accessToken)}`
    : `#pedido=${encodeURIComponent(orderData.order_code)}`;

  const trackingFullUrl = window.location.origin + window.location.pathname + trackingFragment;

  if (copyBtn) {
    copyBtn.onclick = () => {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(trackingFullUrl).then(() => {
          copyBtn.textContent = '✓ Copiado!';
          setTimeout(() => { copyBtn.textContent = '📋 Copiar Link'; }, 2500);
        });
      } else {
        prompt('Copie o link seguro de acompanhamento:', trackingFullUrl);
      }
    };
  }

  // Monta mensagem oficial do WhatsApp contendo o código real do pedido (sem token)
  if (waBtn) {
    waBtn.href = buildOrderWhatsAppLink({
      orderCode: orderData.order_code,
      totalAmount: orderData.total_amount,
      totalItems: orderData.total_items,
      customerName: customerName,
      statusLabel: 'RECEBIDO'
    });
  }

  // Inicia timer de 30 minutos regressivos
  startReservationCountdown(orderData.reservation_expires_at, timerEl, timerFillEl);

  modal.style.display = 'flex';
  requestAnimationFrame(() => {
    modal.classList.add('is-open');
  });
  document.body.style.overflow = 'hidden';
}

/**
 * Fecha o Modal de Sucesso do Pedido.
 */
function closeOrderSuccessModal() {
  const modal = document.getElementById('order-success-backdrop');
  if (!modal) return;

  if (orderTimerInterval) clearInterval(orderTimerInterval);

  modal.classList.remove('is-open');
  setTimeout(() => {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }, 200);
}

/**
 * Gerencia o contador regressivo de 30 minutos da reserva temporária.
 */
function startReservationCountdown(expiresAtIso, labelEl, fillEl) {
  if (orderTimerInterval) clearInterval(orderTimerInterval);

  const expiresTime = new Date(expiresAtIso).getTime();
  const totalDurationMs = 30 * 60 * 1000;

  function update() {
    const now = Date.now();
    const remainingMs = Math.max(0, expiresTime - now);

    const minutes = Math.floor(remainingMs / 60000);
    const seconds = Math.floor((remainingMs % 60000) / 1000);

    if (labelEl) {
      labelEl.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    if (fillEl) {
      const pct = Math.min(100, Math.max(0, (remainingMs / totalDurationMs) * 100));
      fillEl.style.width = `${pct}%`;
    }

    if (remainingMs <= 0) {
      clearInterval(orderTimerInterval);
      if (labelEl) labelEl.textContent = 'Reserva Expirada';
    }
  }

  update();
  orderTimerInterval = setInterval(update, 1000);
}

/**
 * Inspeciona o fragmento da URL (#pedido=...&token=...) e abre o tracking seguro.
 */
async function checkAndHandleUrlTracking() {
  const hash = window.location.hash;
  if (!hash || !hash.includes('pedido=')) return;

  const rawHash = hash.replace(/^#/, '');
  const params = new URLSearchParams(rawHash);

  const orderCode = params.get('pedido');
  let token = params.get('token');

  if (!orderCode) return;

  // Se não veio no hash, verifica se o navegador possui o token salvo localmente
  if (!token) {
    token = getLocalAccessToken(orderCode);
  }

  openOrderTrackingModal(orderCode, token);
}

// ==========================================================================
// RASTREAMENTO DO PEDIDO COM POLLING ATIVO & EXPIRAÇÃO DINÂMICA (Etapa 3N.5.3)
// ==========================================================================

const TRACKING_POLL_INTERVAL_MS = 20000; // 20 segundos
const TERMINAL_ORDER_STATUSES = ['completed', 'cancelled', 'expired'];
const ACTIVE_TRACKING_STATUSES = ['received', 'confirmed', 'preparing', 'ready'];

let trackingPollIntervalId = null;
let isFetchingTrackingStatus = false;
let activeTrackingOrderCode = null;
let activeTrackingAccessToken = null;
let activeTrackingCurrentStatus = null;
let trackingReservationTimerInterval = null;
let trackingVisibilityListenersAttached = false;

/**
 * Mapeamento visual canônico para crachás e textos de status de pedidos.
 */
const ORDER_TRACKING_STATUS_MAP = {
  received: { label: 'Recebido (Aguardando Loja)', cls: 'received' },
  confirmed: { label: 'Confirmado', cls: 'confirmed' },
  preparing: { label: 'Em Preparação', cls: 'preparing' },
  ready: { label: 'Pronto para Retirada', cls: 'ready' },
  completed: { label: 'Concluído', cls: 'completed' },
  cancelled: { label: 'Cancelado', cls: 'cancelled' },
  expired: { label: 'Expirado', cls: 'expired' }
};

/**
 * Atualiza o cronômetro visual de reserva dentro do modal de tracking quando o pedido está em 'received'.
 * @param {string|null} expiresAtIso
 */
function updateTrackingReservationCountdown(expiresAtIso) {
  if (trackingReservationTimerInterval) {
    clearInterval(trackingReservationTimerInterval);
    trackingReservationTimerInterval = null;
  }

  const container = document.getElementById('order-tracking-reservation-timer-box');
  const timerLabel = document.getElementById('order-tracking-reservation-time-val');
  if (!container || !timerLabel) return;

  if (!expiresAtIso || activeTrackingCurrentStatus !== 'received') {
    container.style.display = 'none';
    return;
  }

  const expiresTime = new Date(expiresAtIso).getTime();
  if (isNaN(expiresTime)) {
    container.style.display = 'none';
    return;
  }

  function tick() {
    const now = Date.now();
    const remainingMs = Math.max(0, expiresTime - now);

    if (remainingMs <= 0) {
      if (trackingReservationTimerInterval) {
        clearInterval(trackingReservationTimerInterval);
        trackingReservationTimerInterval = null;
      }
      timerLabel.textContent = '00:00 (Reserva expirada)';
      container.style.background = '#fff5f5';
      container.style.borderColor = '#feb2b2';
      container.style.color = '#c53030';
      // Dispara imediatamente uma consulta de atualização para sincronizar status com Supabase
      if (!isFetchingTrackingStatus && activeTrackingOrderCode && activeTrackingAccessToken) {
        pollOrderTrackingStatus(true);
      }
      return;
    }

    const minutes = Math.floor(remainingMs / 60000);
    const seconds = Math.floor((remainingMs % 60000) / 1000);
    timerLabel.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  container.style.display = 'flex';
  tick();
  trackingReservationTimerInterval = setInterval(tick, 1000);
}

/**
 * Renderiza ou atualiza o conteúdo do corpo do modal de tracking de forma estável.
 * @param {Object} order
 */
function renderTrackingModalContent(order) {
  const subtitleEl = document.getElementById('order-tracking-subtitle');
  const bodyEl = document.getElementById('order-tracking-body');
  const trackWaBtn = document.getElementById('order-tracking-btn-whatsapp');

  if (!bodyEl) return;

  const stInfo = ORDER_TRACKING_STATUS_MAP[order.status] || { label: order.status, cls: 'received' };
  activeTrackingCurrentStatus = order.status;

  if (subtitleEl) {
    subtitleEl.textContent = `Status: ${stInfo.label}`;
  }

  // Prepara itens
  const itemsHtml = (order.items || []).map(it => `
    <div style="display: flex; justify-content: space-between; padding: 0.5rem 0; border-bottom: 1px solid var(--color-border); font-size: 0.875rem;">
      <div>
        <strong>${escapeHTML(it.product_name)}</strong>
        <div style="font-size: 0.775rem; color: var(--color-text-muted);">${it.quantity} un. × ${formatCurrency(it.unit_price)}</div>
      </div>
      <div>${formatCurrency(it.subtotal)}</div>
    </div>
  `).join('');

  // Prepara histórico / linha do tempo
  const historyHtml = (order.history || []).map(h => `
    <div class="order-timeline-node">
      <div style="font-weight: 600;">${ORDER_TRACKING_STATUS_MAP[h.status] ? ORDER_TRACKING_STATUS_MAP[h.status].label : h.status}</div>
      <div class="order-timeline-time">${new Date(h.created_at).toLocaleString('pt-BR')} ${h.comment ? '— ' + escapeHTML(h.comment) : ''}</div>
    </div>
  `).join('');

  // Bloco de aviso de reserva quando status for 'received'
  const isReceived = order.status === 'received';
  const reservationBoxHtml = `
    <div id="order-tracking-reservation-timer-box" style="display: ${isReceived ? 'flex' : 'none'}; justify-content: space-between; align-items: center; background: #fffaf0; border: 1px solid #feebc8; border-radius: var(--radius-md); padding: 0.625rem 0.875rem; margin-bottom: 0.75rem; font-size: 0.85rem; color: #c05621;">
      <span>⏱️ Tempo restante de reserva:</span>
      <strong id="order-tracking-reservation-time-val">—</strong>
    </div>
  `;

  bodyEl.innerHTML = `
    ${reservationBoxHtml}

    <div style="display: flex; justify-content: space-between; align-items: center; background: var(--color-bg-alt); padding: 0.75rem 1rem; border-radius: var(--radius-md);">
      <span style="font-size: 0.85rem; font-weight: 600;">Status do Pedido:</span>
      <span class="order-status-badge order-status-badge--${stInfo.cls}" id="order-tracking-status-badge">${stInfo.label}</span>
    </div>

    <div>
      <h4 style="font-size: 0.85rem; font-weight: 700; text-transform: uppercase; margin-bottom: 0.5rem; color: var(--color-text-muted);">Itens do Pedido</h4>
      ${itemsHtml}
      <div style="display: flex; justify-content: space-between; padding-top: 0.75rem; font-weight: 800; font-size: 1rem;">
        <span>Total:</span>
        <span>${formatCurrency(order.total_amount)}</span>
      </div>
    </div>

    <div>
      <h4 style="font-size: 0.85rem; font-weight: 700; text-transform: uppercase; margin-bottom: 0.5rem; color: var(--color-text-muted);">Linha do Tempo</h4>
      <div class="order-tracking-timeline" id="order-tracking-timeline">
        ${historyHtml}
      </div>
    </div>
  `;

  // Configura botão do WhatsApp com link contextual
  if (trackWaBtn) {
    const totalUnits = (order.items || []).reduce((acc, it) => acc + (it.quantity || 1), 0);
    trackWaBtn.href = buildOrderWhatsAppLink({
      orderCode: order.order_code,
      totalAmount: order.total_amount,
      totalItems: totalUnits || 1,
      statusLabel: stInfo.label
    });
    trackWaBtn.style.display = 'inline-flex';
  }

  // Ativa contador regressivo se status for 'received'
  if (isReceived && order.reservation_expires_at) {
    updateTrackingReservationCountdown(order.reservation_expires_at);
  } else if (trackingReservationTimerInterval) {
    clearInterval(trackingReservationTimerInterval);
    trackingReservationTimerInterval = null;
  }
}

/**
 * Consulta o status atualizado do pedido no Supabase durante o ciclo de polling.
 * @param {boolean} [isForced=false]
 */
async function pollOrderTrackingStatus(isForced = false) {
  if (isFetchingTrackingStatus) return;
  if (!activeTrackingOrderCode || !activeTrackingAccessToken) return;

  // Condições de pausa: sem internet ou aba oculta
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden' && !isForced) return;

  const modal = document.getElementById('order-tracking-backdrop');
  if (!modal || modal.style.display !== 'flex') {
    stopOrderTrackingPolling();
    return;
  }

  isFetchingTrackingStatus = true;

  try {
    const { data, error } = await supabaseClient.rpc('get_order_tracking', {
      p_order_code: activeTrackingOrderCode,
      p_access_token: activeTrackingAccessToken
    });

    if (error || !data || !data.success || !data.order) {
      return;
    }

    const freshOrder = data.order;
    const freshStatus = freshOrder.status;

    // Se houve alteração de status ou valores, atualiza a UI suavemente
    const statusChanged = activeTrackingCurrentStatus !== freshStatus;

    if (statusChanged) {
      renderTrackingModalContent(freshOrder);
    } else {
      // Mesmo com mesmo status, atualiza timeline se novos eventos foram registrados
      const timelineEl = document.getElementById('order-tracking-timeline');
      if (timelineEl && freshOrder.history) {
        timelineEl.innerHTML = freshOrder.history.map(h => `
          <div class="order-timeline-node">
            <div style="font-weight: 600;">${ORDER_TRACKING_STATUS_MAP[h.status] ? ORDER_TRACKING_STATUS_MAP[h.status].label : h.status}</div>
            <div class="order-timeline-time">${new Date(h.created_at).toLocaleString('pt-BR')} ${h.comment ? '— ' + escapeHTML(h.comment) : ''}</div>
          </div>
        `).join('');
      }
    }

    // Persiste no cache local de pedidos para manter "Meus Pedidos" sempre alinhado
    updateOrderInLocalHistory(freshOrder.order_code, {
      status: freshStatus,
      totalAmount: freshOrder.total_amount,
      totalItems: freshOrder.total_items,
      reservationExpiresAt: freshOrder.reservation_expires_at
    });

    // Se o pedido atingiu status terminal, interrompe o polling imediatamente
    if (TERMINAL_ORDER_STATUSES.includes(freshStatus)) {
      stopOrderTrackingPolling();
    }

  } catch (err) {
    // Erros pontuais de conexão não quebram o ciclo
  } finally {
    isFetchingTrackingStatus = false;
  }
}

/**
 * Inicia o polling seguro e periódico para pedidos com status ativos.
 * @param {string} orderCode
 * @param {string} token
 * @param {string} initialStatus
 */
function startOrderTrackingPolling(orderCode, token, initialStatus) {
  stopOrderTrackingPolling();

  activeTrackingOrderCode = orderCode;
  activeTrackingAccessToken = token;
  activeTrackingCurrentStatus = initialStatus;

  // Não inicia polling em status terminais
  if (TERMINAL_ORDER_STATUSES.includes(initialStatus)) {
    return;
  }

  // Registra os listeners de visibilidade e rede uma única vez
  initTrackingLifecycleListeners();

  // Inicia o intervalo de polling
  trackingPollIntervalId = setInterval(() => {
    pollOrderTrackingStatus(false);
  }, TRACKING_POLL_INTERVAL_MS);
}

/**
 * Para imediatamente qualquer ciclo de polling ativo e limpa timers.
 */
function stopOrderTrackingPolling() {
  if (trackingPollIntervalId) {
    clearInterval(trackingPollIntervalId);
    trackingPollIntervalId = null;
  }

  if (trackingReservationTimerInterval) {
    clearInterval(trackingReservationTimerInterval);
    trackingReservationTimerInterval = null;
  }

  isFetchingTrackingStatus = false;
  activeTrackingOrderCode = null;
  activeTrackingAccessToken = null;
  activeTrackingCurrentStatus = null;
}

/**
 * Registra listeners globais para Visibility API e Online/Offline uma única vez.
 */
function initTrackingLifecycleListeners() {
  if (trackingVisibilityListenersAttached) return;
  trackingVisibilityListenersAttached = true;

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const modal = document.getElementById('order-tracking-backdrop');
      if (modal && modal.style.display === 'flex' && activeTrackingOrderCode && activeTrackingAccessToken) {
        if (!TERMINAL_ORDER_STATUSES.includes(activeTrackingCurrentStatus)) {
          // Faz uma checagem imediata ao voltar à aba ativa
          pollOrderTrackingStatus(true);
        }
      }
    }
  });

  window.addEventListener('online', () => {
    const modal = document.getElementById('order-tracking-backdrop');
    if (modal && modal.style.display === 'flex' && activeTrackingOrderCode && activeTrackingAccessToken) {
      if (!TERMINAL_ORDER_STATUSES.includes(activeTrackingCurrentStatus)) {
        pollOrderTrackingStatus(true);
      }
    }
  });
}

/**
 * Abre o modal de rastreamento e consulta o pedido via get_order_tracking.
 */
async function openOrderTrackingModal(orderCode, token) {
  const modal = document.getElementById('order-tracking-backdrop');
  const titleEl = document.getElementById('order-tracking-title');
  const subtitleEl = document.getElementById('order-tracking-subtitle');
  const bodyEl = document.getElementById('order-tracking-body');

  if (!modal || !bodyEl) return;

  // Garante limpeza de ciclo anterior
  stopOrderTrackingPolling();

  if (titleEl) titleEl.textContent = `Pedido ${escapeHTML(orderCode)}`;
  if (subtitleEl) subtitleEl.textContent = 'Consultando status em tempo real...';

  bodyEl.innerHTML = `
    <div class="order-tracking-loading" style="text-align: center; padding: 2rem;">
      <div class="catalog-loading-spinner" aria-hidden="true"></div>
      <p style="margin-top: 0.75rem; color: var(--color-text-muted);">Consultando status seguro do pedido...</p>
    </div>
  `;

  modal.style.display = 'flex';
  requestAnimationFrame(() => {
    modal.classList.add('is-open');
  });
  document.body.style.overflow = 'hidden';

  const trackWaBtn = document.getElementById('order-tracking-btn-whatsapp');
  if (trackWaBtn) trackWaBtn.style.display = 'none';

  if (!token) {
    if (subtitleEl) subtitleEl.textContent = 'Acesso Restrito';
    bodyEl.innerHTML = `
      <div style="text-align: center; padding: 1.5rem;">
        <span style="font-size: 2rem;">🔒</span>
        <h3 style="font-size: 1.05rem; margin-top: 0.5rem; color: #c53030;">Chave de Acesso Necessária</h3>
        <p style="font-size: 0.85rem; color: var(--color-text-muted); margin-top: 0.5rem;">
          Por razões de segurança, os detalhes do pedido só podem ser visualizados com o link de acompanhamento original gerado neste dispositivo.
        </p>
      </div>
    `;
    return;
  }

  try {
    const { data, error } = await supabaseClient.rpc('get_order_tracking', {
      p_order_code: orderCode,
      p_access_token: token
    });

    if (error || !data || !data.success) {
      if (subtitleEl) subtitleEl.textContent = 'Não Encontrado';
      bodyEl.innerHTML = `
        <div style="text-align: center; padding: 1.5rem;">
          <span style="font-size: 2rem;">⚠️</span>
          <h3 style="font-size: 1.05rem; margin-top: 0.5rem; color: #c53030;">Acesso Não Autorizado</h3>
          <p style="font-size: 0.85rem; color: var(--color-text-muted); margin-top: 0.5rem;">
            O código do pedido ou a chave de acesso não conferem. Verifique o link de acompanhamento oficial.
          </p>
        </div>
      `;
      return;
    }

    const order = data.order;

    // Renderiza todo o conteúdo estável do modal
    renderTrackingModalContent(order);

    // Persiste status inicial atualizado de volta no histórico local
    updateOrderInLocalHistory(order.order_code, {
      status: order.status,
      totalAmount: order.total_amount,
      totalItems: order.total_items,
      reservationExpiresAt: order.reservation_expires_at
    });

    // Inicia o polling automático se o pedido for elegível (status ativo)
    if (ACTIVE_TRACKING_STATUSES.includes(order.status)) {
      startOrderTrackingPolling(order.order_code, token, order.status);
    }

  } catch (e) {
    const trackWaBtn = document.getElementById('order-tracking-btn-whatsapp');
    if (trackWaBtn) trackWaBtn.style.display = 'none';
    bodyEl.innerHTML = `<p style="color: #c53030; text-align: center;">Erro ao carregar detalhes do pedido.</p>`;
  }
}

/**
 * Fecha o Modal de Rastreamento e interrompe o polling imediatamente.
 */
function closeOrderTrackingModal() {
  stopOrderTrackingPolling();

  const modal = document.getElementById('order-tracking-backdrop');
  if (!modal) return;

  const trackWaBtn = document.getElementById('order-tracking-btn-whatsapp');
  if (trackWaBtn) trackWaBtn.style.display = 'none';

  modal.classList.remove('is-open');
  setTimeout(() => {
    modal.style.display = 'none';
    document.body.style.overflow = '';
  }, 200);
}

/* ==========================================================================
   MEUS PEDIDOS (Etapa 3N.3)
   ========================================================================== */

/**
 * Obtém os pedidos salvos localmente em mascotcar_orders_v1.
 */
function getLocalOrdersList() {
  try {
    const raw = localStorage.getItem(ORDERS_STORAGE_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

// Status ativos/não-terminais que devem ser sincronizados com o Supabase (Etapa 3N.5.1)
const SYNCABLE_ORDER_STATUSES = ['received', 'confirmed', 'preparing', 'ready'];

let isSyncingCustomerOrders = false;

/**
 * Sincroniza em segundo plano os pedidos locais ativos chamando public.get_order_tracking.
 * Não bloqueia a interface e atualiza os cards/localStorage de forma silenciosa.
 */
async function syncCustomerOrdersStatuses() {
  if (isSyncingCustomerOrders) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  if (!supabaseClient) return;

  const orders = getLocalOrdersList();
  if (!orders || orders.length === 0) return;

  // Filtra apenas pedidos cujo status local seja 'received', 'confirmed', 'preparing' ou 'ready'
  // e que possuam token de acesso salvo localmente
  const eligibleOrders = orders.filter(o =>
    o &&
    o.orderCode &&
    o.accessToken &&
    SYNCABLE_ORDER_STATUSES.includes(o.status || 'received')
  );

  if (eligibleOrders.length === 0) return;

  isSyncingCustomerOrders = true;

  try {
    let hasAnyChanges = false;
    const MAX_CONCURRENT_RPCS = 5;
    let nextIndex = 0;

    // Worker assíncrono que consome a fila compartilhada garantindo no máximo 5 RPCs simultâneas
    async function worker() {
      while (nextIndex < eligibleOrders.length) {
        const ord = eligibleOrders[nextIndex++];
        try {
          const { data, error } = await supabaseClient.rpc('get_order_tracking', {
            p_order_code: ord.orderCode,
            p_access_token: ord.accessToken
          });

          if (error || !data || !data.success || !data.order) continue;

          const freshOrder = data.order;
          const freshStatus = freshOrder.status;
          const freshTotalAmount = freshOrder.total_amount;
          const freshTotalItems = freshOrder.total_items;
          const freshReservationExpiresAt = freshOrder.reservation_expires_at;

          // Verifica se houve mudança em relação ao estado em cache
          const changed = ord.status !== freshStatus ||
            ord.totalAmount !== freshTotalAmount ||
            ord.totalItems !== freshTotalItems ||
            ord.reservationExpiresAt !== freshReservationExpiresAt;

          if (changed) {
            updateOrderInLocalHistory(ord.orderCode, {
              status: freshStatus,
              totalAmount: freshTotalAmount,
              totalItems: freshTotalItems,
              reservationExpiresAt: freshReservationExpiresAt
            });
            hasAnyChanges = true;
          }
        } catch (err) {
          // Falhas isoladas de rede ou token não interrompem a sincronização dos demais pedidos
        }
      }
    }

    // Instancia pool com no máximo 5 workers concorrentes (ou a quantidade de pedidos elegíveis, se menor)
    const workerCount = Math.min(MAX_CONCURRENT_RPCS, eligibleOrders.length);
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.allSettled(workers);

    // Se houve alterações e o modal de Meus Pedidos ainda estiver aberto, atualiza a lista
    if (hasAnyChanges) {
      const backdrop = document.getElementById('customer-orders-backdrop');
      if (backdrop && backdrop.classList.contains('is-open')) {
        renderCustomerOrdersList();
      }
    }
  } finally {
    isSyncingCustomerOrders = false;
  }
}

/**
 * Abre o Modal de Meus Pedidos e renderiza os registros locais.
 */
function openCustomerOrdersModal() {
  const backdrop = document.getElementById('customer-orders-backdrop');
  if (!backdrop) return;

  // 1. Renderiza imediatamente a partir do cache local
  renderCustomerOrdersList();

  backdrop.style.display = 'flex';
  requestAnimationFrame(() => {
    backdrop.classList.add('is-open');
  });
  document.body.style.overflow = 'hidden';

  // 2. Dispara sincronização em segundo plano sem bloquear a abertura
  syncCustomerOrdersStatuses();
}

/**
 * Fecha o Modal de Meus Pedidos.
 */
function closeCustomerOrdersModal() {
  const backdrop = document.getElementById('customer-orders-backdrop');
  if (!backdrop) return;

  backdrop.classList.remove('is-open');
  setTimeout(() => {
    backdrop.style.display = 'none';
    document.body.style.overflow = '';
  }, 200);
}

/**
 * Renderiza a listagem de pedidos locais em #customer-orders-list.
 */
function renderCustomerOrdersList() {
  const container = document.getElementById('customer-orders-list');
  if (!container) return;

  const orders = getLocalOrdersList();

  if (orders.length === 0) {
    container.innerHTML = `
      <div class="customer-orders-empty">
        <span class="customer-orders-empty__icon" aria-hidden="true">📦</span>
        <p class="customer-orders-empty__text">
          Você ainda não realizou nenhum pedido neste navegador.
        </p>
        <button type="button" class="btn btn--primary btn--md" id="customer-orders-btn-explore">
          Explorar catálogo
        </button>
      </div>
    `;

    const exploreBtn = document.getElementById('customer-orders-btn-explore');
    if (exploreBtn) {
      exploreBtn.addEventListener('click', () => {
        closeCustomerOrdersModal();
        const catalogSec = document.getElementById('produtos');
        if (catalogSec) {
          catalogSec.scrollIntoView({ behavior: 'smooth' });
        }
      });
    }
    return;
  }

  const statusMap = {
    received: { label: 'Recebido', cls: 'received' },
    confirmed: { label: 'Confirmado', cls: 'confirmed' },
    preparing: { label: 'Em Preparação', cls: 'preparing' },
    ready: { label: 'Pronto', cls: 'ready' },
    completed: { label: 'Concluído', cls: 'completed' },
    cancelled: { label: 'Cancelado', cls: 'cancelled' },
    expired: { label: 'Expirado', cls: 'expired' }
  };

  const now = Date.now();

  container.innerHTML = orders.map((ord) => {
    const code = escapeHTML(ord.orderCode || 'MC-00000');
    const total = typeof ord.totalAmount === 'number' ? formatCurrency(ord.totalAmount) : 'R$ 0,00';
    const itemsCount = ord.totalItems || 1;
    const itemsText = itemsCount === 1 ? '1 item' : `${itemsCount} itens`;
    const st = ord.status || 'received';
    const stInfo = statusMap[st] || { label: st, cls: 'received' };

    let dateStr = '';
    if (ord.createdAt) {
      const d = new Date(ord.createdAt);
      dateStr = !isNaN(d.getTime()) ? d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '';
    }

    // Calcula tempo de reserva restante a partir de reservationExpiresAt
    let reserveHtml = '';
    if (ord.reservationExpiresAt) {
      const expTime = new Date(ord.reservationExpiresAt).getTime();
      const diffMs = expTime - now;

      if (diffMs > 0) {
        const mins = Math.ceil(diffMs / 60000);
        reserveHtml = `
          <span class="customer-orders-item__reserve customer-orders-item__reserve--active">
            ⏱️ Reserva ativa — ${mins} min
          </span>
        `;
      } else {
        reserveHtml = `
          <span class="customer-orders-item__reserve customer-orders-item__reserve--expired">
            Reserva expirada
          </span>
        `;
      }
    }

    return `
      <div class="customer-orders-item">
        <div class="customer-orders-item__top">
          <span class="customer-orders-item__code">${code}</span>
          <span class="order-status-badge order-status-badge--${stInfo.cls}">${stInfo.label}</span>
        </div>

        <div class="customer-orders-item__info">
          <div>
            <div class="customer-orders-item__amount">${total} • ${itemsText}</div>
            ${dateStr ? `<div class="customer-orders-item__date">${dateStr}</div>` : ''}
          </div>
          ${reserveHtml ? `<div>${reserveHtml}</div>` : ''}
        </div>

        <div class="customer-orders-item__actions">
          <button type="button" class="btn btn--outline btn--sm customer-orders-btn-track" data-order-code="${code}">
            Ver acompanhamento
          </button>
        </div>
      </div>
    `;
  }).join('');

  // Adiciona evento de clique aos botões de acompanhamento
  const trackBtns = container.querySelectorAll('.customer-orders-btn-track');
  trackBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const orderCode = btn.getAttribute('data-order-code');
      if (!orderCode) return;

      const token = getLocalAccessToken(orderCode);
      // Abre diretamente sem alterar o hash da URL
      openOrderTrackingModal(orderCode, token);
    });
  });
}

/**
 * Limpa o histórico local sob confirmação explícita do cliente.
 */
function clearCustomerOrdersLocalHistory() {
  const confirmed = window.confirm(
    'Isso remove os pedidos salvos neste dispositivo. Seus pedidos não serão apagados da MascotCar. Deseja continuar?'
  );

  if (!confirmed) return;

  try {
    localStorage.removeItem(ORDERS_STORAGE_KEY);
  } catch (e) {}

  renderCustomerOrdersList();
}

/**
 * Inicializa todos os eventos do Carrinho, Drawer e Revisão.
 */
function initCartEvents() {
  // 1. Abrir Drawer pelo Header
  const openCartBtn = document.getElementById('open-cart-btn');
  if (openCartBtn) {
    openCartBtn.addEventListener('click', () => {
      openCartDrawer();
    });
  }

  // 2. Fechar Drawer
  const closeCartBtn = document.getElementById('cart-drawer-close');
  if (closeCartBtn) {
    closeCartBtn.addEventListener('click', closeCartDrawer);
  }

  const cartBackdrop = document.getElementById('cart-drawer-backdrop');
  if (cartBackdrop) {
    cartBackdrop.addEventListener('click', (e) => {
      if (e.target === cartBackdrop) closeCartDrawer();
    });
  }

  const continueBtn = document.getElementById('cart-btn-continue');
  if (continueBtn) {
    continueBtn.addEventListener('click', () => {
      closeCartDrawer();
      const prodSec = document.getElementById('produtos');
      if (prodSec) prodSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  // 3. Adicionar pelo modal de detalhes do produto
  const modalAddCartBtn = document.getElementById('modal-product-add-cart');
  if (modalAddCartBtn) {
    modalAddCartBtn.addEventListener('click', () => {
      const pId = modalAddCartBtn.getAttribute('data-cart-id');
      if (pId) {
        addToCart(pId, 1);
      }
    });
  }

  // 4. Delegação de eventos no grid de produtos para botão de adicionar
  const grid = document.getElementById('products-grid');
  if (grid) {
    grid.addEventListener('click', (e) => {
      const addBtn = e.target.closest('.btn-card-add-cart');
      if (addBtn) {
        const id = addBtn.getAttribute('data-cart-id');
        if (id) addToCart(id, 1);
      }
    });
  }

  // 5. Delegação de eventos no Drawer do Carrinho
  const drawerBody = document.getElementById('cart-drawer-body');
  if (drawerBody) {
    drawerBody.addEventListener('click', (e) => {
      // Remover individual
      const removeBtn = e.target.closest('.cart-item__btn-remove');
      if (removeBtn) {
        const id = removeBtn.getAttribute('data-remove-id');
        if (id) removeCartItem(id);
        return;
      }

      // Botões de Quantidade + / -
      const qtyBtn = e.target.closest('.cart-qty-btn');
      if (qtyBtn) {
        const id = qtyBtn.getAttribute('data-product-id');
        const action = qtyBtn.getAttribute('data-qty-action');
        const item = cartItems.find((i) => i.productId === id);
        if (item && action === 'plus') {
          updateCartItemQuantity(id, item.quantity + 1);
        } else if (item && action === 'minus') {
          updateCartItemQuantity(id, item.quantity - 1);
        }
        return;
      }
    });

    // Mudança no checkbox do item
    drawerBody.addEventListener('change', (e) => {
      if (e.target.classList.contains('cart-item-checkbox')) {
        const id = e.target.getAttribute('data-product-id');
        if (id) {
          if (e.target.checked) {
            selectedCartProductIds.add(id);
          } else {
            selectedCartProductIds.delete(id);
          }
          renderCartDrawer();
        }
      } else if (e.target.classList.contains('cart-qty-input')) {
        const id = e.target.getAttribute('data-product-id');
        const val = parseInt(e.target.value, 10);
        if (id && !isNaN(val)) {
          updateCartItemQuantity(id, val);
        } else {
          renderCartDrawer();
        }
      }
    });
  }

  // 6. Selecionar Todos / Desmarcar Todos
  const selectAllCheckbox = document.getElementById('cart-select-all');
  if (selectAllCheckbox) {
    selectAllCheckbox.addEventListener('change', (e) => {
      const isChecked = e.target.checked;
      selectedCartProductIds.clear();

      if (isChecked) {
        cartItems.forEach((item) => {
          const product = publicCatalogProducts.find((p) => p.id === item.productId);
          if (product && product.active && (product.stock || 0) > 0) {
            selectedCartProductIds.add(item.productId);
          }
        });
      }
      renderCartDrawer();
    });
  }

  // 7. Remover Selecionados em Massa
  const removeSelectedBtn = document.getElementById('cart-remove-selected-btn');
  if (removeSelectedBtn) {
    removeSelectedBtn.addEventListener('click', removeSelectedCartItems);
  }

  // 8. Botão Finalizar Pedido no Drawer -> Abre Revisão
  const proceedBtn = document.getElementById('cart-btn-proceed');
  if (proceedBtn) {
    proceedBtn.addEventListener('click', openOrderReviewModal);
  }

  // 9. Eventos do Modal de Revisão
  const reviewCloseBtn = document.getElementById('order-review-close');
  if (reviewCloseBtn) {
    reviewCloseBtn.addEventListener('click', closeOrderReviewModal);
  }

  const reviewBackBtn = document.getElementById('order-review-btn-back');
  if (reviewBackBtn) {
    reviewBackBtn.addEventListener('click', () => {
      closeOrderReviewModal();
      openCartDrawer();
    });
  }

  const reviewBackdrop = document.getElementById('order-review-backdrop');
  if (reviewBackdrop) {
    reviewBackdrop.addEventListener('click', (e) => {
      if (e.target === reviewBackdrop) closeOrderReviewModal();
    });
  }

  // 10. Submissão do Checkout
  const submitCheckoutBtn = document.getElementById('order-review-btn-submit');
  if (submitCheckoutBtn) {
    submitCheckoutBtn.addEventListener('click', submitOrderCheckout);
  }

  // 11. Eventos do Modal de Sucesso
  const successCloseBtn = document.getElementById('order-success-close');
  if (successCloseBtn) {
    successCloseBtn.addEventListener('click', closeOrderSuccessModal);
  }

  const successDoneBtn = document.getElementById('order-success-btn-done');
  if (successDoneBtn) {
    successDoneBtn.addEventListener('click', closeOrderSuccessModal);
  }

  const successBackdrop = document.getElementById('order-success-backdrop');
  if (successBackdrop) {
    successBackdrop.addEventListener('click', (e) => {
      if (e.target === successBackdrop) closeOrderSuccessModal();
    });
  }

  // 12. Eventos do Modal de Tracking
  const trackingCloseBtn = document.getElementById('order-tracking-close');
  if (trackingCloseBtn) {
    trackingCloseBtn.addEventListener('click', closeOrderTrackingModal);
  }

  const trackingDoneBtn = document.getElementById('order-tracking-btn-close');
  if (trackingDoneBtn) {
    trackingDoneBtn.addEventListener('click', closeOrderTrackingModal);
  }

  const trackingBackdrop = document.getElementById('order-tracking-backdrop');
  if (trackingBackdrop) {
    trackingBackdrop.addEventListener('click', (e) => {
      if (e.target === trackingBackdrop) closeOrderTrackingModal();
    });
  }

  // 13. Acessibilidade por Teclado (Escape para todos os Modais)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const ordersEl = document.getElementById('customer-orders-backdrop');
      if (ordersEl && ordersEl.style.display === 'flex') {
        closeCustomerOrdersModal();
        return;
      }
      const trackEl = document.getElementById('order-tracking-backdrop');
      if (trackEl && trackEl.style.display === 'flex') {
        closeOrderTrackingModal();
        return;
      }
      const successEl = document.getElementById('order-success-backdrop');
      if (successEl && successEl.style.display === 'flex') {
        closeOrderSuccessModal();
        return;
      }
      const revEl = document.getElementById('order-review-backdrop');
      if (revEl && revEl.style.display === 'flex') {
        closeOrderReviewModal();
        return;
      }
      const cartEl = document.getElementById('cart-drawer-backdrop');
      if (cartEl && cartEl.style.display === 'block') {
        closeCartDrawer();
      }
    }
  });

  // 14. Eventos de Meus Pedidos (Etapa 3N.3)
  const openOrdersBtn = document.getElementById('open-my-orders-btn');
  if (openOrdersBtn) {
    openOrdersBtn.addEventListener('click', openCustomerOrdersModal);
  }

  const closeOrdersBtn = document.getElementById('customer-orders-close');
  if (closeOrdersBtn) {
    closeOrdersBtn.addEventListener('click', closeCustomerOrdersModal);
  }

  const closeOrdersActionBtn = document.getElementById('customer-orders-btn-close');
  if (closeOrdersActionBtn) {
    closeOrdersActionBtn.addEventListener('click', closeCustomerOrdersModal);
  }

  const ordersBackdrop = document.getElementById('customer-orders-backdrop');
  if (ordersBackdrop) {
    ordersBackdrop.addEventListener('click', (e) => {
      if (e.target === ordersBackdrop) closeCustomerOrdersModal();
    });
  }

  const clearOrdersBtn = document.getElementById('customer-orders-btn-clear');
  if (clearOrdersBtn) {
    clearOrdersBtn.addEventListener('click', clearCustomerOrdersLocalHistory);
  }

  // 15. Listener para mudanças no hash de tracking (#pedido=...&token=...)
  window.addEventListener('hashchange', checkAndHandleUrlTracking);
  checkAndHandleUrlTracking();
}

// Expõe helpers globais de forma limpa para depuração e extensibilidade
window.MascotCarData = {
  client: supabaseClient,
  getProducts: fetchProductsFromSupabase,
  getCategories: fetchCategoriesFromSupabase,
  loadCatalog: loadCatalog,
  renderCatalog: renderPublicCatalog,
  populateTopCategoriesBar: populateTopCategoriesBar,
  setCategoryFilter: setCategoryFilter,
  resetFilters: resetPublicCatalogFilters,
  openDetailModal: openProductDetailModal,
  closeDetailModal: closeProductDetailModal,
  // Métodos da Minha Lista (Etapa 3M)
  getCart: () => [...cartItems],
  addToCart: addToCart,
  updateCartQuantity: updateCartItemQuantity,
  removeCartItem: removeCartItem,
  openCart: openCartDrawer,
  closeCart: closeCartDrawer,
  openReview: openOrderReviewModal,
  closeReview: closeOrderReviewModal,
  // Métodos de Meus Pedidos (Etapa 3N.3)
  openMyOrders: openCustomerOrdersModal,
  closeMyOrders: closeCustomerOrdersModal
};

// Executa o carregamento quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
  initCatalogEvents();
  initCartEvents();
  syncCartWithCatalog();
  loadCatalog();
});
