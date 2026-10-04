/**
 * MascotCar — Configuração e Integração com Supabase
 * Responsável pela conexão segura com a API pública do Supabase e
 * carregamento dinâmico dos produtos da tabela public.products.
 *
 * ⚠️ SEGURANÇA:
 * - Apenas a chave pública (Publishable / Anon Key) é permitida no frontend.
 * - NUNCA inclua 'service_role' ou segredos de banco de dados neste arquivo.
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

/**
 * Consulta a tabela public.products no Supabase via SELECT.
 * Não realiza operações de escrita (INSERT, UPDATE ou DELETE).
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
      .select('*, categories(*)');

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

/**
 * Gera o markup HTML de um produto com os campos oficiais:
 * name, description, price, image_url e stock.
 *
 * @param {Object} product
 * @returns {string}
 */
function buildProductCardHTML(product) {
  const name = product.name || 'Mascote MascotCar';
  const desc = product.description || 'Aromatizador veicular personalizado com fragrância duradoura.';
  
  // Formatação de preço (BRL)
  let formattedPrice = 'R$ --,--';
  if (typeof product.price === 'number') {
    formattedPrice = product.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  } else if (product.price) {
    formattedPrice = `R$ ${product.price}`;
  }

  const stock = typeof product.stock === 'number' ? product.stock : 0;
  const inStock = stock > 0;

  // Categoria obtida do relacionamento ou fallback
  const categorySlug = (product.categories && product.categories.slug)
    ? product.categories.slug
    : (product.category || 'animais').toLowerCase();

  const categoryLabel = (product.categories && product.categories.name)
    ? product.categories.name
    : (product.category || 'Mascote');

  // Imagem real ou placeholder estilizado
  const imageMarkup = product.image_url
    ? `<img src="${product.image_url}" alt="${name}" class="product-card__img" style="width:100%;height:100%;object-fit:cover;" onerror="this.onerror=null;this.parentElement.innerHTML='<div class=\'product-card__placeholder\'><span>🚗</span></div>';">`
    : `<div class="product-card__placeholder"><span>🚗</span></div>`;

  return `
    <article class="product-card" data-category="${categorySlug}">
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
          <button class="btn btn--primary btn--sm" ${inStock ? '' : 'disabled'}>
            ${inStock ? 'Comprar' : 'Esgotado'}
          </button>
        </div>
      </div>
    </article>
  `;
}

/**
 * Carrega e renderiza os produtos reais da tabela public.products.
 * Mantém os produtos de teste existentes se houver falha de rede ou pendência de RLS.
 */
async function loadCatalog() {
  const grid = document.getElementById('products-grid');
  if (!grid) return;

  const result = await fetchProductsFromSupabase();

  if (result.success) {
    const products = result.data;
    console.info(`✅ [MascotCar] Conexão com Supabase OK! Produtos encontrados: ${products.length}`);

    if (products.length === 0) {
      // Caso não haja produtos cadastrados no banco
      grid.innerHTML = `
        <div class="products-empty-state" style="grid-column: 1 / -1; text-align: center; padding: 3.5rem 1.5rem; background: var(--color-bg-alt); border: 2px dashed var(--color-border); border-radius: var(--radius-lg);">
          <span style="font-size: 3rem; display: block; margin-bottom: 0.5rem;">📦</span>
          <h3 style="font-size: 1.25rem; font-weight: 700; color: var(--color-secondary); margin-bottom: 0.5rem;">Nenhum produto cadastrado no momento</h3>
          <p style="color: var(--color-text-muted); font-size: 0.95rem; max-width: 480px; margin: 0 auto;">Nosso estoque está sendo abastecido no Supabase. Volte em breve!</p>
        </div>
      `;
      return;
    }

    // Renderiza os produtos reais do Supabase
    grid.innerHTML = products.map(buildProductCardHTML).join('');

    // Atualiza subtítulo informando produtos reais
    const subtitle = document.querySelector('#produtos .section-subtitle');
    if (subtitle) {
      const countText = products.length === 1 ? '1 produto disponível' : `${products.length} produtos disponíveis`;
      subtitle.textContent = `Catálogo oficial conectado via Supabase (${countText})`;
    }

    // Atualiza visibilidade dos novos cards
    grid.querySelectorAll('.product-card').forEach((el) => {
      el.style.opacity = '1';
      el.style.transform = 'translateY(0)';
    });

  } else {
    // Tratamento de erro (ex: RLS pendente ou falha de conexão)
    console.warn('⚠️ [MascotCar] Não foi possível obter os produtos de public.products:', result.error.message || result.error);
    console.info('💡 Dica: Aplique a política RLS no painel do Supabase para que a chave pública (anon) possa ler public.products.');
    console.info('ℹ️ [MascotCar] Mantendo os produtos de teste visíveis para validação contínua da interface.');

    // Mantém os produtos de teste no grid sem quebrar o layout
    const subtitle = document.querySelector('#produtos .section-subtitle');
    if (subtitle && result.error.code === '42501') {
      subtitle.textContent = '⚠️ Modo de teste — Produtos demonstrativos (Aguardando liberação de RLS no Supabase)';
    }
  }
}

// Expõe helpers globais de forma limpa para depuração e extensibilidade
window.MascotCarData = {
  client: supabaseClient,
  getProducts: fetchProductsFromSupabase,
  getCategories: fetchCategoriesFromSupabase,
  loadCatalog: loadCatalog
};

// Executa o carregamento quando o DOM estiver pronto
document.addEventListener('DOMContentLoaded', () => {
  loadCatalog();
});
