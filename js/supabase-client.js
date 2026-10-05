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
    ? `<img src="${escapeHTML(product.image_url)}" alt="${name}" class="product-card__img" style="width:100%;height:100%;object-fit:cover;">`
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

function openProductDetailModal(productId) {
  const product = publicCatalogProducts.find((p) => p.id === productId);
  if (!product) return;

  const modalEl = document.getElementById('product-detail-modal');
  if (!modalEl) return;

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

  modalEl.style.display = 'flex';
  requestAnimationFrame(() => {
    modalEl.classList.add('is-open');
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
  closeDetailModal: closeProductDetailModal
};

// Executa o carregamento quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
  initCatalogEvents();
  loadCatalog();
});
