// 100% Pure-JavaScript Exact Mathematical & Scientific Engine for Downloaded Standalone App

// ==================== 1. Exact BigInt Rational Arithmetic ====================
function absBig(n) {
  return n < 0n ? -n : n;
}

export function gcdBig(a, b) {
  let x = absBig(BigInt(a));
  let y = absBig(BigInt(b));
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === 0n ? 1n : x;
}

export function lcmBig(a, b) {
  const x = absBig(BigInt(a));
  const y = absBig(BigInt(b));
  if (x === 0n || y === 0n) return 0n;
  return (x / gcdBig(x, y)) * y;
}

export class BigFrac {
  constructor(num, den = 1n) {
    let n = BigInt(num);
    let d = BigInt(den);
    if (d === 0n) throw new Error('Деление на ноль');
    if (d < 0n) {
      n = -n;
      d = -d;
    }
    if (n === 0n) {
      this.n = 0n;
      this.d = 1n;
    } else {
      const g = gcdBig(n, d);
      this.n = n / g;
      this.d = d / g;
    }
  }

  static fromNumberStr(str) {
    const s = str.trim().replace(',', '.');
    if (!s.includes('.')) return new BigFrac(BigInt(s), 1n);
    const neg = s.startsWith('-');
    const clean = neg ? s.slice(1) : s;
    const [ip, fp] = clean.split('.');
    const den = 10n ** BigInt(fp.length);
    const num = BigInt(ip || '0') * den + BigInt(fp || '0');
    return new BigFrac(neg ? -num : num, den);
  }

  isZero() {
    return this.n === 0n;
  }
  isNeg() {
    return this.n < 0n;
  }
  isInt() {
    return this.d === 1n;
  }
  neg() {
    return new BigFrac(-this.n, this.d);
  }
  add(o) {
    return new BigFrac(this.n * o.d + o.n * this.d, this.d * o.d);
  }
  sub(o) {
    return new BigFrac(this.n * o.d - o.n * this.d, this.d * o.d);
  }
  mul(o) {
    return new BigFrac(this.n * o.n, this.d * o.d);
  }
  div(o) {
    if (o.n === 0n) throw new Error('Деление на ноль');
    return new BigFrac(this.n * o.d, this.d * o.n);
  }
  pow(exp) {
    const e = Number(exp);
    if (e === 0) return new BigFrac(1n, 1n);
    if (e > 0) return new BigFrac(this.n ** BigInt(e), this.d ** BigInt(e));
    return new BigFrac(this.d ** BigInt(-e), this.n ** BigInt(-e));
  }
  eq(o) {
    return this.n === o.n && this.d === o.d;
  }
  toFloat() {
    return Number(this.n) / Number(this.d);
  }
  toLatex() {
    if (this.d === 1n) return this.n.toString();
    const sign = this.n < 0n ? '-' : '';
    return `${sign}\\frac{${absBig(this.n).toString()}}{${this.d.toString()}}`;
  }
  toMixedLatex() {
    if (this.d === 1n) return this.n.toString();
    const sign = this.n < 0n ? '-' : '';
    const an = absBig(this.n);
    const whole = an / this.d;
    const rem = an % this.d;
    if (whole === 0n) return `${sign}\\frac{${rem}}{${this.d}}`;
    return `${sign}${whole}\\frac{${rem}}{${this.d}}`;
  }
}

const ZERO = new BigFrac(0n, 1n);
const ONE = new BigFrac(1n, 1n);

// Exact integer square root simplification: sqrt(N) -> { out: k, rad: m } where N = k^2 * m
function simplifyIntSqrt(nBig) {
  let n = absBig(nBig);
  if (n === 0n) return { out: 0n, rad: 1n };
  // Check exact integer square root first (fast Newton method)
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  if (x * x === n) return { out: x, rad: 1n };

  let out = 1n;
  let rad = n;
  let d = 2n;
  while (d * d <= rad && d <= 100000n) {
    while (rad % (d * d) === 0n) {
      out *= d;
      rad /= d * d;
    }
    d = d === 2n ? 3n : d + 2n;
  }
  return { out, rad };
}

// ==================== 2. Symbolic Single-Variable Polynomial Engine ====================
class Poly {
  // coeffs[i] = BigFrac for x^i
  constructor(coeffs = [ZERO], varName = 'x') {
    this.varName = varName;
    this.c = coeffs.slice();
    this.trim();
  }
  trim() {
    while (this.c.length > 1 && this.c[this.c.length - 1].isZero()) {
      this.c.pop();
    }
  }
  degree() {
    if (this.c.length === 1 && this.c[0].isZero()) return 0;
    return this.c.length - 1;
  }
  isConst() {
    return this.c.length === 1;
  }
  add(o) {
    const len = Math.max(this.c.length, o.c.length);
    const res = [];
    for (let i = 0; i < len; i++) {
      res.push((this.c[i] || ZERO).add(o.c[i] || ZERO));
    }
    return new Poly(res, this.varName || o.varName);
  }
  sub(o) {
    const len = Math.max(this.c.length, o.c.length);
    const res = [];
    for (let i = 0; i < len; i++) {
      res.push((this.c[i] || ZERO).sub(o.c[i] || ZERO));
    }
    return new Poly(res, this.varName || o.varName);
  }
  mul(o) {
    const res = Array(this.c.length + o.c.length - 1).fill(ZERO);
    for (let i = 0; i < this.c.length; i++) {
      for (let j = 0; j < o.c.length; j++) {
        res[i + j] = res[i + j].add(this.c[i].mul(o.c[j]));
      }
    }
    return new Poly(res, this.varName || o.varName);
  }
  divConst(o) {
    if (!o.isConst() || o.c[0].isZero()) {
      throw new Error('Деление на переменную поддерживается в ИИ-решателе');
    }
    return new Poly(
      this.c.map((cf) => cf.div(o.c[0])),
      this.varName
    );
  }
  pow(expPoly) {
    if (!expPoly.isConst() || !expPoly.c[0].isInt() || expPoly.c[0].isNeg()) {
      throw new Error('Показатель степени должен быть неотрицательным целым числом');
    }
    const e = Number(expPoly.c[0].n);
    if (e > 20) throw new Error('Слишком большая степень');
    let res = new Poly([ONE], this.varName);
    for (let i = 0; i < e; i++) res = res.mul(this);
    return res;
  }
  evalAt(fracVal) {
    let acc = ZERO;
    for (let i = this.c.length - 1; i >= 0; i--) {
      acc = acc.mul(fracVal).add(this.c[i]);
    }
    return acc;
  }
  diff() {
    if (this.c.length <= 1) return new Poly([ZERO], this.varName);
    const res = [];
    for (let i = 1; i < this.c.length; i++) {
      res.push(this.c[i].mul(new BigFrac(BigInt(i), 1n)));
    }
    return new Poly(res, this.varName);
  }
  integrate() {
    const res = [ZERO];
    for (let i = 0; i < this.c.length; i++) {
      res.push(this.c[i].div(new BigFrac(BigInt(i + 1), 1n)));
    }
    return new Poly(res, this.varName);
  }
  toLatex() {
    const v = this.varName || 'x';
    const terms = [];
    for (let i = this.c.length - 1; i >= 0; i--) {
      const cf = this.c[i];
      if (cf.isZero()) continue;
      const isFirst = terms.length === 0;
      const neg = cf.isNeg();
      const absCf = neg ? cf.neg() : cf;
      const signStr = isFirst ? (neg ? '-' : '') : neg ? ' - ' : ' + ';

      if (i === 0) {
        terms.push(`${signStr}${absCf.toLatex()}`);
      } else {
        const coeffPart = absCf.eq(ONE) ? '' : absCf.toLatex();
        const varPart = i === 1 ? v : `${v}^{${i}}`;
        terms.push(`${signStr}${coeffPart}${varPart}`);
      }
    }
    return terms.length ? terms.join('') : '0';
  }
}

function cleanMathStr(raw) {
  let s = raw.trim();
  s = s.replace(/[−–—]/g, '-').replace(/[×·]/g, '*').replace(/:/g, '/');
  s = s.replace(/²/g, '^2').replace(/³/g, '^3').replace(/⁴/g, '^4');
  s = s.replace(/(\d),(\d)/g, '$1.$2');
  s = s.replace(/х/g, 'x').replace(/Х/g, 'X').replace(/у/g, 'y').replace(/У/g, 'Y');
  return s;
}

function parsePolynomial(exprStr) {
  const s = cleanMathStr(exprStr);
  // Detect variable name (at most 1 variable for single-poly mode)
  const vars = Array.from(new Set((s.match(/[a-zA-Z]/g) || [])));
  if (vars.length > 1) {
    throw new Error('Для нескольких переменных используйте систему уравнений через ;');
  }
  const vName = vars[0] || 'x';

  // Tokenize
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (/[0-9.]/.test(ch)) {
      let num = '';
      while (i < s.length && /[0-9.]/.test(s[i])) num += s[i++];
      tokens.push({ type: 'num', val: BigFrac.fromNumberStr(num) });
    } else if (/[a-zA-Z]/.test(ch)) {
      tokens.push({ type: 'var', val: ch });
      i++;
    } else if ('+-*/^()'.includes(ch)) {
      tokens.push({ type: 'op', val: ch });
      i++;
    } else {
      throw new Error(`Неизвестный символ: ${ch}`);
    }
  }

  // Insert implicit '*' between: num/var/) and var/(/num
  const expanded = [];
  for (let k = 0; k < tokens.length; k++) {
    const cur = tokens[k];
    expanded.push(cur);
    const nxt = tokens[k + 1];
    if (!nxt) continue;
    const leftCanMul = cur.type === 'num' || cur.type === 'var' || (cur.type === 'op' && cur.val === ')');
    const rightCanMul = nxt.type === 'var' || (nxt.type === 'op' && nxt.val === '(') || (cur.type === 'op' && cur.val === ')' && nxt.type === 'num');
    if (leftCanMul && rightCanMul) {
      expanded.push({ type: 'op', val: '*' });
    }
  }

  let pos = 0;
  const peek = () => expanded[pos];
  const consume = () => expanded[pos++];

  function parseExpr() {
    let left = parseTerm();
    while (peek() && peek().type === 'op' && (peek().val === '+' || peek().val === '-')) {
      const op = consume().val;
      const right = parseTerm();
      left = op === '+' ? left.add(right) : left.sub(right);
    }
    return left;
  }

  function parseTerm() {
    let left = parseFactor();
    while (peek() && peek().type === 'op' && (peek().val === '*' || peek().val === '/')) {
      const op = consume().val;
      const right = parseFactor();
      left = op === '*' ? left.mul(right) : left.divConst(right);
    }
    return left;
  }

  function parseFactor() {
    if (peek() && peek().type === 'op' && peek().val === '-') {
      consume();
      return new Poly([ZERO], vName).sub(parseFactor());
    }
    if (peek() && peek().type === 'op' && peek().val === '+') {
      consume();
      return parseFactor();
    }
    let base = parsePrimary();
    if (peek() && peek().type === 'op' && peek().val === '^') {
      consume();
      const exp = parseFactor();
      base = base.pow(exp);
    }
    return base;
  }

  function parsePrimary() {
    const tok = peek();
    if (!tok) throw new Error('Неожиданный конец выражения');
    if (tok.type === 'num') {
      consume();
      return new Poly([tok.val], vName);
    }
    if (tok.type === 'var') {
      consume();
      return new Poly([ZERO, ONE], vName);
    }
    if (tok.type === 'op' && tok.val === '(') {
      consume();
      const inside = parseExpr();
      if (!peek() || peek().val !== ')') throw new Error('Не закрыта скобка');
      consume();
      return inside;
    }
    throw new Error(`Неожиданный токен: ${tok.val}`);
  }

  const res = parseExpr();
  if (pos < expanded.length) throw new Error('Проверьте знаки операций');
  return res;
}

// ==================== Rational Gaussian Elimination (Systems & Chemistry) ====================
function solveLinearSystem(A, b) {
  // A: n x n of BigFrac, b: n of BigFrac
  const n = A.length;
  const M = A.map((row, idx) => [...row, b[idx]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    while (pivot < n && M[pivot][col].isZero()) pivot++;
    if (pivot === n) return null; // No unique solution
    [M[col], M[pivot]] = [M[pivot], M[col]];

    const divVal = M[col][col];
    for (let j = col; j <= n; j++) M[col][j] = M[col][j].div(divVal);

    for (let r = 0; r < n; r++) {
      if (r !== col && !M[r][col].isZero()) {
        const factor = M[r][col];
        for (let j = col; j <= n; j++) {
          M[r][j] = M[r][j].sub(factor.mul(M[col][j]));
        }
      }
    }
  }
  return M.map((row) => row[n]);
}

function parseLinearEquationMultiVar(eqStr, allVars) {
  // Supports e.g. "2x + y = 11" or "3x - 2y + 5 = x + 1"
  const [lhsS, rhsS] = eqStr.split('=');
  const parseSide = (sideStr) => {
    const coeffs = Object.fromEntries(allVars.map((v) => [v, ZERO]));
    let constTerm = ZERO;
    const norm = sideStr.replace(/\s+/g, '').replace(/-/g, '+-');
    const parts = norm.split('+').filter(Boolean);
    for (const part of parts) {
      const mVar = part.match(/^([+-]?\d*(?:\.\d+)?)\*?([a-zA-Z])$/);
      if (mVar) {
        const rawNum = mVar[1];
        const v = mVar[2];
        const cf =
          rawNum === '' || rawNum === '+'
            ? ONE
            : rawNum === '-'
            ? ONE.neg()
            : BigFrac.fromNumberStr(rawNum);
        coeffs[v] = (coeffs[v] || ZERO).add(cf);
      } else {
        constTerm = constTerm.add(BigFrac.fromNumberStr(part));
      }
    }
    return { coeffs, constTerm };
  };
  const L = parseSide(lhsS);
  const R = parseSide(rhsS);
  const row = allVars.map((v) => L.coeffs[v].sub(R.coeffs[v]));
  const rhs = R.constTerm.sub(L.constTerm);
  return { row, rhs };
}

function getDivisors(bigN) {
  const n = absBig(bigN);
  if (n === 0n) return [1n];
  const divs = [];
  for (let d = 1n; d * d <= n && d <= 2000n; d++) {
    if (n % d === 0n) {
      divs.push(d);
      if (d * d !== n) divs.push(n / d);
    }
  }
  return divs;
}

function findRationalRoots(poly) {
  // Convert poly to integer coefficients by multiplying by LCM of denominators
  let lcmDen = 1n;
  for (const cf of poly.c) lcmDen = lcmBig(lcmDen, cf.d);
  const intC = poly.c.map((cf) => (cf.n * lcmDen) / cf.d);

  const roots = [];
  let curPoly = poly;

  while (curPoly.degree() >= 1 && curPoly.c[0].isZero()) {
    roots.push(ZERO);
    curPoly = new Poly(curPoly.c.slice(1), curPoly.varName);
  }
  if (curPoly.degree() === 0) return { roots, quotient: curPoly };

  const pDivs = getDivisors(intC[0]);
  const qDivs = getDivisors(intC[intC.length - 1]);
  const candidates = [];
  const seen = new Set();
  for (const p of pDivs) {
    for (const q of qDivs) {
      for (const sgn of [1n, -1n]) {
        const f = new BigFrac(sgn * p, q);
        const key = `${f.n}/${f.d}`;
        if (!seen.has(key)) {
          seen.add(key);
          candidates.push(f);
        }
      }
    }
  }

  for (const cand of candidates) {
    while (curPoly.degree() >= 1 && curPoly.evalAt(cand).isZero()) {
      roots.push(cand);
      // Synthetic division by (x - cand)
      const deg = curPoly.degree();
      const nextC = Array(deg).fill(ZERO);
      let carry = curPoly.c[deg];
      for (let i = deg - 1; i >= 0; i--) {
        nextC[i] = carry;
        carry = curPoly.c[i].add(carry.mul(cand));
      }
      curPoly = new Poly(nextC, curPoly.varName);
    }
  }
  return { roots, quotient: curPoly };
}

function formatQuadraticExactRoots(a, b, c, v) {
  // Normalize so a > 0
  if (a.isNeg()) {
    a = a.neg();
    b = b.neg();
    c = c.neg();
  }
  const stdPoly = new Poly([c, b, a], v);
  const D = b.mul(b).sub(new BigFrac(4n, 1n).mul(a).mul(c));

  const md = [
    `### Решение квадратного уравнения относительно $${v}$\n`,
    `**1. Приведём квадратное уравнение к стандартному виду $ax^2 + bx + c = 0$:**`,
    `$$${stdPoly.toLatex()} = 0$$`,
    `Коэффициенты: $a = ${a.toLatex()}$, $b = ${b.toLatex()}$, $c = ${c.toLatex()}$.\n`,
    `**2. Вычислим дискриминант по формуле $D = b^2 - 4ac$:**`,
    `$$D = (${b.toLatex()})^2 - 4 \\cdot (${a.toLatex()}) \\cdot (${c.toLatex()}) = ${D.toLatex()}$$\n`,
  ];

  if (D.isNeg()) {
    md.push('Так как $D < 0$, действительных корней нет.\n');
    md.push('**Ответ:** корней нет ($\\varnothing$).');
    return { markdown: md.join('\n'), rootsLatex: [] };
  }

  if (D.isZero()) {
    const x0 = b.neg().div(new BigFrac(2n, 1n).mul(a));
    md.push('Так как $D = 0$, уравнение имеет один корень:');
    md.push(`$$${v} = \\frac{-b}{2a} = \\frac{-(${b.toLatex()})}{2 \\cdot (${a.toLatex()})} = ${x0.toLatex()}$$\n`);
    md.push(`**Ответ:** $${v} = ${x0.toLatex()}$.`);
    return { markdown: md.join('\n'), rootsLatex: [x0.toLatex()] };
  }

  // D > 0: D = D.n / D.d. Note sqrt(n/d) = sqrt(n*d) / d
  const numSimp = simplifyIntSqrt(D.n * D.d);
  if (numSimp.rad === 1n) {
    // Rational roots!
    const sqrtD = new BigFrac(numSimp.out, D.d);
    const twoA = new BigFrac(2n, 1n).mul(a);
    const x1 = b.neg().sub(sqrtD).div(twoA);
    const x2 = b.neg().add(sqrtD).div(twoA);
    md.push(`Так как $D > 0$, уравнение имеет два различных корня ($\\sqrt{D} = ${sqrtD.toLatex()}$):`);
    md.push(`$$${v}_1 = \\frac{-b - \\sqrt{D}}{2a} = \\frac{-(${b.toLatex()}) - ${sqrtD.toLatex()}}{2 \\cdot (${a.toLatex()})} = ${x1.toLatex()}$$`);
    md.push(`$$${v}_2 = \\frac{-b + \\sqrt{D}}{2a} = \\frac{-(${b.toLatex()}) + ${sqrtD.toLatex()}}{2 \\cdot (${a.toLatex()})} = ${x2.toLatex()}$$\n`);
    md.push('**Проверка по теореме Виета:**');
    md.push(`- $${v}_1 + ${v}_2 = ${x1.add(x2).toLatex()} = -\\frac{b}{a}$`);
    md.push(`- $${v}_1 \\cdot ${v}_2 = ${x1.mul(x2).toLatex()} = \\frac{c}{a}$\n`);
    md.push(`**Ответ:** $${v}_1 = ${x1.toLatex()}$; $${v}_2 = ${x2.toLatex()}$.`);
    return { markdown: md.join('\n'), rootsLatex: [x1.toLatex(), x2.toLatex()] };
  } else {
    // Irrational roots with exact radical
    const sqrtLatex =
      D.d === 1n
        ? `${numSimp.out === 1n ? '' : numSimp.out}\\sqrt{${numSimp.rad}}`
        : `\\frac{${numSimp.out === 1n ? '' : numSimp.out}\\sqrt{${numSimp.rad}}}{${D.d}}`;
    const twoA = new BigFrac(2n, 1n).mul(a);
    const r1 = `\\frac{${b.neg().toLatex()} - ${sqrtLatex}}{${twoA.toLatex()}}`;
    const r2 = `\\frac{${b.neg().toLatex()} + ${sqrtLatex}}{${twoA.toLatex()}}`;
    md.push(`Так как $D > 0$, уравнение имеет два иррациональных корня ($\\sqrt{D} = ${sqrtLatex}$):`);
    md.push(`$$${v}_{1,2} = \\frac{${b.neg().toLatex()} \\pm ${sqrtLatex}}{${twoA.toLatex()}}$$\n`);
    md.push(`**Ответ:** $${v}_1 = ${r1}$; $${v}_2 = ${r2}$.`);
    return { markdown: md.join('\n'), rootsLatex: [r1, r2] };
  }
}

export function solveAlgebraJS(rawInput, action = 'auto') {
  const cleaned = cleanMathStr(rawInput);
  if (!cleaned) return { ok: false, error: 'Введите уравнение или выражение.' };

  try {
    // 1. Check system of linear equations separated by ; or newline
    const parts = cleaned
      .split(/[;\n]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length > 1 && parts.every((p) => p.includes('='))) {
      const vars = Array.from(new Set((cleaned.match(/[a-zA-Z]/g) || []))).sort();
      if (vars.length !== parts.length) {
        return {
          ok: false,
          error: 'Число уравнений должно совпадать с числом неизвестных (или решите нестандартную систему во вкладке «ИИ-Решатель»).',
        };
      }
      const A = [];
      const bVec = [];
      for (const p of parts) {
        const { row, rhs } = parseLinearEquationMultiVar(p, vars);
        A.push(row);
        bVec.push(rhs);
      }
      const sol = solveLinearSystem(A, bVec);
      const casesLatex = `\\begin{cases} ${parts.join(' \\\\ ')} \\end{cases}`;
      if (!sol) {
        return {
          ok: true,
          markdown: `### Решение системы уравнений\n$$${casesLatex}$$\n\nСистема не имеет единственного решения (несовместна или имеет бесконечно много решений).`,
        };
      }
      const pairs = vars.map((v, idx) => `${v} = ${sol[idx].toLatex()}`);
      return {
        ok: true,
        markdown: `### Решение системы уравнений\n**Исходная система:**\n$$${casesLatex}$$\n\n**Найдены значения переменных:**\n${pairs
          .map((p) => `- $${p}$`)
          .join('\n')}\n\n**Ответ:** $(${pairs.join(';\\ ')})$.`,
      };
    }

    // 2. Single equation
    if (cleaned.includes('=') && (action === 'auto' || action === 'solve')) {
      const [lhsS, rhsS] = cleaned.split('=');
      const lhs = parsePolynomial(lhsS);
      const rhs = parsePolynomial(rhsS);
      const diff = lhs.sub(rhs);
      const v = diff.varName || 'x';
      const deg = diff.degree();

      if (deg === 0) {
        const isTrue = diff.c[0].isZero();
        return {
          ok: true,
          markdown: `### Проверка равенства\n**Вывод:** равенство **${
            isTrue ? 'верно при любых значениях (тождество)' : 'неверно (корней нет)'
          }**.`,
        };
      }

      if (deg === 1) {
        const b = diff.c[0];
        const a = diff.c[1];
        const root = b.neg().div(a);
        return {
          ok: true,
          markdown: [
            `### Решение линейного уравнения относительно $${v}$\n`,
            `**1. Перенесём все слагаемые в одну часть и раскроем скобки:**`,
            `$$${diff.toLatex()} = 0 \\implies ${a.toLatex()}${v} = ${b.neg().toLatex()}$$`,
            `**2. Разделим на коэффициент при неизвестном:**`,
            `$$${v} = \\frac{${b.neg().toLatex()}}{${a.toLatex()}} = ${root.toLatex()}$$\n`,
            `**Ответ:** $${v} = ${root.toLatex()}$.`,
          ].join('\n'),
        };
      }

      if (deg === 2) {
        const res = formatQuadraticExactRoots(diff.c[2], diff.c[1], diff.c[0], v);
        return { ok: true, markdown: res.markdown };
      }

      // Higher degree (cubic, biquadratic, etc.)
      const { roots, quotient } = findRationalRoots(diff);
      const allRootsLatex = roots.map((r) => r.toLatex());
      if (quotient.degree() === 2) {
        const qRes = formatQuadraticExactRoots(quotient.c[2], quotient.c[1], quotient.c[0], v);
        allRootsLatex.push(...qRes.rootsLatex);
      }
      const uniqueRoots = Array.from(new Set(allRootsLatex));
      return {
        ok: true,
        markdown: [
          `### Решение уравнения ${deg}-й степени\n`,
          `**Стандартный вид:** $$${diff.toLatex()} = 0$$\n`,
          uniqueRoots.length
            ? `**Найденные действительные корни:**\n$$${uniqueRoots
                .map((r) => `${v} = ${r}`)
                .join('; \\quad ')}$$\n\n**Ответ:** ${uniqueRoots.map((r) => `$${v} = ${r}$`).join('; ')}.`
            : `Рациональных корней не обнаружено. Отправьте уравнение во вкладку **«ИИ-Решатель»** для численного и графического разбора!`,
        ].join('\n'),
      };
    }

    // 3. Expression actions: diff, integrate, factor, simplify
    const poly = parsePolynomial(cleaned);
    const v = poly.varName || 'x';

    if (action === 'diff') {
      const d = poly.diff();
      return {
        ok: true,
        markdown: `### Нахождение производной по $${v}$\n$$\\left(${poly.toLatex()}\\right)' = ${d.toLatex()}$$\n\n**Ответ:** $${d.toLatex()}$.`,
      };
    }

    if (action === 'integrate') {
      const integ = poly.integrate();
      return {
        ok: true,
        markdown: `### Первообразная (неопределённый интеграл)\n$$\\int \\left(${poly.toLatex()}\\right) d${v} = ${integ.toLatex()} + C$$`,
      };
    }

    if (action === 'factor') {
      const { roots, quotient } = findRationalRoots(poly);
      if (roots.length === 0) {
        return {
          ok: true,
          markdown: `### Разложение на множители\nМногочлен $${poly.toLatex()}$ не раскладывается на линейные множители с рациональными корнями.`,
        };
      }
      const factors = [];
      const lead = quotient.c[quotient.degree()];
      if (!lead.eq(ONE)) {
        factors.push(lead.eq(ONE.neg()) ? '-' : lead.toLatex());
      }
      for (const r of roots) {
        if (r.isZero()) {
          factors.push(v);
        } else if (r.isNeg()) {
          factors.push(`\\left(${v} + ${r.neg().toLatex()}\\right)`);
        } else {
          factors.push(`\\left(${v} - ${r.toLatex()}\\right)`);
        }
      }
      if (quotient.degree() >= 1) {
        const monicQ = quotient.divConst(new Poly([lead], v));
        factors.push(`\\left(${monicQ.toLatex()}\\right)`);
      }
      const factStr = factors.join('');
      return {
        ok: true,
        markdown: `### Разложение на множители\n$$${poly.toLatex()} = ${factStr}$$\n\n**Ответ:** $${factStr}$.`,
      };
    }

    // Simplify / expand
    return {
      ok: true,
      markdown: `### Преобразование и раскрытие скобок\n**Стандартный вид многочлена:**\n$$${poly.toLatex()}$$\n\n**Ответ:** $${poly.toLatex()}$.`,
    };
  } catch (err) {
    return {
      ok: false,
      error: `Не удалось разобрать запись (${err.message}). Проверьте скобки и знаки или используйте вкладку «ИИ-Решатель» для тригонометрии и логарифмов!`,
    };
  }
}

// ==================== 3. Fractions Step-by-Step (5-6 Grade) ====================
export function solveFractionsJS(rawInput) {
  const s = rawInput
    .trim()
    .replace(/[−–]/g, '-')
    .replace(/[×·]/g, '*')
    .replace(/[:÷]/g, '/');

  const pattern = /^\s*(-?\d+\s+\d+\/\d+|-?\d+\/\d+|-?\d+)\s*([+\-*/])\s*(-?\d+\s+\d+\/\d+|-?\d+\/\d+|-?\d+)\s*$/;
  const m = s.match(pattern);
  if (!m) {
    return {
      ok: false,
      error: 'Введите пример с двумя дробями или смешанными числами, например: 2 1/3 + 1 3/4 или 5/6 : 15/16',
    };
  }

  function parseTok(tok) {
    let t = tok.trim();
    const neg = t.startsWith('-');
    if (neg) t = t.slice(1).trim();
    if (t.includes(' ') && t.includes('/')) {
      const [wS, frS] = t.split(/\s+/);
      const [nS, dS] = frS.split('/');
      const w = BigInt(wS), n = BigInt(nS), d = BigInt(dS);
      const f = new BigFrac((w * d + n) * (neg ? -1n : 1n), d);
      return { f, orig: `${neg ? '-' : ''}${w}\\frac{${n}}{${d}}` };
    }
    if (t.includes('/')) {
      const [nS, dS] = t.split('/');
      const n = BigInt(nS), d = BigInt(dS);
      const f = new BigFrac(n * (neg ? -1n : 1n), d);
      return { f, orig: `${neg ? '-' : ''}\\frac{${n}}{${d}}` };
    }
    const w = BigInt(t);
    return { f: new BigFrac(w * (neg ? -1n : 1n), 1n), orig: `${neg ? '-' : ''}${w}` };
  }

  try {
    const p1 = parseTok(m[1]);
    const op = m[2];
    const p2 = parseTok(m[3]);
    const opLatex = { '+': '+', '-': '-', '*': '\\cdot', '/': ':' }[op];

    const md = [
      `### Пошаговое решение с обыкновенными дробями (5–6 класс)\n`,
      `**Пример:** $$${p1.orig} ${opLatex} ${p2.orig}$$\n`,
      `**Шаг 1. Представим числа в виде неправильных дробей:**`,
      `- Первое число: $${p1.orig} = \\frac{${p1.f.n}}{${p1.f.d}}$`,
      `- Второе число: $${p2.orig} = \\frac{${p2.f.n}}{${p2.f.d}}$\n`,
    ];

    let res;
    if (op === '+' || op === '-') {
      const commonD = lcmBig(p1.f.d, p2.f.d);
      const m1 = commonD / p1.f.d;
      const m2 = commonD / p2.f.d;
      const n1 = p1.f.n * m1;
      const n2 = p2.f.n * m2;
      const resN = op === '+' ? n1 + n2 : n1 - n2;
      res = new BigFrac(resN, commonD);
      md.push(`**Шаг 2. Приведём к наименьшему общему знаменателю ($\\text{НОК}(${p1.f.d}; ${p2.f.d}) = ${commonD}$):**`);
      md.push(`Дополнительные множители: к первой дроби — $${m1}$, ко второй — $${m2}$.`);
      md.push(`$$\\frac{${p1.f.n} \\cdot ${m1}}{${commonD}} ${op} \\frac{${p2.f.n} \\cdot ${m2}}{${commonD}} = \\frac{${resN}}{${commonD}}$$\n`);
    } else if (op === '*') {
      res = p1.f.mul(p2.f);
      md.push(`**Шаг 2. Перемножим числители и знаменатели:**`);
      md.push(`$$\\frac{${p1.f.n} \\cdot (${p2.f.n})}{${p1.f.d} \\cdot ${p2.f.d}} = \\frac{${p1.f.n * p2.f.n}}{${p1.f.d * p2.f.d}}$$\n`);
    } else {
      res = p1.f.div(p2.f);
      md.push(`**Шаг 2. Заменим деление умножением на взаимно обратную дробь:**`);
      md.push(`$$\\frac{${p1.f.n}}{${p1.f.d}} \\cdot \\frac{${p2.f.d}}{${p2.f.n}} = \\frac{${p1.f.n * p2.f.d}}{${p1.f.d * p2.f.n}}$$\n`);
    }

    md.push(`**Шаг 3. Сократим дробь и выделим целую часть:**`);
    md.push(`- Несократимый вид: $${res.toLatex()}$`);
    md.push(`- Смешанное число: $${res.toMixedLatex()}$\n`);
    md.push(`**Ответ:** $${res.toMixedLatex()}$.`);
    return { ok: true, markdown: md.join('\n') };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// ==================== 4. GCD & LCM Column Factorization ====================
export function solveGcdLcmJS(rawNumbers) {
  const matches = rawNumbers.match(/\d+/g) || [];
  const nums = matches.map((x) => BigInt(x)).filter((x) => x > 0n);
  if (nums.length < 2) {
    return { ok: false, error: 'Введите минимум два натуральных числа (например: 36, 48).' };
  }
  if (nums.some((x) => x > 1000000000n)) {
    return { ok: false, error: 'Введите числа до 1 000 000 000.' };
  }

  let g = nums[0];
  let l = nums[0];
  for (let i = 1; i < nums.length; i++) {
    g = gcdBig(g, nums[i]);
    l = lcmBig(l, nums[i]);
  }

  const label = nums.map(String).join('; ');
  const md = [
    `### Нахождение НОД и НОК чисел (${label})\n`,
    `**1. Разложим числа на простые множители «столбиком»:**\n`,
  ];

  for (const n of nums) {
    let cur = n;
    let d = 2n;
    const rows = [];
    const counts = new Map();
    while (d * d <= cur) {
      while (cur % d === 0n) {
        rows.push([cur, d]);
        counts.set(d, (counts.get(d) || 0) + 1);
        cur /= d;
      }
      d = d === 2n ? 3n : d + 2n;
    }
    if (cur > 1n) {
      rows.push([cur, cur]);
      counts.set(cur, (counts.get(cur) || 0) + 1);
    }
    rows.push([1n, 0n]);

    const width = String(n).length;
    const colText = rows
      .map(([v, div]) =>
        div === 0n ? `${String(v).padStart(width, ' ')} |` : `${String(v).padStart(width, ' ')} | ${div}`
      )
      .join('\n');

    const powStr =
      Array.from(counts.entries())
        .map(([p, k]) => (k > 1 ? `${p}^{${k}}` : `${p}`))
        .join(' \\cdot ') || '1';

    md.push(`Число **${n}** ($${n} = ${powStr}$):`);
    md.push('```text\n' + colText + '\n```');
  }

  md.push(`**2. Наибольший общий делитель:** $\\text{НОД}(${label}) = ${g}$`);
  md.push(`**3. Наименьшее общее кратное:** $\\text{НОК}(${label}) = ${l}$\n`);
  md.push(`**Ответ:** НОД $= ${g}$; НОК $= ${l}$.`);
  return { ok: true, markdown: md.join('\n') };
}

// ==================== 5. Chemistry Equation Balancer & Molar Mass ====================
const SCHOOL_AR = {
  H: [1, 'Водород'], He: [4, 'Гелий'], Li: [7, 'Литий'], Be: [9, 'Бериллий'],
  B: [11, 'Бор'], C: [12, 'Углерод'], N: [14, 'Азот'], O: [16, 'Кислород'],
  F: [19, 'Фтор'], Ne: [20, 'Неон'], Na: [23, 'Натрий'], Mg: [24, 'Магний'],
  Al: [27, 'Алюминий'], Si: [28, 'Кремний'], P: [31, 'Фосфор'], S: [32, 'Сера'],
  Cl: [35.5, 'Хлор'], Ar: [40, 'Аргон'], K: [39, 'Калий'], Ca: [40, 'Кальций'],
  Cr: [52, 'Хром'], Mn: [55, 'Марганец'], Fe: [56, 'Железо'], Co: [59, 'Кобальт'],
  Ni: [59, 'Никель'], Cu: [64, 'Медь'], Zn: [65, 'Цинк'], Br: [80, 'Бром'],
  Ag: [108, 'Серебро'], Sn: [119, 'Олово'], I: [127, 'Йод'], Ba: [137, 'Барий'],
  Au: [197, 'Золото'], Hg: [201, 'Ртуть'], Pb: [207, 'Свинец'],
};

function parseFormulaJS(formula) {
  const f = formula.trim();
  if (f.includes('·') || f.includes('*')) {
    const total = {};
    for (const part of f.split(/[·*]/)) {
      const m = part.trim().match(/^(\d+)(.+)$/);
      const mult = m ? Number(m[1]) : 1;
      const sub = parseFormulaJS(m ? m[2] : part.trim());
      for (const [el, c] of Object.entries(sub)) total[el] = (total[el] || 0) + c * mult;
    }
    return total;
  }
  const tokens = f.match(/([A-Z][a-z]?|\(|\)|\d+)/g) || [];
  const stack = [{}];
  let i = 0;
  while (i < tokens.length) {
    const tok = tokens[i];
    if (tok === '(') {
      stack.push({});
      i++;
    } else if (tok === ')') {
      const grp = stack.pop();
      let mult = 1;
      if (tokens[i + 1] && /^\d+$/.test(tokens[i + 1])) {
        mult = Number(tokens[++i]);
      }
      for (const [el, c] of Object.entries(grp)) {
        stack[stack.length - 1][el] = (stack[stack.length - 1][el] || 0) + c * mult;
      }
      i++;
    } else if (/^[A-Z][a-z]?$/.test(tok)) {
      let mult = 1;
      if (tokens[i + 1] && /^\d+$/.test(tokens[i + 1])) {
        mult = Number(tokens[++i]);
      }
      stack[stack.length - 1][tok] = (stack[stack.length - 1][tok] || 0) + mult;
      i++;
    } else {
      i++;
    }
  }
  if (stack.length !== 1) throw new Error('Не закрыта скобка в формуле');
  return stack[0];
}

function nullspaceVector(rowsInt) {
  // Exact RREF over BigFrac to find first basis vector of nullspace
  const m = rowsInt.length;
  const n = rowsInt[0].length;
  const M = rowsInt.map((r) => r.map((v) => new BigFrac(BigInt(v), 1n)));

  const pivotColForRow = [];
  let r = 0;
  for (let col = 0; col < n && r < m; col++) {
    let piv = r;
    while (piv < m && M[piv][col].isZero()) piv++;
    if (piv === m) continue;
    [M[r], M[piv]] = [M[piv], M[r]];
    const pv = M[r][col];
    for (let j = col; j < n; j++) M[r][j] = M[r][j].div(pv);
    for (let i = 0; i < m; i++) {
      if (i !== r && !M[i][col].isZero()) {
        const factor = M[i][col];
        for (let j = col; j < n; j++) M[i][j] = M[i][j].sub(factor.mul(M[r][j]));
      }
    }
    pivotColForRow.push(col);
    r++;
  }

  const pivotSet = new Set(pivotColForRow);
  const freeCols = [];
  for (let col = 0; col < n; col++) {
    if (!pivotSet.has(col)) freeCols.push(col);
  }
  if (freeCols.length === 0) return null;

  const freeCol = freeCols[0];
  const vec = Array(n).fill(ZERO);
  vec[freeCol] = ONE;
  for (let idx = 0; idx < pivotColForRow.length; idx++) {
    const pCol = pivotColForRow[idx];
    vec[pCol] = M[idx][freeCol].neg();
  }

  let lcmD = 1n;
  for (const f of vec) lcmD = lcmBig(lcmD, f.d);
  let ints = vec.map((f) => (f.n * lcmD) / f.d);
  if (ints.every((x) => x < 0n)) ints = ints.map((x) => -x);
  if (ints.some((x) => x <= 0n)) return null;
  let g = ints[0];
  for (let i = 1; i < ints.length; i++) g = gcdBig(g, ints[i]);
  return ints.map((x) => Number(x / g));
}

export function solveChemistryJS(rawInput) {
  const s = rawInput.trim();
  if (!s) return { ok: false, error: 'Введите химическую формулу или уравнение реакции.' };

  const chemLatex = (f) => f.trim().replace(/(\d+)/g, '_{$1}');

  if (/[=→⇄]|->/.test(s)) {
    try {
      const norm = s.replace(/->|→|⇄/g, '=');
      const [leftS, rightS] = norm.split('=');
      const reactants = leftS.split('+').map((x) => x.trim().replace(/^\d+\s*/, '')).filter(Boolean);
      const products = rightS.split('+').map((x) => x.trim().replace(/^\d+\s*/, '')).filter(Boolean);
      const all = [...reactants, ...products];
      const parsed = all.map(parseFormulaJS);
      const elements = Array.from(new Set(parsed.flatMap((d) => Object.keys(d)))).sort();

      const matrix = elements.map((el) =>
        parsed.map((d, idx) => (idx < reactants.length ? d[el] || 0 : -(d[el] || 0)))
      );

      const coeffs = nullspaceVector(matrix);
      if (!coeffs) {
        return {
          ok: false,
          error: 'Не удалось уравнять реакцию — проверьте формулы реагентов и продуктов слева и справа.',
        };
      }

      const lParts = reactants.map((f, i) => `${coeffs[i] > 1 ? coeffs[i] : ''}${chemLatex(f)}`);
      const rParts = products.map((f, i) => `${coeffs[reactants.length + i] > 1 ? coeffs[reactants.length + i] : ''}${chemLatex(f)}`);
      const plainL = reactants.map((f, i) => `${coeffs[i] > 1 ? coeffs[i] : ''}${f}`).join(' + ');
      const plainR = products.map((f, i) => `${coeffs[reactants.length + i] > 1 ? coeffs[reactants.length + i] : ''}${f}`).join(' + ');

      const table = ['| Элемент | Слева (атомов) | Справа (атомов) |', '|---|---|---|'];
      for (const el of elements) {
        const lc = reactants.reduce((acc, _, i) => acc + coeffs[i] * (parsed[i][el] || 0), 0);
        const rc = products.reduce(
          (acc, _, i) => acc + coeffs[reactants.length + i] * (parsed[reactants.length + i][el] || 0),
          0
        );
        table.push(`| **${el}** | ${lc} | ${rc} ✅ |`);
      }

      const sumC = coeffs.reduce((a, b) => a + b, 0);
      return {
        ok: true,
        markdown: [
          `### Уравнивание химической реакции\n`,
          `**Уравнение с коэффициентами:**\n$$\\mathrm{${lParts.join(' + ')} = ${rParts.join(' + ')}}$$\n`,
          `**Для записи в тетрадь:** \`${plainL} = ${plainR}\`\n`,
          `**Сумма всех коэффициентов (ОГЭ/ЕГЭ):** **${sumC}**\n`,
          `**Проверка материального баланса:**\n` + table.join('\n'),
        ].join('\n'),
      };
    } catch (e) {
      return { ok: false, error: `Ошибка разбора реакции: ${e.message}` };
    }
  }

  // Molar mass
  try {
    const counts = parseFormulaJS(s);
    const entries = Object.entries(counts);
    if (!entries.length) return { ok: false, error: 'Не удалось распознать формулу.' };

    let total = 0;
    const sumParts = [];
    for (const [el, cnt] of entries) {
      if (!SCHOOL_AR[el]) {
        return { ok: false, error: `Неизвестный элемент: ${el}. Проверьте регистр букв (например, Co — кобальт, CO — угарный газ).` };
      }
      const ar = SCHOOL_AR[el][0];
      total += ar * cnt;
      const arStr = ar === 35.5 ? '35{,}5' : String(ar);
      sumParts.push(cnt > 1 ? `${arStr} \\cdot ${cnt}` : arStr);
    }

    const totalStr = String(total).replace('.', '{,}');
    const fl = chemLatex(s);
    const rows = [
      '| Элемент | Название | Атомов ($n$) | $A_r$ | Массовая доля $\\omega$, % |',
      '|---|---|---|---|---|',
    ];
    for (const [el, cnt] of entries) {
      const [ar, name] = SCHOOL_AR[el];
      const omega = ((ar * cnt) / total) * 100;
      rows.push(`| **${el}** | ${name} | ${cnt} | ${ar} | **${omega.toFixed(2)}%** |`);
    }

    return {
      ok: true,
      markdown: [
        `### Молярная масса и массовые доли для $\\mathrm{${fl}}$\n`,
        `$$M_r(\\mathrm{${fl}}) = ${sumParts.join(' + ')} = ${totalStr}$$`,
        `$$M(\\mathrm{${fl}}) = ${totalStr}\\text{ г/моль}$$\n`,
        rows.join('\n'),
      ].join('\n'),
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ==================== 6. Physics SI Converter ====================
const SI_MAP = {
  мм: [1e-3, 'м', '1 мм = 0,001 м'],
  см: [1e-2, 'м', '1 см = 0,01 м'],
  дм: [1e-1, 'м', '1 дм = 0,1 м'],
  км: [1e3, 'м', '1 км = 1000 м'],
  м: [1, 'м', 'уже в СИ'],
  мм2: [1e-6, 'м²', '1 мм² = 10⁻⁶ м²'],
  'мм²': [1e-6, 'м²', '1 мм² = 10⁻⁶ м²'],
  см2: [1e-4, 'м²', '1 см² = 10⁻⁴ м²'],
  'см²': [1e-4, 'м²', '1 см² = 10⁻⁴ м²'],
  дм2: [1e-2, 'м²', '1 дм² = 0,01 м²'],
  мл: [1e-6, 'м³', '1 мл = 10⁻⁶ м³'],
  см3: [1e-6, 'м³', '1 см³ = 10⁻⁶ м³'],
  'см³': [1e-6, 'м³', '1 см³ = 10⁻⁶ м³'],
  л: [1e-3, 'м³', '1 л = 0,001 м³'],
  мг: [1e-6, 'кг', '1 мг = 10⁻⁶ кг'],
  г: [1e-3, 'кг', '1 г = 0,001 кг'],
  ц: [100, 'кг', '1 ц = 100 кг'],
  т: [1000, 'кг', '1 т = 1000 кг'],
  кг: [1, 'кг', 'уже в СИ'],
  мс: [1e-3, 'с', '1 мс = 0,001 с'],
  мин: [60, 'с', '1 мин = 60 с'],
  ч: [3600, 'с', '1 ч = 3600 с'],
  с: [1, 'с', 'уже в СИ'],
  'км/ч': [1 / 3.6, 'м/с', 'делим на 3,6'],
  'км/с': [1e3, 'м/с', '1 км/с = 1000 м/с'],
  'м/с': [1, 'м/с', 'уже в СИ'],
  'г/см3': [1000, 'кг/м³', '1 г/см³ = 1000 кг/м³'],
  'г/см³': [1000, 'кг/м³', '1 г/см³ = 1000 кг/м³'],
  кн: [1e3, 'Н', '1 кН = 1000 Н'],
  кдж: [1e3, 'Дж', '1 кДж = 1000 Дж'],
  квт: [1e3, 'Вт', '1 кВт = 1000 Вт'],
  кпа: [1e3, 'Па', '1 кПа = 1000 Па'],
  ма: [1e-3, 'А', '1 мА = 0,001 А'],
  мка: [1e-6, 'А', '1 мкА = 10⁻⁶ А'],
  кв: [1e3, 'В', '1 кВ = 1000 В'],
  мв: [1e-3, 'В', '1 мВ = 0,001 В'],
  ком: [1e3, 'Ом', '1 кОм = 1000 Ом'],
  мкф: [1e-6, 'Ф', '1 мкФ = 10⁻⁶ Ф'],
};

const SI_EXACT_CASE = {
  МДж: [1e6, 'Дж', '1 МДж = 10⁶ Дж'],
  мДж: [1e-3, 'Дж', '1 мДж = 10⁻³ Дж'],
  МПа: [1e6, 'Па', '1 МПа = 10⁶ Па'],
  мПа: [1e-3, 'Па', '1 мПа = 10⁻³ Па'],
  МВт: [1e6, 'Вт', '1 МВт = 10⁶ Вт'],
};

export function convertPhysicsSiJS(rawText) {
  const items = rawText
    .split(/[;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  if (!items.length) {
    return { ok: false, error: 'Введите величины через точку с запятой, например: v = 72 км/ч; m = 250 г' };
  }

  const lines = [
    '### Перевод величин в систему СИ (для оформления «Дано | СИ»)\n',
    '| Дано | СИ | Правило перевода |',
    '|---|---|---|',
  ];

  for (const item of items) {
    const m = item.match(/^(?:([a-zA-Zа-яА-Я0-9_]+)\s*=\s*)?(-?\d+(?:[.,]\d+)?)\s*(.+)$/);
    if (!m) {
      lines.push(`| ${item} | — | Проверьте формат (пример: m = 250 г) |`);
      continue;
    }
    const sym = m[1] || 'x';
    const val = parseFloat(m[2].replace(',', '.'));
    const uRaw = m[3].trim();

    if (['°C', 'C', '°С', 'С'].includes(uRaw)) {
      lines.push(`| $${sym} = ${m[2]}\\ ^\\circ\\text{C}$ | $T = ${val + 273}\\text{ К}$ | $T = t + 273$ |`);
      continue;
    }

    const info = SI_EXACT_CASE[uRaw] || SI_MAP[uRaw.toLowerCase()];
    if (!info) {
      lines.push(`| ${sym} = ${m[2]} ${uRaw} | Проверить ед. | Нестандартная единица |`);
      continue;
    }

    const [mult, siUnit, rule] = info;
    const siVal = val * mult;
    let siStr = '—';
    if (mult !== 1) {
      if (Math.abs(siVal) >= 0.01 && Math.abs(siVal) < 1e5) {
        siStr = `$${Number(siVal.toPrecision(6))}\\text{ ${siUnit}}$`.replace('.', '{,}');
      } else {
        const exp = siVal === 0 ? 0 : Math.floor(Math.log10(Math.abs(siVal)));
        const mant = siVal === 0 ? 0 : Number((siVal / Math.pow(10, exp)).toPrecision(4));
        siStr = `$${String(mant).replace('.', '{,}')} \\cdot 10^{${exp}}\\text{ ${siUnit}}$`;
      }
    }
    lines.push(`| $${sym} = ${m[2]}\\text{ ${uRaw}}$ | ${siStr} | ${rule} |`);
  }

  return { ok: true, markdown: lines.join('\n') };
}

// ==================== 7. Number Bases & Truth Tables ====================
const DIGS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function solveNumberBasesJS(numStr, fromBase, toBase) {
  let s = (numStr || '').trim().toUpperCase();
  if (!s) return { ok: false, error: 'Введите число.' };
  if (fromBase < 2 || fromBase > 36 || toBase < 2 || toBase > 36) {
    return { ok: false, error: 'Основание системы должно быть от 2 до 36.' };
  }
  const neg = s.startsWith('-');
  if (neg) s = s.slice(1);
  for (const ch of s) {
    const idx = DIGS.indexOf(ch);
    if (idx === -1 || idx >= fromBase) {
      return { ok: false, error: `Цифра ${ch} недопустима в системе с основанием ${fromBase}.` };
    }
  }

  let dec = 0n;
  const terms = [];
  for (let i = 0; i < s.length; i++) {
    const dVal = BigInt(DIGS.indexOf(s[i]));
    const p = s.length - 1 - i;
    dec = dec * BigInt(fromBase) + dVal;
    terms.push(`${dVal} \\cdot ${fromBase}^{${p}}`);
  }

  const md = [`### Перевод числа $${neg ? '-' : ''}${s}_{${fromBase}} \\rightarrow X_{${toBase}}$\n`];
  if (fromBase !== 10) {
    md.push(`**Шаг 1. Переведём в десятичную систему через развёрнутую запись:**`);
    md.push(`$$${s}_{${fromBase}} = ${terms.join(' + ')} = ${dec}_{10}$$\n`);
  } else {
    md.push(`**Десятичное число:** $${dec}_{10}$\n`);
  }

  if (toBase === 10) {
    md.push(`**Ответ:** $${neg ? '-' : ''}${dec}_{10}$.`);
    return { ok: true, markdown: md.join('\n') };
  }

  md.push(`**Шаг 2. Последовательно делим $${dec}$ на $${toBase}$ и выписываем остатки снизу вверх:**`);
  let resDigits = '';
  if (dec === 0n) {
    resDigits = '0';
    md.push(`- $0 : ${toBase} = 0$ (остаток **0**)`);
  } else {
    let cur = dec;
    const tb = BigInt(toBase);
    const rems = [];
    while (cur > 0n) {
      const q = cur / tb;
      const r = Number(cur % tb);
      md.push(`- $${cur} : ${toBase} = ${q}$, остаток **${DIGS[r]}**`);
      rems.push(DIGS[r]);
      cur = q;
    }
    resDigits = rems.reverse().join('');
  }
  md.push(`\n**Ответ:** $${neg ? '-' : ''}${resDigits}_{${toBase}}$.`);
  return { ok: true, markdown: md.join('\n') };
}

export function solveTruthTableJS(rawExpr) {
  const s = (rawExpr || '').trim();
  if (!s) return { ok: false, error: 'Введите логическое выражение.' };

  // Safe boolean expression parser (supports ¬, !, not, ∧, /\, &, and, ∨, \/, |, or, →, ->, <=, ≡, ==, <->, ⊕, !=)
  let norm = s
    .replace(/\bnot\b/gi, ' ! ')
    .replace(/\band\b/gi, ' && ')
    .replace(/\bor\b/gi, ' || ')
    .replace(/¬|~/g, ' ! ')
    .replace(/&&|∧|\/\\|&/g, ' && ')
    .replace(/\|\||∨|\\\/|\|/g, ' || ')
    .replace(/<->|≡|⇔|===/g, ' == ')
    .replace(/⊕|\^/g, ' != ')
    .replace(/->|→|⇒|<=/g, ' <= ');

  const vars = Array.from(new Set(norm.match(/\b[a-zA-Z]\b/g) || [])).sort();
  if (!vars.length || vars.length > 5) {
    return { ok: false, error: 'Используйте от 1 до 5 однобуквенных логических переменных (например: A, B, C или x, y, z, w).' };
  }

  // Validate characters strictly
  const stripped = norm.replace(/\b[a-zA-Z]\b/g, '').replace(/[()!&|=<>+\-*\s]/g, '');
  if (stripped.length > 0) {
    return { ok: false, error: `Недопустимые символы в логическом выражении: ${stripped}` };
  }

  try {
    const fn = new Function(...vars, `return (${norm}) ? 1 : 0;`);
    const header = `| ${vars.join(' | ')} | **F** |`;
    const sep = `|${vars.map(() => '---').join('|')}|---|`;
    const allRows = [header, sep];
    const trueRows = [header, sep];

    const total = 1 << vars.length;
    for (let mask = 0; mask < total; mask++) {
      const vals = vars.map((_, idx) => (mask >> (vars.length - 1 - idx)) & 1);
      // In JS, boolean/number comparison: convert 0/1 properly for ! and <=
      const res = fn(...vals);
      const rowStr = `| ${vals.join(' | ')} | **${res}** |`;
      allRows.push(rowStr);
      if (res === 1) trueRows.push(rowStr);
    }

    const md = [
      `### Таблица истинности (Информатика ОГЭ / ЕГЭ №2)\n`,
      `**Выражение:** \`${rawExpr}\`\n`,
      allRows.join('\n'),
    ];
    if (vars.length >= 3 && trueRows.length > 2) {
      md.push(`\n**Строки, где $F = 1$:**\n` + trueRows.join('\n'));
    }
    return { ok: true, markdown: md.join('\n') };
  } catch (e) {
    return { ok: false, error: `Проверьте скобки и операторы в логической формуле (${e.message}).` };
  }
}

export function runExactToolJS({ tool, input, action = 'auto', fromBase = 10, toBase = 2 }) {
  switch (tool) {
    case 'algebra':
      return solveAlgebraJS(input, action);
    case 'fractions':
      return solveFractionsJS(input);
    case 'gcd_lcm':
      return solveGcdLcmJS(input);
    case 'chemistry':
      return solveChemistryJS(input);
    case 'physics_si':
      return convertPhysicsSiJS(input);
    case 'bases':
      return solveNumberBasesJS(input, Number(fromBase), Number(toBase));
    case 'truth_table':
      return solveTruthTableJS(input);
    default:
      return { ok: false, error: 'Неизвестный инструмент' };
  }
}

export function autoVerifyMathJS(taskText) {
  if (!taskText || taskText.length > 600) return '';
  const lines = taskText.split('\n').filter((l) => l.includes('='));
  for (const ln of lines) {
    const m = ln.match(/([0-9xXyY+\-*/^()\s²³]{3,}=[0-9xXyY+\-*/^()\s²³\-]{1,})/);
    if (m && /[xXyY]/.test(m[1])) {
      const cand = m[1].trim();
      const res = solveAlgebraJS(cand, 'solve');
      if (res.ok && res.markdown.includes('**Ответ:**')) {
        const ansPart = res.markdown.split('**Ответ:**')[1].trim();
        return `Точная локальная проверка для \`${cand}\`: ${ansPart}`;
      }
    }
  }
  return '';
}
