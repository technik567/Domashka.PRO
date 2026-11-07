// Bounded expression interpreter, not JavaScript evaluation. Safe under the
// hosted CSP and for untrusted formulas returned by an AI. No properties,
// assignments, strings, loops, imports, eval or Function constructors.
const FUNCTIONS = Object.freeze({ sin: Math.sin, cos: Math.cos, tan: Math.tan, sqrt: Math.sqrt,
  abs: Math.abs, exp: Math.exp, ln: Math.log, log: Math.log, log10: Math.log10,
  asin: Math.asin, acos: Math.acos, atan: Math.atan, floor: Math.floor, ceil: Math.ceil });

export function compileMathExpression(input) {
  if (typeof input !== 'string' || input.length > 400) throw new Error('Формула: не более 400 символов.');
  const source = input.trim().replace(/^(?:y|f\s*\(\s*x\s*\))\s*=\s*/i, '')
    .replace(/\*\*/g, '^').replace(/²/g, '^2').replace(/³/g, '^3').replace(/π/gi, 'pi').replace(/×|·/g, '*').replace(/−/g, '-').toLowerCase();
  const tokens = []; const re = /\s*(?:(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?|([a-z_][a-z_0-9]*)|([+*/^()\-]))/gy;
  let at = 0;
  while (at < source.length) {
    if (!source.slice(at).trim()) break;
    re.lastIndex = at; const m = re.exec(source);
    if (!m) throw new Error('Формула содержит неподдерживаемые символы. Используйте x, числа, + − * / ^ и функции sin, cos, sqrt, abs, ln.');
    tokens.push(m[1] ? { type: 'number', value: Number(m[1] + (m[2] ? `e${m[2]}` : '')) } : { type: m[3] ? 'name' : 'operator', value: m[3] || m[4] });
    at = re.lastIndex;
    if (tokens.length > 180) throw new Error('Слишком сложная формула.');
  }
  let i = 0; let depth = 0;
  const peek = () => tokens[i]?.value;
  function guarded(fn) { if (++depth > 32) throw new Error('Слишком много вложенных скобок или степеней.'); try { return fn(); } finally { depth--; } }
  function primary() {
    return guarded(() => {
      const token = tokens[i++]; if (!token) throw new Error('Формула не закончена.');
      if (token.type === 'number') { if (!Number.isFinite(token.value)) throw new Error('Слишком большое число.'); return () => token.value; }
      if (token.value === '(') { const sub = expression(); if (peek() !== ')') throw new Error('Не хватает закрывающей скобки.'); i++; return sub; }
      if (token.type === 'name') {
        if (token.value === 'x') return (x) => x;
        if (['pi', 'e'].includes(token.value)) return () => token.value === 'pi' ? Math.PI : Math.E;
        if (Object.hasOwn(FUNCTIONS, token.value)) {
          if (peek() !== '(') throw new Error('Аргумент функции нужно заключить в скобки.');
          i++; const sub = expression(); if (peek() !== ')') throw new Error('Не хватает скобки после функции.'); i++;
          return (x) => FUNCTIONS[token.value](sub(x));
        }
      }
      throw new Error('Неизвестная переменная или операция в формуле.');
    });
  }
  function power() { const left = primary(); if (peek() !== '^') return left; i++; const right = unary(); return (x) => Math.pow(left(x), right(x)); }
  function unary() { return guarded(() => { if (['+', '-'].includes(peek())) { const sign = tokens[i++].value; const sub = unary(); return (x) => sign === '-' ? -sub(x) : sub(x); } return power(); }); }
  function product() {
    let left = unary();
    while (['*', '/'].includes(peek()) || peek() === '(' || tokens[i]?.type === 'name') {
      const op = ['*', '/'].includes(peek()) ? tokens[i++].value : '*';
      const right = unary(); const previous = left; left = (x) => op === '*' ? previous(x) * right(x) : previous(x) / right(x);
    }
    return left;
  }
  function expression() { let left = product(); while (['+', '-'].includes(peek())) { const op = tokens[i++].value; const right = product(); const previous = left; left = (x) => op === '+' ? previous(x) + right(x) : previous(x) - right(x); } return left; }
  const fn = expression(); if (i !== tokens.length) throw new Error('Лишняя скобка или незавершённая формула.');
  return (x) => typeof x === 'number' && Number.isFinite(x) ? fn(x) : NaN;
}
