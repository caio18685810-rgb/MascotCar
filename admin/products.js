/**
 * MascotCar — Gestão e Listagem de Produtos no Painel Administrativo
 * Responsável por buscar, renderizar, cadastrar, editar e visualizar imagens dos produtos.
 *
 * ⚠️ SEGURANÇA E REGRAS:
 * - Reutiliza a instância autenticada de window.supabaseClient.
 * - Respeita o RLS e a função is_admin() no banco.
 * - Não utiliza chaves secretas ou service_role.
 * - Não executa DELETE ou UPDATE de arquivos no Storage nesta etapa.
 * - Não altera tabelas ou schemas no Supabase.
 */

'use strict';

(function () {
  // Armazena em memória os produtos carregados para acesso rápido na edição e visualização
  let loadedProducts = [];

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
   * Escapa caracteres HTML para prevenir injeção (XSS).
   * @param {string} str
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
   * Formata valores numéricos para o padrão de moeda brasileiro (R$).
   * @param {number|string} val
   * @returns {string}
   */
  function formatPrice(val) {
    const num = Number(val);
    if (isNaN(num)) return 'R$ 0,00';
    return num.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }

  /**
   * Realiza a consulta de produtos ao Supabase.
   * Busca todos os produtos (ativos e inativos) ordenados por data de criação.
   * Tenta incluir o relacionamento com a tabela categories.
   *
   * @returns {Promise<{success: boolean, data?: Array, error?: any}>}
   */
  async function fetchProducts() {
    const client = getClient();
    if (!client) {
      return { success: false, error: { message: 'Cliente Supabase não inicializado.' } };
    }

    try {
      // 1. Tenta consulta com relacionamento de categories
      const { data, error } = await client
        .from('products')
        .select('id, name, description, price, image_url, stock, active, category_id, created_at, categories(id, name)')
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        return { success: true, data };
      }

      // Se houver erro de relacionamento de FK, faz fallback para consulta simples
      console.warn('⚠️ [MascotCar Products] Consulta com categories falhou, tentando fallback simples:', error);
      const fallbackResult = await client
        .from('products')
        .select('id, name, description, price, image_url, stock, active, category_id, created_at')
        .order('created_at', { ascending: false });

      if (fallbackResult.error) {
        return { success: false, error: fallbackResult.error };
      }

      return { success: true, data: fallbackResult.data || [] };
    } catch (err) {
      console.error('❌ [MascotCar Products] Erro inesperado ao buscar produtos:', err);
      return { success: false, error: err };
    }
  }

  /**
   * Consulta a tabela categories para preencher selects de categorias.
   * @returns {Promise<Array>}
   */
  async function fetchCategories() {
    const client = getClient();
    if (!client) return [];

    try {
      const { data, error } = await client
        .from('categories')
        .select('id, name')
        .order('name', { ascending: true });

      if (error) {
        console.warn('⚠️ [MascotCar Products] Erro ao carregar categorias:', error.message);
        return [];
      }
      return data || [];
    } catch (err) {
      console.warn('⚠️ [MascotCar Products] Falha inesperada ao carregar categorias:', err);
      return [];
    }
  }

  /**
   * Preenche o campo select de categorias no modal informado.
   * @param {string} selectId
   * @param {string|null} selectedValue
   */
  async function populateCategoriesSelect(selectId = 'create-category', selectedValue = null) {
    const selectEl = document.getElementById(selectId);
    if (!selectEl) return;

    const categories = await fetchCategories();
    selectEl.innerHTML = '<option value="">Sem categoria</option>';

    categories.forEach((cat) => {
      const option = document.createElement('option');
      option.value = cat.id;
      option.textContent = cat.name;
      if (selectedValue && cat.id === selectedValue) {
        option.selected = true;
      }
      selectEl.appendChild(option);
    });
  }

  /**
   * Busca todas as imagens associadas ao produto:
   * 1. A imagem principal registrada em products.image_url.
   * 2. Outras imagens associadas no bucket products que correspondam ao ID do produto.
   *
   * @param {string} productId
   * @param {string|null} primaryUrl
   * @returns {Promise<Array<{url: string, isPrimary: boolean, name: string}>>}
   */
  async function fetchProductImages(productId, primaryUrl) {
    const client = getClient();
    const images = [];

    // Adiciona a imagem principal cadastrada
    if (primaryUrl && typeof primaryUrl === 'string' && primaryUrl.trim() !== '') {
      images.push({
        url: primaryUrl.trim(),
        isPrimary: true,
        name: 'Imagem Principal'
      });
    }

    // Busca arquivos no bucket que comecem com o identificador do produto
    if (client && productId) {
      try {
        const { data: files, error } = await client.storage
          .from('products')
          .list('', { search: `prod-${productId}` });

        if (!error && Array.isArray(files)) {
          files.forEach((file) => {
            const { data: urlData } = client.storage
              .from('products')
              .getPublicUrl(file.name);
            const fileUrl = urlData?.publicUrl;
            // Evita duplicar se for idêntica à URL principal
            if (fileUrl && (!primaryUrl || fileUrl.trim() !== primaryUrl.trim())) {
              images.push({
                url: fileUrl,
                isPrimary: false,
                name: file.name
              });
            }
          });
        }
      } catch (err) {
        console.warn('⚠️ [MascotCar] Erro ao listar imagens associadas no Storage:', err);
      }
    }

    return images;
  }

  /**
   * Controla a exibição dos estados da seção de produtos.
   */
  const UI = {
    loading: () => document.getElementById('products-loading'),
    error: () => document.getElementById('products-error'),
    errorMessage: () => document.getElementById('products-error-message'),
    empty: () => document.getElementById('products-empty'),
    content: () => document.getElementById('products-content'),
    tableBody: () => document.getElementById('products-table-body'),
    countBadge: () => document.getElementById('products-count-badge'),

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
   * Renderiza as linhas da tabela com os produtos carregados.
   * @param {Array} products
   */
  function renderProductsTable(products) {
    loadedProducts = Array.isArray(products) ? products : [];
    const tbody = UI.tableBody();
    const countBadge = UI.countBadge();

    if (countBadge) {
      const total = loadedProducts.length;
      countBadge.textContent = `${total} ${total === 1 ? 'produto' : 'produtos'}`;
    }

    if (!tbody) return;
    tbody.innerHTML = '';

    loadedProducts.forEach((prod) => {
      const tr = document.createElement('tr');

      // Categoria (resolvida pelo relacionamento ou fallback)
      let categoryName = 'Sem categoria';
      if (prod.categories && prod.categories.name) {
        categoryName = prod.categories.name;
      }

      // Imagem e fallback
      const hasImage = Boolean(prod.image_url && typeof prod.image_url === 'string' && prod.image_url.trim() !== '');
      const imageUrl = hasImage ? escapeHtml(prod.image_url.trim()) : '';

      // Status Ativo / Inativo
      const isActive = prod.active === true;
      const statusBadge = isActive
        ? '<span class="status-badge status-active"><span class="status-dot"></span>Ativo</span>'
        : '<span class="status-badge status-inactive"><span class="status-dot"></span>Inativo</span>';

      // Estoque
      const stockNum = Number(prod.stock);
      const isOutOfStock = isNaN(stockNum) || stockNum <= 0;
      const stockBadge = isOutOfStock
        ? '<span class="stock-badge stock-zero">0 un. (Esgotado)</span>'
        : `<span class="stock-badge stock-ok">${stockNum} un.</span>`;

      // Miniatura clicável para abrir no Lightbox
      const thumbHtml = hasImage
        ? `<div 
            class="product-thumb product-thumb-clickable" 
            data-lightbox-url="${imageUrl}" 
            data-lightbox-title="${escapeHtml(prod.name || 'Produto')}" 
            data-lightbox-badge="Imagem Principal" 
            title="Clique para ampliar a imagem"
          >
            <img 
              src="${imageUrl}" 
              alt="${escapeHtml(prod.name || 'Produto')}" 
              loading="lazy" 
              onerror="this.onerror=null; this.parentElement.classList.remove('product-thumb-clickable'); this.parentElement.innerHTML='<span class=\\'thumb-placeholder\\'>🚗</span>';"
            >
          </div>`
        : `<div class="product-thumb" title="Sem imagem cadastrada">
            <span class="thumb-placeholder">🚗</span>
          </div>`;

      tr.innerHTML = `
        <td class="col-thumb">
          ${thumbHtml}
        </td>
        <td class="col-name">
          <strong class="product-name">${escapeHtml(prod.name || 'Sem nome')}</strong>
          ${
            prod.description
              ? `<p class="product-desc-preview" title="${escapeHtml(prod.description)}">${escapeHtml(prod.description)}</p>`
              : ''
          }
        </td>
        <td class="col-category">
          <span class="category-pill">${escapeHtml(categoryName)}</span>
        </td>
        <td class="col-price">
          <strong class="product-price">${formatPrice(prod.price)}</strong>
        </td>
        <td class="col-stock">
          ${stockBadge}
        </td>
        <td class="col-status">
          ${statusBadge}
        </td>
        <td class="col-actions">
          <button 
            type="button" 
            class="btn btn-secondary btn-sm btn-edit-product" 
            data-id="${escapeHtml(prod.id)}" 
            title="Editar dados do produto"
          >
            ✏️ Editar
          </button>
        </td>
      `;

      tbody.appendChild(tr);
    });
  }

  /**
   * Carrega os produtos do Supabase e atualiza a interface.
   */
  async function loadProducts() {
    UI.showOnly('loading');

    const result = await fetchProducts();

    if (!result.success) {
      const errorMsg = result.error?.message || 'Falha ao carregar os produtos do banco de dados.';
      const msgEl = UI.errorMessage();
      if (msgEl) {
        msgEl.textContent = errorMsg;
      }
      UI.showOnly('error');
      return;
    }

    const products = result.data || [];

    if (products.length === 0) {
      const countBadge = UI.countBadge();
      if (countBadge) countBadge.textContent = '0 produtos';
      UI.showOnly('empty');
      return;
    }

    renderProductsTable(products);
    UI.showOnly('content');
  }

  // --------------------------------------------------------------------------
  // Controle do Lightbox Modal (Etapa 3D)
  // --------------------------------------------------------------------------

  function getLightboxElements() {
    return {
      modal: document.getElementById('image-lightbox-modal'),
      img: document.getElementById('lightbox-img'),
      caption: document.getElementById('lightbox-caption'),
      closeBtn: document.getElementById('lightbox-close-btn')
    };
  }

  /**
   * Abre o Lightbox para exibição em tamanho grande.
   * @param {string} url
   * @param {string} title
   * @param {string} badgeText
   */
  function openLightbox(url, title = 'Produto', badgeText = '') {
    const { modal, img, caption } = getLightboxElements();
    if (!modal || !img || !url) return;

    img.src = url;
    img.alt = title;

    if (caption) {
      caption.innerHTML = `
        ${badgeText ? `<span class="image-badge-primary" style="position: static; font-size: 0.7rem; padding: 0.2rem 0.5rem;">${escapeHtml(badgeText)}</span>` : ''}
        <span>${escapeHtml(title)}</span>
      `;
    }

    modal.style.display = 'flex';
  }

  /**
   * Fecha o Lightbox modal.
   */
  function closeLightbox() {
    const { modal, img } = getLightboxElements();
    if (!modal) return;
    modal.style.display = 'none';
    if (img) img.src = '';
  }

  // --------------------------------------------------------------------------
  // Controle do Modal de Cadastro de Produto
  // --------------------------------------------------------------------------

  function getCreateModalElements() {
    return {
      modal: document.getElementById('modal-create-product'),
      form: document.getElementById('form-create-product'),
      alert: document.getElementById('create-product-alert'),
      submitBtn: document.getElementById('btn-submit-create'),
      nameInput: document.getElementById('create-name'),
      descInput: document.getElementById('create-description'),
      priceInput: document.getElementById('create-price'),
      stockInput: document.getElementById('create-stock'),
      categorySelect: document.getElementById('create-category'),
      imageInput: document.getElementById('create-image'),
      activeCheckbox: document.getElementById('create-active')
    };
  }

  function showCreateModalAlert(message, type = 'error') {
    const { alert } = getCreateModalElements();
    if (!alert) return;
    alert.textContent = message;
    alert.className = `alert alert-${type}`;
    alert.style.display = 'block';
  }

  function hideCreateModalAlert() {
    const { alert } = getCreateModalElements();
    if (!alert) return;
    alert.style.display = 'none';
  }

  function openCreateModal() {
    const { modal, form, nameInput } = getCreateModalElements();
    if (!modal) return;

    if (form) form.reset();
    hideCreateModalAlert();
    populateCategoriesSelect('create-category');

    modal.style.display = 'flex';
    if (nameInput) {
      setTimeout(() => nameInput.focus(), 50);
    }
  }

  function closeCreateModal() {
    const { modal, form } = getCreateModalElements();
    if (!modal) return;
    modal.style.display = 'none';
    if (form) form.reset();
    hideCreateModalAlert();
  }

  /**
   * Valida os campos do formulário antes de enviar ao Supabase.
   * @param {Object} data
   * @returns {{isValid: boolean, error?: string}}
   */
  function validateFormData(data) {
    if (!data.name || data.name.trim() === '') {
      return { isValid: false, error: 'O nome do produto é obrigatório.' };
    }

    const priceNum = parseFloat(data.price);
    if (isNaN(priceNum) || priceNum <= 0) {
      return { isValid: false, error: 'O preço deve ser um valor numérico maior que zero.' };
    }

    const stockNum = Number(data.stock);
    if (isNaN(stockNum) || !Number.isInteger(stockNum) || stockNum < 0) {
      return { isValid: false, error: 'O estoque deve ser um número inteiro maior ou igual a zero.' };
    }

    if (data.imageFile) {
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!allowedTypes.includes(data.imageFile.type)) {
        return {
          isValid: false,
          error: 'Formato de imagem inválido. Aceitos somente JPEG, PNG ou WebP.'
        };
      }

      const maxBytes = 5 * 1024 * 1024; // 5 MB
      if (data.imageFile.size > maxBytes) {
        return {
          isValid: false,
          error: 'A imagem excede o tamanho máximo permitido de 5 MB.'
        };
      }
    }

    return { isValid: true };
  }

  /**
   * Fluxo de cadastro de produto:
   * 1. Valida os dados do formulário.
   * 2. Cria primeiro o registro em public.products sem image_url.
   * 3. Obtém o ID do produto criado.
   * 4. Se houver imagem:
   *    - Faz upload para o bucket products com caminho único baseado no ID.
   *    - Obtém a URL pública.
   *    - Atualiza image_url do produto via UPDATE.
   *    - Se o upload falhar, mantém o produto cadastrado e informa o erro.
   * 5. Atualiza a listagem automaticamente.
   */
  async function handleCreateProductSubmit(e) {
    e.preventDefault();
    hideCreateModalAlert();

    const client = getClient();
    if (!client) {
      showCreateModalAlert('Cliente Supabase não inicializado.', 'error');
      return;
    }

    const {
      nameInput,
      descInput,
      priceInput,
      stockInput,
      categorySelect,
      imageInput,
      activeCheckbox,
      submitBtn
    } = getCreateModalElements();

    const name = nameInput ? nameInput.value.trim() : '';
    const description = descInput ? descInput.value.trim() : '';
    const price = priceInput ? priceInput.value : '';
    const stock = stockInput ? stockInput.value : '';
    const categoryId = categorySelect && categorySelect.value ? categorySelect.value : null;
    const isActive = activeCheckbox ? activeCheckbox.checked : true;
    const imageFile = imageInput && imageInput.files && imageInput.files[0] ? imageInput.files[0] : null;

    // 1. Validação dos dados
    const validation = validateFormData({ name, price, stock, imageFile });
    if (!validation.isValid) {
      showCreateModalAlert(validation.error, 'error');
      return;
    }

    // Trava o botão e exibe estado de carregamento
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Criando produto...</span>';
    }

    try {
      // 2. Cria primeiro o registro em products sem image_url
      const insertPayload = {
        name,
        description: description || null,
        price: parseFloat(price),
        stock: parseInt(stock, 10),
        category_id: categoryId,
        active: Boolean(isActive),
        image_url: null
      };

      const { data: createdProduct, error: insertError } = await client
        .from('products')
        .insert([insertPayload])
        .select('id')
        .single();

      if (insertError || !createdProduct) {
        showCreateModalAlert(insertError?.message || 'Falha ao salvar produto no banco de dados.', 'error');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Cadastrar Produto</span>';
        }
        return;
      }

      const productId = createdProduct.id;

      // 3. Se NÃO houver imagem, finaliza o cadastro com sucesso
      if (!imageFile) {
        showCreateModalAlert('Produto cadastrado com sucesso!', 'success');
        setTimeout(() => {
          closeCreateModal();
          loadProducts();
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>Cadastrar Produto</span>';
          }
        }, 600);
        return;
      }

      // 4. Se houver imagem, inicia o upload para o Storage
      if (submitBtn) {
        submitBtn.innerHTML = '<span>Enviando imagem...</span>';
      }

      const ext = imageFile.name.split('.').pop().toLowerCase();
      const safePath = `prod-${productId}-${Date.now()}.${ext}`;

      const { error: uploadError } = await client.storage
        .from('products')
        .upload(safePath, imageFile, {
          cacheControl: '3600',
          upsert: false
        });

      if (uploadError) {
        console.warn('⚠️ [MascotCar Storage] Upload da imagem falhou:', uploadError);
        showCreateModalAlert(
          `Produto criado com sucesso, mas o upload da imagem falhou: ${uploadError.message}. O produto foi salvo sem imagem.`,
          'warning'
        );
        loadProducts();
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Cadastrar Produto</span>';
        }
        return;
      }

      // 5. Obter a URL pública da imagem recém-enviada
      const { data: publicUrlData } = client.storage
        .from('products')
        .getPublicUrl(safePath);

      const publicUrl = publicUrlData?.publicUrl || null;

      if (publicUrl) {
        if (submitBtn) {
          submitBtn.innerHTML = '<span>Vinculando imagem...</span>';
        }

        // 6. Atualiza o image_url do produto
        const { error: updateError } = await client
          .from('products')
          .update({ image_url: publicUrl })
          .eq('id', productId);

        if (updateError) {
          console.warn('⚠️ [MascotCar Products] Falha ao atualizar image_url:', updateError);
          showCreateModalAlert(
            `Produto e imagem enviados, mas ocorreu um erro ao salvar a URL da imagem: ${updateError.message}`,
            'warning'
          );
          loadProducts();
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<span>Cadastrar Produto</span>';
          }
          return;
        }
      }

      // Sucesso completo com imagem
      showCreateModalAlert('Produto e imagem cadastrados com sucesso!', 'success');
      setTimeout(() => {
        closeCreateModal();
        loadProducts();
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Cadastrar Produto</span>';
        }
      }, 600);

    } catch (err) {
      console.error('❌ [MascotCar Products] Erro inesperado ao cadastrar produto:', err);
      showCreateModalAlert('Ocorreu um erro inesperado ao cadastrar o produto.', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Cadastrar Produto</span>';
      }
    }
  }

  // --------------------------------------------------------------------------
  // Controle do Modal de Edição de Produto (Etapas 3C e 3D)
  // --------------------------------------------------------------------------

  function getEditModalElements() {
    return {
      modal: document.getElementById('modal-edit-product'),
      form: document.getElementById('form-edit-product'),
      alert: document.getElementById('edit-product-alert'),
      submitBtn: document.getElementById('btn-submit-edit'),
      idInput: document.getElementById('edit-id'),
      nameInput: document.getElementById('edit-name'),
      descInput: document.getElementById('edit-description'),
      priceInput: document.getElementById('edit-price'),
      stockInput: document.getElementById('edit-stock'),
      categorySelect: document.getElementById('edit-category'),
      activeCheckbox: document.getElementById('edit-active'),
      imageViewerContainer: document.getElementById('product-image-viewer'),
      btnRemoveImage: document.getElementById('btn-remove-image')
    };
  }

  function showEditModalAlert(message, type = 'error') {
    const { alert } = getEditModalElements();
    if (!alert) return;
    alert.textContent = message;
    alert.className = `alert alert-${type}`;
    alert.style.display = 'block';
  }

  function hideEditModalAlert() {
    const { alert } = getEditModalElements();
    if (!alert) return;
    alert.style.display = 'none';
  }

  /**
   * Renderiza o componente de visualização e galeria de imagens no modal de edição.
   * @param {Array<{url: string, isPrimary: boolean, name: string}>} images
   * @param {string} productName
   */
  function renderImageViewer(images, productName) {
    const { imageViewerContainer } = getEditModalElements();
    if (!imageViewerContainer) return;

    if (!images || images.length === 0) {
      imageViewerContainer.innerHTML = `
        <div class="image-viewer-stage">
          <div class="image-viewer-placeholder">
            <span class="icon">🚗</span>
            <span>Nenhuma imagem vinculada a este produto.</span>
          </div>
        </div>
      `;
      return;
    }

    // Inicialmente, a imagem ativa é a principal (primeira do array)
    let activeIndex = 0;

    function updateStage() {
      const activeImg = images[activeIndex];
      const badgeText = activeImg.isPrimary ? '★ Imagem Principal' : 'Imagem Adicional';
      const badgeClass = activeImg.isPrimary ? 'image-badge-primary' : 'image-badge-secondary';

      let galleryHtml = '';
      if (images.length > 1) {
        galleryHtml = `
          <div class="image-viewer-gallery" role="tablist" aria-label="Galeria de imagens do produto">
            ${images
              .map(
                (img, idx) => `
                <button 
                  type="button" 
                  class="gallery-thumb ${idx === activeIndex ? 'is-active' : ''}" 
                  data-gallery-idx="${idx}"
                  title="${escapeHtml(img.isPrimary ? 'Imagem Principal' : 'Imagem ' + (idx + 1))}"
                >
                  <img src="${escapeHtml(img.url)}" alt="${escapeHtml(productName)}" onerror="this.onerror=null; this.parentElement.innerHTML='🚗';">
                  ${img.isPrimary ? '<span class="thumb-star" title="Principal">★</span>' : ''}
                </button>
              `
              )
              .join('')}
          </div>
        `;
      }

      imageViewerContainer.innerHTML = `
        <div class="image-viewer-stage">
          <span class="${badgeClass}">${badgeText}</span>
          <img 
            id="image-stage-current" 
            src="${escapeHtml(activeImg.url)}" 
            alt="${escapeHtml(productName)}" 
            title="Clique para ver em tamanho maior"
            onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\\'image-viewer-placeholder\\'><span class=\\'icon\\'>🚗</span><span>Erro ao carregar imagem.</span></div>';"
          >
          <button type="button" class="image-zoom-hint" id="btn-zoom-stage" title="Ampliar imagem">
            <span>🔍 Ampliar</span>
          </button>
        </div>
        ${galleryHtml}
      `;

      // Evento de zoom na imagem do palco
      const stageImg = document.getElementById('image-stage-current');
      const zoomBtn = document.getElementById('btn-zoom-stage');
      const triggerZoom = () => {
        openLightbox(activeImg.url, productName, badgeText);
      };

      if (stageImg) stageImg.addEventListener('click', triggerZoom);
      if (zoomBtn) zoomBtn.addEventListener('click', triggerZoom);

      // Evento de troca de miniatura na galeria
      const galleryButtons = imageViewerContainer.querySelectorAll('.gallery-thumb');
      galleryButtons.forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const idx = parseInt(btn.getAttribute('data-gallery-idx'), 10);
          if (!isNaN(idx) && idx !== activeIndex) {
            activeIndex = idx;
            updateStage();
          }
        });
      });
    }

    updateStage();
  }

  /**
   * Abre o modal de edição e carrega os dados atuais do produto selecionado.
   * @param {string} productId
   */
  async function openEditModal(productId) {
    const {
      modal,
      form,
      idInput,
      nameInput,
      descInput,
      priceInput,
      stockInput,
      categorySelect,
      activeCheckbox,
      imageViewerContainer
    } = getEditModalElements();

    if (!modal) return;

    hideEditModalAlert();
    if (form) form.reset();

    const prod = loadedProducts.find((p) => p.id === productId);
    if (!prod) {
      console.warn('⚠️ [MascotCar Edit] Produto não encontrado em memória:', productId);
      return;
    }

    // Preenche os campos do formulário
    if (idInput) idInput.value = prod.id;
    if (nameInput) nameInput.value = prod.name || '';
    if (descInput) descInput.value = prod.description || '';
    if (priceInput) priceInput.value = prod.price !== null && prod.price !== undefined ? prod.price : '';
    if (stockInput) stockInput.value = prod.stock !== null && prod.stock !== undefined ? prod.stock : 0;
    if (activeCheckbox) activeCheckbox.checked = prod.active === true;

    // Carrega as categorias e seleciona a categoria atual do produto
    await populateCategoriesSelect('edit-category', prod.category_id || null);
    if (categorySelect && prod.category_id) {
      categorySelect.value = prod.category_id;
    }

    // Estado inicial de carregamento da imagem
    if (imageViewerContainer) {
      imageViewerContainer.innerHTML = `
        <div class="image-viewer-stage">
          <div class="image-viewer-placeholder">
            <div class="spinner" style="width: 24px; height: 24px;"></div>
            <span>Carregando visualização da imagem...</span>
          </div>
        </div>
      `;
    }

    modal.style.display = 'flex';
    if (nameInput) {
      setTimeout(() => nameInput.focus(), 50);
    }

    // Configura o botão "Remover Imagem" (Etapa 3E — Fase 2)
    const { btnRemoveImage } = getEditModalElements();
    const hasImage = Boolean(prod.image_url && typeof prod.image_url === 'string' && prod.image_url.trim() !== '');
    if (btnRemoveImage) {
      btnRemoveImage.style.display = hasImage ? 'inline-flex' : 'none';
      btnRemoveImage.disabled = false;
      btnRemoveImage.innerHTML = '<span>🗑️ Remover Imagem</span>';
    }

    // Busca assíncrona das imagens do produto (principal + Storage)
    const images = await fetchProductImages(prod.id, prod.image_url);
    renderImageViewer(images, prod.name || 'Produto');
  }

  function closeEditModal() {
    const { modal, form, btnRemoveImage } = getEditModalElements();
    if (!modal) return;
    modal.style.display = 'none';
    if (form) form.reset();
    if (btnRemoveImage) {
      btnRemoveImage.style.display = 'none';
      btnRemoveImage.disabled = false;
      btnRemoveImage.innerHTML = '<span>🗑️ Remover Imagem</span>';
    }
    hideEditModalAlert();
  }

  /**
   * Extrai com segurança o caminho relativo do objeto no bucket Storage
   * a partir da sua URL pública.
   * @param {string} imageUrl
   * @returns {string|null}
   */
  function extractStoragePath(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') return null;

    try {
      // 1. Remove parâmetros de consulta e hash
      const cleanUrl = imageUrl.split('?')[0].split('#')[0];

      // 2. Busca pelo marcador oficial do Supabase Storage para o bucket 'products'
      const marker = '/storage/v1/object/public/products/';
      const markerIdx = cleanUrl.indexOf(marker);

      let path = '';
      if (markerIdx !== -1) {
        path = cleanUrl.substring(markerIdx + marker.length);
      } else {
        // Fallback para marcadores alternativos de path
        const altMarker = '/products/';
        const altIdx = cleanUrl.lastIndexOf(altMarker);
        if (altIdx !== -1) {
          path = cleanUrl.substring(altIdx + altMarker.length);
        } else {
          path = cleanUrl.substring(cleanUrl.lastIndexOf('/') + 1);
        }
      }

      return decodeURIComponent(path).trim() || null;
    } catch (err) {
      console.warn('⚠️ [MascotCar] Erro ao extrair caminho do Storage:', err);
      return null;
    }
  }

  /**
   * Fluxo seguro de remoção de imagem de produto (Etapa 3E — Fase 2):
   * 1. Confirmação obrigatória do administrador.
   * 2. Identificação segura do caminho do objeto na URL.
   * 3. Atualização no banco de dados PRIMEIRO (products.image_url = null).
   * 4. Exclusão condicional no Storage:
   *    - Bloqueia exclusão da imagem legada protegida ('produto teste.webp').
   *    - Exige que o arquivo pertença ao produto ('prod-${productId}-...').
   * 5. Atualização da interface e listagem.
   */
  async function handleRemoveProductImage() {
    const { idInput, btnRemoveImage, submitBtn } = getEditModalElements();
    const productId = idInput ? idInput.value : '';

    if (!productId) {
      showEditModalAlert('Identificador do produto não encontrado.', 'error');
      return;
    }

    const prod = loadedProducts.find((p) => p.id === productId);
    if (!prod || !prod.image_url) {
      showEditModalAlert('Este produto não possui imagem para ser removida.', 'warning');
      return;
    }

    // 1. Confirmação clara e obrigatória antes de qualquer execução
    const confirmed = window.confirm(
      'Tem certeza que deseja remover a imagem deste produto?\n\nO produto ficará sem imagem.'
    );
    if (!confirmed) return;

    hideEditModalAlert();

    const client = getClient();
    if (!client) {
      showEditModalAlert('Cliente Supabase não inicializado.', 'error');
      return;
    }

    // Feedback visual de carregamento
    if (btnRemoveImage) {
      btnRemoveImage.disabled = true;
      btnRemoveImage.innerHTML = '<span>Removendo...</span>';
    }
    if (submitBtn) {
      submitBtn.disabled = true;
    }

    const currentImageUrl = prod.image_url;
    const storagePath = extractStoragePath(currentImageUrl);

    try {
      // 2. Atualização no banco de dados PRIMEIRO (garante consistência da loja)
      const { error: dbError } = await client
        .from('products')
        .update({ image_url: null })
        .eq('id', productId);

      if (dbError) {
        console.error('❌ [MascotCar] Erro ao desvincular imagem no banco:', dbError);
        showEditModalAlert(dbError.message || 'Falha ao desvincular imagem no banco de dados.', 'error');
        if (btnRemoveImage) {
          btnRemoveImage.disabled = false;
          btnRemoveImage.innerHTML = '<span>🗑️ Remover Imagem</span>';
        }
        if (submitBtn) {
          submitBtn.disabled = false;
        }
        return;
      }

      // 3. Verificações de segurança para exclusão no Storage
      const isLegacyProtected = storagePath === 'produto teste.webp' || currentImageUrl.includes('produto%20teste.webp');
      const isProductPattern = Boolean(storagePath && storagePath.startsWith(`prod-${productId}-`));

      if (isLegacyProtected) {
        console.info('ℹ️ [MascotCar Storage] Imagem legada "produto teste.webp" preservada no Storage por segurança.');
      } else if (!isProductPattern) {
        console.warn(`⚠️ [MascotCar Storage] Arquivo "${storagePath}" não corresponde ao padrão esperado prod-${productId}-*, mantido no Storage.`);
      } else if (storagePath) {
        // Exclusão no Storage autorizada pela policy "Admin pode excluir imagens de produtos"
        const { error: storageError } = await client.storage
          .from('products')
          .remove([storagePath]);

        if (storageError) {
          console.warn('⚠️ [MascotCar Storage] Aviso: Não foi possível apagar o arquivo do Storage:', storageError.message);
        } else {
          console.info(`✔ [MascotCar Storage] Arquivo "${storagePath}" removido com sucesso do Storage.`);
        }
      }

      // 4. Atualiza estado em memória e interface imediatamente
      prod.image_url = null;
      renderImageViewer([], prod.name || 'Produto');

      if (btnRemoveImage) {
        btnRemoveImage.style.display = 'none';
        btnRemoveImage.disabled = false;
        btnRemoveImage.innerHTML = '<span>🗑️ Remover Imagem</span>';
      }

      if (submitBtn) {
        submitBtn.disabled = false;
      }

      showEditModalAlert('Imagem removida com sucesso!', 'success');

      // Atualiza a listagem no fundo
      loadProducts();

    } catch (err) {
      console.error('❌ [MascotCar] Erro inesperado ao remover imagem:', err);
      showEditModalAlert('Ocorreu um erro inesperado ao remover a imagem.', 'error');
      if (btnRemoveImage) {
        btnRemoveImage.disabled = false;
        btnRemoveImage.innerHTML = '<span>🗑️ Remover Imagem</span>';
      }
      if (submitBtn) {
        submitBtn.disabled = false;
      }
    }
  }

  /**
   * Trata a submissão do formulário de edição de produtos.
   * Utiliza exclusivamente a policy de UPDATE administrativa já existente no Supabase.
   * NUNCA altera image_url e NUNCA faz chamadas ao Storage.
   */
  async function handleEditProductSubmit(e) {
    e.preventDefault();
    hideEditModalAlert();

    const client = getClient();
    if (!client) {
      showEditModalAlert('Cliente Supabase não inicializado.', 'error');
      return;
    }

    const {
      idInput,
      nameInput,
      descInput,
      priceInput,
      stockInput,
      categorySelect,
      activeCheckbox,
      submitBtn
    } = getEditModalElements();

    const productId = idInput ? idInput.value : '';
    if (!productId) {
      showEditModalAlert('Identificador do produto inválido.', 'error');
      return;
    }

    const name = nameInput ? nameInput.value.trim() : '';
    const description = descInput ? descInput.value.trim() : '';
    const price = priceInput ? priceInput.value : '';
    const stock = stockInput ? stockInput.value : '';
    const categoryId = categorySelect && categorySelect.value ? categorySelect.value : null;
    const isActive = activeCheckbox ? activeCheckbox.checked : false;

    // 1. Validação no frontend
    if (!name) {
      showEditModalAlert('O nome do produto é obrigatório.', 'error');
      return;
    }

    const priceNum = parseFloat(price);
    if (isNaN(priceNum) || priceNum <= 0) {
      showEditModalAlert('O preço deve ser um valor numérico maior que zero.', 'error');
      return;
    }

    const stockNum = Number(stock);
    if (isNaN(stockNum) || !Number.isInteger(stockNum) || stockNum < 0) {
      showEditModalAlert('O estoque deve ser um número inteiro maior ou igual a zero.', 'error');
      return;
    }

    // 2. Feedback de carregamento
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span>Salvando alterações...</span>';
    }

    try {
      // 3. Monta o payload SOMENTE com os campos permitidos (sem image_url)
      const updatePayload = {
        name,
        description: description || null,
        price: priceNum,
        stock: stockNum,
        category_id: categoryId,
        active: Boolean(isActive)
      };

      // 4. Executa UPDATE usando a sessão autenticada e as policies existentes
      const { error: updateError } = await client
        .from('products')
        .update(updatePayload)
        .eq('id', productId);

      if (updateError) {
        console.error('❌ [MascotCar Edit] Erro no UPDATE de produto:', updateError);
        showEditModalAlert(updateError.message || 'Falha ao atualizar o produto.', 'error');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Salvar Alterações</span>';
        }
        return;
      }

      // 5. Sucesso
      showEditModalAlert('Produto atualizado com sucesso!', 'success');
      setTimeout(() => {
        closeEditModal();
        loadProducts();
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Salvar Alterações</span>';
        }
      }, 600);

    } catch (err) {
      console.error('❌ [MascotCar Edit] Erro inesperado ao editar produto:', err);
      showEditModalAlert('Ocorreu um erro inesperado ao salvar as alterações.', 'error');
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>Salvar Alterações</span>';
      }
    }
  }

  /**
   * Inicializa os ouvintes de eventos da seção de produtos, modais e visualizador.
   */
  function init() {
    // Botões de recarregar listagem
    const retryBtn = document.getElementById('products-retry-btn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => loadProducts());
    }

    const refreshBtn = document.getElementById('products-refresh-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => loadProducts());
    }

    // Botões do Modal de Cadastro
    const openModalBtn = document.getElementById('btn-open-create-modal');
    if (openModalBtn) {
      openModalBtn.addEventListener('click', () => openCreateModal());
    }

    const closeModalBtn = document.getElementById('btn-close-modal');
    if (closeModalBtn) {
      closeModalBtn.addEventListener('click', () => closeCreateModal());
    }

    const cancelModalBtn = document.getElementById('btn-cancel-modal');
    if (cancelModalBtn) {
      cancelModalBtn.addEventListener('click', () => closeCreateModal());
    }

    // Fechar Modal de Cadastro ao clicar no backdrop
    const createModalEl = document.getElementById('modal-create-product');
    if (createModalEl) {
      createModalEl.addEventListener('click', (e) => {
        if (e.target === createModalEl) {
          closeCreateModal();
        }
      });
    }

    // Envio do formulário de cadastro
    const createFormEl = document.getElementById('form-create-product');
    if (createFormEl) {
      createFormEl.addEventListener('submit', handleCreateProductSubmit);
    }

    // ------------------------------------------------------------------------
    // Eventos da Tabela de Produtos (Edição e Lightbox)
    // ------------------------------------------------------------------------

    const tableBodyEl = document.getElementById('products-table-body');
    if (tableBodyEl) {
      tableBodyEl.addEventListener('click', (e) => {
        // Clique no botão Editar
        const editBtn = e.target.closest('.btn-edit-product');
        if (editBtn) {
          const productId = editBtn.getAttribute('data-id');
          if (productId) {
            openEditModal(productId);
          }
          return;
        }

        // Clique na miniatura para abrir no Lightbox
        const thumbClickable = e.target.closest('.product-thumb-clickable');
        if (thumbClickable) {
          const url = thumbClickable.getAttribute('data-lightbox-url');
          const title = thumbClickable.getAttribute('data-lightbox-title') || 'Produto';
          const badge = thumbClickable.getAttribute('data-lightbox-badge') || 'Imagem Principal';
          if (url) {
            openLightbox(url, title, badge);
          }
        }
      });
    }

    // ------------------------------------------------------------------------
    // Eventos do Modal de Edição (Etapa 3C)
    // ------------------------------------------------------------------------

    const closeEditModalBtn = document.getElementById('btn-close-edit-modal');
    if (closeEditModalBtn) {
      closeEditModalBtn.addEventListener('click', () => closeEditModal());
    }

    const cancelEditModalBtn = document.getElementById('btn-cancel-edit-modal');
    if (cancelEditModalBtn) {
      cancelEditModalBtn.addEventListener('click', () => closeEditModal());
    }

    const editModalEl = document.getElementById('modal-edit-product');
    if (editModalEl) {
      editModalEl.addEventListener('click', (e) => {
        if (e.target === editModalEl) {
          closeEditModal();
        }
      });
    }

    const editFormEl = document.getElementById('form-edit-product');
    if (editFormEl) {
      editFormEl.addEventListener('submit', handleEditProductSubmit);
    }

    const btnRemoveImageEl = document.getElementById('btn-remove-image');
    if (btnRemoveImageEl) {
      btnRemoveImageEl.addEventListener('click', handleRemoveProductImage);
    }

    // ------------------------------------------------------------------------
    // Eventos do Lightbox Modal (Etapa 3D)
    // ------------------------------------------------------------------------

    const lightboxModal = document.getElementById('image-lightbox-modal');
    const lightboxCloseBtn = document.getElementById('lightbox-close-btn');

    if (lightboxCloseBtn) {
      lightboxCloseBtn.addEventListener('click', () => closeLightbox());
    }

    if (lightboxModal) {
      lightboxModal.addEventListener('click', (e) => {
        if (e.target === lightboxModal) {
          closeLightbox();
        }
      });
    }

    // Fechar modais ao pressionar tecla Escape (com prioridade para o Lightbox)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (lightboxModal && lightboxModal.style.display === 'flex') {
          closeLightbox();
          return;
        }

        const editModal = document.getElementById('modal-edit-product');
        if (editModal && editModal.style.display === 'flex') {
          closeEditModal();
          return;
        }

        const createModal = document.getElementById('modal-create-product');
        if (createModal && createModal.style.display === 'flex') {
          closeCreateModal();
        }
      }
    });

    // Carrega a listagem inicial
    loadProducts();
  }

  // Expõe no escopo global
  window.MascotCarProducts = {
    init,
    loadProducts,
    openCreateModal,
    closeCreateModal,
    openEditModal,
    closeEditModal,
    handleRemoveProductImage,
    openLightbox,
    closeLightbox
  };
})();
