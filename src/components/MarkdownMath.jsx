import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { marked } from 'marked';
import katex from 'katex';
import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';

marked.setOptions({
  gfm: true,
  breaks: true,
});

const useIsoLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export function renderMarkdownWithMath(rawText) {
  if (!rawText) return '';

  const mathBlocks = [];
  const placeholder = (idx) => `@@KATEX_TOKEN_${idx}@@`;

  // Protect code blocks first so $ inside code doesn't become math
  const codeBlocks = [];
  let text = rawText.replace(/```[\s\S]*?```|`[^`\n]+`/g, (match) => {
    const idx = codeBlocks.length;
    codeBlocks.push(match);
    return `@@CODE_TOKEN_${idx}@@`;
  });

  // Display math $$...$$
  text = text.replace(/\$\$([\s\S]+?)\$\$/g, (_, formula) => {
    const idx = mathBlocks.length;
    try {
      mathBlocks.push(
        katex.renderToString(formula.trim(), {
          displayMode: true,
          throwOnError: false,
          strict: false,
        })
      );
    } catch {
      mathBlocks.push(`<code>${formula}</code>`);
    }
    return placeholder(idx);
  });

  // Inline math $...$
  text = text.replace(/\$([^\$\n]+?)\$/g, (_, formula) => {
    const idx = mathBlocks.length;
    try {
      mathBlocks.push(
        katex.renderToString(formula.trim(), {
          displayMode: false,
          throwOnError: false,
          strict: false,
        })
      );
    } catch {
      mathBlocks.push(`<code>${formula}</code>`);
    }
    return placeholder(idx);
  });

  // Restore code blocks before Markdown parsing
  text = text.replace(/@@CODE_TOKEN_(\d+)@@/g, (_, idx) => codeBlocks[Number(idx)] || '');

  // Parse Markdown
  let html = marked.parse(text);

  // Restore rendered KaTeX HTML
  html = html.replace(/@@KATEX_TOKEN_(\d+)@@/g, (_, idx) => mathBlocks[Number(idx)] || '');

  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true, svg: true } });
}

/**
 * Calibrates --nb-bg-y on the enclosing .notebook-grid / .notebook-lined sheet to the exact
 * alphabetic baseline of the active font AND snaps variable-height blocks (display math,
 * tables, pre, blockquotes, tall inline fractions) to exact integer multiples of --nb-step
 * so every single word from top to bottom sits flush on the blue line!
 */
function snapNotebookBaseline(rootEl) {
  if (!rootEl || typeof window === 'undefined') return;
  const sheet = rootEl.closest('.notebook-grid, .notebook-lined');
  if (!sheet) return;

  const cs = window.getComputedStyle(sheet);
  const step = parseFloat(cs.getPropertyValue('--nb-step')) || 32;
  const cell = parseFloat(cs.getPropertyValue('--nb-cell')) || step / 2;
  const isGrid = sheet.classList.contains('notebook-grid');

  // 1. Reset any prior inline block adjustments before measuring
  const children = Array.from(rootEl.children);
  for (const el of children) {
    el.style.removeProperty('margin-bottom');
    if (el.tagName === 'UL' || el.tagName === 'OL') {
      for (const li of Array.from(el.children)) {
        li.style.removeProperty('margin-bottom');
      }
    }
  }

  // 2. Snap list items first, then snap every direct child block so cumulative top positions stay locked to `step`!
  for (const el of children) {
    if (el.tagName === 'UL' || el.tagName === 'OL') {
      for (const li of Array.from(el.children)) {
        const liH = li.getBoundingClientRect().height;
        const remLi = ((liH % step) + step) % step;
        if (remLi > 0.5 && step - remLi > 0.5) {
          li.style.setProperty('margin-bottom', `${(step - remLi).toFixed(2)}px`, 'important');
        }
      }
    }
    const h = el.getBoundingClientRect().height;
    const rem = ((h % step) + step) % step;
    if (rem > 0.5 && step - rem > 0.5) {
      const baseMb = parseFloat(window.getComputedStyle(el).marginBottom) || 0;
      el.style.setProperty('margin-bottom', `${(baseMb + (step - rem)).toFixed(2)}px`, 'important');
    }
  }

  // Cumulative verification pass: lock every child's top coordinate to an exact integer multiple of `step`
  if (children.length >= 2) {
    const firstTop = children[0].getBoundingClientRect().top;
    for (let i = 1; i < children.length; i += 1) {
      const curTop = children[i].getBoundingClientRect().top;
      const delta = curTop - firstTop;
      const rem = ((delta % step) + step) % step;
      if (rem > 0.4 && step - rem > 0.4) {
        const prev = children[i - 1];
        const prevMb = parseFloat(window.getComputedStyle(prev).marginBottom) || 0;
        prev.style.setProperty('margin-bottom', `${(prevMb + (step - rem)).toFixed(2)}px`, 'important');
      }
    }
  }

  // 3. Measure exact alphabetic baseline of a probe span on the 1st line rhythm
  const probeWrap = document.createElement('div');
  probeWrap.style.cssText =
    `position:absolute;visibility:hidden;pointer-events:none;left:0;top:${step}px;` +
    `line-height:${step}px;font-size:${window.getComputedStyle(rootEl).fontSize};font-family:${window.getComputedStyle(rootEl).fontFamily};`;
  const textSpan = document.createElement('span');
  textSpan.textContent = 'Нх';
  const strut = document.createElement('span');
  strut.style.cssText = 'display:inline-block;width:1px;height:0;vertical-align:baseline;';
  probeWrap.appendChild(textSpan);
  probeWrap.appendChild(strut);

  const prevPos = sheet.style.position;
  if (cs.position === 'static') sheet.style.position = 'relative';
  sheet.appendChild(probeWrap);

  const sheetBorderTop = parseFloat(cs.borderTopWidth) || 0;
  const paddingBoxTop = sheet.getBoundingClientRect().top + sheetBorderTop;
  const baselineY = strut.getBoundingClientRect().top - paddingBoxTop;
  sheet.removeChild(probeWrap);
  if (cs.position === 'static') sheet.style.position = prevPos;

  if (Number.isFinite(baselineY)) {
    if (isGrid) {
      // In .notebook-grid, 1px line is at top (y=0) of each `cell` tile -> place line right under baseline (+1px)
      const bgY = (((baselineY + 1) % cell) + cell) % cell;
      sheet.style.setProperty('--nb-bg-y', `${bgY.toFixed(1)}px`);
    } else {
      // In .notebook-lined, 1px line is at bottom (y = step - 1) of each `step` tile
      const bgY = (((baselineY - (step - 1) + 1) % step) + step) % step;
      sheet.style.setProperty('--nb-bg-y', `${bgY.toFixed(1)}px`);
    }
  }
}

export default function MarkdownMath({ content, className = '' }) {
  const html = useMemo(() => renderMarkdownWithMath(content), [content]);
  const rootRef = useRef(null);

  useIsoLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return undefined;
    snapNotebookBaseline(el);
    const raf = window.requestAnimationFrame(() => snapNotebookBaseline(el));
    const onResize = () => snapNotebookBaseline(el);
    window.addEventListener('resize', onResize);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
    };
  }, [html]);

  return (
    <div
      ref={rootRef}
      className={`md-content ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
