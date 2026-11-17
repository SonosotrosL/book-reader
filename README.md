# Tonho Book Reader

Leitor de livros, mangás e quadrinhos que roda no navegador, no computador e no celular. Dá para instalar como app (PWA) e ler sem internet os livros que já estão no aparelho.

Além de ler, ele tem ferramentas para estudar e aprender idiomas: destaques, notas, cartões no estilo Anki, tradução, dicionário e resumos com IA (opcional, com uma chave gratuita do Google Gemini).

Site: https://tonhobookreader.vercel.app

---

## Sumário

- [O que ele lê](#o-que-ele-lê)
- [Lendo](#lendo)
- [Estudo e idiomas](#estudo-e-idiomas)
- [IA (opcional)](#ia-opcional)
- [Nuvem e estante compartilhada](#nuvem-e-estante-compartilhada)
- [Livros e mangás gratuitos](#livros-e-mangás-gratuitos)
- [Kindle](#kindle)
- [O que precisa de internet](#o-que-precisa-de-internet)
- [Limitações conhecidas](#limitações-conhecidas)
- [Publicar na Vercel](#publicar-na-vercel)
- [Configurar o Supabase](#configurar-o-supabase)
- [Rodar no computador](#rodar-no-computador)
- [Estrutura do código](#estrutura-do-código)

---

## O que ele lê

| Formato | Observações |
|---|---|
| EPUB 2 e 3 | Imagens, sumário, notas de rodapé e capa. |
| MOBI, AZW, AZW3, PRC | Leitura dos formatos do Kindle sem DRM. |
| PDF | Página original (com zoom) ou modo texto. Sumário e busca. |
| CBZ / ZIP | Mangá (direita para a esquerda), HQ (esquerda para a direita), página dupla e tira contínua estilo Webtoon. |
| FB2 | Inclui arquivos antigos em windows-1251. |
| DOCX, ODT, RTF | Abre como livro de texto. |
| TXT, Markdown, HTML | TXT em UTF-8 ou Latin-1 (acentos de arquivos antigos aparecem certos). |
| SRT, VTT | Legendas, lidas como texto. |

CBR (RAR) não é suportado. Converta para CBZ antes (o Calibre ou o 7-Zip fazem isso).

---

## Lendo

- **Abrir um livro:** "+ Adicionar livro" na estante, arrastar o arquivo para a janela, ou colar o link de um arquivo.
- **Virar a página:** setas do teclado, botões da barra, toque nas laterais da tela ou deslizar o dedo. No mangá, toque duplo na página abre o zoom.
- **Modos de página:** Contínuo, Capítulo, 1 página e 2 páginas.
- **Voltar à estante:** botão "‹ Estante". O ponto onde você parou fica salvo, e ao reabrir o livro aparece uma marca "Você parou aqui".
- **Progresso:** a porcentagem é a mesma no rodapé, no topo da página e no card da estante. O rodapé também mostra página estimada, posição no estilo Kindle e tempo restante (clique nele para alternar).
- **Aparência (botão Aa):** tema do app (claro, sépia, escuro, OLED), cor da página, fonte (inclui OpenDyslexic, se estiver instalada no aparelho), tamanho, entrelinha, largura do texto, alinhamento e texto vertical (japonês/chinês).
- **Conforto:** luz âmbar sobre a tela, régua de foco, leitura biônica, Pomodoro e sons de fundo (chuva, ruído marrom e lareira, gerados no próprio navegador).
- **Navegação:** sumário, busca (Ctrl+F), marcadores (Ctrl+D), "Ir para" uma porcentagem ou posição (tecla G), miniaturas para folhear o livro e galeria com todas as imagens do livro.
- **Imagens:** clique (ou toque duplo) para ampliar, girar, copiar ou baixar.

Pomodoro, sons, ferramentas de estudo e de idiomas ficam escondidos por padrão. Ative em **Aa → App e estante → Mostrar ferramentas extras**.

---

## Estudo e idiomas

Ao selecionar um trecho aparece uma barra com:

- **Cores de destaque** e nota.
- **Dicionário** (português e inglês) e **Wikipédia**.
- **Traduzir** e **Ouvir** (pronúncia com a voz do aparelho).
- **+ Anki**: cria um cartão com a palavra, o significado e a frase do livro.

Outras ferramentas:

- **Cartões e revisão:** revisão espaçada dentro do app (no estilo do Anki), exportação em `.tsv` e envio direto para o Anki Desktop (pelo add-on AnkiConnect).
- **Quiz de lacunas** feito a partir dos seus destaques.
- **Vocabulário frequente** do livro, com botão para virar cartão.
- **Word Wise:** dicas curtas acima de palavras difíceis. Usa uma lista pequena de palavras literárias (português e inglês) mais as palavras que você salvou como cartão.
- **Nível CEFR** (A1 a C2) no rodapé, só para livros em inglês.
- **Método Cornell:** painel de anotações (perguntas, notas e resumo), exportável em Markdown.
- **Destaques e citações:** lista com filtro e exportação em Markdown, Word, PDF ou para o Obsidian.
- **Citação bibliográfica** do livro em ABNT, APA ou BibTeX.
- **Tradução do capítulo** lado a lado ou abaixo de cada parágrafo.
- **Resumo e quiz** do capítulo, e **revisor gramatical** (LanguageTool).
- **Metas:** minutos lidos por dia, sequência de dias, palavras por minuto e meta anual de livros.

---

## IA (opcional)

Sem chave, essas ferramentas funcionam em modo básico: mostram trechos do próprio livro, não respostas geradas. Com uma chave gratuita do Google Gemini (criada em aistudio.google.com) elas passam a usar o Gemini 2.5 Flash. A chave fica salva só no seu navegador.

- **Recap:** "o que aconteceu até aqui", com ou sem spoilers.
- **Tutor:** perguntas sobre o trecho selecionado ou o capítulo.
- **Raio-X:** personagens e termos recorrentes e onde aparecem.
- **NotebookLM:** chat com o livro (precisa da chave), guia de estudo exportável em `.md` e um "podcast" com duas vozes lido pelo próprio aparelho.

Tudo isso fica em **⋯ Recursos → IA & Estudo**. O mesmo menu mostra se a chave está configurada.

---

## Nuvem e estante compartilhada

- **Supabase:** guarda os livros, o progresso, as notas, os cartões e o perfil, e sincroniza entre celular e computador.
- **Google Drive ou OneDrive:** alternativa usando a sua própria conta.
- **Estante compartilhada:** cada pessoa entra com o próprio e-mail e tem progresso e notas separados. O dono escolhe o papel de cada um:

| Papel | Pode |
|---|---|
| Dono | Tudo, inclusive gerenciar membros |
| Membro | Ler, enviar e apagar livros |
| Colaborador | Ler e sugerir livros (o dono aprova) |
| Leitor | Ler e salvar o próprio progresso |

A estante é privada: quem não estiver logado com um e-mail liberado em **Gerenciar membros** não vê nada. O link de convite só leva a pessoa até a estante; ela ainda precisa entrar com o e-mail cadastrado.

---

## Livros e mangás gratuitos

Na estante, "Buscar livros e mangás gratuitos" pesquisa em:

- MangaDex (português e inglês), WEBTOON e Tapas;
- Standard Ebooks, Project Gutenberg, Open Library, Wikisource;
- Internet Archive (livros, quadrinhos e mangás).

Dá para ler na hora ou salvar na estante. Essas buscas passam pelo servidor (`/api/opds-proxy`), então só funcionam no site publicado, não abrindo o arquivo direto do computador.

---

## Kindle

- **Conversor de mangá:** gera um EPUB de layout fixo, da direita para a esquerda, pronto para o Send to Kindle (Ferramentas → Conversor). Também existe o script `manga_kindle_converter.py`, para converter pastas inteiras no computador:
  ```bash
  python manga_kindle_converter.py "C:\Mangas" -o "C:\Mangas\Kindle"
  ```
  Use `--ltr` para quadrinhos ocidentais.
- **Enviar por e-mail:** envia para o seu endereço `@kindle.com` usando o seu Gmail (com senha de app), Brevo ou Resend. O servidor só aceita destinos `@kindle.com` e arquivos de até ~3 MB. Para arquivos maiores, use o botão que abre o Send to Kindle da Amazon.
- **Conversor de formatos:** gera EPUB, MOBI, RTF, ODT, Markdown e TXT a partir do livro aberto. É uma conversão só de texto (imagens e formatação avançada se perdem). "PDF" abre a janela de impressão para salvar como PDF. Para conversões fiéis, use o Calibre.

---

## O que precisa de internet

Funciona sem internet: ler livros que já estão no aparelho, destaques, notas, cartões, revisão, Cornell, metas, sons, Pomodoro e o modo básico das ferramentas de IA.

Precisa de internet: nuvem, acervos gratuitos, dicionário, tradução, Wikipédia, revisor gramatical, IA com chave, QR code e envio ao Kindle.

---

## Limitações conhecidas

- CBR não é suportado.
- A narração (TTS) usa as vozes instaladas no aparelho, então a qualidade e os idiomas variam. Não há exportação em MP3.
- O "Continuar no celular" (QR code) abre o mesmo livro e posição no celular se o livro estiver na nuvem ou já estiver salvo no celular.
- Livros com DRM (comprados na Amazon, Kobo etc.) não abrem.
- O conversor de formatos trabalha só com o texto.

---

## Publicar na Vercel

1. Suba o repositório no GitHub e importe o projeto na Vercel. A cada commit a Vercel publica de novo.
2. Configure as variáveis de ambiente (Settings → Environment Variables):

| Variável | Para quê |
|---|---|
| `SUPABASE_URL` | URL do projeto Supabase |
| `SUPABASE_ANON_KEY` | chave pública (anon) do Supabase |
| `SUPABASE_BUCKET` | nome do bucket (padrão `books`) |
| `GDRIVE_CLIENT_ID` / `ONEDRIVE_CLIENT_ID` | opcional, login no Drive ou OneDrive |
| `OWNER_NOTIFY_EMAIL` | opcional, e-mail que recebe aviso de livros sugeridos |
| `KINDLE_SMTP_USER`, `KINDLE_SMTP_PASS`, `KINDLE_EMAIL_PROVIDER` | opcional, conta usada só para enviar esse aviso |
| `OPDS_PROXY_EXTRA_HOSTS` | opcional, domínios extras liberados no proxy (ex.: `meucatalogo.com,outro.org`) |

O GitHub Pages não serve, porque não roda as funções da pasta `api/`.

---

## Configurar o Supabase

1. Crie um projeto no Supabase.
2. Abra o SQL Editor, cole o conteúdo de `SUPABASE_SETUP.sql`, troque o e-mail do dono se precisar e clique em Run. Pode rodar de novo sem problema.
3. No app, entre com o e-mail do dono e adicione as outras pessoas em **Conta → Nuvem → Gerenciar membros**.

O script deixa o bucket privado, cria os papéis acima e garante que cada pessoa só altere o próprio progresso.

---

## Rodar no computador

Abrir o `index.html` direto funciona para ler livros locais. Para testar tudo (Service Worker, nuvem), sirva a pasta com um servidor simples:

```bash
python -m http.server 8080
```

e abra http://localhost:8080. As funções da pasta `api/` (acervos, Kindle) só funcionam na Vercel ou com `vercel dev`.

---

## Estrutura do código

O app é um único HTML gerado a partir dos arquivos em `src/`:

```
index.html                  gerado pelo build (é o que a Vercel publica)
portable_book_reader.html   cópia idêntica do index.html
build_bundle.py             junta os arquivos de src/ e gera os dois HTML
sw.js                       Service Worker (cache offline)
manifest.webmanifest        dados do app instalável
SUPABASE_SETUP.sql          tabelas e permissões do Supabase
manga_kindle_converter.py   conversor de mangá para Kindle (linha de comando)
api/                        funções da Vercel: proxy dos acervos, Kindle, AnkiWeb, configuração da nuvem
src/
  00_head.html              cabeçalho e bibliotecas
  01_styles.css             estilos e temas
  02_body.html              HTML da interface
  03_core_parsers.js        leitura dos formatos (EPUB, MOBI, PDF, CBZ...)
  04_reader_ui.js           leitor, estante, menus e ferramentas
  05_cloud_sync.js          nuvem, perfis e membros
  06_catalogs_init.js       acervos gratuitos e inicialização
  99_tail.html              fechamento do HTML
```

Depois de mudar qualquer arquivo em `src/`, rode:

```bash
python build_bundle.py
```

Ao publicar mudanças, aumente o número em `CACHE_VERSION` no `sw.js` para os aparelhos baixarem a versão nova.

---

Licença MIT.
