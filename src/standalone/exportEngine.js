/**
 * Pure Browser Export Engine for Domashka.PRO v3.2:
 *   1) Real OOXML Microsoft Word (.docx) generator (works 100% offline on file:// & HTTP!)
 *   2) High-DPI Baseline-Locked School Notebook Sheet (.png) image generator ("В клетку" / "В линейку")
 */

const SUPERSCRIPTS = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴',
  '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ',
};

const SUBSCRIPTS = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄',
  '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
};

const LATEX_SYMBOLS = [
  [/\\cdot\b/g, '·'],
  [/\\times\b/g, '×'],
  [/\\div\b/g, '÷'],
  [/\\pm\b/g, '±'],
  [/\\mp\b/g, '∓'],
  [/\\le(?:q)?\b/g, '≤'],
  [/\\ge(?:q)?\b/g, '≥'],
  [/\\ne(?:q)?\b/g, '≠'],
  [/\\approx\b/g, '≈'],
  [/\\equiv\b/g, '≡'],
  [/\\sim\b/g, '∼'],
  [/\\infty\b/g, '∞'],
  [/\\circ\b/g, '°'],
  [/\^\\circ/g, '°'],
  [/\^\{\\circ\}/g, '°'],
  [/\\triangle\b/g, '△'],
  [/\\angle\b/g, '∠'],
  [/\\perp\b/g, '⊥'],
  [/\\parallel\b/g, '∥'],
  [/\\in\b/g, '∈'],
  [/\\notin\b/g, '∉'],
  [/\\subset\b/g, '⊂'],
  [/\\cup\b/g, '∪'],
  [/\\cap\b/g, '∩'],
  [/\\emptyset\b/g, '∅'],
  [/\\Rightarrow\b|\\implies\b/g, '⇒'],
  [/\\Leftrightarrow\b|\\iff\b/g, '⇔'],
  [/\\rightarrow\b|\\to\b/g, '→'],
  [/\\leftarrow\b/g, '←'],
  [/\\uparrow\b/g, '↑'],
  [/\\downarrow\b/g, '↓'],
  [/\\alpha\b/g, 'α'],
  [/\\beta\b/g, 'β'],
  [/\\gamma\b/g, 'γ'],
  [/\\delta\b/g, 'δ'],
  [/\\Delta\b/g, 'Δ'],
  [/\\pi\b/g, 'π'],
  [/\\rho\b/g, 'ρ'],
  [/\\sigma\b/g, 'σ'],
  [/\\omega\b/g, 'ω'],
  [/\\Omega\b/g, 'Ω'],
  [/\\lambda\b/g, 'λ'],
  [/\\mu\b/g, 'μ'],
  [/\\phi\b|\\varphi\b/g, 'φ'],
  [/\\sum\b/g, '∑'],
  [/\\prod\b/g, '∏'],
  [/\\int\b/g, '∫'],
];

export function latexToReadableUnicode(input) {
  if (!input) return '';
  let s = String(input);

  const convertFormula = (expr) => {
    let f = expr.trim();
    // \text{...} / \mathrm{...}
    f = f.replace(/\\(?:text|mathrm|mathbf|mathit)\{([^{}]*)\}/g, '$1');
    // Nested \frac{a}{b} (2 passes)
    for (let pass = 0; pass < 2; pass += 1) {
      f = f.replace(/\\(?:d|t)?frac\{([^{}]+)\}\{([^{}]+)\}/g, (_, a, b) => {
        const na = a.trim();
        const nb = b.trim();
        const wa = /[+\-\s]/.test(na) ? `(${na})` : na;
        const wb = /[+\-\s*/]/.test(nb) ? `(${nb})` : nb;
        return `${wa}/${wb}`;
      });
    }
    // \sqrt[n]{x} and \sqrt{x}
    f = f.replace(/\\sqrt\[([^\]]+)\]\{([^{}]+)\}/g, '√[$1]($2)');
    f = f.replace(/\\sqrt\{([^{}]+)\}/g, (_, x) => (x.length <= 2 ? `√${x}` : `√(${x})`));
    for (const [re, rep] of LATEX_SYMBOLS) {
      f = f.replace(re, rep);
    }
    // ^{...} and ^d
    f = f.replace(/\^\{([0-9+\-=()n]+)\}/g, (_, grp) =>
      grp.split('').map((c) => SUPERSCRIPTS[c] || c).join('')
    );
    f = f.replace(/\^([0-9n])/g, (_, c) => SUPERSCRIPTS[c] || `^${c}`);
    // _{...} and _d
    f = f.replace(/_\{([0-9+\-=()]+)\}/g, (_, grp) =>
      grp.split('').map((c) => SUBSCRIPTS[c] || c).join('')
    );
    f = f.replace(/_([0-9])/g, (_, c) => SUBSCRIPTS[c] || `_${c}`);
    f = f.replace(/\\left|\\right/g, '');
    f = f.replace(/\\[,;:!]/g, ' ');
    f = f.replace(/\{([^{}]*)\}/g, '$1');
    f = f.replace(/\\\\/g, '; ');
    return f.replace(/\s+/g, ' ').trim();
  };

  s = s.replace(/\$\$([\s\S]+?)\$\$/g, (_, f) => `\n  ${convertFormula(f)}\n`);
  s = s.replace(/\$([^\$\n]+?)\$/g, (_, f) => convertFormula(f));
  return s;
}

// ==================== Minimal Pure-JS PKZIP Builder (Store Method 0 + CRC32) ====================
const CRC_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tbl[i] = c >>> 0;
  }
  return tbl;
})();

function crc32Bytes(u8) {
  let crc = 0xffffffff;
  for (let i = 0; i < u8.length; i += 1) {
    crc = CRC_TABLE[(crc ^ u8[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildZipBlob(entries, mimeType) {
  const enc = new TextEncoder();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const dataBytes = typeof entry.data === 'string' ? enc.encode(entry.data) : entry.data;
    const crc = crc32Bytes(dataBytes);
    const size = dataBytes.length;

    // Local file header (30 bytes + name)
    const lh = new Uint8Array(30 + nameBytes.length);
    const lhv = new DataView(lh.buffer);
    lhv.setUint32(0, 0x04034b50, true);
    lhv.setUint16(4, 20, true); // version needed
    lhv.setUint16(6, 0x0800, true); // UTF-8 flag
    lhv.setUint16(8, 0, true); // method 0 (stored)
    lhv.setUint16(10, 0, true); // mod time
    lhv.setUint16(12, 0x5821, true); // mod date
    lhv.setUint32(14, crc, true);
    lhv.setUint32(18, size, true);
    lhv.setUint32(22, size, true);
    lhv.setUint16(26, nameBytes.length, true);
    lhv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);

    localParts.push(lh, dataBytes);

    // Central directory header (46 bytes + name)
    const ch = new Uint8Array(46 + nameBytes.length);
    const chv = new DataView(ch.buffer);
    chv.setUint32(0, 0x02014b50, true);
    chv.setUint16(4, 20, true);
    chv.setUint16(6, 20, true);
    chv.setUint16(8, 0x0800, true);
    chv.setUint16(10, 0, true);
    chv.setUint16(12, 0, true);
    chv.setUint16(14, 0x5821, true);
    chv.setUint32(16, crc, true);
    chv.setUint32(20, size, true);
    chv.setUint32(24, size, true);
    chv.setUint16(28, nameBytes.length, true);
    chv.setUint16(30, 0, true);
    chv.setUint16(32, 0, true);
    chv.setUint16(34, 0, true);
    chv.setUint16(36, 0, true);
    chv.setUint32(38, 0, true);
    chv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    centralParts.push(ch);

    offset += lh.length + size;
  }

  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  return new Blob([...localParts, ...centralParts, eocd], { type: mimeType });
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function inlineRunsXml(line) {
  // Parse **bold**, *italic*, and `code` into <w:r> runs
  const cleaned = line.replace(/`([^`]+)`/g, '$1');
  const tokens = cleaned.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).filter(Boolean);
  if (!tokens.length) return '<w:r><w:t xml:space="preserve"></w:t></w:r>';
  return tokens
    .map((tok) => {
      if (tok.startsWith('**') && tok.endsWith('**') && tok.length > 4) {
        return `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(tok.slice(2, -2))}</w:t></w:r>`;
      }
      if (tok.startsWith('*') && tok.endsWith('*') && tok.length > 2) {
        return `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${escapeXml(tok.slice(1, -1))}</w:t></w:r>`;
      }
      return `<w:r><w:t xml:space="preserve">${escapeXml(tok)}</w:t></w:r>`;
    })
    .join('');
}

function triggerDownloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/**
 * Generates and downloads a real Microsoft Word (.docx) document from Markdown + LaTeX!
 */
export function exportMarkdownToDocx(
  markdown,
  {
    title = 'Чистовик домашней работы',
    grade = 8,
    subjectLabel = '',
    filename = '',
  } = {}
) {
  const readable = latexToReadableUnicode(markdown || '');
  const rawLines = readable.split(/\r?\n/);

  const bodyXmlParts = [];

  // Document Header Banner
  const subtitle = [`Домашка.ПРО`, `${grade} класс`, subjectLabel].filter(Boolean).join(' · ');
  bodyXmlParts.push(
    `<w:p><w:pPr><w:spacing w:after="80"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="1E3A8A"/><w:sz w:val="30"/></w:rPr><w:t>${escapeXml(
      title
    )}</w:t></w:r></w:p>`,
    `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="4" w:color="CBD5E1"/></w:pBdr><w:spacing w:after="200"/></w:pPr><w:r><w:rPr><w:color w:val="64748B"/><w:sz w:val="20"/></w:rPr><w:t>${escapeXml(
      subtitle
    )}</w:t></w:r></w:p>`
  );

  let i = 0;
  while (i < rawLines.length) {
    const line = rawLines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // Markdown table block
    if (trimmed.startsWith('|') && trimmed.endsWith('|') && i + 1 < rawLines.length && /^\s*\|[\s\-:|]+\|\s*$/.test(rawLines[i + 1])) {
      const tableRows = [];
      tableRows.push(
        trimmed
          .slice(1, -1)
          .split('|')
          .map((c) => c.trim())
      );
      i += 2; // skip separator row
      while (i < rawLines.length && rawLines[i].trim().startsWith('|')) {
        tableRows.push(
          rawLines[i]
            .trim()
            .replace(/^\|/, '')
            .replace(/\|$/, '')
            .split('|')
            .map((c) => c.trim())
        );
        i += 1;
      }
      const tblXml =
        `<w:tbl>` +
        `<w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>` +
        `<w:top w:val="single" w:sz="4" w:space="0" w:color="94A3B8"/>` +
        `<w:left w:val="single" w:sz="4" w:space="0" w:color="94A3B8"/>` +
        `<w:bottom w:val="single" w:sz="4" w:space="0" w:color="94A3B8"/>` +
        `<w:right w:val="single" w:sz="4" w:space="0" w:color="94A3B8"/>` +
        `<w:insideH w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>` +
        `<w:insideV w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>` +
        `</w:tblBorders></w:tblPr>` +
        tableRows
          .map(
            (row, rIdx) =>
              `<w:tr>` +
              row
                .map(
                  (cell) =>
                    `<w:tc><w:tcPr>${
                      rIdx === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="F1F5F9"/>' : ''
                    }</w:tcPr><w:p><w:pPr><w:spacing w:after="60"/></w:pPr>${
                      rIdx === 0
                        ? `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(
                            cell.replace(/\*\*/g, '')
                          )}</w:t></w:r>`
                        : inlineRunsXml(cell)
                    }</w:p></w:tc>`
                )
                .join('') +
              `</w:tr>`
          )
          .join('') +
        `</w:tbl><w:p><w:pPr><w:spacing w:after="120"/></w:pPr></w:p>`;
      bodyXmlParts.push(tblXml);
      continue;
    }

    // Fenced code block
    if (trimmed.startsWith('```')) {
      i += 1;
      const codeLines = [];
      while (i < rawLines.length && !rawLines[i].trim().startsWith('```')) {
        codeLines.push(rawLines[i]);
        i += 1;
      }
      i += 1;
      for (const cl of codeLines) {
        bodyXmlParts.push(
          `<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F8FAFC"/><w:spacing w:after="40"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="20"/></w:rPr><w:t xml:space="preserve">${escapeXml(
            cl
          )}</w:t></w:r></w:p>`
        );
      }
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(trimmed)) {
      bodyXmlParts.push(
        `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="4" w:space="1" w:color="CBD5E1"/></w:pBdr><w:spacing w:after="140"/></w:pPr></w:p>`
      );
      i += 1;
      continue;
    }

    // Headings
    const hMatch = trimmed.match(/^(#{1,4})\s+(.*)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      const sz = level === 1 ? '28' : level === 2 ? '26' : '24';
      const cleanH = hMatch[2].replace(/\*\*/g, '');
      bodyXmlParts.push(
        `<w:p><w:pPr><w:spacing w:before="200" w:after="100"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="1E293B"/><w:sz w:val="${sz}"/></w:rPr><w:t xml:space="preserve">${escapeXml(
          cleanH
        )}</w:t></w:r></w:p>`
      );
      i += 1;
      continue;
    }

    // Bullet or numbered list item
    const ulMatch = trimmed.match(/^[-*•]\s+(.*)$/);
    const olMatch = trimmed.match(/^(\d+[.)])\s+(.*)$/);
    if (ulMatch || olMatch) {
      const prefix = ulMatch ? '• ' : `${olMatch[1]} `;
      const rest = ulMatch ? ulMatch[1] : olMatch[2];
      bodyXmlParts.push(
        `<w:p><w:pPr><w:ind w:left="360"/><w:spacing w:after="80"/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${escapeXml(
          prefix
        )}</w:t></w:r>${inlineRunsXml(rest)}</w:p>`
      );
      i += 1;
      continue;
    }

    // Blockquote
    if (trimmed.startsWith('>')) {
      const qText = trimmed.replace(/^>\s*/, '');
      bodyXmlParts.push(
        `<w:p><w:pPr><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="3B82F6"/></w:pBdr><w:ind w:left="280"/><w:spacing w:after="120"/></w:pPr>${inlineRunsXml(
          qText
        )}</w:p>`
      );
      i += 1;
      continue;
    }

    // Standard paragraph
    bodyXmlParts.push(
      `<w:p><w:pPr><w:spacing w:after="120" w:line="300" w:lineRule="auto"/></w:pPr>${inlineRunsXml(
        trimmed
      )}</w:p>`
    );
    i += 1;
  }

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

  const rootRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault>
      <w:rPr>
        <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
        <w:sz w:val="24"/>
        <w:lang w:val="ru-RU"/>
      </w:rPr>
    </w:rPrDefault>
  </w:docDefaults>
</w:styles>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyXmlParts.join('\n    ')}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1134" w:right="850" w:bottom="1134" w:left="1417"/>
    </w:sectPr>
  </w:body>
</w:document>`;

  const blob = buildZipBlob(
    [
      { name: '[Content_Types].xml', data: contentTypesXml },
      { name: '_rels/.rels', data: rootRelsXml },
      { name: 'word/_rels/document.xml.rels', data: docRelsXml },
      { name: 'word/styles.xml', data: stylesXml },
      { name: 'word/document.xml', data: documentXml },
    ],
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  );

  const outName = filename || `Domashka_PRO_${grade}kl_${new Date().toISOString().slice(0, 10)}.docx`;
  triggerDownloadBlob(blob, outName);
  return outName;
}

/**
 * Renders and downloads a high-DPI PNG image of a baseline-locked school notebook sheet
 * ("Тетрадь в клетку" or "Тетрадь в линейку") where every word sits directly on the ruled line!
 */
export function exportNotebookSheetPng(
  markdown,
  {
    grade = 8,
    paperStyle = 'notebook', // 'notebook' (grid) | 'lined'
    title = 'Домашняя работа',
    filename = '',
  } = {}
) {
  const readable = latexToReadableUnicode(markdown || '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1');

  const isLined = paperStyle === 'lined';
  const pageWidth = 960;
  const cell = 16;
  const step = 32; // 2 cells per text row!
  const leftPad = cell * 3; // 48px — aligned to 3rd vertical cell line
  const rightMarginX = pageWidth - cell * 4; // 896px red margin line
  const maxTextWidth = rightMarginX - leftPad - 16;

  // Measure & wrap lines using an offscreen context
  const measureCanvas = document.createElement('canvas');
  const mctx = measureCanvas.getContext('2d');
  const baseFont = '18px "Segoe UI", system-ui, -apple-system, Arial, sans-serif';
  const boldFont = 'bold 19px "Segoe UI", system-ui, -apple-system, Arial, sans-serif';

  const wrappedRows = [];
  // Header row
  wrappedRows.push({ text: `${title} (${grade} класс · Домашка.ПРО)`, bold: true, color: '#1e3a8a' });
  wrappedRows.push({ text: '', bold: false });

  for (const rawLine of readable.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      if (wrappedRows.length && wrappedRows[wrappedRows.length - 1].text !== '') {
        wrappedRows.push({ text: '', bold: false });
      }
      continue;
    }
    if (/^---+$/.test(trimmed) || /^\s*\|[\s\-:|]+\|\s*$/.test(trimmed)) {
      continue;
    }

    const isHeading = /^#{1,4}\s+/.test(trimmed);
    const cleanText = trimmed
      .replace(/^#{1,4}\s+/, '')
      .replace(/^>\s*/, '│ ')
      .replace(/^[-*]\s+/, '• ')
      .replace(/^\|\s*/, '')
      .replace(/\s*\|$/, '')
      .replace(/\s*\|\s*/g, '   |   ');

    mctx.font = isHeading ? boldFont : baseFont;
    const words = cleanText.split(/\s+/);
    let cur = '';
    for (const w of words) {
      const test = cur ? `${cur} ${w}` : w;
      if (mctx.measureText(test).width > maxTextWidth && cur) {
        wrappedRows.push({
          text: cur,
          bold: isHeading,
          color: isHeading ? '#1e3a8a' : '#0f172a',
        });
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) {
      wrappedRows.push({
        text: cur,
        bold: isHeading,
        color: isHeading ? '#1e3a8a' : '#0f172a',
      });
    }
  }

  const totalRows = Math.max(16, wrappedRows.length + 3);
  const pageHeight = (totalRows + 2) * step;
  const dpr = 2;

  const canvas = document.createElement('canvas');
  canvas.width = pageWidth * dpr;
  canvas.height = pageHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  // Paper background
  ctx.fillStyle = '#fdfcf7';
  ctx.fillRect(0, 0, pageWidth, pageHeight);

  // Draw squared grid or ruled lines
  if (!isLined) {
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.22)';
    ctx.lineWidth = 1;
    for (let x = 0; x <= pageWidth; x += cell) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, pageHeight);
      ctx.stroke();
    }
    for (let y = 0; y <= pageHeight; y += cell) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(pageWidth, y + 0.5);
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = 'rgba(59, 130, 246, 0.28)';
    ctx.lineWidth = 1;
    for (let y = step * 2; y <= pageHeight; y += step) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(pageWidth, y + 0.5);
      ctx.stroke();
    }
  }

  // Red vertical margin line
  ctx.strokeStyle = 'rgba(239, 68, 68, 0.52)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(rightMarginX, 0);
  ctx.lineTo(rightMarginX, pageHeight);
  ctx.stroke();

  // Draw every text row with alphabetic baseline resting directly on y = (rowIdx + 2) * step - 1!
  ctx.textBaseline = 'alphabetic';
  wrappedRows.forEach((row, idx) => {
    if (!row.text) return;
    const baselineY = (idx + 2) * step - 1.5;
    ctx.font = row.bold ? boldFont : baseFont;
    ctx.fillStyle = row.color || '#0f172a';
    ctx.fillText(row.text, leftPad, baselineY);
  });

  canvas.toBlob((blob) => {
    if (!blob) return;
    const outName = filename || `Domashka_PRO_Лист_${grade}kl_${new Date().toISOString().slice(0, 10)}.png`;
    triggerDownloadBlob(blob, outName);
  }, 'image/png');
}
