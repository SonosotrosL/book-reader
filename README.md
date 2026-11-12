# 📚 Leitor Portátil & Estante Universal de Livros & Mangás

> **Leitor universal, portátil e 100% autossuficiente (PWA)** para **EPUB**, **MOBI**, **AZW3/KF8**, **PDF**, **CBZ/CBR** e **TXT**. Funciona diretamente no navegador (offline-first via Service Worker) ou como aplicativo desktop/mobile instalado, com sincronização em nuvem via **Supabase**, **Google Drive** ou **OneDrive**, suporte a múltiplos perfis, estantes compartilhadas seguras e suíte integrada de **Inteligência Artificial (NotebookLM)** e **Estudo de Idiomas**.

![HTML5](https://img.shields.io/badge/HTML5-Single--File-E34F26?logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-Modern%20Themes-1572B6?logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-Vanilla%20ES6+-F7DF1E?logo=javascript&logoColor=black)
![PWA](https://img.shields.io/badge/PWA-Offline%20Ready-5A0FC8?logo=pwa&logoColor=white)
![Supabase](https://img.shields.io/badge/Supabase-Cloud%20Sync-3ECF8E?logo=supabase&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-Auto%20Deploy-000000?logo=vercel&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue.svg)

---

## 📑 Índice
1. [🌟 Catálogo Completo de Recursos](#-catálogo-completo-de-recursos)
   - [Formatos Suportados](#-formatos-suportados-100-no-navegador)
   - [Leitura & Ergonomia Visual](#-leitura--ergonomia-visual)
   - [Suíte NotebookLM (IA & Aprendizado)](#-suíte-notebooklm-ia--aprendizado)
   - [Idiomas & Vocabulário](#-ferramentas-de-idiomas--vocabulário)
   - [Método Cornell & Estudos](#-método-cornell--estudo-ativo)
   - [Conversor de Mangás p/ Kindle (KCC RTL)](#-conversor-de-mangás-p-kindle-kcc-web--calibre-rtl)
   - [Nuvem, Perfis & Segurança](#-nuvem-estantes-compartilhadas--segurança)
   - [Scrapers & Acervos Públicos](#-explorador-de-acervos-públicos--scrapers)
2. [📖 Guia Prático: Como Usar Cada Ferramenta](#-guia-prático-como-usar-cada-ferramenta)
3. [💾 Como Funciona o Armazenamento Local (IndexedDB)](#-como-funciona-o-armazenamento-local-indexeddb)
4. [🔒 Segurança dos Convites: O que acontece se alguém compartilhar o link?](#-segurança-dos-convites-o-que-acontece-se-alguém-compartilhar-o-link)
5. [🚀 Como Rodar e Fazer Deploy (Vercel / GitHub)](#-como-rodar-e-fazer-deploy)
6. [🛠️ Arquitetura e Compilação (`src/`)](#-arquitetura-e-compilação)

---

## 🌟 Catálogo Completo de Recursos

### 📖 Formatos Suportados (100% no Navegador)
* **EPUB 2 / 3**: Suporte completo a imagens, CSS nativo, tipografia adaptável, notas de rodapé flutuantes, sumário multinível (NCX / Nav) e capas SVG.
* **MOBI / AZW3 (KF8)**: Descompressão PalmDOC LZ77 pura em JavaScript, decodificação oficial de cabeçalhos Mobipocket, imagens `recindex` e links internos via `filepos`.
* **PDF**: Renderização nítida via PDF.js, com sumário em árvore, busca textual por palavra-chave, controle de contraste e filtro noturno invertido.
* **CBZ / CBR / ZIP / Mangás**: Modo Mangá com leitura tradicional oriental da **Direita para a Esquerda (RTL)**, detecção inteligente de **página dupla panorâmica** e modo **Tira Contínua (Webtoon)** com zoom de toque.
* **TXT & Markdown**: Paginação instantânea e auto-detecção de charset (UTF-8, ISO-8859-1).

---

### 🎨 Leitura & Ergonomia Visual
* **Leitura Biônica (Bionic Reading)**: Destaque visual guiado nas primeiras letras das palavras (*Fixação Visual*). Permite ao cérebro processar a leitura até 2x mais rápido sem cansaço visual.
* **Temas do Site**: Claro, Sépia e Escuro com paleta customizável de **Cores de Destaque** (Marrom Editorial, Azul, Verde, Roxo, Âmbar e Rosa).
* **Papel da Folha Independente**: Mude a folha do livro para claro, sépia ou escuro sem alterar as barras do leitor.
* **Filtro de Luz Âmbar**: Controle deslizante de luz quente sobre toda a tela para proteger seus olhos durante a leitura noturna.
* **Régua de Foco Visual**: Linha horizontal semi-transparente que acompanha a leitura para evitar perda de foco em parágrafos longos.
* **Sons Ambiente 100% Offline**: Chuva suave, Ruído Marrom e Lareira sintetizados em tempo real via Web Audio API (sem consumir internet nem carregar MP3s pesados).
* **Timer Pomodoro**: Temporizador de foco e pausas (15, 25, 45, 60 min) embutido no topo.
* **Galeria de Imagens & Mapas do Livro (Sidebar)**: Nova aba *Imagens* na barra lateral que escaneia e exibe todas as ilustrações, gravuras e mapas do livro em miniaturas organizadas, permitindo abri-las em alta resolução ou baixá-las individualmente.
* **Fita Marcadora de Retorno de Leitura**: Ao retomar a leitura de onde você parou, uma elegante fita iluminada (*"📍 Você parou aqui"*) aponta visualmente para o parágrafo exato onde a leitura parou, sumindo suavemente após alguns segundos.
* **Conversor de Capítulo para Áudio MP3 Offline**: Na barra de narração (TTS), clique em **📥 Baixar Áudio (.mp3)** para sintetizar e exportar o capítulo inteiro em arquivo MP3 contínuo para ouvir no carro, smartphone ou caixinha de som sem precisar de internet!
* **Visualizador & Ampliador Profissional de Imagens**: Clique em qualquer imagem de livro, mangá ou mapa para abrir o visualizador em tela cheia com **Zoom livre (até 500% ou roda do mouse)**, **Arrasto de detalhes (Pan)**, **Rotação 90°**, **Copiar Imagem** para a área de transferência e **Baixar Imagem (`.png`/`.jpg`)** com 1 clique.
* **Botão Direto "Fechar Livro" (`✕ Fechar`)**: Localizado na barra superior de leitura, descarrega o livro da memória RAM e retorna instantaneamente para a Estante inicial.
* **Page Flip**: Folheie rapidamente qualquer capítulo com grade de miniaturas sem perder a página em que estava (graças ao *Pino de Retorno*).

---

### 🧠 Suíte NotebookLM (IA & Aprendizado)
Localizada na **Central de Ferramentas ↗** → aba **NotebookLM**:
1. **Chat Grounded (Sem Alucinações)**: Converse com o livro! Tire dúvidas sobre personagens, enredo, teorias ou conceitos históricos. A IA é estritamente ancorada no texto do livro aberto.
2. **Audio Overview (Podcast com 2 Apresentadores)**: Gera um bate-papo dinâmico entre dois anfitriões (Alex e Sam) debatendo os principais insights da obra. A reprodução é feita em voz alta alternando dois sintetizadores de voz nativos do navegador!
3. **Guia de Estudo / Dossiê Automático**: Cria em segundos um documento completo contendo Resumo Executivo, Fatos-Chave, Linha do Tempo e Perguntas de Fixação, com botão de **Exportar para Markdown (`.md`)**.
4. **Motor Híbrido**: Funciona 100% offline via algoritmo léxico semântico ou conectado à chave gratuita do Google Gemini 1.5 Flash.

---

### 🌍 Ferramentas de Idiomas & Vocabulário
* **Barra Rápida de Seleção**: Selecione qualquer palavra ou frase para abrir opções instantâneas:
  * **Tradução Imediata**: Tradução sem sair da página.
  * **Pronúncia (Shadowing)**: Ouve o trecho com sotaque nativo para treino auditivo e vocal.
  * **Frequência Lexical**: Descubra se a palavra é comum ou rara na literatura.
  * **Salvar no Anki**: Cria flashcard com a palavra, significado e frase exata de exemplo do livro com 1 clique.
* **Classificador de Nível CEFR (A1 a C2)**: Badge inteligente no rodapé do livro avaliando a complexidade do vocabulário do capítulo atual.
* **Word Wise (Estilo Kindle)**: Exibe dicas e sinônimos simples em inglês diretamente sobre palavras difíceis do texto.
* **Integração Direta com Anki**: Conexão com AnkiConnect (desktop) e AnkiWeb, além de sistema interno de revisão espaçada (SRS).

---

### 📝 Método Cornell & Estudo Ativo
* **Painel Dividido Cornell**: Clique no botão `Cornell` no topo para abrir o caderno de anotações dividido no formato pedagógico clássico:
  1. *Perguntas & Palavras-Chave (Cues)*
  2. *Anotações principais da leitura (Notes)*
  3. *Resumo executivo do capítulo (Summary)*
* Todas as anotações ficam gravadas automaticamente por livro no navegador.
* **Citações & Destaques**: Marque trechos com cores diferentes, adicione notas e exporte todas as suas marcações organizadas em Markdown.

---

### 🎌 Conversor de Mangás p/ Kindle (KCC Web & Calibre RTL)
* **Conversor Web Embutido**: Na *Central de Ferramentas*, arraste qualquer mangá em `.cbz` ou `.epub` para gerar um arquivo formatado com leitura oriental (Direita → Esquerda / RTL), diagramação fixa e metadados oficiais para o *Send to Kindle*.
* **Script Python Autônomo**: Acompanha o arquivo [`manga_kindle_converter.py`](./manga_kindle_converter.py) para conversão em lote de pastas inteiras via linha de comando no computador.
* **Envio para Amazon**: Envie direto para o e-mail `@kindle.com` ou abra a página oficial da Amazon com 1 clique.

---

### ☁️ Nuvem, Estantes Compartilhadas & Segurança
* **Supabase (PostgreSQL + Storage)**: Sincronize estantes inteiras, capas, progresso de leitura, resenhas e cartões entre celular, tablet e computador.
* **Nuvem Pessoal Direta (Google Drive & OneDrive)**: Conecte seu próprio Google Drive ou OneDrive via OAuth seguro no navegador, sem passar seus arquivos por servidores intermediários.
* **Múltiplos Leitores & Clube do Livro**:
  * Cada leitor tem seu próprio perfil (foto, metas anuais, histórico e estatísticas).
  * Progresso individual separado: duas pessoas lendo o mesmo livro compartilhado mantêm páginas e marcações independentes.
* **Sistema de Permissões Granular**:
  * **Owner (Dono)**: Acesso total (subir, apagar, gerenciar membros).
  * **Member (Membro)**: Leitura total e permissão para subir livros direto.
  * **Contributor (Colaborador)**: Pode ler e sugerir livros que caem em uma fila de aprovação (`_inbox`).
  * **Viewer (Somente Leitura)**: Pode ler e salvar seu próprio progresso, sem permissão de alterar a estante.

---

### 🌐 Explorador de Acervos Públicos & Scrapers
Acesse milhões de obras gratuitas e legais direto na aba retrátil da Estante:
* **MangaDex**: Pesquise mangás em Português (PT-BR) e Inglês com leitura imediata ou download `.cbz`.
* **WEBTOON & Tapas**: Scrapers públicos de quadrinhos e cartoons.
* **Standard Ebooks & Project Gutenberg**: Mais de 70.000 livros clássicos em alta qualidade tipográfica.
* **Internet Archive & Wikisource**: Acervos abertos de livros e documentos históricos.

---

## 📖 Guia Prático: Como Usar Cada Ferramenta

### 1. Como Abrir Livros e Usar no Dia a Dia
* **Arrastar e Soltar:** Arraste qualquer arquivo `.epub`, `.mobi`, `.azw3`, `.pdf`, `.cbz` ou `.txt` de qualquer pasta do seu computador para o navegador. Ele entra na sua Estante imediatamente.
* **Navegação:** Use as setas `←` e `→` do teclado, a roda do mouse, ou toque nas laterais da tela no celular.
* **Voltar à Estante:** Clique no botão `Estante` no topo esquerdo a qualquer momento.

### 2. Como Usar a Leitura Biônica
1. Abra qualquer livro de texto (EPUB, MOBI, TXT).
2. Clique no menu **Aa Tema** no topo direito.
3. Marque a caixa **Habilitar Leitura Biônica**.
4. O texto terá as primeiras letras destacadas em negrito instantaneamente. Para voltar ao normal, basta desmarcar.

### 3. Como Usar o NotebookLM (Chat, Podcast e Dossiê)
1. Com um livro aberto, clique em **Recursos ▾** → **Central de Ferramentas ↗**.
2. Clique na aba **NotebookLM**.
3. **Chat:** Digite qualquer pergunta na caixa de texto e clique em *Perguntar*.
4. **Podcast:** Clique no botão azul *Gerar Conversa em Podcast* para ouvir os dois apresentadores debatendo o livro.
5. **Dossiê:** Clique em *Gerar Dossiê de Estudo* para montar o roteiro e clique em *Exportar Markdown* para salvar no seu computador ou Obsidian.

### 4. Como Converter Mangás para Ler no Kindle (RTL)
1. Vá em **Central de Ferramentas ↗** → aba **Conversor & Otimizador**.
2. Arraste seu arquivo `.cbz` ou `.epub` para a área de conversão.
3. Escolha a ordem *Direita para a Esquerda (Mangá Tradicional)*.
4. Clique em *Baixar EPUB Kindle* ou *Enviar p/ Kindle por E-mail*.

### 5. Como Continuar no Celular (QR Code)
1. Enquanto estiver lendo no computador, clique em **Recursos ▾** → **Continuar no Celular**.
2. Um modal flutuante com o QR Code da sua leitura se abrirá.
3. Aponte a câmera do celular para o QR Code: a mesma página e livro serão abertos no seu telefone na hora.

---

## 💾 Como Funciona o Armazenamento Local (IndexedDB)

> **Pergunta frequente:** *"O app guarda os livros no IndexedDB do navegador. Isso não vai deixar o site lento ou pesado com o tempo?"*

**Resposta técnica:** **Não, o site não fica lento!**
1. **Armazenamento em Disco vs Memória RAM:** O IndexedDB funciona como uma pasta no seu disco rígido (SSD/HD), **não na memória RAM ativa do navegador**. Ter 100 livros ou 2 GB de mangás salvos ocupa apenas espaço de armazenamento do dispositivo, sem consumir memória de processamento.
2. **Carregamento Sob Demanda (Lazy Loading):** Ao abrir a Estante, o leitor carrega apenas uma lista leve de metadados (título, autor, capa e porcentagem). O arquivo de 50 MB ou as centenas de imagens de um mangá **nunca são carregadas na memória** até você clicar explicitamente em *Continuar Lendo*.
3. **Liberação Automática de Memória:** Ao fechar o livro ou voltar para a estante, o navegador descarta as páginas da memória RAM imediatamente.
4. **Opção "Só Nuvem":** Se você tem livros sincronizados no Supabase/Drive e quer liberar espaço do seu disco rígido local, basta clicar no botão **Só Nuvem** no card do livro na estante: o arquivo pesado local é removido do navegador, mas o livro continua disponível na sua nuvem para ler quando quiser.

---

## 🔒 Segurança dos Convites: O que acontece se alguém compartilhar o link?

> **Pergunta frequente:** *"Se eu enviar um convite de Somente Leitura para alguém, e essa pessoa tentar compartilhar com acesso completo para ela mesma ou para outro conhecido?"*

O sistema possui uma camada dupla de proteção que **impede qualquer escalação indevida de privilégios**:

1. **O que contém no link de convite:**
   * Quando você escolhe **"Somente Ver e Baixar/Ler" (viewer)**, o link codifica a chave pública e a permissão restrita `role: "viewer"`.
   * Se o convidado repassar o link dele para terceiros, todo mundo que abrir aquele link entrará **obrigatoriamente como Somente Leitura**.
2. **Impossível fraudar no navegador (Bloqueio do Banco de Dados / RLS):**
   * Mesmo que um usuário com conhecimentos de programação tente alterar o código JavaScript ou mandar requisições manuais ao Supabase fingindo ser administrador, o banco de dados PostgreSQL bloqueia a operação através do **Row-Level Security (RLS)**.
   * No modo protegido com a tabela `library_members`, o Supabase verifica se o e-mail dele está registrado como `owner` ou `member`. Como o e-mail dele não está na lista de donos, o banco **rejeita** a gravação com erro `403 Unauthorized`.
3. **Autonomia Segura de Dono:**
   * Somente você, no painel *Gerenciar Membros com Acesso Total*, pode digitar o e-mail de um amigo de confiança e promovê-lo a Membro Completo. Visitantes e convidados de leitura **nunca** conseguem se autopromover.

---

## 🚀 Como Rodar e Fazer Deploy

### 1. Deploy Automático no Vercel (Recomendado)
Como este repositório possui `vercel.json` configurado:
1. Suba este repositório para a sua conta do **GitHub**.
2. Conecte o repositório na **Vercel**.
3. A cada novo commit que você fizer no GitHub, a Vercel compila e atualiza o seu leitor automaticamente na nuvem!

### 2. Deploy no GitHub Pages
1. No seu repositório do GitHub, vá em **Settings** > **Pages**.
2. Em **Branch**, selecione `main` e a pasta `/ (root)`.
3. Clique em **Save**. O link do site será gerado em instantes.

### 3. Execução 100% Offline no Computador
* Dê dois cliques no arquivo **[`Start_Visual_App.bat`](./Start_Visual_App.bat)** (Windows) ou simplesmente abra o arquivo **[`index.html`](./index.html)** no Chrome, Edge ou Firefox.

---

## 🛠️ Arquitetura e Compilação

O código-fonte é organizado de forma modular dentro da pasta `src/`:

```
portable-book-reader/
├── index.html                  # Bundle final compilado pronto para deploy
├── portable_book_reader.html    # Cópia monolítica para uso local
├── build_bundle.py             # Compilador dos arquivos de src/
├── SUPABASE_SETUP.sql          # Configuração do banco Postgres & Storage
├── manga_kindle_converter.py   # Utilitário CLI Python para mangás
│
├── src/                        # Código-fonte limpo e modular
│   ├── 00_head.html            # Metatags, PWA e bibliotecas JS
│   ├── 01_styles.css           # Estilos visuais, temas e responsividade
│   ├── 02_body.html            # Estrutura HTML, menus e modais
│   ├── 03_core_parsers.js      # Decodificadores MOBI, EPUB, PDF, CBZ
│   ├── 04_reader_ui.js         # Interface de leitura, paginação e eventos
│   ├── 05_cloud_sync.js        # Supabase, Google Drive, OneDrive, Perfis
│   ├── 06_catalogs_init.js     # OPDS, Scrapers e inicialização
│   └── 99_tail.html            # Fechamento e Service Worker
```

### Como Compilar Alterações:
Sempre que fizer mudanças dentro da pasta `src/`, execute no terminal:
```bash
python build_bundle.py
```
Isso atualizará automaticamente os arquivos finais `index.html` e `portable_book_reader.html`.

---

## 📄 Licença
Distribuído sob a licença **MIT**. Sinta-se livre para usar, estudar, modificar e compartilhar com seus amigos!
