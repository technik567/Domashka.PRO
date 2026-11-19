import { compileMathExpression } from './mathExpression';

import featurePolicy from '../../shared/ai-features.json';
export const GRAPHIC_ANSWER_PROMPT = featurePolicy.graphicPrompt;

const escape = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const numeric = (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e12;
const label = (s, fallback = '') => typeof s === 'string' ? s.slice(0, 140) : fallback;
const range = (r) => Array.isArray(r) && r.length === 2 && r.every(numeric) && r[1] - r[0] >= 1e-9;
const numberText = (n) => (Math.abs(n) >= 1e6 || n !== 0 && Math.abs(n) < .001) ? n.toExponential(2) : Number(n.toPrecision(5)).toLocaleString('ru-RU', { maximumSignificantDigits: 5 });
const COLORS = ['#2563eb', '#e11d48', '#059669'];

export function parseChart(raw) {
  if (typeof raw !== 'string' || raw.length > 48000) throw new Error('Слишком большой блок графика.');
  let value; try { value = JSON.parse(raw); } catch { throw new Error('График не построен: ИИ прислал незаконченный или некорректный JSON.'); }
  if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Нужен объект с параметрами графика.');
  const chart = { type: value.type, title: label(value.title, 'График'), xLabel: label(value.xLabel, 'x'), yLabel: label(value.yLabel, 'y') };
  if (value.yRange !== undefined) { if (!range(value.yRange)) throw new Error('Некорректный диапазон y.'); chart.yRange = value.yRange; }
  if (value.type === 'function') {
    if (!range(value.domain || [-5, 5]) || (value.domain || [-5, 5]).some((x) => Math.abs(x) > 1e6)) throw new Error('Некорректный диапазон x.');
    chart.domain = value.domain || [-5, 5]; chart.expression = typeof value.expression === 'string' ? value.expression : '';
    if (chart.expression.length > 400) throw new Error('Формула слишком длинная.');
    if (!chart.expression) throw new Error('ИИ не указал формулу функции.');
    const fn = compileMathExpression(chart.expression); const [a, b] = chart.domain;
    chart.series = [{ name: `y = ${chart.expression}`, points: Array.from({ length: 257 }, (_, index) => {
      const x = a + (b - a) * index / 256; const y = fn(x); return [x, numeric(y) ? y : null];
    }) }];
  } else if (['line', 'scatter'].includes(value.type)) {
    if (!Array.isArray(value.series) || !value.series.length || value.series.length > 3) throw new Error('Допустимо 1–3 ряда данных.');
    chart.series = value.series.map((s, i) => {
      if (!s || !Array.isArray(s.points) || !s.points.length || s.points.length > 160 || s.points.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(numeric))) throw new Error('Каждый ряд должен содержать до 160 числовых пар [x,y].');
      return { name: label(s.name, `Ряд ${i + 1}`), points: [...s.points] };
    });
  } else if (value.type === 'bar') {
    if (!Array.isArray(value.labels) || !Array.isArray(value.values) || value.labels.length !== value.values.length || !value.labels.length || value.labels.length > 24 || value.labels.some((s) => typeof s !== 'string') || !value.values.every(numeric)) throw new Error('Столбцы: до 24 подписей и столько же числовых значений.');
    chart.labels = value.labels.map((s) => label(s)); chart.values = value.values;
    chart.series = [{ name: chart.yLabel, points: value.values.map((y, i) => [i + 1, y]) }];
  } else throw new Error('Поддерживаются function, line, scatter и bar.');
  if (!chart.series.some((s) => s.points.some((p) => p[1] !== null))) throw new Error('Нет значений в поддерживаемом масштабе (|y| ≤ 10¹²). Проверьте область определения и диапазон.');
  return chart;
}

export function renderChartHtml(raw) {
  let chart; try { chart = parseChart(raw); } catch (error) {
    return `<aside class="ai-chart-error" role="note">${escape(error.message)} Исправьте формулу или попросите ИИ повторить построение. Исходный блок сохранён в тексте ответа.</aside>`;
  }
  const points = chart.series.flatMap((s) => s.points).filter((p) => p[1] !== null);
  const expand = ([a, b]) => a === b ? [a - Math.max(1, Math.abs(a) * .1), b + Math.max(1, Math.abs(b) * .1)] : [a, b];
  const xr = chart.type === 'bar' ? [0, chart.labels.length + 1] : expand(chart.domain || [Math.min(...points.map((p) => p[0])), Math.max(...points.map((p) => p[0]))]);
  let yr = expand(chart.yRange || [Math.min(...points.map((p) => p[1]), ...(chart.type === 'bar' ? [0] : [])), Math.max(...points.map((p) => p[1]), ...(chart.type === 'bar' ? [0] : []))]);
  if (!chart.yRange) { const pad = (yr[1] - yr[0]) * .08; yr = [yr[0] - pad, yr[1] + pad]; }
  const width = 640, height = 368, left = 76, top = 24, w = 540, h = 270;
  const x = (v) => left + (v - xr[0]) / (xr[1] - xr[0]) * w;
  const y = (v) => top + h - (v - yr[0]) / (yr[1] - yr[0]) * h;
  const fixed = (n) => Number(n.toFixed(3));
  const inY = (v) => v >= yr[0] && v <= yr[1];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escape(chart.title)}"><title>${escape(chart.title)}</title><rect width="640" height="368" rx="12" fill="#fff"/>`;
  const text = (xx, yy, content, anchor = 'middle', color = '#475569') => `<text x="${fixed(xx)}" y="${fixed(yy)}" text-anchor="${anchor}" font-family="system-ui,sans-serif" font-size="12" fill="${color}">${escape(content)}</text>`;
  for (let i = 0; i <= 5; i++) {
    const xx = left + i * w / 5, yy = top + i * h / 5;
    svg += `<path d="M${xx} ${top}V${top + h} M${left} ${yy}H${left + w}" stroke="#e2e8f0" stroke-width="1"/>`;
    if (chart.type !== 'bar') svg += text(xx, top + h + 20, numberText(xr[0] + i * (xr[1] - xr[0]) / 5));
    svg += text(left - 8, yy + 4, numberText(yr[1] - i * (yr[1] - yr[0]) / 5), 'end');
  }
  const zeroY = y(Math.min(yr[1], Math.max(yr[0], 0)));
  svg += `<path d="M${left} ${zeroY}H${left + w} M${x(Math.max(xr[0], Math.min(xr[1], 0)))} ${top}V${top + h}" stroke="#94a3b8" stroke-width="1.4"/>`;
  svg += text(left + w / 2, height - 12, chart.xLabel.slice(0, 55));
  svg += text(left - 10, 15, chart.yLabel.slice(0, 35), 'start');
  chart.series.forEach((series, index) => {
    const color = COLORS[index]; let previous = null; let path = '';
    series.points.forEach(([xx, yy], pointIndex) => {
      if (yy === null || !inY(yy)) { previous = null; return; }
      const px = x(xx), py = y(yy);
      if (chart.type === 'bar') {
        const bw = w / (chart.labels.length + 1) * .65;
        svg += `<rect x="${fixed(px - bw / 2)}" y="${fixed(Math.min(py, zeroY))}" width="${fixed(bw)}" height="${fixed(Math.max(.5, Math.abs(py - zeroY)))}" fill="${color}"/>`;
        svg += text(px, top + h + 20, chart.labels.length > 8 ? String(pointIndex + 1) : chart.labels[pointIndex].slice(0, 9));
      } else {
        // Do not draw through missing domains or a sampled asymptote. This is a
        // numerical plot, not a symbolic continuity proof; disclosed below.
        const jump = previous && chart.type === 'function' && Math.abs(previous[1] - yy) > (yr[1] - yr[0]) * .65;
        path += `${previous && !jump ? 'L' : 'M'}${fixed(px)} ${fixed(py)} `;
        if (chart.type !== 'function') svg += `<circle cx="${fixed(px)}" cy="${fixed(py)}" r="3.2" fill="${color}"/>`;
      }
      previous = [xx, yy];
    });
    if (path && chart.type !== 'scatter') svg += `<path d="${path.trim()}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round"/>`;
  });
  svg += '</svg>';
  const legend = chart.series.map((s, i) => `<span><i style="background:${COLORS[i]}"></i>${escape(s.name)}</span>`).join('');
  const rows = chart.series.map((s) => s.points.map(([a, b], i) => `<tr><td>${escape(s.name)}</td><td>${escape(chart.labels?.[i] || numberText(a))}</td><td>${b === null ? 'вне области/масштаба' : escape(numberText(b))}</td></tr>`).join('')).join('');
  return `<figure class="ai-chart"><figcaption>${escape(chart.title)}</figcaption><div class="ai-chart-legend">${legend}</div>${svg}<p class="ai-chart-note">${chart.type === 'function' ? 'Построение по 257 точкам формулы. Особые точки и разрывы требуют отдельной проверки.' : 'Данные из ответа ИИ: проверьте источник. График не подтверждает достоверность чисел.'}</p><button type="button" data-chart-download="svg" class="ai-chart-download">Скачать график SVG</button><details><summary>Точки и данные графика</summary><div class="table-scroll" role="region" aria-label="Данные графика" tabindex="0"><table><thead><tr><th>Ряд</th><th>${escape(chart.xLabel)}</th><th>${escape(chart.yLabel)}</th></tr></thead><tbody>${rows}</tbody></table></div></details></figure>`;
}
