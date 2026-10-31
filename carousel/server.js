'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

const PORT = Number(process.env.PORT || 3000);
const MAX_SLIDES = Number(process.env.MAX_SLIDES || 8);
const DRAFT_TTL_DAYS = Number(process.env.DRAFT_TTL_DAYS || 7);
const DRAFTS_DIR = path.join(__dirname, 'data', 'drafts');
const WIDTH = 1080;
const HEIGHT = 1350;

fs.mkdirSync(DRAFTS_DIR, { recursive: true });

const app = express();
app.use(express.json({ limit: '2mb' }));

function hexToRgb(hex, fallback) {
  const raw = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return fallback;
  return {
    r: parseInt(raw.slice(0, 2), 16) / 255,
    g: parseInt(raw.slice(2, 4), 16) / 255,
    b: parseInt(raw.slice(4, 6), 16) / 255,
  };
}

function wrapText(text, font, size, maxWidth) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function renderPdf(slides, theme) {
  if (!Array.isArray(slides) || slides.length === 0) {
    throw new Error('slides deve ser um array não vazio');
  }
  if (slides.length > MAX_SLIDES) {
    throw new Error(`Máximo de ${MAX_SLIDES} slides`);
  }

  const bg = hexToRgb(theme?.bg, { r: 0.043, g: 0.071, b: 0.125 });
  const accent = hexToRgb(theme?.accent, { r: 0.231, g: 0.510, b: 0.965 });
  const brand = theme?.brand || 'Product & Tech';
  const label = theme?.label || 'LinkedIn';

  const pdf = await PDFDocument.create();
  const fontRegular = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);

  for (let i = 0; i < slides.length; i += 1) {
    const slide = slides[i] || {};
    const page = pdf.addPage([WIDTH, HEIGHT]);

    page.drawRectangle({ x: 0, y: 0, width: WIDTH, height: HEIGHT, color: rgb(bg.r, bg.g, bg.b) });
    page.drawRectangle({
      x: 0,
      y: HEIGHT - 8,
      width: WIDTH,
      height: 8,
      color: rgb(accent.r, accent.g, accent.b),
    });

    const muted = rgb(0.58, 0.64, 0.72);
    const text = rgb(0.97, 0.98, 0.99);
    const bodyColor = rgb(0.89, 0.91, 0.94);

    page.drawText(String(brand).toUpperCase().slice(0, 40), {
      x: 64,
      y: HEIGHT - 100,
      size: 18,
      font: fontBold,
      color: muted,
    });

    const titleSize = i === 0 ? 48 : 40;
    const titleLines = wrapText(slide.title || '', fontBold, titleSize, WIDTH - 128).slice(0, 4);
    let titleY = HEIGHT - 200;
    for (const line of titleLines) {
      page.drawText(line, {
        x: 64,
        y: titleY,
        size: titleSize,
        font: fontBold,
        color: text,
      });
      titleY -= titleSize + 12;
    }

    const bodySize = 24;
    const bodyLines = wrapText(slide.body || '', fontRegular, bodySize, WIDTH - 128).slice(0, 18);
    let bodyY = titleY - 36;
    for (const line of bodyLines) {
      page.drawText(line, {
        x: 64,
        y: bodyY,
        size: bodySize,
        font: fontRegular,
        color: bodyColor,
      });
      bodyY -= bodySize + 10;
    }

    page.drawRectangle({
      x: 64,
      y: 88,
      width: WIDTH - 128,
      height: 1,
      color: rgb(0.35, 0.40, 0.48),
    });

    page.drawText(String(label).slice(0, 30), {
      x: 64,
      y: 56,
      size: 18,
      font: fontBold,
      color: rgb(accent.r, accent.g, accent.b),
    });

    const footer = String(slide.footer || `${i + 1}/${slides.length}`);
    const footerWidth = fontRegular.widthOfTextAtSize(footer, 18);
    page.drawText(footer, {
      x: WIDTH - 64 - footerWidth,
      y: 56,
      size: 18,
      font: fontRegular,
      color: muted,
    });
  }

  return Buffer.from(await pdf.save());
}

function draftPath(id) {
  const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe) throw new Error('draftId inválido');
  return path.join(DRAFTS_DIR, `${safe}.json`);
}

function readDraft(id) {
  const file = draftPath(id);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeDraft(id, data) {
  fs.writeFileSync(draftPath(id), JSON.stringify(data, null, 2));
  return data;
}

function pruneDrafts() {
  const cutoff = Date.now() - DRAFT_TTL_DAYS * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(DRAFTS_DIR)) {
    if (!name.endsWith('.json')) continue;
    const file = path.join(DRAFTS_DIR, name);
    try {
      const draft = JSON.parse(fs.readFileSync(file, 'utf8'));
      const created = Date.parse(draft.createdAt || 0);
      if (Number.isFinite(created) && created < cutoff) fs.unlinkSync(file);
    } catch {
      // ignore
    }
  }
}

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.post('/render', async (req, res) => {
  try {
    const { slides, theme } = req.body || {};
    const pdf = await renderPdf(slides, theme);
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'attachment; filename="carousel.pdf"',
      'Content-Length': pdf.length,
    });
    res.send(pdf);
  } catch (error) {
    res.status(400).json({ error: error.message || String(error) });
  }
});

app.post('/drafts', (req, res) => {
  try {
    pruneDrafts();
    const body = req.body || {};
    const draftId = String(body.draftId || '').replace(/[^a-zA-Z0-9_-]/g, '')
      || Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const now = new Date().toISOString();
    const draft = {
      draftId,
      status: body.status || 'pending',
      revisionCount: Number(body.revisionCount || 0),
      createdAt: now,
      updatedAt: now,
      links: body.links || [],
      count: body.count || 0,
      hook: body.hook || '',
      post_text: body.post_text || '',
      hashtags: body.hashtags || [],
      carousel_slides: body.carousel_slides || [],
      sources: body.sources || [],
      telegramMessageId: body.telegramMessageId || null,
      pendingRevision: Boolean(body.pendingRevision),
    };
    writeDraft(draftId, draft);
    res.status(201).json(draft);
  } catch (error) {
    res.status(400).json({ error: error.message || String(error) });
  }
});

app.get('/drafts/:id', (req, res) => {
  try {
    const draft = readDraft(req.params.id);
    if (!draft) return res.status(404).json({ error: 'draft não encontrado' });
    res.json(draft);
  } catch (error) {
    res.status(400).json({ error: error.message || String(error) });
  }
});

app.patch('/drafts/:id', (req, res) => {
  try {
    const existing = readDraft(req.params.id);
    if (!existing) return res.status(404).json({ error: 'draft não encontrado' });
    const patch = req.body || {};
    const updated = {
      ...existing,
      ...patch,
      draftId: existing.draftId,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
    };
    writeDraft(existing.draftId, updated);
    res.json(updated);
  } catch (error) {
    res.status(400).json({ error: error.message || String(error) });
  }
});

app.get('/drafts', (_req, res) => {
  pruneDrafts();
  const drafts = fs.readdirSync(DRAFTS_DIR)
    .filter((name) => name.endsWith('.json'))
    .map((name) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(DRAFTS_DIR, name), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  res.json({ drafts });
});

app.listen(PORT, '0.0.0.0', () => {
  // eslint-disable-next-line no-console
  console.log(`carousel listening on :${PORT}`);
});
