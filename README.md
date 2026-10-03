# MascotCar — Site Oficial

Loja de aromatizadores automotivos personalizados em formato de mascotes.

## 🚀 Como rodar o projeto localmente

Este projeto usa **HTML, CSS e JavaScript puros** — sem dependências ou build tools.

### Opção 1 — Abrir direto no navegador
Basta abrir o arquivo `index.html` diretamente no seu navegador (duplo clique).

### Opção 2 — Servidor local simples (recomendado)
Para evitar limitações de CORS no navegador ao carregar recursos locais:

**Com Python (geralmente já instalado):**
```bash
# Python 3
python -m http.server 8080

# Depois acesse: http://localhost:8080
```

**Com Node.js (`npx serve`):**
```bash
npx serve .
# Depois acesse: http://localhost:3000
```

**Com VS Code (extensão Live Server):**
- Instale a extensão "Live Server" no VS Code
- Clique com botão direito em `index.html` → "Open with Live Server"

---

## 📂 Estrutura do Projeto

```
MascotCar/
├── index.html          → Página principal
├── README.md           → Este arquivo
├── css/
│   └── style.css       → Estilos (responsivo, dark mode)
├── js/
│   └── main.js         → Interações e animações
└── assets/
    └── images/         → Pasta para imagens futuras
```

## 🎨 Seções da página

| Seção | ID | Descrição |
|-------|-----|-----------|
| Header | `#header` | Logo + menu de navegação |
| Hero | `#inicio` | Destaque principal |
| Categorias | `#categorias` | Filtro por tipo de mascote |
| Produtos | `#produtos` | Grade de produtos demonstrativos |
| Como Funciona | `#como-funciona` | Processo de personalização em 4 passos |
| Benefícios | `#beneficios` | Diferenciais da loja |
| CTA | `#comprar` | Chamada para ação |
| Footer | `#contato` | Rodapé com links e informações |

## ⚠️ Conteúdo Demonstrativo

Todos os produtos, preços, e informações de contato exibidos no site são **fictícios e apenas para demonstração**. Não representam ofertas reais.

## 🛠️ Próximos Passos Sugeridos

- [ ] Adicionar logo oficial (substituir emoji 🚗 por imagem)
- [ ] Inserir fotos reais dos produtos em `assets/images/`
- [ ] Definir preços e catálogo real
- [ ] Conectar formulário de captura de e-mail (Mailchimp, etc.)
- [ ] Integrar sistema de pagamento (Mercado Pago, Stripe, etc.)
- [ ] Adicionar carrinho de compras
- [ ] Configurar domínio e hospedagem
- [ ] Adicionar página de produto individual
- [ ] Criar seção de avaliações/depoimentos

## 🎯 Tecnologias

- HTML5 semântico
- CSS3 (Custom Properties, Grid, Flexbox, animações)
- JavaScript ES6+ (vanilla)
- Google Fonts (Poppins)
- Design responsivo (mobile-first)
- Suporte a dark mode (`prefers-color-scheme`)
- Acessibilidade (ARIA labels, `focus-visible`)
