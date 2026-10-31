# Agente RSS → LinkedIn (n8n + HITL Telegram)

Stack Docker Compose local: o n8n lê feeds de Product Management e Programação, gera um post LinkedIn em PT-BR com o Gemini, pede aprovação no Telegram (Aprovar / Rejeitar / Ajustar) e, só após aprovação, gera um carrossel PDF e publica no LinkedIn.

## Arquitetura

| Peça | Função |
| --- | --- |
| `n8n` | Orquestração (2 workflows) |
| `carousel` | Draft store HTTP + geração de carrossel PDF (`pdf-lib`, 1080×1350) |
| Túnel HTTPS | Expõe webhooks do Telegram (`WEBHOOK_URL`) |

```text
Cron → RSS → Gemini (JSON) → salva draft → Telegram (botões)
                                              ↓ callback
                         Webhook → Switch → approve → PDF → LinkedIn
                                         → reject
                                         → revise → texto → Gemini → Telegram
```

## Estrutura

```text
├── docker-compose.yml
├── .env / .env.example
├── workflows/
│   ├── 01-producer-rss-draft.json
│   └── 02-approver-telegram-linkedin.json
├── carousel/                 # sidecar PDF + drafts
├── prompts/                  # system prompts (referência)
└── scripts/
    ├── set-telegram-webhook.sh
    └── generate-workflows.js
```

## Configurar

```bash
cp .env.example .env
```

Preenche no `.env`:

| Variável | Obrigatório | Notas |
| --- | --- | --- |
| `GEMINI_API_KEY` | sim | [Google AI Studio](https://aistudio.google.com/apikey) |
| `TELEGRAM_BOT_TOKEN` | sim | [@BotFather](https://t.me/BotFather) |
| `TELEGRAM_CHAT_ID` | sim | teu chat numérico |
| `WEBHOOK_URL` | sim (HITL) | URL HTTPS pública do túnel, com `/` final |
| `N8N_PROTOCOL` / `N8N_HOST` | sim (HITL) | `https` + hostname do túnel |
| `CAROUSEL_URL` | não | default `http://carousel:3000` |
| `LINKEDIN_AUTHOR_URN` | para publicar | `urn:li:person:XXXX` |
| `LINKEDIN_ACCESS_TOKEN` | para publicar | OAuth com `w_member_social` |
| `LINKEDIN_CLIENT_ID/SECRET` | documentação | app em [LinkedIn Developers](https://www.linkedin.com/developers/) |

### Túnel (Cloudflare quick tunnel)

Num terminal à parte:

```bash
cloudflared tunnel --url http://localhost:5678
```

Copia a URL `https://….trycloudflare.com` para o `.env`:

```bash
WEBHOOK_URL=https://SEU-SUBDOMINIO.trycloudflare.com/
N8N_PROTOCOL=https
N8N_HOST=SEU-SUBDOMINIO.trycloudflare.com
```

Reinicia o n8n depois de alterar `WEBHOOK_URL`.

### Webhook do Telegram

Com o Approver **ativo** no n8n (path `telegram-approver`):

```bash
./scripts/set-telegram-webhook.sh
```

Isto aponta o Bot API para `WEBHOOK_URL/webhook/telegram-approver`.

> Sem URL pública HTTPS, os botões do Telegram não disparam o Approver.

## Subir

> O sidecar usa `node:20-bookworm-slim` (leve). Se um build anterior do Playwright encheu o disco do Docker Desktop, liberta espaço (Images/Build cache) antes de subir.

```bash
docker compose up -d --build
```

Smoke-test do carrossel sem Docker:

```bash
cd carousel && npm install --omit=dev && node server.js
# noutro terminal:
curl -s http://127.0.0.1:3000/health
```

UI: [http://localhost:5678](http://localhost:5678)

```bash
docker compose logs -f n8n carousel
```

## Importar workflows

1. Na UI: **Import from File**
2. Importa `workflows/01-producer-rss-draft.json`
3. Importa `workflows/02-approver-telegram-linkedin.json`
4. Ativa os dois (o Approver primeiro, para o webhook existir)
5. Corre `./scripts/set-telegram-webhook.sh`

O Producer dispara às **08:00** (`America/Sao_Paulo`). Para testar: **Execute Workflow** no Producer.

## Fluxo humano (Telegram)

1. Recebes o rascunho com botões **Aprovar / Rejeitar / Ajustar**
2. **Aprovar** → gera PDF (pré-visualização no Telegram) → publica no LinkedIn
3. **Rejeitar** → marca draft e para
4. **Ajustar** → respondes com o texto do ajuste (máx. 3 revisões) → novo rascunho com botões

Drafts ficam em `carousel` (`POST/GET/PATCH /drafts`), TTL 7 dias. Callbacks em drafts já `published`/`rejected` são ignorados.

## LinkedIn

1. Cria app em LinkedIn Developers; produto **Share on LinkedIn**
2. OAuth com escopo `w_member_social`; obtém access token e `urn:li:person:…`
3. Preenche `LINKEDIN_ACCESS_TOKEN` e `LINKEDIN_AUTHOR_URN`
4. Reinicia o compose se necessário

O Approver usa a Documents API (`/rest/documents?action=initializeUpload`) + `/rest/posts` com o PDF. Se o teu app não tiver permissão de DOCUMENT, a publicação falha — nesse caso adapta o branch approve para multi-image (o sidecar já gera PNGs internamente; expõe endpoint de imagens se precisares).

## Sidecar `carousel`

| Endpoint | Uso |
| --- | --- |
| `GET /health` | healthcheck |
| `POST /render` | `{ slides, theme }` → PDF |
| `POST /drafts` | cria draft |
| `GET /drafts/:id` | lê draft |
| `PATCH /drafts/:id` | atualiza status/conteúdo |

Slides: páginas PDF **1080×1350** desenhadas com `pdf-lib` (tema via `theme.bg` / `theme.accent`). Os HTML/CSS em `carousel/templates/` servem de referência visual; o render runtime não depende de Chromium (imagem Docker leve).

## Feeds

Product: Lenny's, SVPG, Roman Pichler, Product Coalition, Product Compass, Reddit r/ProductManagement.

Programming: Hacker News, CSS-Tricks, DEV.to.

Editáveis no nó **Lista de feeds** do Producer.

## Parar

```bash
docker compose stop
# ou
docker compose down   # mantém volumes n8n_data e carousel_drafts
```

## Notas

- Tokens e chat vêm do `.env` (`N8N_BLOCK_ENV_ACCESS_IN_NODE=false`). Não é preciso credencial Telegram na UI.
- O workflow legado `workflow-rss-telegram.json` foi substituído pelos dois ficheiros em `workflows/`.
- Prompts de referência: `prompts/system-linkedin-ptbr.md` e `prompts/revise-linkedin-ptbr.md` (o texto efectivo está embutido nos workflows; regenera com `node scripts/generate-workflows.js` se alterares o gerador).
