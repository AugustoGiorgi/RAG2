"use strict";

const PptxGenJS = require("pptxgenjs");

const SLIDE_W = 13.333;
const SLIDE_H = 7.5;
const SAFE_FONTS = new Set(["Arial", "Calibri", "Times New Roman", "Courier New", "Georgia", "Trebuchet MS", "Verdana"]);

function cleanHex(value, fallback = "1B3A6B") {
  const hex = String(value || "").replace(/^#/, "").trim();
  return /^[0-9a-f]{6}$/i.test(hex) ? hex.toUpperCase() : fallback;
}

function safeFont(value) {
  const font = String(value || "").trim();
  return SAFE_FONTS.has(font) ? font : "Arial";
}

function text(value) {
  return String(value ?? "").replace(/\s+\n/g, "\n").trim();
}

function sanitizeTheme(theme = {}) {
  return {
    primaryColor: cleanHex(theme.primaryColor, "1B3A6B"),
    secondaryColor: cleanHex(theme.secondaryColor, "2563EB"),
    accentColor: cleanHex(theme.accentColor, "60A5FA"),
    backgroundColor: cleanHex(theme.backgroundColor, "FFFFFF"),
    textColor: cleanHex(theme.textColor, "0F172A"),
    fontTitle: safeFont(theme.fontTitle),
    fontBody: safeFont(theme.fontBody),
  };
}

function addRect(pptx, slide, x, y, w, h, color, line = "none") {
  slide.addShape(pptx.ShapeType.rect, {
    x, y, w, h,
    fill: { color: cleanHex(color, "FFFFFF") },
    line: line === "none" ? { transparency: 100 } : { color: cleanHex(line, "E2E8F0"), pt: 0.5 },
  });
}

function addFooter(pptx, slide, data, pageNum) {
  const theme = data.theme;
  addRect(pptx, slide, 0, SLIDE_H - 0.36, SLIDE_W, 0.36, theme.primaryColor);
  slide.addText(`${data.firmName || "RAG Tax AI"} | CONFIDENTIAL | ${pageNum}`, {
    x: 0.35, y: SLIDE_H - 0.29, w: SLIDE_W - 0.7, h: 0.18,
    fontFace: theme.fontBody,
    fontSize: 7.5,
    color: "DBEAFE",
    margin: 0,
  });
}

function addHeader(pptx, slide, slideData, data) {
  const theme = data.theme;
  addRect(pptx, slide, 0, 0, SLIDE_W, 1.03, theme.primaryColor);
  addRect(pptx, slide, 0, 1.03, SLIDE_W, 0.04, theme.accentColor);
  slide.addText(text(slideData.title), {
    x: 0.45, y: 0.16, w: SLIDE_W - 0.9, h: 0.45,
    fontFace: theme.fontTitle,
    fontSize: 24,
    bold: true,
    color: "FFFFFF",
    fit: "shrink",
    margin: 0,
  });
  if (slideData.subtitle) {
    slide.addText(text(slideData.subtitle), {
      x: 0.47, y: 0.66, w: SLIDE_W - 0.94, h: 0.24,
      fontFace: theme.fontBody,
      fontSize: 11,
      italic: true,
      color: "BFDBFE",
      fit: "shrink",
      margin: 0,
    });
  }
}

function contentLines(slideData) {
  if (Array.isArray(slideData.bullets) && slideData.bullets.length) return slideData.bullets.map(text).filter(Boolean);
  if (Array.isArray(slideData.columns) && slideData.columns.length) {
    return slideData.columns.flatMap((col) => [text(col.header), text(col.content)]).filter(Boolean);
  }
  if (Array.isArray(slideData.actionItems) && slideData.actionItems.length) {
    return slideData.actionItems.map((item, idx) => `${item.number || idx + 1}. ${text(item.action)} ${text(item.owner)} ${text(item.deadline)}`.trim());
  }
  if (Array.isArray(slideData.timelineItems) && slideData.timelineItems.length) {
    return slideData.timelineItems.map((item) => `${text(item.date)}: ${text(item.event)} ${text(item.description)}`.trim());
  }
  if (slideData.quote) return [text(slideData.quote)];
  if (slideData.visualSuggestion) return [text(slideData.visualSuggestion)];
  return [];
}

function renderTitleSlide(pptx, slideData, data) {
  const theme = data.theme;
  const slide = pptx.addSlide();
  slide.background = { color: theme.primaryColor };
  addRect(pptx, slide, SLIDE_W - 0.48, 0, 0.48, SLIDE_H, theme.accentColor);
  addRect(pptx, slide, 1.05, 1.15, 1.05, 1.05, theme.secondaryColor);
  slide.addText("R", {
    x: 1.05, y: 1.17, w: 1.05, h: 0.95,
    fontFace: theme.fontTitle,
    fontSize: 38,
    bold: true,
    color: "FFFFFF",
    align: "center",
    valign: "mid",
    margin: 0,
  });
  slide.addText(text(slideData.title || data.presentationTitle || "Client Presentation"), {
    x: 1.05, y: 2.48, w: 9.6, h: 0.8,
    fontFace: theme.fontTitle,
    fontSize: 34,
    bold: true,
    color: "FFFFFF",
    fit: "shrink",
    margin: 0,
  });
  if (slideData.subtitle || data.subtitle) {
    slide.addText(text(slideData.subtitle || data.subtitle), {
      x: 1.08, y: 3.34, w: 9.25, h: 0.36,
      fontFace: theme.fontBody,
      fontSize: 14,
      italic: true,
      color: "DBEAFE",
      fit: "shrink",
      margin: 0,
    });
  }
  slide.addText(text(data.firmName || "RAG Tax AI"), {
    x: 1.08, y: 6.25, w: 5.5, h: 0.24,
    fontFace: theme.fontBody,
    fontSize: 11,
    color: "CBD5E1",
    margin: 0,
  });
  return slide;
}

function renderBullets(pptx, slideData, data, pageNum) {
  const theme = data.theme;
  const slide = pptx.addSlide();
  slide.background = { color: theme.backgroundColor };
  addHeader(pptx, slide, slideData, data);
  const lines = contentLines(slideData).slice(0, 12);
  if (lines.length) {
    slide.addText(lines.map((line) => ({ text: line, options: { bullet: { type: "ul" } } })), {
      x: 0.75, y: 1.35, w: SLIDE_W - 1.5, h: 5.35,
      fontFace: theme.fontBody,
      fontSize: 14,
      color: theme.textColor,
      breakLine: false,
      fit: "shrink",
      margin: 0.04,
    });
  }
  addMaybeImage(slide, slideData);
  addFooter(pptx, slide, data, pageNum);
  return slide;
}

function renderTwoColumn(pptx, slideData, data, pageNum) {
  const theme = data.theme;
  const slide = pptx.addSlide();
  slide.background = { color: theme.backgroundColor };
  addHeader(pptx, slide, slideData, data);
  const columns = Array.isArray(slideData.columns) && slideData.columns.length ? slideData.columns.slice(0, 3) : [{ header: "", content: contentLines(slideData).join("\n") }];
  const gap = 0.18;
  const colW = (SLIDE_W - 0.9 - gap * (columns.length - 1)) / columns.length;
  columns.forEach((col, idx) => {
    const x = 0.45 + idx * (colW + gap);
    addRect(pptx, slide, x, 1.35, colW, 0.42, idx % 2 ? theme.secondaryColor : theme.primaryColor);
    slide.addText(text(col.header || `Column ${idx + 1}`), {
      x: x + 0.07, y: 1.44, w: colW - 0.14, h: 0.16,
      fontFace: theme.fontTitle,
      fontSize: 11,
      bold: true,
      color: "FFFFFF",
      align: "center",
      margin: 0,
    });
    addRect(pptx, slide, x, 1.83, colW, 4.75, "F8FAFC", "E2E8F0");
    slide.addText(text(col.content), {
      x: x + 0.12, y: 1.98, w: colW - 0.24, h: 4.35,
      fontFace: theme.fontBody,
      fontSize: 11.5,
      color: theme.textColor,
      fit: "shrink",
      valign: "top",
      margin: 0,
      breakLine: false,
    });
  });
  addFooter(pptx, slide, data, pageNum);
  return slide;
}

function renderBigNumber(pptx, slideData, data, pageNum) {
  const theme = data.theme;
  const slide = pptx.addSlide();
  slide.background = { color: theme.backgroundColor };
  addHeader(pptx, slide, slideData, data);
  const items = (Array.isArray(slideData.bigNumbers) ? slideData.bigNumbers : []).slice(0, 4);
  const cardW = (SLIDE_W - 1.0) / Math.max(items.length, 1);
  items.forEach((item, idx) => {
    const x = 0.5 + idx * cardW;
    addRect(pptx, slide, x + 0.08, 1.75, cardW - 0.16, 3.7, "F8FAFC", "E2E8F0");
    slide.addText(text(item.value), {
      x: x + 0.14, y: 2.35, w: cardW - 0.28, h: 0.9,
      fontFace: theme.fontTitle,
      fontSize: 32,
      bold: true,
      color: theme.primaryColor,
      align: "center",
      fit: "shrink",
      margin: 0,
    });
    slide.addText(text(item.label), {
      x: x + 0.2, y: 3.32, w: cardW - 0.4, h: 0.48,
      fontFace: theme.fontBody,
      fontSize: 12,
      color: theme.textColor,
      align: "center",
      fit: "shrink",
      margin: 0,
    });
    if (item.change) {
      slide.addText(text(item.change), {
        x: x + 0.2, y: 4.08, w: cardW - 0.4, h: 0.24,
        fontFace: theme.fontBody,
        fontSize: 10,
        bold: true,
        color: String(item.change).startsWith("-") ? "DC2626" : "15803D",
        align: "center",
        margin: 0,
      });
    }
  });
  addFooter(pptx, slide, data, pageNum);
  return slide;
}

function renderTable(pptx, slideData, data, pageNum) {
  const theme = data.theme;
  const slide = pptx.addSlide();
  slide.background = { color: theme.backgroundColor };
  addHeader(pptx, slide, slideData, data);
  const table = slideData.tableData || {};
  const headers = Array.isArray(table.headers) ? table.headers.map(text) : [];
  const rows = Array.isArray(table.rows) ? table.rows.slice(0, 12).map((row) => Array.isArray(row) ? row.map(text) : [text(row)]) : [];
  if (headers.length) {
    slide.addTable([headers, ...rows], {
      x: 0.5, y: 1.32, w: SLIDE_W - 1.0, h: 4.95,
      fontFace: theme.fontBody,
      fontSize: 9.5,
      color: theme.textColor,
      border: { color: "CBD5E1", pt: 0.5 },
      fill: { color: "FFFFFF" },
      margin: 0.04,
      valign: "mid",
      fit: "shrink",
    });
  }
  addFooter(pptx, slide, data, pageNum);
  return slide;
}

function renderTimeline(pptx, slideData, data, pageNum) {
  const theme = data.theme;
  const items = Array.isArray(slideData.timelineItems) ? slideData.timelineItems : [];
  return renderBullets(pptx, { ...slideData, bullets: items.map((item) => `${text(item.date)}: ${text(item.event)} ${text(item.description)}`.trim()) }, data, pageNum);
}

function renderActionItems(pptx, slideData, data, pageNum) {
  const items = Array.isArray(slideData.actionItems) ? slideData.actionItems : [];
  return renderBullets(pptx, { ...slideData, bullets: items.map((item, idx) => `${item.number || idx + 1}. ${text(item.action)} - ${text(item.owner)} ${text(item.deadline)}`.trim()) }, data, pageNum);
}

function renderClosing(pptx, slideData, data, pageNum) {
  const theme = data.theme;
  const slide = pptx.addSlide();
  slide.background = { color: theme.primaryColor };
  addRect(pptx, slide, SLIDE_W - 0.48, 0, 0.48, SLIDE_H, theme.accentColor);
  slide.addText(text(slideData.title || "Thank You"), {
    x: 1.1, y: 2.1, w: SLIDE_W - 2.2, h: 0.9,
    fontFace: theme.fontTitle,
    fontSize: 42,
    bold: true,
    color: "FFFFFF",
    align: "center",
    fit: "shrink",
    margin: 0,
  });
  slide.addText(text(slideData.subtitle || data.firmName || "RAG Tax AI"), {
    x: 1.2, y: 3.2, w: SLIDE_W - 2.4, h: 0.4,
    fontFace: theme.fontBody,
    fontSize: 16,
    color: "DBEAFE",
    align: "center",
    margin: 0,
  });
  addFooter(pptx, slide, data, pageNum);
  return slide;
}

function addMaybeImage(slide, slideData) {
  const image = slideData.imageBase64 || slideData.imageData;
  if (!image) return;
  const mime = slideData.imageMimeType || "image/png";
  const data = String(image).startsWith("data:") ? String(image) : `data:${mime};base64,${image}`;
  try {
    slide.addImage({ data, x: 8.2, y: 1.35, w: 4.4, h: 3.1 });
  } catch (_) {}
}

function renderSlide(pptx, slideData, data, pageNum) {
  const type = String(slideData.type || "bullets").toLowerCase();
  if (pageNum === 1 || type === "title_slide") return renderTitleSlide(pptx, slideData, data);
  if (type === "two_column" || type === "comparison") return renderTwoColumn(pptx, slideData, data, pageNum);
  if (type === "big_number") return renderBigNumber(pptx, slideData, data, pageNum);
  if (type === "table") return renderTable(pptx, slideData, data, pageNum);
  if (type === "timeline") return renderTimeline(pptx, slideData, data, pageNum);
  if (type === "action_items") return renderActionItems(pptx, slideData, data, pageNum);
  if (type === "closing") return renderClosing(pptx, slideData, data, pageNum);
  return renderBullets(pptx, slideData, data, pageNum);
}

async function buildPresentation(input) {
  const data = {
    ...input,
    theme: sanitizeTheme(input?.theme || {}),
    firmName: text(input?.firmName || "RAG Tax AI"),
    preparedBy: text(input?.preparedBy || "RAG Tax AI"),
    presentationTitle: text(input?.presentationTitle || "Client Presentation"),
  };
  const slides = Array.isArray(input?.slides) ? input.slides : [];
  if (!slides.length) throw new Error("Presentation has no slides.");

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = data.preparedBy;
  pptx.company = data.firmName;
  pptx.subject = data.presentationTitle;
  pptx.title = data.presentationTitle;
  pptx.lang = "en-US";
  pptx.theme = {
    headFontFace: data.theme.fontTitle,
    bodyFontFace: data.theme.fontBody,
    lang: "en-US",
  };

  slides.slice(0, 30).forEach((slideData, idx) => renderSlide(pptx, slideData || {}, data, idx + 1));
  const out = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.isBuffer(out) ? out : Buffer.from(out);
}

// ---------------------------------------------------------------------------
// Tax Planning Studio deck. Maps the planning analysis (base profile, computed
// scenarios, opportunities) onto the existing slide schema and reuses
// buildPresentation — no changes to the generic builder above.
// ---------------------------------------------------------------------------

function money(n) {
  const v = Number(n) || 0;
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

function pct(n) {
  const v = Number(n) || 0;
  // accept either 0.21 or 21 style inputs
  const asPct = v <= 1 ? v * 100 : v;
  return `${asPct.toFixed(1)}%`;
}

async function buildPlanningDeck(input = {}) {
  const clientName = text(input.clientName || "Client");
  const year = text(input.year || new Date().getFullYear());
  const firmName = text(input.firmName || "RAG Tax AI");
  const base = input.baseData || {};
  const scenarios = Array.isArray(input.scenarios) ? input.scenarios : [];
  const opportunities = Array.isArray(input.opportunities) ? input.opportunities : [];
  const nextSteps = Array.isArray(input.nextSteps) ? input.nextSteps : [];
  const disclaimer = text(
    input.disclaimer ||
      `This analysis is prepared by ${firmName} for planning purposes. Figures are estimates based on the information provided and current tax law. Consult your CPA before acting.`
  );

  // Pick the base scenario and the best (lowest-total) scenario for the headline.
  const baseScenario = scenarios.find((s) => s && (s.isBase || /base/i.test(s.name || ""))) || scenarios[0] || {};
  const baseTotal = Number(baseScenario?.taxCalc?.total) || 0;
  const best = scenarios.reduce((acc, s) => {
    const t = Number(s?.taxCalc?.total);
    if (!Number.isFinite(t)) return acc;
    return !acc || t < Number(acc.taxCalc.total) ? s : acc;
  }, null);
  const bestSavings = best && baseTotal ? baseTotal - Number(best.taxCalc.total) : 0;

  const slides = [];

  // 1) Title
  slides.push({
    type: "title_slide",
    title: `Tax Planning Analysis ${year}`,
    subtitle: `${clientName}  ·  ${new Date().toLocaleDateString("en-US")}`,
  });

  // 2) Current situation — big numbers
  slides.push({
    type: "big_number",
    title: "Your Current Situation",
    subtitle: "Where things stand today",
    bigNumbers: [
      { value: money(baseScenario?.taxCalc?.total || base.currentTaxTotal), label: "Current total tax" },
      { value: pct(baseScenario?.taxCalc?.effectiveRate || base.effectiveRate), label: "Effective tax rate" },
      { value: money(baseScenario?.taxCalc?.taxableIncome || base.taxableIncome), label: "Taxable income" },
    ].filter((n) => n.value && n.value !== "$0"),
  });

  // 3) Scenario comparison table
  if (scenarios.length) {
    slides.push({
      type: "table",
      title: "Scenario Comparison",
      subtitle: "Side-by-side projected outcomes",
      tableData: {
        headers: ["Scenario", "Total Tax", "Savings vs. Today", "Effective Rate"],
        rows: scenarios.slice(0, 10).map((s) => {
          const total = Number(s?.taxCalc?.total) || 0;
          const savings = baseTotal ? baseTotal - total : 0;
          return [
            text(s.name || "Scenario"),
            money(total),
            savings > 0 ? money(savings) : "—",
            pct(s?.taxCalc?.effectiveRate),
          ];
        }),
      },
    });
  }

  // 4) Opportunities — bullets (sorted by savings, highest first)
  if (opportunities.length) {
    const sorted = [...opportunities].sort(
      (a, b) => (Number(b?.estimatedSavings?.max) || 0) - (Number(a?.estimatedSavings?.max) || 0)
    );
    slides.push({
      type: "bullets",
      title: "Recommended Opportunities",
      subtitle: "Prioritized by potential savings",
      bullets: sorted.slice(0, 8).map((o) => {
        const min = Number(o?.estimatedSavings?.min) || 0;
        const max = Number(o?.estimatedSavings?.max) || 0;
        const range = max ? ` (${money(min)}–${money(max)})` : "";
        const deadline = o.deadline ? `  ·  by ${text(o.deadline)}` : "";
        return `${text(o.title)}${range}${deadline} — ${text(o.description)}`;
      }),
    });
  }

  // 5) Next steps — action items
  if (nextSteps.length) {
    slides.push({
      type: "action_items",
      title: "Next Steps",
      actionItems: nextSteps.slice(0, 10).map((step, idx) => ({
        number: idx + 1,
        action: text(step.action || step),
        owner: text(step.owner || ""),
        deadline: text(step.deadline || ""),
      })),
    });
  }

  // 6) Closing with disclaimer
  slides.push({
    type: "closing",
    title: bestSavings > 0 ? `Potential savings: ${money(bestSavings)}` : "Let's plan ahead",
    subtitle: disclaimer,
  });

  return buildPresentation({
    firmName,
    preparedBy: firmName,
    presentationTitle: `Tax Planning Analysis ${year} — ${clientName}`,
    theme: input.theme || {},
    slides,
  });
}

module.exports = { buildPresentation, buildPlanningDeck, sanitizeTheme };
