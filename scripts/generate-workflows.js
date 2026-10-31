'use strict';

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outDir = path.join(root, 'workflows');
fs.mkdirSync(outDir, { recursive: true });

const SYSTEM_PROMPT = [
  'És um ghostwriter de LinkedIn para Product Managers e Tech Leads no Brasil.',
  'Tom: direto, concreto, storytelling curto. Zero hype vazio, zero emojis excessivos, sem markdown.',
  'Usa apenas factos presentes nos artigos. Português do Brasil.',
  'Hook na 1ª linha. Hashtags 3–5. Carrossel 5–8 slides (slide 1 = capa/hook; último = CTA + fontes).',
  'footer de cada slide no formato n/total (ex.: 1/6).',
  'Responde SOMENTE com JSON válido:',
  '{"hook":"...","post_text":"...","hashtags":["#..."],"carousel_slides":[{"title":"...","body":"...","footer":"1/6"}],"sources":[{"title":"...","url":"..."}]}',
].join(' ');

const REVISE_PROMPT = [
  'És um ghostwriter de LinkedIn para Product Managers e Tech Leads no Brasil.',
  'Recebes um rascunho JSON e instruções de ajuste do autor.',
  'Aplica os ajustes sem inventar factos. Mantém PT-BR, tom direto, sem markdown.',
  'Se necessário, regenera o carrossel (5–8 slides) coerente com o novo texto.',
  'Responde SOMENTE com JSON no mesmo schema do rascunho.',
].join(' ');

const feedsCode = String.raw`const feeds = [
  {
    source: "Lenny's Newsletter",
    focus: 'estratégia, growth e métricas de produto',
    url: 'https://www.lennysnewsletter.com/feed',
  },
  {
    source: 'SVPG',
    focus: 'cultura, liderança e práticas de produto',
    url: 'https://www.svpg.com/feed/',
  },
  {
    source: 'Roman Pichler',
    focus: 'agile, roadmaps e backlogs de produto',
    url: 'https://www.romanpichler.com/feed/',
  },
  {
    source: 'Product Coalition',
    focus: 'artigos da comunidade de product management',
    url: 'https://www.productcoalition.com/feed',
  },
  {
    source: 'The Product Compass',
    focus: 'estratégias práticas, frameworks e produtos de IA',
    url: 'https://www.productcompass.pm/feed',
  },
  {
    source: 'Reddit r/ProductManagement',
    focus: 'discussões, carreira e bastidores de PMs',
    url: 'https://www.reddit.com/r/ProductManagement/.rss',
  },
  {
    source: 'Hacker News',
    focus: 'engenharia, startups e discussões técnicas',
    url: 'https://hnrss.org/frontpage',
  },
  {
    source: 'CSS-Tricks',
    focus: 'frontend, CSS e práticas de desenvolvimento web',
    url: 'https://css-tricks.com/feed/',
  },
  {
    source: 'DEV.to',
    focus: 'programação, carreira em tech e tutoriais',
    url: 'https://dev.to/feed',
  },
];

return feeds.map((feed) => ({ json: feed }));
`;

const selectCode = String.raw`const WINDOW_DAYS = 21;
const DEFAULT_LIMIT = 2;
const LIMITS = {
  'Reddit r/ProductManagement': 5,
  'Hacker News': 3,
  'DEV.to': 3,
};

function decode(value) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function stripHtml(value) {
  return decode(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function textTag(block, names) {
  for (const name of names) {
    const match = block.match(new RegExp('<' + name + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + name + '>', 'i'));
    if (match && stripHtml(match[1])) return stripHtml(match[1]);
  }
  return '';
}

function atomLink(block) {
  const tags = block.match(/<link\b[^>]*>/gi) || [];
  let fallback = '';
  for (const tag of tags) {
    const href = (tag.match(/href=["']([^"']+)["']/i) || [])[1] || '';
    const rel = (tag.match(/rel=["']([^"']+)["']/i) || [])[1] || 'alternate';
    if (!href) continue;
    if (rel === 'alternate') return decode(href);
    if (!fallback) fallback = decode(href);
  }
  return fallback;
}

function blocksOf(xml) {
  const marker = /<entry[\s>]/i.test(xml) && !/<item[\s>]/i.test(xml) ? 'entry' : 'item';
  return xml
    .split(new RegExp('<' + marker + '[\\s>]', 'i'))
    .slice(1)
    .map((part) => part.split(new RegExp('</' + marker + '>', 'i'))[0]);
}

function feedFor(item, index) {
  if (item.json?.source && item.json?.url && !item.json?.xml) return item.json;
  const feeds = $('Lista de feeds').all();
  const paired = item.pairedItem;
  const pairedIndex = Array.isArray(paired) ? paired[0]?.item : paired?.item;
  return feeds[pairedIndex ?? index]?.json ?? { source: 'Fonte desconhecida', focus: '', url: '' };
}

const staticData = $getWorkflowStaticData('global');
const sent = new Set(staticData.sentLinks || []);
const cutoff = Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
const grouped = new Map();

for (const [index, item] of $input.all().entries()) {
  const feed = feedFor(item, index);
  const xml = typeof item.json?.xml === 'string' ? item.json.xml : '';
  if (!xml.includes('<item') && !xml.includes('<entry')) continue;

  const articles = blocksOf(xml)
    .map((block) => {
      const rawDate = textTag(block, ['pubDate', 'published', 'updated', 'dc:date']);
      const timestamp = Date.parse(rawDate);
      return {
        source: feed.source,
        focus: feed.focus,
        title: textTag(block, ['title']),
        link: textTag(block, ['link']) || atomLink(block),
        pubDate: rawDate,
        timestamp: Number.isNaN(timestamp) ? null : timestamp,
        excerpt: textTag(block, ['description', 'summary', 'content', 'content:encoded']).slice(0, 500),
      };
    })
    .filter((article) => article.title && article.link && article.timestamp && article.timestamp >= cutoff && !sent.has(article.link))
    .sort((left, right) => right.timestamp - left.timestamp);

  const limit = LIMITS[feed.source] || DEFAULT_LIMIT;
  grouped.set(feed.source, articles.slice(0, limit));
}

const selected = [...grouped.values()].flat().sort((left, right) => right.timestamp - left.timestamp);

if (selected.length === 0) {
  return [{
    json: {
      hasNews: false,
      count: 0,
      links: [],
      message: 'Agente LinkedIn\n\nNão há artigos novos nos últimos 21 dias nas fontes acompanhadas.',
    },
  }];
}

const prompt = [
  'Gera um post LinkedIn + carrossel a partir destes artigos.',
  '',
  selected.map((article, index) => [
    (index + 1) + '. ' + article.source,
    'Foco da fonte: ' + article.focus,
    'Título: ' + article.title,
    'Data: ' + article.pubDate,
    'Link: ' + article.link,
    article.excerpt ? 'Excerto: ' + article.excerpt : '',
  ].filter(Boolean).join('\n')).join('\n\n'),
].join('\n');

return [{
  json: {
    hasNews: true,
    count: selected.length,
    links: selected.map((article) => article.link),
    prompt,
  },
}];
`;

const parseDraftCode = String.raw`const response = $input.first().json;
const source = $('Seleccionar notícias').first().json;

if (response?.promptFeedback?.blockReason) {
  throw new Error('Pedido bloqueado pelo Gemini: ' + response.promptFeedback.blockReason);
}

const parts = response?.candidates?.[0]?.content?.parts ?? [];
const text = parts.map((part) => part.text || '').join('').trim();
if (!text) {
  const finishReason = response?.candidates?.[0]?.finishReason || 'sem conteúdo';
  throw new Error('Resposta vazia do Gemini (' + finishReason + ').');
}

let parsed;
try {
  const fence = String.fromCharCode(96, 96, 96);
  const cleaned = text
    .replace(new RegExp('^' + fence + 'json\\\\s*', 'i'), '')
    .replace(new RegExp('^' + fence + '\\\\s*', 'i'), '')
    .replace(new RegExp('\\\\s*' + fence + '$', 'i'), '')
    .trim();
  parsed = JSON.parse(cleaned);
} catch (error) {
  throw new Error('Gemini não devolveu JSON válido: ' + error.message);
}

const slides = Array.isArray(parsed.carousel_slides) ? parsed.carousel_slides.slice(0, 8) : [];
if (!parsed.post_text || slides.length < 3) {
  throw new Error('JSON incompleto: post_text e pelo menos 3 slides são obrigatórios.');
}

const draftId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const hashtags = Array.isArray(parsed.hashtags) ? parsed.hashtags : [];
let postText = String(parsed.post_text).trim();
if (hashtags.length && !hashtags.some((tag) => postText.includes(tag))) {
  postText = postText + '\n\n' + hashtags.join(' ');
}

return [{
  json: {
    draftId,
    status: 'pending',
    revisionCount: 0,
    links: source.links || [],
    count: source.count,
    hook: parsed.hook || '',
    post_text: postText,
    hashtags,
    carousel_slides: slides,
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
  },
}];
`;

const registerCode = String.raw`const staticData = $getWorkflowStaticData('global');
const links = $('Seleccionar notícias').first().json.links || [];
const sent = new Set(staticData.sentLinks || []);
for (const link of links) sent.add(link);
staticData.sentLinks = [...sent].slice(-500);
return [{ json: { registered: links.length } }];
`;

const noNewsPrepareCode = String.raw`const source = $input.first().json;
return [{
  json: {
    message: source.message,
    reply_markup: undefined,
    skipKeyboard: true,
  },
}];
`;

const prepareTelegramCode = String.raw`const draft = $('Parse draft').first().json;
const save = $input.first().json;
const draftId = save.draftId || draft.draftId;

let message = '📝 Rascunho LinkedIn (' + draftId + ')\n\n' + draft.post_text;
const limit = 3900;
if (message.length > limit) {
  message = message.slice(0, limit - 16) + '\n\n[truncado]';
}

return [{
  json: {
    draftId,
    message,
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Aprovar', callback_data: 'approve:' + draftId },
        { text: '❌ Rejeitar', callback_data: 'reject:' + draftId },
        { text: '✏️ Ajustar', callback_data: 'revise:' + draftId },
      ]],
    },
  },
}];
`;

const producer = {
  id: 'wf01producerlinkedin',
  name: '01 Producer RSS → Draft LinkedIn',
  active: false,
  nodes: [
    {
      parameters: {
        rule: { interval: [{ field: 'cronExpression', expression: '0 8 * * *' }] },
      },
      id: 'p01-cron',
      name: 'Cron diário 08:00',
      type: 'n8n-nodes-base.scheduleTrigger',
      typeVersion: 1.2,
      position: [0, 300],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: feedsCode },
      id: 'p01-feeds',
      name: 'Lista de feeds',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [260, 300],
    },
    {
      parameters: {
        method: 'GET',
        url: '={{ $json.url }}',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'User-Agent', value: 'Mozilla/5.0 (compatible; n8n-linkedin-agent/1.0)' },
            { name: 'Accept', value: 'application/rss+xml, application/atom+xml, application/xml, text/xml' },
          ],
        },
        options: {
          timeout: 30000,
          response: { response: { neverError: true, responseFormat: 'text', outputPropertyName: 'xml' } },
        },
      },
      id: 'p01-fetch',
      name: 'Buscar feeds',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [520, 300],
      onError: 'continueRegularOutput',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: selectCode },
      id: 'p01-select',
      name: 'Seleccionar notícias',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [780, 300],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{
            id: 'p01-cond-news',
            leftValue: '={{ $json.hasNews }}',
            rightValue: '',
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          }],
          combinator: 'and',
        },
        options: {},
      },
      id: 'p01-if',
      name: 'Há notícias novas',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.4,
      position: [1040, 300],
    },
    {
      parameters: {
        method: 'POST',
        url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
        sendHeaders: true,
        headerParameters: {
          parameters: [{ name: 'x-goog-api-key', value: '={{ $env.GEMINI_API_KEY }}' }],
        },
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({
  systemInstruction: { parts: [{ text: ${JSON.stringify(SYSTEM_PROMPT)} }] },
  contents: [{ role: 'user', parts: [{ text: $json.prompt }] }],
  generationConfig: {
    temperature: 0.5,
    maxOutputTokens: 8192,
    responseMimeType: 'application/json'
  }
}) }}`,
        options: { timeout: 120000 },
      },
      id: 'p01-gemini',
      name: 'Gerar post LinkedIn',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1300, 180],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: parseDraftCode },
      id: 'p01-parse',
      name: 'Parse draft',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1560, 180],
    },
    {
      parameters: {
        method: 'POST',
        url: '={{ ($env.CAROUSEL_URL || \'http://carousel:3000\') + \'/drafts\' }}',
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json) }}',
        options: { timeout: 15000 },
      },
      id: 'p01-save',
      name: 'Salvar draft',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1820, 180],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: prepareTelegramCode },
      id: 'p01-prep-tg',
      name: 'Preparar Telegram',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [2080, 180],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: noNewsPrepareCode },
      id: 'p01-nonews',
      name: 'Preparar sem novidades',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1300, 420],
    },
    {
      parameters: {
        method: 'POST',
        url: "={{ 'https://api.telegram.org/bot' + $env.TELEGRAM_BOT_TOKEN + '/sendMessage' }}",
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({
  chat_id: $env.TELEGRAM_CHAT_ID,
  text: $json.message,
  disable_web_page_preview: true,
  ...( $json.reply_markup ? { reply_markup: $json.reply_markup } : {} )
}) }}`,
        options: { timeout: 30000 },
      },
      id: 'p01-send',
      name: 'Enviar no Telegram',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [2340, 300],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: registerCode },
      id: 'p01-reg',
      name: 'Registar enviados',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [2600, 300],
      notes: 'Guarda links já enviados. Rejeição no Approver não devolve o artigo.',
    },
  ],
  connections: {
    'Cron diário 08:00': { main: [[{ node: 'Lista de feeds', type: 'main', index: 0 }]] },
    'Lista de feeds': { main: [[{ node: 'Buscar feeds', type: 'main', index: 0 }]] },
    'Buscar feeds': { main: [[{ node: 'Seleccionar notícias', type: 'main', index: 0 }]] },
    'Seleccionar notícias': { main: [[{ node: 'Há notícias novas', type: 'main', index: 0 }]] },
    'Há notícias novas': {
      main: [
        [{ node: 'Gerar post LinkedIn', type: 'main', index: 0 }],
        [{ node: 'Preparar sem novidades', type: 'main', index: 0 }],
      ],
    },
    'Gerar post LinkedIn': { main: [[{ node: 'Parse draft', type: 'main', index: 0 }]] },
    'Parse draft': { main: [[{ node: 'Salvar draft', type: 'main', index: 0 }]] },
    'Salvar draft': { main: [[{ node: 'Preparar Telegram', type: 'main', index: 0 }]] },
    'Preparar Telegram': { main: [[{ node: 'Enviar no Telegram', type: 'main', index: 0 }]] },
    'Preparar sem novidades': { main: [[{ node: 'Enviar no Telegram', type: 'main', index: 0 }]] },
    'Enviar no Telegram': { main: [[{ node: 'Registar enviados', type: 'main', index: 0 }]] },
  },
  pinData: {},
  settings: {
    executionOrder: 'v1',
    timezone: 'America/Sao_Paulo',
    callerPolicy: 'workflowsFromSameOwner',
  },
  meta: { templateCredsSetupCompleted: true },
};

// ——— Approver ———

const parseUpdateCode = String.raw`const body = $input.first().json;
const expectedChat = String($env.TELEGRAM_CHAT_ID || '');
const staticData = $getWorkflowStaticData('global');

const cq = body.callback_query;
if (cq) {
  const chatId = String(cq.message?.chat?.id ?? '');
  const data = String(cq.data || '');
  const [action, draftId] = data.split(':');
  return [{
    json: {
      kind: 'callback',
      okChat: chatId === expectedChat,
      chatId,
      action: action || '',
      draftId: draftId || '',
      callbackQueryId: cq.id,
      messageId: cq.message?.message_id,
      text: '',
    },
  }];
}

const msg = body.message;
if (msg && msg.text && !msg.text.startsWith('/')) {
  const chatId = String(msg.chat?.id ?? '');
  const draftId = staticData.pendingRevisionDraftId || '';
  return [{
    json: {
      kind: 'revision_text',
      okChat: chatId === expectedChat,
      chatId,
      action: 'apply_revision',
      draftId,
      callbackQueryId: '',
      messageId: msg.message_id,
      text: msg.text,
    },
  }];
}

return [{
  json: {
    kind: 'ignore',
    okChat: false,
    chatId: '',
    action: '',
    draftId: '',
    callbackQueryId: '',
    messageId: null,
    text: '',
  },
}];
`;

const afterLoadDraftCode = String.raw`const update = $('Parse update').first().json;
const draft = $input.first().json;

if (draft.error) {
  return [{ json: { ...update, abort: true, abortReason: draft.error } }];
}

const status = draft.status || 'pending';
const revisionCount = Number(draft.revisionCount || 0);
let abort = false;
let abortReason = '';

if (update.kind === 'callback') {
  if (!['approve', 'reject', 'revise'].includes(update.action)) {
    abort = true;
    abortReason = 'ação desconhecida';
  } else if (status === 'published' || status === 'rejected') {
    abort = true;
    abortReason = 'draft já finalizado (' + status + ')';
  } else if (status !== 'pending' && status !== 'pending_revision') {
    abort = true;
    abortReason = 'status inválido: ' + status;
  }
}

if (update.kind === 'revision_text') {
  if (!update.draftId) {
    abort = true;
    abortReason = 'nenhum ajuste pendente';
  } else if (status !== 'pending_revision') {
    abort = true;
    abortReason = 'draft não está à espera de ajuste';
  } else if (revisionCount >= 3) {
    abort = true;
    abortReason = 'limite de 3 revisões atingido';
  }
}

return [{
  json: {
    ...update,
    abort,
    abortReason,
    draft,
    revisionCount,
  },
}];
`;

const setPendingRevisionCode = String.raw`const staticData = $getWorkflowStaticData('global');
const draftId = $('Switch ação').first().json.draftId;
staticData.pendingRevisionDraftId = draftId;
return [{ json: { draftId } }];
`;

const clearPendingRevisionCode = String.raw`const staticData = $getWorkflowStaticData('global');
delete staticData.pendingRevisionDraftId;
return [$input.first()];
`;

const buildRevisionPromptCode = String.raw`const item = $input.first().json;
const draft = item.draft;
const instruction = item.text;

const prompt = [
  'Rascunho atual:',
  JSON.stringify({
    hook: draft.hook,
    post_text: draft.post_text,
    hashtags: draft.hashtags,
    carousel_slides: draft.carousel_slides,
    sources: draft.sources,
  }, null, 2),
  '',
  'Instruções de ajuste do autor:',
  instruction,
].join('\n');

return [{
  json: {
    ...item,
    prompt,
  },
}];
`;

const parseRevisionCode = String.raw`const response = $input.first().json;
const prev = $('Montar prompt revisão').first().json;

if (response?.promptFeedback?.blockReason) {
  throw new Error('Pedido bloqueado pelo Gemini: ' + response.promptFeedback.blockReason);
}

const parts = response?.candidates?.[0]?.content?.parts ?? [];
const text = parts.map((part) => part.text || '').join('').trim();
if (!text) throw new Error('Resposta vazia do Gemini na revisão.');

let parsed;
try {
  const fence = String.fromCharCode(96, 96, 96);
  const cleaned = text
    .replace(new RegExp('^' + fence + 'json\\\\s*', 'i'), '')
    .replace(new RegExp('^' + fence + '\\\\s*', 'i'), '')
    .replace(new RegExp('\\\\s*' + fence + '$', 'i'), '')
    .trim();
  parsed = JSON.parse(cleaned);
} catch (error) {
  throw new Error('JSON de revisão inválido: ' + error.message);
}

const slides = Array.isArray(parsed.carousel_slides) ? parsed.carousel_slides.slice(0, 8) : [];
const hashtags = Array.isArray(parsed.hashtags) ? parsed.hashtags : [];
let postText = String(parsed.post_text || '').trim();
if (!postText || slides.length < 3) throw new Error('Revisão incompleta.');

if (hashtags.length && !hashtags.some((tag) => postText.includes(tag))) {
  postText = postText + '\n\n' + hashtags.join(' ');
}

const draftId = prev.draftId;
const revisionCount = Number(prev.revisionCount || 0) + 1;

return [{
  json: {
    draftId,
    status: 'pending',
    revisionCount,
    pendingRevision: false,
    hook: parsed.hook || '',
    post_text: postText,
    hashtags,
    carousel_slides: slides,
    sources: Array.isArray(parsed.sources) ? parsed.sources : prev.draft.sources,
    links: prev.draft.links || [],
    count: prev.draft.count || 0,
  },
}];
`;

const prepareRevisedTelegramCode = String.raw`const draft = $input.first().json;
const draftId = draft.draftId;
let message = '✏️ Rascunho ajustado (' + draftId + ') — revisão ' + draft.revisionCount + '/3\n\n' + draft.post_text;
if (message.length > 3900) message = message.slice(0, 3884) + '\n\n[truncado]';

return [{
  json: {
    ...draft,
    message,
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Aprovar', callback_data: 'approve:' + draftId },
        { text: '❌ Rejeitar', callback_data: 'reject:' + draftId },
        { text: '✏️ Ajustar', callback_data: 'revise:' + draftId },
      ]],
    },
  },
}];
`;

const prepareLinkedInInitCode = String.raw`const draft = $('Guardar contexto approve').first().json.draft;
const author = $env.LINKEDIN_AUTHOR_URN;
const token = $env.LINKEDIN_ACCESS_TOKEN;
if (!author || !token) {
  throw new Error('Defina LINKEDIN_AUTHOR_URN e LINKEDIN_ACCESS_TOKEN no .env');
}
const binary = $('Gerar carrossel PDF').first().binary || {};
return [{
  json: {
    draft,
    author,
    token,
    initBody: {
      initializeUploadRequest: {
        owner: author,
      },
    },
  },
  binary,
}];
`;

const prepareLinkedInPostCode = String.raw`const ctx = $('Preparar LinkedIn init').first().json;
const init = $('LinkedIn init upload').first().json;
const value = init.value || init;
const documentUrn = value.document || value.documents || value.image || null;
const uploadUrl = value.uploadUrl || value.uploadMechanism?.['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest']?.uploadUrl;

if (!documentUrn) {
  // Alguns tenants devolvem o URN noutro campo — tenta inferir
  const maybe = value.id || null;
  if (!maybe) {
    throw new Error('LinkedIn init upload sem document URN: ' + JSON.stringify(init).slice(0, 500));
  }
}

const urn = documentUrn || value.id;
const draft = ctx.draft;
const commentary = String(draft.post_text || '').slice(0, 3000);
const binary = $('Gerar carrossel PDF').first().binary || {};

return [{
  json: {
    ...ctx,
    documentUrn: urn,
    uploadUrl,
    postBody: {
      author: ctx.author,
      commentary,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      content: {
        media: {
          title: draft.hook || 'Carrossel',
          id: urn,
        },
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    },
  },
  binary,
}];
`;

const saveApproveContextCode = String.raw`const validated = $('Validar draft').first().json;
return [{
  json: {
    draftId: validated.draftId,
    draft: validated.draft,
    action: validated.action,
    callbackQueryId: validated.callbackQueryId,
  },
}];
`;

const approver = {
  id: 'wf02approverlinkedin',
  name: '02 Approver Telegram → LinkedIn',
  active: false,
  nodes: [
    {
      parameters: {
        httpMethod: 'POST',
        path: 'telegram-approver',
        responseMode: 'onReceived',
        options: {},
      },
      id: 'a02-hook',
      name: 'Webhook Telegram',
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: [0, 300],
      webhookId: 'telegram-approver',
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: parseUpdateCode },
      id: 'a02-parse',
      name: 'Parse update',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [240, 300],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{
            id: 'a02-okchat',
            leftValue: '={{ $json.okChat }}',
            rightValue: '',
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          }],
          combinator: 'and',
        },
        options: {},
      },
      id: 'a02-if-chat',
      name: 'Chat autorizado',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.4,
      position: [480, 300],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{
            id: 'a02-has-draft',
            leftValue: '={{ $json.draftId }}',
            rightValue: '',
            operator: { type: 'string', operation: 'notEmpty', singleValue: true },
          }],
          combinator: 'and',
        },
        options: {},
      },
      id: 'a02-if-draft',
      name: 'Tem draftId',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.4,
      position: [720, 220],
    },
    {
      parameters: {
        method: 'GET',
        url: "={{ ($env.CAROUSEL_URL || 'http://carousel:3000') + '/drafts/' + $json.draftId }}",
        options: { timeout: 15000, response: { response: { neverError: true } } },
      },
      id: 'a02-load',
      name: 'Load draft',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [960, 140],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: afterLoadDraftCode },
      id: 'a02-validate',
      name: 'Validar draft',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1200, 140],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{
            id: 'a02-abort',
            leftValue: '={{ $json.abort }}',
            rightValue: '',
            operator: { type: 'boolean', operation: 'true', singleValue: true },
          }],
          combinator: 'and',
        },
        options: {},
      },
      id: 'a02-if-abort',
      name: 'Deve abortar',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.4,
      position: [1440, 140],
    },
    {
      parameters: {
        conditions: {
          options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
          conditions: [{
            id: 'a02-has-cb',
            leftValue: '={{ $json.callbackQueryId }}',
            rightValue: '',
            operator: { type: 'string', operation: 'notEmpty', singleValue: true },
          }],
          combinator: 'and',
        },
        options: {},
      },
      id: 'a02-ack-abort-if',
      name: 'Tem callback abort',
      type: 'n8n-nodes-base.if',
      typeVersion: 2.4,
      position: [1680, 0],
    },
    {
      parameters: {
        method: 'POST',
        url: "={{ 'https://api.telegram.org/bot' + $env.TELEGRAM_BOT_TOKEN + '/answerCallbackQuery' }}",
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({
  callback_query_id: $json.callbackQueryId,
  text: $json.abortReason || 'Ignorado',
  show_alert: false
}) }}`,
        options: { timeout: 15000 },
      },
      id: 'a02-ack-abort',
      name: 'Ack abort',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1920, 0],
    },
    {
      parameters: {
        rules: {
          values: [
            {
              conditions: {
                options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
                conditions: [{
                  leftValue: '={{ $json.action }}',
                  rightValue: 'approve',
                  operator: { type: 'string', operation: 'equals' },
                }],
                combinator: 'and',
              },
              renameOutput: true,
              outputKey: 'approve',
            },
            {
              conditions: {
                options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
                conditions: [{
                  leftValue: '={{ $json.action }}',
                  rightValue: 'reject',
                  operator: { type: 'string', operation: 'equals' },
                }],
                combinator: 'and',
              },
              renameOutput: true,
              outputKey: 'reject',
            },
            {
              conditions: {
                options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
                conditions: [{
                  leftValue: '={{ $json.action }}',
                  rightValue: 'revise',
                  operator: { type: 'string', operation: 'equals' },
                }],
                combinator: 'and',
              },
              renameOutput: true,
              outputKey: 'revise',
            },
            {
              conditions: {
                options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
                conditions: [{
                  leftValue: '={{ $json.action }}',
                  rightValue: 'apply_revision',
                  operator: { type: 'string', operation: 'equals' },
                }],
                combinator: 'and',
              },
              renameOutput: true,
              outputKey: 'apply_revision',
            },
          ],
        },
        options: { fallbackOutput: 'none' },
      },
      id: 'a02-switch',
      name: 'Switch ação',
      type: 'n8n-nodes-base.switch',
      typeVersion: 3.2,
      position: [1680, 260],
    },

    // ——— REJECT ———
    {
      parameters: {
        method: 'POST',
        url: "={{ 'https://api.telegram.org/bot' + $env.TELEGRAM_BOT_TOKEN + '/answerCallbackQuery' }}",
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ callback_query_id: $json.callbackQueryId, text: 'Rejeitado' }) }}`,
        options: { timeout: 15000 },
      },
      id: 'a02-reject-ack',
      name: 'Ack reject',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1960, 260],
    },
    {
      parameters: {
        method: 'PATCH',
        url: "={{ ($env.CAROUSEL_URL || 'http://carousel:3000') + '/drafts/' + $('Switch ação').item.json.draftId }}",
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify({ status: "rejected", pendingRevision: false }) }}',
        options: { timeout: 15000 },
      },
      id: 'a02-reject-patch',
      name: 'Marcar rejected',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [2220, 260],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: clearPendingRevisionCode },
      id: 'a02-reject-clear',
      name: 'Clear pending reject',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [2480, 260],
    },
    {
      parameters: {
        method: 'POST',
        url: "={{ 'https://api.telegram.org/bot' + $env.TELEGRAM_BOT_TOKEN + '/sendMessage' }}",
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({
  chat_id: $env.TELEGRAM_CHAT_ID,
  text: '❌ Rascunho ' + $('Switch ação').item.json.draftId + ' rejeitado. Nada será publicado.'
}) }}`,
        options: { timeout: 15000 },
      },
      id: 'a02-reject-msg',
      name: 'Confirmar reject',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [2740, 260],
    },

    // ——— REVISE (ask) ———
    {
      parameters: {
        method: 'POST',
        url: "={{ 'https://api.telegram.org/bot' + $env.TELEGRAM_BOT_TOKEN + '/answerCallbackQuery' }}",
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ callback_query_id: $json.callbackQueryId, text: 'Envie o ajuste' }) }}`,
        options: { timeout: 15000 },
      },
      id: 'a02-revise-ack',
      name: 'Ack revise',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1960, 440],
    },
    {
      parameters: {
        method: 'PATCH',
        url: "={{ ($env.CAROUSEL_URL || 'http://carousel:3000') + '/drafts/' + $('Switch ação').item.json.draftId }}",
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify({ status: "pending_revision", pendingRevision: true }) }}',
        options: { timeout: 15000 },
      },
      id: 'a02-revise-patch',
      name: 'Marcar pending_revision',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [2220, 440],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: setPendingRevisionCode },
      id: 'a02-revise-set',
      name: 'Set pending revision',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [2480, 440],
    },
    {
      parameters: {
        method: 'POST',
        url: "={{ 'https://api.telegram.org/bot' + $env.TELEGRAM_BOT_TOKEN + '/sendMessage' }}",
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({
  chat_id: $env.TELEGRAM_CHAT_ID,
  text: '✏️ O que devo ajustar no rascunho ' + $('Switch ação').item.json.draftId + '? Responda com o texto do ajuste (revisão ' + (($('Validar draft').item.json.revisionCount || 0) + 1) + '/3).',
  reply_markup: { force_reply: true }
}) }}`,
        options: { timeout: 15000 },
      },
      id: 'a02-revise-ask',
      name: 'Pedir ajuste',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [2740, 440],
    },

    // ——— APPLY REVISION ———
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: buildRevisionPromptCode },
      id: 'a02-rev-prompt',
      name: 'Montar prompt revisão',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [1960, 620],
    },
    {
      parameters: {
        method: 'POST',
        url: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
        sendHeaders: true,
        headerParameters: {
          parameters: [{ name: 'x-goog-api-key', value: '={{ $env.GEMINI_API_KEY }}' }],
        },
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({
  systemInstruction: { parts: [{ text: ${JSON.stringify(REVISE_PROMPT)} }] },
  contents: [{ role: 'user', parts: [{ text: $json.prompt }] }],
  generationConfig: {
    temperature: 0.4,
    maxOutputTokens: 8192,
    responseMimeType: 'application/json'
  }
}) }}`,
        options: { timeout: 120000 },
      },
      id: 'a02-rev-gemini',
      name: 'Gemini revisão',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [2220, 620],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: parseRevisionCode },
      id: 'a02-rev-parse',
      name: 'Parse revisão',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [2480, 620],
    },
    {
      parameters: {
        method: 'PATCH',
        url: "={{ ($env.CAROUSEL_URL || 'http://carousel:3000') + '/drafts/' + $json.draftId }}",
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json) }}',
        options: { timeout: 15000 },
      },
      id: 'a02-rev-save',
      name: 'Salvar revisão',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [2740, 620],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: clearPendingRevisionCode },
      id: 'a02-rev-clear',
      name: 'Clear pending after rev',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [3000, 620],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: prepareRevisedTelegramCode },
      id: 'a02-rev-prep',
      name: 'Preparar Telegram revisão',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [3260, 620],
    },
    {
      parameters: {
        method: 'POST',
        url: "={{ 'https://api.telegram.org/bot' + $env.TELEGRAM_BOT_TOKEN + '/sendMessage' }}",
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({
  chat_id: $env.TELEGRAM_CHAT_ID,
  text: $json.message,
  disable_web_page_preview: true,
  reply_markup: $json.reply_markup
}) }}`,
        options: { timeout: 30000 },
      },
      id: 'a02-rev-send',
      name: 'Enviar revisão',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [3520, 620],
    },

    // ——— APPROVE ———
    {
      parameters: {
        method: 'POST',
        url: "={{ 'https://api.telegram.org/bot' + $env.TELEGRAM_BOT_TOKEN + '/answerCallbackQuery' }}",
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({ callback_query_id: $json.callbackQueryId, text: 'Aprovado — a gerar carrossel' }) }}`,
        options: { timeout: 15000 },
      },
      id: 'a02-appr-ack',
      name: 'Ack approve',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [1960, 40],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: saveApproveContextCode },
      id: 'a02-appr-ctx',
      name: 'Guardar contexto approve',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [2220, 40],
    },
    {
      parameters: {
        method: 'POST',
        url: "={{ ($env.CAROUSEL_URL || 'http://carousel:3000') + '/render' }}",
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({
  slides: $json.draft.carousel_slides,
  theme: { bg: '#0B1220', accent: '#3B82F6', brand: 'Product & Tech', label: 'LinkedIn' }
}) }}`,
        options: {
          timeout: 90000,
          response: { response: { responseFormat: 'file', outputPropertyName: 'carousel' } },
        },
      },
      id: 'a02-render',
      name: 'Gerar carrossel PDF',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [2480, 40],
    },
    {
      parameters: {
        method: 'POST',
        url: "={{ 'https://api.telegram.org/bot' + $env.TELEGRAM_BOT_TOKEN + '/sendDocument' }}",
        sendBody: true,
        contentType: 'multipart-form-data',
        bodyParameters: {
          parameters: [
            { name: 'chat_id', value: '={{ $env.TELEGRAM_CHAT_ID }}' },
            { name: 'caption', value: '={{ "Pré-visualização do carrossel — " + $("Guardar contexto approve").item.json.draftId }}' },
            {
              parameterType: 'formBinaryData',
              name: 'document',
              inputDataFieldName: 'carousel',
            },
          ],
        },
        options: { timeout: 60000 },
      },
      id: 'a02-preview',
      name: 'Preview PDF Telegram',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [2740, 40],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: prepareLinkedInInitCode },
      id: 'a02-li-prep',
      name: 'Preparar LinkedIn init',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [3000, 40],
    },
    {
      parameters: {
        method: 'POST',
        url: 'https://api.linkedin.com/rest/documents?action=initializeUpload',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Authorization', value: "={{ 'Bearer ' + $json.token }}" },
            { name: 'LinkedIn-Version', value: '202405' },
            { name: 'X-Restli-Protocol-Version', value: '2.0.0' },
            { name: 'Content-Type', value: 'application/json' },
          ],
        },
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($json.initBody) }}',
        options: { timeout: 30000 },
      },
      id: 'a02-li-init',
      name: 'LinkedIn init upload',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [3260, 40],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: prepareLinkedInPostCode },
      id: 'a02-li-prep-post',
      name: 'Preparar LinkedIn post',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [3520, 40],
    },
    {
      parameters: {
        method: 'PUT',
        url: '={{ $json.uploadUrl }}',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Authorization', value: "={{ 'Bearer ' + $json.token }}" },
            { name: 'Content-Type', value: 'application/pdf' },
          ],
        },
        sendBody: true,
        contentType: 'binaryData',
        inputDataFieldName: 'carousel',
        options: { timeout: 120000 },
      },
      id: 'a02-li-upload',
      name: 'LinkedIn upload PDF',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [3780, 40],
    },
    {
      parameters: {
        method: 'POST',
        url: 'https://api.linkedin.com/rest/posts',
        sendHeaders: true,
        headerParameters: {
          parameters: [
            { name: 'Authorization', value: "={{ 'Bearer ' + $('Preparar LinkedIn post').item.json.token }}" },
            { name: 'LinkedIn-Version', value: '202405' },
            { name: 'X-Restli-Protocol-Version', value: '2.0.0' },
            { name: 'Content-Type', value: 'application/json' },
          ],
        },
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify($("Preparar LinkedIn post").item.json.postBody) }}',
        options: { timeout: 30000 },
      },
      id: 'a02-li-post',
      name: 'LinkedIn criar post',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [4040, 40],
    },
    {
      parameters: {
        method: 'PATCH',
        url: "={{ ($env.CAROUSEL_URL || 'http://carousel:3000') + '/drafts/' + $('Guardar contexto approve').item.json.draftId }}",
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: '={{ JSON.stringify({ status: "published", pendingRevision: false, linkedInResponse: $json }) }}',
        options: { timeout: 15000 },
      },
      id: 'a02-appr-done',
      name: 'Marcar published',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [4300, 40],
    },
    {
      parameters: { mode: 'runOnceForAllItems', language: 'javaScript', jsCode: clearPendingRevisionCode },
      id: 'a02-appr-clear',
      name: 'Clear pending approve',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [4560, 40],
    },
    {
      parameters: {
        method: 'POST',
        url: "={{ 'https://api.telegram.org/bot' + $env.TELEGRAM_BOT_TOKEN + '/sendMessage' }}",
        sendBody: true,
        contentType: 'json',
        specifyBody: 'json',
        jsonBody: `={{ JSON.stringify({
  chat_id: $env.TELEGRAM_CHAT_ID,
  text: '🚀 Publicado no LinkedIn (draft ' + $('Guardar contexto approve').item.json.draftId + ').'
}) }}`,
        options: { timeout: 15000 },
      },
      id: 'a02-appr-msg',
      name: 'Confirmar publicação',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [4820, 40],
    },
  ],
  connections: {
    'Webhook Telegram': { main: [[{ node: 'Parse update', type: 'main', index: 0 }]] },
    'Parse update': { main: [[{ node: 'Chat autorizado', type: 'main', index: 0 }]] },
    'Chat autorizado': {
      main: [
        [{ node: 'Tem draftId', type: 'main', index: 0 }],
        [],
      ],
    },
    'Tem draftId': {
      main: [
        [{ node: 'Load draft', type: 'main', index: 0 }],
        [],
      ],
    },
    'Load draft': { main: [[{ node: 'Validar draft', type: 'main', index: 0 }]] },
    'Validar draft': { main: [[{ node: 'Deve abortar', type: 'main', index: 0 }]] },
    'Deve abortar': {
      main: [
        [{ node: 'Tem callback abort', type: 'main', index: 0 }],
        [{ node: 'Switch ação', type: 'main', index: 0 }],
      ],
    },
    'Tem callback abort': {
      main: [
        [{ node: 'Ack abort', type: 'main', index: 0 }],
        [],
      ],
    },
    'Switch ação': {
      main: [
        [{ node: 'Ack approve', type: 'main', index: 0 }],
        [{ node: 'Ack reject', type: 'main', index: 0 }],
        [{ node: 'Ack revise', type: 'main', index: 0 }],
        [{ node: 'Montar prompt revisão', type: 'main', index: 0 }],
      ],
    },
    'Ack reject': { main: [[{ node: 'Marcar rejected', type: 'main', index: 0 }]] },
    'Marcar rejected': { main: [[{ node: 'Clear pending reject', type: 'main', index: 0 }]] },
    'Clear pending reject': { main: [[{ node: 'Confirmar reject', type: 'main', index: 0 }]] },
    'Ack revise': { main: [[{ node: 'Marcar pending_revision', type: 'main', index: 0 }]] },
    'Marcar pending_revision': { main: [[{ node: 'Set pending revision', type: 'main', index: 0 }]] },
    'Set pending revision': { main: [[{ node: 'Pedir ajuste', type: 'main', index: 0 }]] },
    'Montar prompt revisão': { main: [[{ node: 'Gemini revisão', type: 'main', index: 0 }]] },
    'Gemini revisão': { main: [[{ node: 'Parse revisão', type: 'main', index: 0 }]] },
    'Parse revisão': { main: [[{ node: 'Salvar revisão', type: 'main', index: 0 }]] },
    'Salvar revisão': { main: [[{ node: 'Clear pending after rev', type: 'main', index: 0 }]] },
    'Clear pending after rev': { main: [[{ node: 'Preparar Telegram revisão', type: 'main', index: 0 }]] },
    'Preparar Telegram revisão': { main: [[{ node: 'Enviar revisão', type: 'main', index: 0 }]] },
    'Ack approve': { main: [[{ node: 'Guardar contexto approve', type: 'main', index: 0 }]] },
    'Guardar contexto approve': { main: [[{ node: 'Gerar carrossel PDF', type: 'main', index: 0 }]] },
    'Gerar carrossel PDF': { main: [[{ node: 'Preview PDF Telegram', type: 'main', index: 0 }]] },
    'Preview PDF Telegram': { main: [[{ node: 'Preparar LinkedIn init', type: 'main', index: 0 }]] },
    'Preparar LinkedIn init': { main: [[{ node: 'LinkedIn init upload', type: 'main', index: 0 }]] },
    'LinkedIn init upload': { main: [[{ node: 'Preparar LinkedIn post', type: 'main', index: 0 }]] },
    'Preparar LinkedIn post': { main: [[{ node: 'LinkedIn upload PDF', type: 'main', index: 0 }]] },
    'LinkedIn upload PDF': { main: [[{ node: 'LinkedIn criar post', type: 'main', index: 0 }]] },
    'LinkedIn criar post': { main: [[{ node: 'Marcar published', type: 'main', index: 0 }]] },
    'Marcar published': { main: [[{ node: 'Clear pending approve', type: 'main', index: 0 }]] },
    'Clear pending approve': { main: [[{ node: 'Confirmar publicação', type: 'main', index: 0 }]] },
  },
  pinData: {},
  settings: {
    executionOrder: 'v1',
    timezone: 'America/Sao_Paulo',
    callerPolicy: 'workflowsFromSameOwner',
  },
  meta: { templateCredsSetupCompleted: true },
};

fs.writeFileSync(path.join(outDir, '01-producer-rss-draft.json'), JSON.stringify(producer, null, 2));
fs.writeFileSync(path.join(outDir, '02-approver-telegram-linkedin.json'), JSON.stringify(approver, null, 2));
console.log('Wrote workflows to', outDir);
