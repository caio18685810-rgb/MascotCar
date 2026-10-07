/**
 * MascotCar — JavaScript Principal v2
 * Funcionalidades: announcement bar, menu mobile, scroll header,
 *                  filtro de categorias, botão voltar ao topo,
 *                  animação de entrada de elementos.
 */

'use strict';

/* ── Constantes ── */
const HEADER           = document.getElementById('header');
const HAMBURGER        = document.getElementById('hamburger');
const NAV              = document.getElementById('nav');
const BACK_TO_TOP      = document.getElementById('backToTop');
const PRODUCTS         = document.querySelectorAll('.product-card[data-category]');
const CAT_BUTTONS      = document.querySelectorAll('.category-card');
const ANNOUNCEMENT_BAR = document.getElementById('announcementBar');
const CLOSE_ANNOUNCE   = document.getElementById('closeAnnouncement');

/* ══════════════════════════════════════════
   0. ANNOUNCEMENT BAR
══════════════════════════════════════════ */
(function initAnnouncementBar() {
  if (!ANNOUNCEMENT_BAR || !CLOSE_ANNOUNCE) return;

  // Restaurar estado da sessão
  if (sessionStorage.getItem('mc_bar_closed') === '1') {
    ANNOUNCEMENT_BAR.classList.add('hidden');
    document.body.classList.add('no-announcement');
  }

  CLOSE_ANNOUNCE.addEventListener('click', () => {
    ANNOUNCEMENT_BAR.classList.add('hidden');
    document.body.classList.add('no-announcement');
    sessionStorage.setItem('mc_bar_closed', '1');
  });
})();

/* ══════════════════════════════════════════
   1. MENU MOBILE (hamburger)
══════════════════════════════════════════ */
function toggleMenu(open) {
  const isOpen = open !== undefined ? open : !NAV.classList.contains('open');
  NAV.classList.toggle('open', isOpen);
  HAMBURGER.classList.toggle('active', isOpen);
  HAMBURGER.setAttribute('aria-expanded', String(isOpen));
  // Evita scroll do body quando menu aberto
  document.body.style.overflow = isOpen ? 'hidden' : '';
}

if (HAMBURGER && NAV) {
  HAMBURGER.addEventListener('click', () => toggleMenu());

  // Fechar ao clicar num link do menu
  NAV.querySelectorAll('a').forEach(link => {
    link.addEventListener('click', () => toggleMenu(false));
  });

  // Fechar ao clicar fora do menu
  document.addEventListener('click', (e) => {
    if (
      NAV.classList.contains('open') &&
      !NAV.contains(e.target) &&
      !HAMBURGER.contains(e.target)
    ) {
      toggleMenu(false);
    }
  });

  // Fechar com Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && NAV.classList.contains('open')) {
      toggleMenu(false);
      HAMBURGER.focus();
    }
  });
}

/* ══════════════════════════════════════════
   2. HEADER — sombra ao rolar
══════════════════════════════════════════ */
function onScroll() {
  if (!HEADER) return;
  HEADER.classList.toggle('scrolled', window.scrollY > 20);

  // Botão voltar ao topo
  if (BACK_TO_TOP) {
    BACK_TO_TOP.classList.toggle('visible', window.scrollY > 400);
  }
}

window.addEventListener('scroll', onScroll, { passive: true });

/* ══════════════════════════════════════════
   3. BOTÃO VOLTAR AO TOPO
══════════════════════════════════════════ */
if (BACK_TO_TOP) {
  BACK_TO_TOP.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

/* ══════════════════════════════════════════
   4. FILTRO DE CATEGORIAS
══════════════════════════════════════════ */
function filterProducts(category) {
  // Se o catálogo dinâmico estiver carregado, delega para ele
  if (window.MascotCarData && typeof window.MascotCarData.setCategoryFilter === 'function') {
    window.MascotCarData.setCategoryFilter(category);
    return;
  }

  const currentProducts = document.querySelectorAll('.product-card[data-category]');
  currentProducts.forEach(card => {
    const cardCat = card.dataset.category;
    const show    = category === 'todos' || category === 'all' || cardCat === category;

    // Animação suave
    if (show) {
      card.style.display = '';
      requestAnimationFrame(() => {
        card.style.opacity    = '1';
        card.style.transform  = 'translateY(0)';
      });
    } else {
      card.style.opacity    = '0';
      card.style.transform  = 'translateY(8px)';
      setTimeout(() => {
        if (card.style.opacity === '0') card.style.display = 'none';
      }, 250);
    }
  });
}

CAT_BUTTONS.forEach(btn => {
  btn.addEventListener('click', () => {
    // Estado ativo
    CAT_BUTTONS.forEach(b => b.classList.remove('category-card--active'));
    btn.classList.add('category-card--active');

    // Rolar suavemente para produtos se o usuário já passou deles
    const productsSection = document.getElementById('produtos');
    if (productsSection) {
      const rect = productsSection.getBoundingClientRect();
      if (rect.top < -200) {
        productsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    filterProducts(btn.dataset.filter || 'todos');
  });
});

/* ══════════════════════════════════════════
   5. ANIMAÇÃO DE ENTRADA (Intersection Observer)
   Elementos ganham classe .is-visible ao entrar na tela
══════════════════════════════════════════ */
const ANIMATED_SELECTORS = [
  '.product-card',
  '.benefit-card',
  '.step',
  '.category-card',
  '.section-header',
  '.hero__content',
  '.hero__visual',
  '.cta__inner',
];

// Adicionar classe base
document.querySelectorAll(ANIMATED_SELECTORS.join(', ')).forEach((el, i) => {
  el.style.opacity    = '0';
  el.style.transform  = 'translateY(24px)';
  el.style.transition = `opacity .5s ease ${i * 0.04}s, transform .5s ease ${i * 0.04}s`;
});

const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.style.opacity   = '1';
      entry.target.style.transform = 'translateY(0)';
      observer.unobserve(entry.target);
    }
  });
}, {
  threshold:  0.12,
  rootMargin: '0px 0px -40px 0px',
});

document.querySelectorAll(ANIMATED_SELECTORS.join(', ')).forEach(el => {
  observer.observe(el);
});

/* ══════════════════════════════════════════
   6. SMOOTH SCROLL para links âncora
══════════════════════════════════════════ */
document.querySelectorAll('a[href^="#"]').forEach(link => {
  link.addEventListener('click', (e) => {
    const id     = link.getAttribute('href').slice(1);
    const target = document.getElementById(id);
    if (!target) return;

    e.preventDefault();
    const headerH = parseInt(
      getComputedStyle(document.documentElement).getPropertyValue('--header-h'),
      10
    ) || 72;

    const y = target.getBoundingClientRect().top + window.scrollY - headerH - 8;
    window.scrollTo({ top: y, behavior: 'smooth' });
  });
});

/* ══════════════════════════════════════════
   7. MODAIS INSTITUCIONAIS (Etapas 3O.1 & 3O.3)
══════════════════════════════════════════ */
function initInfoModals() {
  const openButtons = document.querySelectorAll('[data-modal-open]');
  const closeButtons = document.querySelectorAll('[data-modal-close]');
  let lastFocusedElementBeforeInfoModal = null;

  function closeAllInfoModals() {
    let closedAny = false;
    document.querySelectorAll('.info-modal-backdrop').forEach(modal => {
      if (modal.style.display === 'flex') {
        closedAny = true;
      }
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    });
    document.body.style.overflow = '';

    if (closedAny && lastFocusedElementBeforeInfoModal && typeof lastFocusedElementBeforeInfoModal.focus === 'function') {
      lastFocusedElementBeforeInfoModal.focus();
      lastFocusedElementBeforeInfoModal = null;
    }
  }

  openButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const modalId = btn.getAttribute('data-modal-open');
      const modal = document.getElementById(modalId);
      if (modal) {
        lastFocusedElementBeforeInfoModal = btn;
        modal.style.display = 'flex';
        modal.removeAttribute('aria-hidden');
        document.body.style.overflow = 'hidden';

        const focusables = getFocusableElements(modal);
        if (focusables.length > 0) {
          focusables[0].focus();
        } else {
          modal.focus();
        }
      }
    });
  });

  closeButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      closeAllInfoModals();
    });
  });

  // Fechar ao clicar no backdrop
  document.querySelectorAll('.info-modal-backdrop').forEach(modal => {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        closeAllInfoModals();
      }
    });
  });

  // Retorna elementos focáveis dentro de um contêiner
  function getFocusableElements(container) {
    const selector = 'button:not([disabled]), [href]:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    return Array.from(container.querySelectorAll(selector)).filter(el => {
      return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement;
    });
  }

  // Teclado: Focus Trap e Escape para modais institucionais
  document.addEventListener('keydown', (e) => {
    const openModal = document.querySelector('.info-modal-backdrop[style*="display: flex"]');
    if (!openModal) return;

    if (e.key === 'Escape') {
      e.preventDefault();
      closeAllInfoModals();
      return;
    }

    if (e.key === 'Tab') {
      const focusables = getFocusableElements(openModal);
      if (focusables.length === 0) {
        e.preventDefault();
        return;
      }

      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === firstEl || !openModal.contains(document.activeElement)) {
          e.preventDefault();
          lastEl.focus();
        }
      } else {
        if (document.activeElement === lastEl || !openModal.contains(document.activeElement)) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    }
  });
}

/* ══════════════════════════════════════════
   8. INICIALIZAÇÃO
══════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  onScroll(); // estado inicial
  initInfoModals(); // modais institucionais
  console.info(
    '%c🚗 MascotCar%c — Site oficial carregado.',
    'font-size:1.2rem; font-weight:bold; color:#FF5722;',
    'font-size:.9rem; color:#666;'
  );
});
