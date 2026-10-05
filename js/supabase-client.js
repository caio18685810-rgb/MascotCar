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
  return `https://wa.me/?text=${textMsg}`;
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
  const reviewSummary = document.getElementById('order-review-summary');
  const sendBtn = document.getElementById('order-review-btn-send');

  if (!reviewBackdrop || !reviewBody || !reviewSummary || !sendBtn) return;

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

  reviewSummary.innerHTML = `
    <span class="order-review-summary__label">${totalUnits} ${totalUnits === 1 ? 'item' : 'itens'} selecionados</span>
    <span class="order-review-summary__total">${formatCurrency(totalPrice)}</span>
  `;

  // Prepara link oficial sem inventar número comercial
  const waMsg = buildWhatsAppOrderMessage(selectedItems);
  sendBtn.href = `https://wa.me/?text=${encodeURIComponent(waMsg)}`;

  closeCartDrawer();
  reviewBackdrop.style.display = 'flex';

  requestAnimationFrame(() => {
    reviewBackdrop.classList.add('is-open');
    const closeBtn = document.getElementById('order-review-close');
    if (closeBtn && typeof closeBtn.focus === 'function') {
      closeBtn.focus();
    }
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

  // 10. Acessibilidade por Teclado (Escape para Drawer e Revisão)
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
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
  closeReview: closeOrderReviewModal
};

// Executa o carregamento quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
  initCatalogEvents();
  initCartEvents();
  syncCartWithCatalog();
  loadCatalog();
});
