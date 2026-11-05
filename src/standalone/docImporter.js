/**
 * Homework Document Importer for Domashka.PRO v3.2:
 * Extracts homework text directly in the browser (both file:// and HTTP!) from:
 *   - .docx (Microsoft Word / LibreOffice / Google Docs — pure JS ZIP + XML parser, 100% offline!)
 *   - .txt / .md / .csv (UTF-8 + automatic Russian Windows-1251 fallback, 100% offline!)
 *   - .pdf (Offline FlateDecode + ToUnicode text extractor + Fastly pdf.js + Vision OCR fallback for scanned PDFs!)
 */

import { recognizeHomeworkPhoto } from './visionEngine';

const PDFJS_SCRIPT_URL = 'https://fastly.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js';
const PDFJS_WORKER_URL = 'https://fastly.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js';

let pdfJsLoadPromise = null;

function decodeTextBufferSmart(buffer) {
  const u8 = new Uint8Array(buffer);
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(u8);
  // If replacement chars appear, try Russian Windows-1251
  if (utf8.includes('\uFFFD')) {
    try {
      const cp1251 = new TextDecoder('windows-1251', { fatal: false }).decode(u8);
      if (!cp1251.includes('\uFFFD')) return cp1251;
    } catch {
      // ignore
    }
  }
  return utf8;
}

async function inflateRawBytes(compressedU8, format = 'deflate-raw') {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Браузер не поддерживает распаковку сжатых архивов');
  }
  const ds = new DecompressionStream(format);
  const writer = ds.writable.getWriter();
  writer.write(compressedU8).catch(() => {});
  writer.close().catch(() => {});
  const resp = new Response(ds.readable);
  const ab = await resp.arrayBuffer();
  return new Uint8Array(ab);
}

/**
 * Reads a file entry from a ZIP ArrayBuffer via Central Directory (handles bit-3 data descriptors!).
 */
async function readZipEntryBytes(arrayBuffer, targetPath) {
  const u8 = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);

  // Locate End of Central Directory (0x06054b50) scanning backwards from end
  let eocdPos = -1;
  const minPos = Math.max(0, u8.length - 65557);
  for (let p = u8.length - 22; p >= minPos; p -= 1) {
    if (dv.getUint32(p, true) === 0x06054b50) {
      eocdPos = p;
      break;
    }
  }
  if (eocdPos < 0) {
    throw new Error('Файл не является корректным документом .docx');
  }

  const totalEntries = dv.getUint16(eocdPos + 10, true);
  const cdOffset = dv.getUint32(eocdPos + 16, true);
  const dec = new TextDecoder('utf-8');

  let ptr = cdOffset;
  for (let i = 0; i < totalEntries && ptr + 46 <= u8.length; i += 1) {
    if (dv.getUint32(ptr, true) !== 0x02014b50) break;
    const method = dv.getUint16(ptr + 10, true);
    const compSize = dv.getUint32(ptr + 20, true);
    const nameLen = dv.getUint16(ptr + 28, true);
    const extraLen = dv.getUint16(ptr + 30, true);
    const commentLen = dv.getUint16(ptr + 32, true);
    const localHeaderOffset = dv.getUint32(ptr + 42, true);
    const name = dec.decode(u8.subarray(ptr + 46, ptr + 46 + nameLen));

    if (name === targetPath) {
      if (dv.getUint32(localHeaderOffset, true) !== 0x04034b50) {
        throw new Error('Повреждён заголовок внутри .docx');
      }
      const lNameLen = dv.getUint16(localHeaderOffset + 26, true);
      const lExtraLen = dv.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
      const slice = u8.subarray(dataStart, dataStart + compSize);
      if (method === 0) return slice;
      if (method === 8) return await inflateRawBytes(slice, 'deflate-raw');
      throw new Error(`Неподдерживаемый метод сжатия .docx (${method})`);
    }
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('Внутри .docx не найден текстовый слой word/document.xml');
}

async function extractDocxText(file) {
  const ab = await file.arrayBuffer();
  const xmlBytes = await readZipEntryBytes(ab, 'word/document.xml');
  const xmlText = new TextDecoder('utf-8').decode(xmlBytes);

  const doc = new DOMParser().parseFromString(xmlText, 'application/xml');
  const lines = [];
  const body = doc.getElementsByTagNameNS('*', 'body')[0] || doc.documentElement;

  for (const child of Array.from(body.childNodes || [])) {
    const local = child.localName || '';
    if (local === 'p') {
      let pTxt = '';
      const runs = child.getElementsByTagNameNS('*', '*');
      for (const node of Array.from(runs)) {
        if (node.localName === 't') pTxt += node.textContent || '';
        else if (node.localName === 'tab') pTxt += '\t';
        else if (node.localName === 'br') pTxt += '\n';
      }
      if (pTxt.trim()) lines.push(pTxt.trim());
    } else if (local === 'tbl') {
      const trs = child.getElementsByTagNameNS('*', 'tr');
      for (const tr of Array.from(trs)) {
        const cells = [];
        for (const tc of Array.from(tr.childNodes || [])) {
          if (tc.localName !== 'tc') continue;
          const tNodes = tc.getElementsByTagNameNS('*', 't');
          const cellStr = Array.from(tNodes)
            .map((n) => n.textContent || '')
            .join('')
            .trim();
          cells.push(cellStr);
        }
        if (cells.some(Boolean)) lines.push(cells.join(' | '));
      }
    }
  }

  const out = lines.join('\n').trim();
  if (!out) {
    throw new Error('В документе Word не найдено текста (возможно, внутри вставлена только картинка — загрузите её как фото).');
  }
  return out;
}

function ensurePdfJsLoaded() {
  if (typeof window !== 'undefined' && window.pdfjsLib) {
    return Promise.resolve(window.pdfjsLib);
  }
  if (pdfJsLoadPromise) return pdfJsLoadPromise;

  pdfJsLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PDFJS_SCRIPT_URL;
    script.async = true;
    script.crossOrigin = 'anonymous';

    const timer = setTimeout(() => {
      pdfJsLoadPromise = null;
      try {
        script.remove();
      } catch {
        // ignore
      }
      reject(new Error('Таймаут загрузки модуля чтения PDF'));
    }, 8000);

    script.onload = () => {
      clearTimeout(timer);
      if (window.pdfjsLib) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
        resolve(window.pdfjsLib);
      } else {
        pdfJsLoadPromise = null;
        reject(new Error('Не удалось инициализировать модуль PDF'));
      }
    };
    script.onerror = () => {
      clearTimeout(timer);
      pdfJsLoadPromise = null;
      try {
        script.remove();
      } catch {
        // ignore
      }
      reject(new Error('Нет доступа к CDN чтения PDF'));
    };
    document.head.appendChild(script);
  });

  return pdfJsLoadPromise;
}

function tryOfflineSimplePdfExtract(ab) {
  const latin = new TextDecoder('latin1').decode(new Uint8Array(ab));
  const chunks = [];
  // Extract UTF-16BE <FEFF...> hex strings or literal (...) Tj strings
  const hexRe = /<FEFF([0-9A-Fa-f\s]+)>/g;
  let m;
  while ((m = hexRe.exec(latin)) !== null) {
    const hex = m[1].replace(/\s+/g, '');
    let str = '';
    for (let i = 0; i + 3 < hex.length; i += 4) {
      str += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16));
    }
    if (str.trim()) chunks.push(str.trim());
  }
  const litRe = /\(([^()\\]{2,200})\)\s*Tj/g;
  while ((m = litRe.exec(latin)) !== null) {
    if (/[А-Яа-яЁёA-Za-z0-9]/.test(m[1])) chunks.push(m[1].trim());
  }
  return chunks.join(' ').trim();
}

async function extractPdfText(file, onProgress) {
  const ab = await file.arrayBuffer();

  // 1. Rich PDF.js extraction via non-Cloudflare Fastly (supports multi-page text + scanned PDF Vision fallback!)
  try {
    onProgress?.('Читаем страницы PDF-документа...');
    const pdfjsLib = await ensurePdfJsLoaded();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
    const maxPages = Math.min(pdf.numPages, 6);
    const pageTexts = [];

    for (let p = 1; p <= maxPages; p += 1) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      let lastY = null;
      let lineBuf = '';
      const lines = [];
      for (const item of tc.items || []) {
        const y = item.transform ? Math.round(item.transform[5]) : 0;
        if (lastY !== null && Math.abs(y - lastY) > 5) {
          if (lineBuf.trim()) lines.push(lineBuf.trim());
          lineBuf = item.str || '';
        } else {
          lineBuf += (lineBuf && !lineBuf.endsWith(' ') ? ' ' : '') + (item.str || '');
        }
        lastY = y;
      }
      if (lineBuf.trim()) lines.push(lineBuf.trim());
      if (lines.length) pageTexts.push(lines.join('\n'));
    }

    const joined = pageTexts.join('\n\n').trim();
    if (joined.length >= 3) {
      return joined;
    }

    // Scanned PDF (0 selectable characters) -> render Page 1 onto Canvas and run Vision OCR!
    onProgress?.('PDF оказался сканом — распознаём страницу ИИ-сканером...');
    const firstPage = await pdf.getPage(1);
    const vp = firstPage.getViewport({ scale: 1.8 });
    const canvas = document.createElement('canvas');
    canvas.width = vp.width;
    canvas.height = vp.height;
    await firstPage.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
    const pageUri = canvas.toDataURL('image/jpeg', 0.88);
    const ocrRes = await recognizeHomeworkPhoto(pageUri, {
      purpose: 'solve',
      onProgress: (st) => onProgress?.(st?.message || 'Распознаём скан PDF...'),
    });
    if (ocrRes?.text) return ocrRes.text;
  } catch {
    // Fall back to offline literal/UTF-16 PDF parser
  }

  const offlineTxt = tryOfflineSimplePdfExtract(ab);
  if (offlineTxt.length >= 3) return offlineTxt;

  throw new Error(
    'Не удалось извлечь текст из этого PDF офлайн. Сделайте скриншот нужной задачи (Win+Shift+S) и вставьте его по Ctrl+V!'
  );
}

/**
 * Unified homework document reader (.docx, .pdf, .txt, .md, .csv)
 */
export async function extractTextFromHomeworkFile(file, { onProgress } = {}) {
  if (!file) throw new Error('Файл не выбран');
  const name = String(file.name || '').toLowerCase();

  if (name.endsWith('.docx')) {
    onProgress?.(`Извлекаем текст из документа Word «${file.name}»...`);
    const text = await extractDocxText(file);
    return { text, sourceLabel: `Word (${file.name})` };
  }

  if (name.endsWith('.doc')) {
    throw new Error(
      'Старый формат .doc (Word 97–2003) бинарный. Пересохраните файл как современный .docx или скопируйте текст в поле!'
    );
  }

  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const text = await extractPdfText(file, onProgress);
    return { text, sourceLabel: `PDF (${file.name})` };
  }

  if (
    name.endsWith('.txt') ||
    name.endsWith('.md') ||
    name.endsWith('.csv') ||
    file.type.startsWith('text/')
  ) {
    onProgress?.(`Читаем текстовый файл «${file.name}»...`);
    const ab = await file.arrayBuffer();
    const text = decodeTextBufferSmart(ab).trim();
    if (!text) throw new Error('Текстовый файл пуст.');
    return { text, sourceLabel: `Текст (${file.name})` };
  }

  throw new Error('Поддерживаются изображения (JPG, PNG, WebP) и документы (.docx, .pdf, .txt).');
}
