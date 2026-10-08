# MascotCar — Site Oficial & Plataforma de Pedidos (v1)

> Loja virtual e painel de gestão operacional de aromatizadores automotivos personalizados em formato de mascotes.

---

## 🚀 Visão Geral e Arquitetura

O **MascotCar v1** é uma aplicação web completa desenvolvida com arquitetura moderna e enxuta, sem dependência de frameworks ou processos pesados de build no frontend:

```text
Cliente / Navegador
  ├── Loja Pública (index.html)
  └── Painel de Gestão (admin/index.html)
        ↓ (HTTPS / REST / WebSocket)
Supabase Platform (BaaS)
  ├── Auth (Autenticação administrativa com verificação de papéis)
  ├── PostgreSQL (Tabelas relacionais com Row Level Security - RLS)
  ├── Storage (Bucket para armazenamento seguro de imagens dos produtos)
  └── RPCs Transacionais (Lógica atômica com bloqueio de concorrência)
```

- **Frontend:** HTML5 semântico, CSS3 moderno (Custom Properties, Grid, Flexbox, Mobile-First) e JavaScript ES6+ Vanilla.
- **Hospedagem & Deploy:** GitHub Pages com entrega estática de alta performance.
- **Backend & Persistência:** Supabase (Database Postgres, Auth, Storage e RPCs).

---

## 🛍️ Funcionalidades da Loja Pública

1. **Catálogo Dinâmico em Tempo Real:**
   - Carregamento de produtos ativos (`active = true`) direto do banco de dados.
   - Categorias dinâmicas com contagem de itens em tempo real.
   - Busca textual instantânea, filtros por categoria, ordenação e badges de estoque/disponibilidade.
   - Fallback visual resiliente para imagens de produtos.
2. **Minha Lista (Carrinho de Compras):**
   - Drawer lateral acessível e intuitivo.
   - Controle de quantidade respeitando o teto de estoque físico disponível.
   - Cálculo automático de subtotais e valor total da lista.
   - Seleção individual ou em lote para finalização.
   - Persistência segura em `localStorage` (`mascotcar_cart_v1`).
3. **Checkout Preventivo & Reserva Atômica:**
   - Revalidação assíncrona automática do catálogo antes de abrir a tela de revisão (impede a compra de itens que foram desativados ou esgotados durante a navegação).
   - Criação atômica do pedido via RPC `create_order` com chave de idempotência (`p_client_request_id`).
   - Reserva temporária de 30 minutos com trava de estoque lógica (`SELECT ... FOR UPDATE`).
   - Geração de código legível oficial (ex: `MC-XXXXX`) e emissão de token de acesso exclusivo para o cliente.
4. **Rastreamento de Pedidos & WhatsApp:**
   - Tela de sucesso com geração de link e mensagem contextualizada para o WhatsApp oficial da loja.
   - Modal de acompanhamento dinâmico com polling de status (`get_order_tracking`).
   - Aba "Meus Pedidos" no dispositivo do cliente, preservando histórico de compras locais.
   - Contador regressivo dinâmico da janela de reserva de 30 minutos.

---

## ⚙️ Painel Administrativo (`/admin`)

O painel de controle operacional do lojista oferece gestão completa e segura:

1. **Autenticação & Controle de Acesso:**
   - Login exclusivo para lojistas via Supabase Auth.
   - Guarda de rotas estrita com verificação de função administrativa (`public.is_admin()`).
   - Proteção contra acessos anônimos ou usuários sem privilégio administrativo.
2. **Gestão de Produtos & Catálogo:**
   - Listagem completa de produtos com busca, filtros de categoria e ordenação.
   - Modal de criação e edição com controle de estoque físico e preços.
   - Upload, substituição e remoção segura de imagens no Supabase Storage com limpeza de arquivos órfãos.
   - **Regra de Desativação Lógica:** Produtos nunca são fisicamente excluídos para preservar a integridade contábil e histórica dos pedidos. O ciclo de vida é controlado pelo status `active`.
3. **Gestão Operacional de Pedidos:**
   - Abas categorizadas por status: **Ativos**, **Todos**, **Concluídos**, **Expirados** e **Cancelados** com contadores dinâmicos.
   - **Segregação de Reservas Vencidas:** Pedidos com status `received` cujo tempo de 30 minutos expirou são automaticamente segregados para a aba "Expirados", mantendo a aba "Ativos" limpa para a operação de entrega.
   - Barra de filtros com busca por código, cliente ou telefone, e filtros por período (*Hoje*, *Últimos 7 dias*, *Últimos 30 dias* ou *Personalizado*).
   - Exportação de pedidos filtrados em formato CSV (compatível com RFC 4180 e protegido contra CSV Injection).
   - Modal de detalhes com itens congelados (snapshot imutável de nome e preço), dados de contato e atalho direto para o WhatsApp do cliente.
   - Impressão formatada para papel em formato **Picking Slip** (`@media print`).
   - Linha do tempo auditável de eventos (`order_status_history`).
   - Ações de transição seguras governadas por RPCs (`confirm_order`, `cancel_order`, `admin_update_order_status`).
   - Polling silencioso a cada 30 segundos com notificações toast de novos pedidos e mini dashboard de KPIs.

---

## 🔒 Segurança e Integridade de Dados

- **Row Level Security (RLS):** Tabelas `orders`, `order_items` e `order_status_history` são protegidas contra leitura de visitantes anônimos.
- **Rastreamento Público Seguro:** A consulta de pedidos por clientes anônimos opera exclusivamente via RPC `get_order_tracking`, que exige a validação criptográfica do hash do token de acesso emitido para aquele pedido.
- **Zero Secrets no Frontend:** Nenhuma chave privilegiada (`service_role`) ou segredo de infraestrutura é exposto no código público. Todas as chamadas utilizam a chave anônima combinada com Auth e RLS.
- **RPCs Transacionais:** Operações críticas usam `SECURITY DEFINER` com `search_path = public, pg_temp` explícito, prevenindo escalação de privilégios.
- **Imutabilidade Histórica:** Os itens de pedidos gravam snapshots de preço unitário e nome do produto, garantindo que alterações cadastrais futuras no catálogo nunca distorçam pedidos passados.

---

## 📂 Estrutura do Projeto

```text
MascotCar/
├── index.html              → Loja pública, vitrine, modais de checkout e tracking
├── README.md               → Documentação oficial da plataforma
├── robots.txt              → Diretivas de indexação para buscadores
├── css/
│   └── style.css           → Estilos da loja pública, carrinho, modais e responsividade
├── js/
│   ├── main.js             → Interações de interface, scroll suave e modais institucionais
│   └── supabase-client.js  → Catálogo dinâmico, carrinho, checkout, tracking e Supabase SDK
├── admin/
│   ├── index.html          → Painel administrativo de produtos e pedidos
│   ├── login.html          → Tela de autenticação segura do lojista
│   ├── admin.css           → Estilos do painel administrativo e regras de impressão
│   ├── auth.js             → Gerenciamento de sessão e proteção de rotas administrativas
│   ├── products.js         → Módulo administrativo de produtos, estoque e storage
│   └── orders.js           → Módulo administrativo de pedidos, CSV, filtros e RPCs
└── assets/                 → Recursos visuais, ícones e mídias estáticas
```

---

## 💻 Como Rodar o Projeto Localmente

Como o projeto utiliza tecnologias web puras, qualquer servidor web estático local é suficiente:

### Opção 1 — Com Node.js (`npx serve`)
```bash
npx serve . -l 3000
# Acesse no navegador: http://localhost:3000
```

### Opção 2 — Com Python 3
```bash
python -m http.server 8080
# Acesse no navegador: http://localhost:8080
```

### Opção 3 — Extensão Live Server (VS Code)
1. Instale a extensão "Live Server" no VS Code.
2. Clique com o botão direito em `index.html` → **Open with Live Server**.

> **Nota:** Para acesso ao painel administrativo localmente, certifique-se de navegar para `/admin/index.html` ou `/admin/login.html`.

---

## 🌐 Deploy em Produção

A plataforma é publicada automaticamente via **GitHub Pages** a partir da branch principal `main`:

- **Loja Pública Oficial:** [https://caio18685810-rgb.github.io/MascotCar/](https://caio18685810-rgb.github.io/MascotCar/)
- **Painel Administrativo:** [https://caio18685810-rgb.github.io/MascotCar/admin/](https://caio18685810-rgb.github.io/MascotCar/admin/)

---

## 🎯 Tecnologias Utilizadas

- **HTML5 & CSS3:** Semântica estrita, CSS Grid, Flexbox, Custom Properties, Dark Mode e responsividade mobile-first.
- **JavaScript ES6+ (Vanilla):** Código desacoplado, assíncrono e modular sem frameworks pesados.
- **Supabase BaaS:** PostgreSQL, GoTrue Auth, Storage Buckets e PL/pgSQL RPCs.
- **Google Fonts:** Tipografia Poppins.
- **Acessibilidade:** ARIA roles, trapping de foco em modais e alertas com `aria-live`.
