/**
 * MascotCar — Autenticação e Proteção do Painel Administrativo
 * Utiliza Supabase Auth com validação no banco via RPC is_admin().
 *
 * ⚠️ SEGURANÇA:
 * - Apenas a chave pública (Publishable Key) é utilizada.
 * - Toda autorização é verificada e garantida pela função is_admin() e RLS no banco de dados.
 */

'use strict';

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
 * Traduz mensagens comuns de erro do Supabase Auth para português amigável.
 * @param {Object} error
 * @returns {string}
 */
function formatAuthError(error) {
  if (!error) return 'Ocorreu um erro inesperado.';
  const msg = error.message || '';

  if (msg.includes('Invalid login credentials')) {
    return 'E-mail ou senha incorretos. Verifique suas credenciais.';
  }
  if (msg.includes('Email not confirmed')) {
    return 'E-mail não confirmado. Verifique sua caixa de entrada para ativar a conta.';
  }
  if (msg.includes('Too many requests') || msg.includes('rate limit')) {
    return 'Muitas tentativas em pouco tempo. Aguarde alguns instantes antes de tentar novamente.';
  }
  if (msg.includes('NetworkError') || msg.includes('Failed to fetch')) {
    return 'Não foi possível conectar ao servidor. Verifique sua conexão com a internet.';
  }
  return msg;
}

/**
 * Obtém a sessão atual do Supabase.
 * @returns {Promise<{session: Object|null, user: Object|null}>}
 */
async function getCurrentSession() {
  const client = getClient();
  if (!client) return { session: null, user: null };

  try {
    const { data, error } = await client.auth.getSession();
    if (error || !data || !data.session) {
      return { session: null, user: null };
    }
    return { session: data.session, user: data.session.user };
  } catch (err) {
    console.warn('⚠️ [MascotCar Admin] Falha ao verificar sessão:', err);
    return { session: null, user: null };
  }
}

/**
 * Verifica se o usuário autenticado possui privilégio de administrador
 * através da função RPC public.is_admin() configurada no Supabase.
 * @returns {Promise<boolean>}
 */
async function checkIfAdmin() {
  const client = getClient();
  if (!client) return false;

  try {
    const { data, error } = await client.rpc('is_admin');
    if (error) {
      console.warn('⚠️ [MascotCar Admin] Verificação de administrador falhou:', error.message);
      return false;
    }
    return data === true;
  } catch (err) {
    console.warn('⚠️ [MascotCar Admin] Erro inesperado ao consultar is_admin():', err);
    return false;
  }
}

/**
 * Realiza o login com e-mail e senha no Supabase Auth.
 * Se o login tiver sucesso, valida se o usuário possui acesso de administrador.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{success: boolean, user?: Object, error?: string}>}
 */
async function loginAdmin(email, password) {
  const client = getClient();
  if (!client) {
    return { success: false, error: 'Cliente Supabase não inicializado.' };
  }

  const cleanEmail = (email || '').trim();
  if (!cleanEmail || !password) {
    return { success: false, error: 'Por favor, preencha o e-mail e a senha.' };
  }

  try {
    // 1. Autenticação oficial do Supabase Auth
    const { data, error } = await client.auth.signInWithPassword({
      email: cleanEmail,
      password: password
    });

    if (error || !data || !data.user) {
      return { success: false, error: formatAuthError(error) };
    }

    // 2. Validação obrigatória da permissão de administrador no banco (RPC is_admin)
    const isAdmin = await checkIfAdmin();

    if (!isAdmin) {
      // Se não for admin, encerra a sessão imediatamente
      await client.auth.signOut();
      return {
        success: false,
        error: 'Acesso negado: este usuário não possui privilégios de administrador.'
      };
    }

    return { success: true, user: data.user };
  } catch (err) {
    return { success: false, error: formatAuthError(err) };
  }
}

/**
 * Encerra a sessão ativa do administrador no Supabase e redireciona para o login.
 */
async function logoutAdmin() {
  const client = getClient();
  if (client) {
    try {
      await client.auth.signOut();
    } catch (err) {
      console.warn('⚠️ [MascotCar Admin] Erro ao deslogar:', err);
    }
  }
  window.location.replace('login.html');
}

/**
 * Protege a rota do painel (/admin/index.html).
 * - Se não logado: redireciona para login.html
 * - Se logado mas NÃO admin: bloqueia exibição e mostra tela de Acesso Negado.
 * - Se logado e admin: libera o painel e configura o botão de Sair.
 */
async function protectAdminPage() {
  const loadingEl = document.getElementById('admin-loading');
  const appEl = document.getElementById('admin-app');
  const deniedEl = document.getElementById('access-denied-view');

  function showLoading(show) {
    if (loadingEl) loadingEl.style.display = show ? 'flex' : 'none';
  }

  showLoading(true);
  if (appEl) appEl.style.display = 'none';
  if (deniedEl) deniedEl.style.display = 'none';

  // 1. Verifica se existe sessão ativa
  const { session, user } = await getCurrentSession();

  if (!session || !user) {
    // Não autenticado: redireciona diretamente para login
    window.location.replace('login.html');
    return false;
  }

  // 2. Verifica se o usuário é administrador autorizado no banco
  const isAdmin = await checkIfAdmin();

  showLoading(false);

  if (!isAdmin) {
    // Usuário autenticado que NÃO é administrador
    if (deniedEl) {
      deniedEl.style.display = 'block';
      const userEmailEl = document.getElementById('denied-user-email');
      if (userEmailEl) userEmailEl.textContent = user.email || 'Usuário';

      const deniedLogoutBtn = document.getElementById('denied-logout-btn');
      if (deniedLogoutBtn) {
        deniedLogoutBtn.addEventListener('click', () => logoutAdmin());
      }
    }
    return false;
  }

  // 3. Usuário autenticado e autorizado como administrador
  if (appEl) {
    appEl.style.display = 'block';

    const userEmailEl = document.getElementById('admin-user-email');
    if (userEmailEl) userEmailEl.textContent = user.email || '';

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        logoutAdmin();
      });
    }
  }

  return true;
}

/**
 * Inicializa a página de login (/admin/login.html).
 * - Se já for admin autenticado: redireciona para o painel.
 * - Trata o envio do formulário de login com feedback visual e tratamento de erros.
 */
async function initLoginPage() {
  const form = document.getElementById('login-form');
  const alertEl = document.getElementById('login-alert');
  const submitBtn = document.getElementById('login-submit-btn');

  function showAlert(msg, type = 'error') {
    if (!alertEl) return;
    alertEl.textContent = msg;
    alertEl.className = `alert alert-${type}`;
    alertEl.style.display = 'flex';
  }

  function hideAlert() {
    if (!alertEl) return;
    alertEl.style.display = 'none';
  }

  // Se já estiver logado e for admin, redireciona para index.html
  const { session } = await getCurrentSession();
  if (session) {
    const isAdmin = await checkIfAdmin();
    if (isAdmin) {
      window.location.replace('index.html');
      return;
    }
  }

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      hideAlert();

      const emailInput = document.getElementById('email');
      const passwordInput = document.getElementById('password');

      const email = emailInput ? emailInput.value : '';
      const password = passwordInput ? passwordInput.value : '';

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Verificando...</span>';
      }

      const result = await loginAdmin(email, password);

      if (!result.success) {
        showAlert(result.error, 'error');
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = '<span>Acessar Painel</span>';
        }
      } else {
        showAlert('Login realizado com sucesso! Redirecionando...', 'success');
        setTimeout(() => {
          window.location.replace('index.html');
        }, 500);
      }
    });
  }
}

// Expõe os métodos globalmente
window.MascotCarAuth = {
  getCurrentSession,
  checkIfAdmin,
  loginAdmin,
  logoutAdmin,
  protectAdminPage,
  initLoginPage
};
