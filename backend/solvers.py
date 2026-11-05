import ast
import fractions
import itertools
import math
import re
from typing import Any, Dict, List, Optional, Tuple

import sympy as sp
from sympy.parsing.sympy_parser import (
    convert_xor,
    implicit_multiplication_application,
    parse_expr as _sympy_parse_expr,
    standard_transformations,
)

TRANSFORMATIONS = standard_transformations + (
    implicit_multiplication_application,
    convert_xor,
)

# SymPy's parser uses eval internally. Only a small mathematical grammar is allowed.
_MATH_FUNCTIONS = {name: getattr(sp, name) for name in ("sin", "cos", "tan", "asin", "acos", "atan", "sqrt", "log", "exp", "Abs")}
_MATH_FUNCTIONS.update({"pi": sp.pi, "E": sp.E})


def parse_expr(text, transformations=TRANSFORMATIONS, evaluate=True):
    text = str(text).strip()
    if not text or len(text) > 1000 or not re.fullmatch(r"[0-9A-Za-z+*/^().,\s-]+", text):
        raise ValueError("Допустимы только школьные математические выражения")
    if re.search(r"(?<![0-9])\.(?![0-9])|[0-9]{50,}|(?:\*\*|\^)\s*[0-9]{4,}", text):
        raise ValueError("Слишком большое число или недопустимая запись")
    for name in re.findall(r"[A-Za-z]+", text):
        if len(name) > 1 and name not in _MATH_FUNCTIONS:
            raise ValueError(f"Неизвестная функция: {name}")
    return _sympy_parse_expr(
        text, transformations=transformations, evaluate=evaluate,
        local_dict=dict(_MATH_FUNCTIONS),
        global_dict={"__builtins__": {}, "Symbol": sp.Symbol, "Integer": sp.Integer,
                     "Float": sp.Float, "Rational": sp.Rational},
    )


# Russian school standard relative atomic masses (ФГОС / таблица Менделеева для школы: Cl = 35.5, остальные целые)
SCHOOL_AR: Dict[str, Tuple[float, str]] = {
    "H": (1, "Водород"),
    "He": (4, "Гелий"),
    "Li": (7, "Литий"),
    "Be": (9, "Бериллий"),
    "B": (11, "Бор"),
    "C": (12, "Углерод"),
    "N": (14, "Азот"),
    "O": (16, "Кислород"),
    "F": (19, "Фтор"),
    "Ne": (20, "Неон"),
    "Na": (23, "Натрий"),
    "Mg": (24, "Магний"),
    "Al": (27, "Алюминий"),
    "Si": (28, "Кремний"),
    "P": (31, "Фосфор"),
    "S": (32, "Сера"),
    "Cl": (35.5, "Хлор"),
    "Ar": (40, "Аргон"),
    "K": (39, "Калий"),
    "Ca": (40, "Кальций"),
    "Sc": (45, "Скандий"),
    "Ti": (48, "Титан"),
    "V": (51, "Ванадий"),
    "Cr": (52, "Хром"),
    "Mn": (55, "Марганец"),
    "Fe": (56, "Железо"),
    "Co": (59, "Кобальт"),
    "Ni": (59, "Никель"),
    "Cu": (64, "Медь"),
    "Zn": (65, "Цинк"),
    "Ga": (70, "Галлий"),
    "Ge": (73, "Германий"),
    "As": (75, "Мышьяк"),
    "Se": (79, "Селен"),
    "Br": (80, "Бром"),
    "Kr": (84, "Криптон"),
    "Rb": (85, "Рубидий"),
    "Sr": (88, "Стронций"),
    "Ag": (108, "Серебро"),
    "Cd": (112, "Кадмий"),
    "Sn": (119, "Олово"),
    "Sb": (122, "Сурьма"),
    "I": (127, "Йод"),
    "Xe": (131, "Ксенон"),
    "Cs": (133, "Цезий"),
    "Ba": (137, "Барий"),
    "W": (184, "Вольфрам"),
    "Pt": (195, "Платина"),
    "Au": (197, "Золото"),
    "Hg": (201, "Ртуть"),
    "Pb": (207, "Свинец"),
    "Bi": (209, "Висмут"),
    "U": (238, "Уран"),
}


def _clean_math_input(raw: str) -> str:
    s = raw.strip()
    s = s.replace("−", "-").replace("–", "-").replace("—", "-")
    s = s.replace("×", "*").replace("·", "*").replace(":", "/")
    s = s.replace("²", "^2").replace("³", "^3").replace("⁴", "^4")
    # Replace comma decimal only between digits: 2,5 -> 2.5
    s = re.sub(r"(\d),(\d)", r"\1.\2", s)
    # Replace Russian х/у if user typed Cyrillic x, y
    s = s.replace("х", "x").replace("Х", "X").replace("у", "y").replace("У", "Y")
    return s


def _fmt_num(val: Any) -> str:
    s = sp.latex(val)
    return s


def solve_algebra(raw_input: str, action: str = "auto") -> Dict[str, Any]:
    cleaned = _clean_math_input(raw_input)
    if not cleaned:
        return {"ok": False, "error": "Введите уравнение или выражение."}

    try:
        # Check system of equations (separated by ; or newline)
        parts = [p.strip() for p in re.split(r"[;\n]+", cleaned) if p.strip()]
        if len(parts) > 1 and all("=" in p for p in parts):
            eqs = []
            syms = set()
            for p in parts:
                lhs_s, rhs_s = p.split("=", 1)
                lhs = parse_expr(lhs_s, transformations=TRANSFORMATIONS)
                rhs = parse_expr(rhs_s, transformations=TRANSFORMATIONS)
                eq = sp.Eq(lhs, rhs)
                eqs.append(eq)
                syms.update(eq.free_symbols)
            sorted_syms = sorted(list(syms), key=lambda z: z.name)
            sol = sp.solve(eqs, sorted_syms, dict=True)

            md = ["### Решение системы уравнений\n", "**Исходная система:**"]
            sys_latex = r" \begin{cases} " + r" \\ ".join(sp.latex(e) for e in eqs) + r" \end{cases}"
            md.append(f"$${sys_latex}$$\n")
            if not sol:
                md.append("**Ответ:** система не имеет решений ($\\varnothing$).")
            else:
                md.append("**Найдём значения переменных:**")
                for idx, sdict in enumerate(sol, 1):
                    pairs = ", \\quad ".join(f"{sp.latex(k)} = {sp.latex(v)}" for k, v in sdict.items())
                    prefix = f"Решение {idx}: " if len(sol) > 1 else ""
                    md.append(f"- {prefix}${pairs}$")
                ans_str = "; ".join(
                    "(" + ", ".join(f"{sp.latex(k)} = {sp.latex(v)}" for k, v in sdict.items()) + ")"
                    for sdict in sol
                )
                md.append(f"\n**Ответ:** ${ans_str}$.")
            return {"ok": True, "markdown": "\n".join(md)}

        # Single equation
        if "=" in cleaned and action in ("auto", "solve"):
            lhs_s, rhs_s = cleaned.split("=", 1)
            lhs = parse_expr(lhs_s, transformations=TRANSFORMATIONS)
            rhs = parse_expr(rhs_s, transformations=TRANSFORMATIONS)
            expr = sp.expand(lhs - rhs)
            syms = sorted(list(expr.free_symbols), key=lambda z: z.name)
            if not syms:
                is_true = sp.simplify(lhs - rhs) == 0
                return {
                    "ok": True,
                    "markdown": f"### Проверка равенства\n$${sp.latex(sp.Eq(lhs, rhs))}$$\n\n**Вывод:** равенство **{'верно (тождество)' if is_true else 'неверно'}**.",
                }

            var = syms[0]
            md = [f"### Решение уравнения относительно ${sp.latex(var)}$\n"]
            md.append(f"**Запишем уравнение:**\n$${sp.latex(sp.Eq(lhs, rhs))}$$\n")

            # Check if polynomial of degree 1 or 2 in var (and no other symbols)
            if len(syms) == 1 and expr.is_polynomial(var):
                poly = sp.Poly(expr, var)
                deg = poly.degree()
                if deg == 1:
                    a, b = poly.all_coeffs()
                    sol = -b / a
                    md.append("**1. Перенесём слагаемые и приведём подобные:**")
                    md.append(f"$${sp.latex(a)}{sp.latex(var)} + ({sp.latex(b)}) = 0 \\implies {sp.latex(a)}{sp.latex(var)} = {sp.latex(-b)}$$")
                    md.append("**2. Разделим обе части на коэффициент при неизвестном:**")
                    md.append(f"$${sp.latex(var)} = \\frac{{{sp.latex(-b)}}}{{{sp.latex(a)}}} = {sp.latex(sol)}$$")
                    md.append(f"\n**Ответ:** ${sp.latex(var)} = {sp.latex(sol)}$.")
                    return {"ok": True, "markdown": "\n".join(md)}

                if deg == 2:
                    a, b, c = poly.all_coeffs()
                    # Normalize sign if a < 0 for cleaner school style
                    if a.is_number and a < 0:
                        a, b, c = -a, -b, -c
                    std_eq = a * var**2 + b * var + c
                    D = sp.simplify(b**2 - 4 * a * c)
                    md.append("**1. Приведём квадратное уравнение к стандартному виду $ax^2 + bx + c = 0$:**")
                    md.append(f"$${sp.latex(std_eq)} = 0$$")
                    md.append(f"Коэффициенты: $a = {sp.latex(a)}$, $b = {sp.latex(b)}$, $c = {sp.latex(c)}$.\n")
                    md.append("**2. Вычислим дискриминант по формуле $D = b^2 - 4ac$:**")
                    md.append(f"$$D = ({sp.latex(b)})^2 - 4 \\cdot ({sp.latex(a)}) \\cdot ({sp.latex(c)}) = {sp.latex(b**2)} - ({sp.latex(4*a*c)}) = {sp.latex(D)}$$\n")

                    if D.is_real and D < 0:
                        md.append("Так как $D < 0$, действительных корней нет.\n")
                        md.append("**Ответ:** корней нет ($\\varnothing$).")
                    elif D == 0:
                        x0 = sp.simplify(-b / (2 * a))
                        md.append("Так как $D = 0$, уравнение имеет один корень (два совпадающих):")
                        md.append(f"$${sp.latex(var)} = \\frac{{-b}}{{2a}} = \\frac{{-({sp.latex(b)})}}{{2 \\cdot ({sp.latex(a)})}} = {sp.latex(x0)}$$\n")
                        md.append(f"**Ответ:** ${sp.latex(var)} = {sp.latex(x0)}$.")
                    else:
                        sqrtD = sp.sqrt(D)
                        x1 = sp.simplify((-b - sqrtD) / (2 * a))
                        x2 = sp.simplify((-b + sqrtD) / (2 * a))
                        md.append(f"Так как $D > 0$, уравнение имеет два различных корня ($\\sqrt{{D}} = {sp.latex(sqrtD)}$):")
                        md.append(f"$${sp.latex(var)}_1 = \\frac{{-b - \\sqrt{{D}}}}{{2a}} = \\frac{{-({sp.latex(b)}) - {sp.latex(sqrtD)}}}{{2 \\cdot ({sp.latex(a)})}} = {sp.latex(x1)}$$")
                        md.append(f"$${sp.latex(var)}_2 = \\frac{{-b + \\sqrt{{D}}}}{{2a}} = \\frac{{-({sp.latex(b)}) + {sp.latex(sqrtD)}}}{{2 \\cdot ({sp.latex(a)})}} = {sp.latex(x2)}$$\n")
                        # Vieta verification
                        v_sum = sp.simplify(x1 + x2)
                        v_prod = sp.simplify(x1 * x2)
                        md.append("**Проверка по теореме Виета:**")
                        md.append(f"- ${sp.latex(var)}_1 + {sp.latex(var)}_2 = {sp.latex(v_sum)} = -\\frac{{b}}{{a}}$")
                        md.append(f"- ${sp.latex(var)}_1 \\cdot {sp.latex(var)}_2 = {sp.latex(v_prod)} = \\frac{{c}}{{a}}$\n")
                        md.append(f"**Ответ:** ${sp.latex(var)}_1 = {sp.latex(x1)}$; ${sp.latex(var)}_2 = {sp.latex(x2)}$.")
                    return {"ok": True, "markdown": "\n".join(md)}

            # General equation solver
            sols = sp.solve(sp.Eq(lhs, rhs), var)
            # Filter to real roots if purely real context
            real_sols = [s for s in sols if s.is_real is not False]
            md.append("**Преобразуем уравнение:**")
            md.append(f"$${sp.latex(sp.simplify(lhs - rhs))} = 0$$")
            if not real_sols:
                md.append("\n**Ответ:** действительных корней нет ($\\varnothing$).")
            else:
                ans = "; \\quad ".join(f"{sp.latex(var)} = {sp.latex(s)}" for s in real_sols)
                md.append(f"\n**Найдены корни:**\n$${ans}$$")
                md.append(f"\n**Ответ:** ${ans}$.")
            return {"ok": True, "markdown": "\n".join(md)}

        # Expression mode (simplify, factor, expand, diff, integrate)
        expr = parse_expr(cleaned, transformations=TRANSFORMATIONS)
        syms = sorted(list(expr.free_symbols), key=lambda z: z.name)
        var = syms[0] if syms else sp.Symbol("x")

        if action == "factor":
            res = sp.factor(expr)
            return {
                "ok": True,
                "markdown": f"### Разложение на множители\n$$ {sp.latex(expr)} = {sp.latex(res)} $$\n\n**Ответ:** ${sp.latex(res)}$.",
            }
        elif action == "diff":
            res = sp.diff(expr, var)
            return {
                "ok": True,
                "markdown": f"### Нахождение производной по ${sp.latex(var)}$\n$$ \\left({sp.latex(expr)}\\right)' = {sp.latex(res)} $$\n\n**Упрощённый вид:** ${sp.latex(sp.simplify(res))}$.",
            }
        elif action == "integrate":
            res = sp.integrate(expr, var)
            return {
                "ok": True,
                "markdown": f"### Первообразная (неопределённый интеграл)\n$$ \\int \\left({sp.latex(expr)}\\right) d{sp.latex(var)} = {sp.latex(res)} + C $$",
            }
        else:
            simp = sp.simplify(expr)
            expd = sp.expand(expr)
            fact = sp.factor(expr)
            md = [
                "### Преобразование выражения\n",
                f"**Исходное выражение:** $${sp.latex(expr)}$$",
                f"- **Упрощённый вид:** ${sp.latex(simp)}$",
            ]
            if expd != simp:
                md.append(f"- **Раскрытие скобок:** ${sp.latex(expd)}$")
            if fact != simp and fact != expd:
                md.append(f"- **Разложение на множители:** ${sp.latex(fact)}$")
            if not syms:
                md.append(f"- **Десятичное приближение:** $\\approx {float(expr.evalf()):.6g}$")
            md.append(f"\n**Ответ:** ${sp.latex(simp)}$.")
            return {"ok": True, "markdown": "\n".join(md)}

    except Exception as exc:
        return {
            "ok": False,
            "error": f"Не удалось разобрать запись. Проверьте скобки и знаки (например: x^2 - 5x + 6 = 0). Детали: {exc}",
        }


def _fmt_mixed_frac(f: fractions.Fraction) -> str:
    if f.denominator == 1:
        return str(f.numerator)
    sign = "-" if f < 0 else ""
    af = abs(f)
    whole = af.numerator // af.denominator
    rem = af.numerator % af.denominator
    if whole == 0:
        return f"{sign}\\frac{{{rem}}}{{{af.denominator}}}"
    return f"{sign}{whole}\\frac{{{rem}}}{{{af.denominator}}}"


def solve_fractions_step(raw_input: str) -> Dict[str, Any]:
    """5-6 grade fraction calculator supporting mixed numbers like '2 1/3 + 1 3/4' or '5/6 : 1 2/3'."""
    s = raw_input.strip()
    s = s.replace("−", "-").replace("–", "-").replace("×", "*").replace("·", "*").replace(":", "/").replace("÷", "/")

    # Match binary fraction operation: [mixed/frac] [op] [mixed/frac]
    pattern = r"^\s*(-?\d+\s+\d+/\d+|-?\d+/\d+|-?\d+)\s*([\+\-\*/])\s*(-?\d+\s+\d+/\d+|-?\d+/\d+|-?\d+)\s*$"
    m = re.match(pattern, s)

    def parse_token(tok: str) -> Tuple[fractions.Fraction, str]:
        tok = tok.strip()
        neg = tok.startswith("-")
        if neg:
            tok = tok[1:].strip()
        if " " in tok and "/" in tok:
            w_s, fr_s = tok.split(None, 1)
            n_s, d_s = fr_s.split("/", 1)
            w, n, d = int(w_s), int(n_s), int(d_s)
            val = fractions.Fraction(w * d + n, d)
            orig = f"{'-' if neg else ''}{w}\\frac{{{n}}}{{{d}}}"
        elif "/" in tok:
            n_s, d_s = tok.split("/", 1)
            n, d = int(n_s), int(d_s)
            val = fractions.Fraction(n, d)
            orig = f"{'-' if neg else ''}\\frac{{{n}}}{{{d}}}"
        else:
            w = int(tok)
            val = fractions.Fraction(w, 1)
            orig = f"{'-' if neg else ''}{w}"
        return (-val if neg else val), orig

    if not m:
        # Fallback to general sympy rational evaluation if complex expression
        try:
            conv = re.sub(r"(\d+)\s+(\d+)/(\d+)", r"(\1 + \2/\3)", s)
            expr = parse_expr(conv, transformations=TRANSFORMATIONS, evaluate=True)
            rat = fractions.Fraction(str(sp.Rational(expr)))
            return {
                "ok": True,
                "markdown": f"### Действия с дробями\n**Выражение:** `{raw_input}`\n\n**Точный результат (неправильная дробь):** $\\frac{{{rat.numerator}}}{{{rat.denominator}}}$\n\n**Смешанное число (Ответ):** ${_fmt_mixed_frac(rat)}$",
            }
        except Exception:
            return {
                "ok": False,
                "error": "Введите пример с дробями, например: 2 1/3 + 1 3/4 или 5/6 : 15/16",
            }

    try:
        t1, op, t2 = m.group(1), m.group(2), m.group(3)
        f1, l1 = parse_token(t1)
        f2, l2 = parse_token(t2)
        op_latex = {"+": "+", "-": "-", "*": "\\cdot", "/": ":"}[op]

        md = ["### Пошаговое решение с обыкновенными дробями (5–6 класс)\n"]
        md.append(f"**Пример:** $${l1} {op_latex} {l2}$$\n")

        md.append("**Шаг 1. Представим числа в виде обыкновенных (неправильных) дробей:**")
        md.append(f"- Первое число: ${l1} = \\frac{{{f1.numerator}}}{{{f1.denominator}}}$")
        md.append(f"- Второе число: ${l2} = \\frac{{{f2.numerator}}}{{{f2.denominator}}}$\n")

        if op in ("+", "-"):
            lcm_d = math.lcm(f1.denominator, f2.denominator)
            m1 = lcm_d // f1.denominator
            m2 = lcm_d // f2.denominator
            n1_new = f1.numerator * m1
            n2_new = f2.numerator * m2
            res_num = n1_new + n2_new if op == "+" else n1_new - n2_new
            res = fractions.Fraction(res_num, lcm_d)
            md.append(f"**Шаг 2. Приведём дроби к наименьшему общему знаменателю (НОЗ):**")
            md.append(f"$\\text{{НОК}}({f1.denominator}; {f2.denominator}) = {lcm_d}$. Дополнительные множители: к первой дроби — ${m1}$, ко второй — ${m2}$.")
            md.append(
                f"$$\\frac{{{f1.numerator} \\cdot {m1}}}{{{lcm_d}}} {op} \\frac{{{f2.numerator} \\cdot {m2}}}{{{lcm_d}}} = \\frac{{{n1_new} {op} ({n2_new})}}{{{lcm_d}}} = \\frac{{{res_num}}}{{{lcm_d}}}$$\n"
            )
        elif op == "*":
            raw_num = f1.numerator * f2.numerator
            raw_den = f1.denominator * f2.denominator
            res = f1 * f2
            md.append("**Шаг 2. Перемножим числители и знаменатели:**")
            md.append(
                f"$$\\frac{{{f1.numerator}}}{{{f1.denominator}}} \\cdot \\frac{{{f2.numerator}}}{{{f2.denominator}}} = \\frac{{{raw_num}}}{{{raw_den}}}$$\n"
            )
        else:
            if f2 == 0:
                return {"ok": False, "error": "Деление на ноль невозможно!"}
            raw_num = f1.numerator * f2.denominator
            raw_den = f1.denominator * f2.numerator
            res = f1 / f2
            md.append("**Шаг 2. Заменим деление умножением на обратную («перевёрнутую») дробь:**")
            md.append(
                f"$$\\frac{{{f1.numerator}}}{{{f1.denominator}}} : \\frac{{{f2.numerator}}}{{{f2.denominator}}} = \\frac{{{f1.numerator}}}{{{f1.denominator}}} \\cdot \\frac{{{f2.denominator}}}{{{f2.numerator}}} = \\frac{{{raw_num}}}{{{raw_den}}}$$\n"
            )

        md.append("**Шаг 3. Сократим дробь и выделим целую часть:**")
        md.append(f"- Несократимая запись: $\\frac{{{res.numerator}}}{{{res.denominator}}}$")
        md.append(f"- Итоговый вид: ${_fmt_mixed_frac(res)}$\n")
        md.append(f"**Ответ:** ${_fmt_mixed_frac(res)}$.")
        return {"ok": True, "markdown": "\n".join(md)}
    except Exception as exc:
        return {"ok": False, "error": f"Ошибка вычисления дробей: {exc}"}


def solve_gcd_lcm(raw_numbers: str) -> Dict[str, Any]:
    nums = [abs(int(x)) for x in re.findall(r"-?\d+", raw_numbers) if int(x) != 0]
    if len(nums) < 2:
        return {"ok": False, "error": "Введите минимум два натуральных числа (например: 36, 48)."}
    if any(n > 10**9 for n in nums):
        return {"ok": False, "error": "Числа слишком велики для разложения столбиком (введите числа до 1 000 000 000)."}

    def factor_steps(n: int) -> Tuple[List[Tuple[int, int]], Dict[int, int]]:
        rows = []
        counts: Dict[int, int] = {}
        cur = n
        d = 2
        while d * d <= cur:
            while cur % d == 0:
                rows.append((cur, d))
                counts[d] = counts.get(d, 0) + 1
                cur //= d
            d += 1 if d == 2 else 2
        if cur > 1:
            rows.append((cur, cur))
            counts[cur] = counts.get(cur, 0) + 1
        rows.append((1, 0))
        return rows, counts

    gcd_val = nums[0]
    lcm_val = nums[0]
    for n in nums[1:]:
        gcd_val = math.gcd(gcd_val, n)
        lcm_val = math.lcm(lcm_val, n)

    nums_label = "; ".join(str(n) for n in nums)
    md = [f"### Нахождение НОД и НОК чисел ({nums_label})\n"]
    md.append("**1. Разложим каждое число на простые множители «столбиком»:**\n")

    for n in nums:
        rows, counts = factor_steps(n)
        width = len(str(n))
        col_lines = []
        for val, div in rows:
            if div == 0:
                col_lines.append(f"{val:>{width}} |")
            else:
                col_lines.append(f"{val:>{width}} | {div}")
        powers = " \\cdot ".join(f"{p}^{{{k}}}" if k > 1 else f"{p}" for p, k in sorted(counts.items())) or "1"
        md.append(f"Число **{n}** ($ {n} = {powers} $):")
        md.append("```text\n" + "\n".join(col_lines) + "\n```")

    md.append(f"**2. Наибольший общий делитель:** $\\text{{НОД}}({nums_label}) = {gcd_val}$")
    md.append(f"**3. Наименьшее общее кратное:** $\\text{{НОК}}({nums_label}) = {lcm_val}$\n")
    md.append(f"**Ответ:** НОД $= {gcd_val}$; НОК $= {lcm_val}$.")
    return {"ok": True, "markdown": "\n".join(md)}


def _parse_formula(formula: str) -> Dict[str, int]:
    """Parse chemical formula like Al2(SO4)3 or CuSO4*5H2O into element counts."""
    formula = formula.strip()
    if "·" in formula or "*" in formula:
        parts = re.split(r"[·\*]", formula)
        total: Dict[str, int] = {}
        for part in parts:
            part = part.strip()
            m = re.match(r"^(\d+)(.+)$", part)
            mult = int(m.group(1)) if m else 1
            sub_f = m.group(2) if m else part
            for el, cnt in _parse_formula(sub_f).items():
                total[el] = total.get(el, 0) + cnt * mult
        return total

    tokens = re.findall(r"([A-Z][a-z]?|\(|\)|\d+)", formula)
    stack: List[Dict[str, int]] = [{}]
    i = 0
    while i < len(tokens):
        tok = tokens[i]
        if tok == "(":
            stack.append({})
            i += 1
        elif tok == ")":
            group = stack.pop()
            mult = 1
            if i + 1 < len(tokens) and tokens[i + 1].isdigit():
                mult = int(tokens[i + 1])
                i += 1
            for el, cnt in group.items():
                stack[-1][el] = stack[-1].get(el, 0) + cnt * mult
            i += 1
        elif re.match(r"^[A-Z][a-z]?$", tok):
            mult = 1
            if i + 1 < len(tokens) and tokens[i + 1].isdigit():
                mult = int(tokens[i + 1])
                i += 1
            stack[-1][tok] = stack[-1].get(tok, 0) + mult
            i += 1
        else:
            i += 1
    if len(stack) != 1:
        raise ValueError("Незакрытая скобка в формуле")
    return stack[0]


def _chem_latex(formula: str) -> str:
    return re.sub(r"(\d+)", r"_{\1}", formula.strip())


def solve_chemistry(raw_input: str) -> Dict[str, Any]:
    s = raw_input.strip()
    if not s:
        return {"ok": False, "error": "Введите химическую формулу (например, Al2(SO4)3) или уравнение реакции (например, Al + H2SO4 = Al2(SO4)3 + H2)."}

    # Check if reaction equation
    if any(sep in s for sep in ("=", "->", "→", "⇄")):
        try:
            norm = s.replace("->", "=").replace("→", "=").replace("⇄", "=")
            left_s, right_s = norm.split("=", 1)
            reactants = [re.sub(r"^\d+\s*", "", x.strip()) for x in left_s.split("+") if x.strip()]
            products = [re.sub(r"^\d+\s*", "", x.strip()) for x in right_s.split("+") if x.strip()]
            all_species = reactants + products
            parsed = [_parse_formula(sp_f) for sp_f in all_species]
            elements = sorted({el for d in parsed for el in d})

            rows = []
            for el in elements:
                row = []
                for idx, d in enumerate(parsed):
                    cnt = d.get(el, 0)
                    row.append(cnt if idx < len(reactants) else -cnt)
                rows.append(row)

            mat = sp.Matrix(rows)
            nullsp = mat.nullspace()
            if not nullsp:
                return {"ok": False, "error": "Невозможно уравнять реакцию: проверьте правильность формул реагентов и продуктов (все ли элементы присутствуют слева и справа)."}

            vec = nullsp[0]
            lcm_den = 1
            for val in vec:
                lcm_den = math.lcm(lcm_den, int(sp.Rational(val).q))
            int_coeffs = [int(sp.Rational(val) * lcm_den) for val in vec]
            if all(c < 0 for c in int_coeffs):
                int_coeffs = [-c for c in int_coeffs]
            if any(c <= 0 for c in int_coeffs):
                return {"ok": False, "error": "Проверьте продукты реакции — получились некорректные стехиометрические коэффициенты."}
            g = int_coeffs[0]
            for c in int_coeffs[1:]:
                g = math.gcd(g, c)
            int_coeffs = [c // g for c in int_coeffs]

            left_parts = [
                (f"{c}" if c > 1 else "") + _chem_latex(f)
                for c, f in zip(int_coeffs[: len(reactants)], reactants)
            ]
            right_parts = [
                (f"{c}" if c > 1 else "") + _chem_latex(f)
                for c, f in zip(int_coeffs[len(reactants) :], products)
            ]
            balanced_latex = " + ".join(left_parts) + " = " + " + ".join(right_parts)
            plain_left = " + ".join((f"{c}" if c > 1 else "") + f for c, f in zip(int_coeffs[: len(reactants)], reactants))
            plain_right = " + ".join((f"{c}" if c > 1 else "") + f for c, f in zip(int_coeffs[len(reactants) :], products))

            # Balance check table
            check_lines = ["| Элемент | Слева (атомов) | Справа (атомов) |", "|---|---|---|"]
            for el in elements:
                l_cnt = sum(int_coeffs[i] * parsed[i].get(el, 0) for i in range(len(reactants)))
                r_cnt = sum(int_coeffs[len(reactants) + j] * parsed[len(reactants) + j].get(el, 0) for j in range(len(products)))
                check_lines.append(f"| **{el}** | {l_cnt} | {r_cnt} ✅ |")

            sum_coeffs = sum(int_coeffs)
            md = [
                "### Уравнивание химической реакции\n",
                f"**Уравнение с расставленными коэффициентами:**\n$$\\mathrm{{{balanced_latex}}}$$\n",
                f"**Для записи в тетрадь:** `{plain_left} = {plain_right}`\n",
                f"**Сумма всех коэффициентов** (часто спрашивают в ОГЭ/ЕГЭ): **{sum_coeffs}**\n",
                "**Проверка материального баланса:**\n" + "\n".join(check_lines),
            ]
            return {"ok": True, "markdown": "\n".join(md)}
        except Exception as exc:
            return {"ok": False, "error": f"Ошибка разбора уравнения реакции: {exc}"}

    # Otherwise: Molar mass & mass fractions
    try:
        counts = _parse_formula(s)
        if not counts:
            return {"ok": False, "error": "Не удалось распознать химическую формулу."}
        total_m = 0.0
        parts_str = []
        unknown = []
        for el, cnt in counts.items():
            if el not in SCHOOL_AR:
                unknown.append(el)
            else:
                ar, _ = SCHOOL_AR[el]
                total_m += ar * cnt
                ar_s = "35{,}5" if ar == 35.5 else str(int(ar))
                parts_str.append(f"{ar_s} \\cdot {cnt}" if cnt > 1 else f"{ar_s}")
        if unknown:
            return {"ok": False, "error": f"Неизвестный химический элемент: {', '.join(unknown)}. Проверьте заглавные и строчные буквы (например, Co — кобальт, CO — угарный газ)."}

        total_s = f"{total_m:.1f}".rstrip("0").rstrip(".").replace(".", "{,}")
        flatex = _chem_latex(s)
        md = [
            f"### Расчёт молярной массы и массовых долей для $\\mathrm{{{flatex}}}$\n",
            "**1. Найдём относительную молекулярную и молярную массу (по школьной таблице Менделеева):**",
            f"$$M_r(\\mathrm{{{flatex}}}) = {' + '.join(parts_str)} = {total_s}$$",
            f"$$M(\\mathrm{{{flatex}}}) = {total_s}\\text{{ г/моль}}$$\n",
            "**2. Вычислим массовые доли элементов $\\omega(\\text{Э}) = \\frac{n \\cdot A_r(\\text{Э})}{M_r} \\cdot 100\\%$:**\n",
            "| Элемент | Название | Атомов ($n$) | $A_r$ | Массовая доля $\\omega$, % |",
            "|---|---|---|---|---|",
        ]
        for el, cnt in counts.items():
            ar, name = SCHOOL_AR[el]
            omega = (ar * cnt / total_m) * 100.0
            md.append(f"| **{el}** | {name} | {cnt} | {ar:g} | **{omega:.2f}%** |")
        return {"ok": True, "markdown": "\n".join(md)}
    except Exception as exc:
        return {"ok": False, "error": f"Ошибка расчёта формулы: {exc}"}


SI_UNITS: Dict[str, Tuple[float, str, str]] = {
    # Length
    "мм": (1e-3, "м", "1 мм = 0,001 м"),
    "см": (1e-2, "м", "1 см = 0,01 м"),
    "дм": (1e-1, "м", "1 дм = 0,1 м"),
    "км": (1e3, "м", "1 км = 1000 м"),
    "м": (1.0, "м", "уже в СИ"),
    # Area
    "мм2": (1e-6, "м²", "1 мм² = 10⁻⁶ м²"),
    "мм²": (1e-6, "м²", "1 мм² = 10⁻⁶ м²"),
    "см2": (1e-4, "м²", "1 см² = 0,0001 м²"),
    "см²": (1e-4, "м²", "1 см² = 0,0001 м²"),
    "дм2": (1e-2, "м²", "1 дм² = 0,01 м²"),
    "дм²": (1e-2, "м²", "1 дм² = 0,01 м²"),
    # Volume
    "мл": (1e-6, "м³", "1 мл = 1 см³ = 10⁻⁶ м³"),
    "см3": (1e-6, "м³", "1 см³ = 10⁻⁶ м³"),
    "см³": (1e-6, "м³", "1 см³ = 10⁻⁶ м³"),
    "л": (1e-3, "м³", "1 л = 1 дм³ = 0,001 м³"),
    "дм3": (1e-3, "м³", "1 дм³ = 0,001 м³"),
    "дм³": (1e-3, "м³", "1 дм³ = 0,001 м³"),
    # Mass
    "мг": (1e-6, "кг", "1 мг = 10⁻⁶ кг"),
    "г": (1e-3, "кг", "1 г = 0,001 кг"),
    "ц": (100.0, "кг", "1 центнер = 100 кг"),
    "т": (1000.0, "кг", "1 тонна = 1000 кг"),
    "кг": (1.0, "кг", "уже в СИ"),
    # Time
    "мс": (1e-3, "с", "1 мс = 0,001 с"),
    "мин": (60.0, "с", "1 мин = 60 с"),
    "ч": (3600.0, "с", "1 ч = 3600 с"),
    "сут": (86400.0, "с", "1 сут = 86400 с"),
    "с": (1.0, "с", "уже в СИ"),
    # Speed
    "км/ч": (1.0 / 3.6, "м/с", "делим на 3,6 (× 1000 / 3600)"),
    "см/с": (1e-2, "м/с", "1 см/с = 0,01 м/с"),
    "км/с": (1e3, "м/с", "1 км/с = 1000 м/с"),
    "м/с": (1.0, "м/с", "уже в СИ"),
    # Density
    "г/см3": (1000.0, "кг/м³", "1 г/см³ = 1000 кг/м³"),
    "г/см³": (1000.0, "кг/м³", "1 г/см³ = 1000 кг/м³"),
    # Force, Energy, Power, Pressure, Electricity
    "кн": (1e3, "Н", "1 кН = 1000 Н"),
    "мн": (1e-3, "Н", "1 мН = 0,001 Н"),
    "кдж": (1e3, "Дж", "1 кДж = 1000 Дж"),
    "мдж": (1e6, "Дж", "1 МДж = 10⁶ Дж"),
    "квт": (1e3, "Вт", "1 кВт = 1000 Вт"),
    "мвт": (1e6, "Вт", "1 МВт = 10⁶ Вт"),
    "кпа": (1e3, "Па", "1 кПа = 1000 Па"),
    "мпа": (1e6, "Па", "1 МПа = 10⁶ Па"),
    "мм рт.ст.": (133.322, "Па", "1 мм рт. ст. ≈ 133,3 Па"),
    "ма": (1e-3, "А", "1 мА = 0,001 А"),
    "мка": (1e-6, "А", "1 мкА = 10⁻⁶ А"),
    "кв": (1e3, "В", "1 кВ = 1000 В"),
    "мв": (1e-3, "В", "1 мВ = 0,001 В"),
    "ком": (1e3, "Ом", "1 кОм = 1000 Ом"),
    "мкф": (1e-6, "Ф", "1 мкФ = 10⁻⁶ Ф"),
    "нф": (1e-9, "Ф", "1 нФ = 10⁻⁹ Ф"),
    "пф": (1e-12, "Ф", "1 пФ = 10⁻¹² Ф"),
    "мкгн": (1e-6, "Гн", "1 мкГн = 10⁻⁶ Гн"),
    "мгн": (1e-3, "Гн", "1 мГн = 10⁻³ Гн"),
}


def convert_physics_si(raw_text: str) -> Dict[str, Any]:
    items = [x.strip() for x in re.split(r"[;\n,]+(?=\s*[a-zA-Zа-яА-Я0-9\-])", raw_text.replace("0,", "0.")) if x.strip()]
    # Better splitting: split on ';' or newline, or comma not between digits
    items = [x.strip() for x in re.split(r"[;\n]+|(?<!\d),(?!\d)", raw_text) if x.strip()]
    if not items:
        return {"ok": False, "error": "Введите величины через точку с запятой, например: v = 72 км/ч; m = 250 г; S = 15 см2"}

    rows = []
    for item in items:
        m = re.match(r"^(?:([a-zA-Zа-яА-Я0-9_]+)\s*=\s*)?(-?\d+(?:[\.,]\d+)?)\s*(.+)$", item)
        if not m:
            rows.append((item, "—", "Не удалось распознать формат (пример: m = 250 г)"))
            continue
        sym_name = m.group(1) or "Величина"
        val_f = float(m.group(2).replace(",", "."))
        unit_raw = m.group(3).strip()

        # Check Celsius temperature
        if unit_raw in ("°C", "C", "°С", "С", "град"):
            kelvin = val_f + 273
            rows.append((f"${sym_name} = {m.group(2)}\\text{{ }}^\\circ\\text{{C}}$", f"$T = {kelvin:g}\\text{{ К}}$", "$T = t + 273$"))
            continue

        # Exact case-sensitive distinctions first (МДж vs мДж, МПа vs мПа, МВт vs мВт)
        exact_mega = {
            "МДж": (1e6, "Дж", "1 МДж = 10⁶ Дж"),
            "мДж": (1e-3, "Дж", "1 мДж = 10⁻³ Дж"),
            "МПа": (1e6, "Па", "1 МПа = 10⁶ Па"),
            "мПа": (1e-3, "Па", "1 мПа = 10⁻³ Па"),
            "МВт": (1e6, "Вт", "1 МВт = 10⁶ Вт"),
            "мВт": (1e-3, "Вт", "1 мВт = 10⁻³ Вт"),
            "МОм": (1e6, "Ом", "1 МОм = 10⁶ Ом"),
        }
        info = exact_mega.get(unit_raw) or SI_UNITS.get(unit_raw.lower())
        if not info:
            rows.append((f"{sym_name} = {m.group(2)} {unit_raw}", "Проверить ед.", "Нестандартная единица"))
            continue

        mult, si_unit, rule = info
        si_val = val_f * mult
        if mult == 1.0:
            si_cell = "—"
        elif abs(si_val) >= 0.01 and abs(si_val) < 100000:
            si_cell = f"${si_val:g}\\text{{ {si_unit}}}$".replace(".", "{,}")
        else:
            exp = int(math.floor(math.log10(abs(si_val)))) if si_val != 0 else 0
            mant = si_val / (10**exp) if si_val != 0 else 0
            mant_s = f"{mant:.4g}".replace(".", "{,}")
            si_cell = f"${mant_s} \\cdot 10^{{{exp}}}\\text{{ {si_unit}}}$"

        rows.append((f"${sym_name} = {m.group(2)}\\text{{ {unit_raw}}}$", si_cell, rule))

    md = [
        "### Перевод величин в систему СИ (для оформления «Дано | СИ»)\n",
        "| Дано | СИ | Правило перевода |",
        "|---|---|---|",
    ]
    for d_col, si_col, rule_col in rows:
        md.append(f"| {d_col} | {si_col} | {rule_col} |")
    return {"ok": True, "markdown": "\n".join(md)}


DIGITS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"


def solve_number_bases(num_str: str, from_base: int, to_base: int) -> Dict[str, Any]:
    s = num_str.strip().upper()
    if not s:
        return {"ok": False, "error": "Введите число для перевода."}
    if not (2 <= from_base <= 36 and 2 <= to_base <= 36):
        return {"ok": False, "error": "Основание системы счисления должно быть от 2 до 36."}

    neg = s.startswith("-")
    if neg:
        s = s[1:]
    if not all(ch in DIGITS[:from_base] for ch in s):
        return {"ok": False, "error": f"Число {s} содержит недопустимые цифры для системы с основанием {from_base}."}

    dec_val = int(s, from_base)
    md = [f"### Перевод числа ${'-' if neg else ''}{s}_{{{from_base}}} \\rightarrow X_{{{to_base}}}$\n"]

    if from_base != 10:
        n = len(s)
        terms = []
        for idx, ch in enumerate(s):
            power = n - 1 - idx
            d_val = DIGITS.index(ch)
            terms.append(f"{d_val} \\cdot {from_base}^{{{power}}}")
        md.append(f"**Шаг 1. Переведём в десятичную систему через развёрнутую запись числа:**")
        md.append(f"$${s}_{{{from_base}}} = {' + '.join(terms)} = {dec_val}_{{10}}$$\n")
    else:
        md.append(f"**Исходное десятичное число:** ${dec_val}_{{10}}$\n")

    if to_base == 10:
        res = f"{'-' if neg else ''}{dec_val}"
        md.append(f"**Ответ:** ${res}_{{10}}$.")
        return {"ok": True, "markdown": "\n".join(md)}

    md.append(f"**Шаг 2. Последовательно делим ${dec_val}$ на основание ${to_base}$ и выписываем остатки снизу вверх:**")
    if dec_val == 0:
        res_digits = "0"
        md.append("- $0 : " + str(to_base) + " = 0$ (остаток $0$)")
    else:
        cur = dec_val
        rems = []
        steps_list = []
        while cur > 0:
            q, r = divmod(cur, to_base)
            r_ch = DIGITS[r]
            extra = f" (цифра **{r_ch}**)" if r >= 10 else f" (остаток **{r}**)"
            steps_list.append(f"- ${cur} : {to_base} = {q}$, остаток ${r}${extra}")
            rems.append(r_ch)
            cur = q
        res_digits = "".join(reversed(rems))
        md.extend(steps_list)

    final_res = ("-" if neg else "") + res_digits
    md.append(f"\nЧитаем остатки в обратном порядке (снизу вверх): **{res_digits}**.\n")
    md.append(f"**Ответ:** ${final_res}_{{{to_base}}}$.")
    return {"ok": True, "markdown": "\n".join(md)}


def solve_truth_table(raw_expr: str) -> Dict[str, Any]:
    s = raw_expr.strip()
    if not s:
        return {"ok": False, "error": "Введите логическое выражение (например: ¬A ∧ (B → C) или not x and (y <= z))."}

    # Normalize Russian/Math/EGE logic symbols into Python safe evaluation
    py_expr = s
    py_expr = re.sub(r"!(?!=)", " not ", py_expr.replace("¬", " not ")).replace("~", " not ")
    py_expr = py_expr.replace("∧", " and ").replace("/\\", " and ").replace("&", " and ").replace("*", " and ")
    py_expr = py_expr.replace("∨", " or ").replace("\\/", " or ").replace("|", " or ").replace("+", " or ")
    py_expr = py_expr.replace("≡", " == ").replace("<->", " == ").replace("⇔", " == ")
    py_expr = py_expr.replace("⊕", " != ").replace("^", " != ")
    py_expr = py_expr.replace("→", " <= ").replace("->", " <= ").replace("⇒", " <= ")

    # Extract variable names (excluding keywords not, and, or, True, False)
    tokens = re.findall(r"\b[a-zA-Z]\b", py_expr)
    vars_list = sorted(set(tokens))
    if not vars_list or len(vars_list) > 5:
        return {"ok": False, "error": "Используйте от 1 до 5 однобуквенных логических переменных (например: A, B, C или x, y, z, w)."}

    try:
        if len(py_expr) > 1000:
            raise ValueError("Выражение слишком длинное")
        tree = ast.parse(py_expr.strip(), mode="eval")
        allowed = (ast.Expression, ast.BoolOp, ast.UnaryOp, ast.Compare, ast.Name,
                   ast.Constant, ast.Load, ast.And, ast.Or, ast.Not,
                   ast.Eq, ast.NotEq, ast.LtE, ast.GtE, ast.Lt, ast.Gt)
        for node in ast.walk(tree):
            if not isinstance(node, allowed):
                raise ValueError("Допустимы только логические операции")
            if isinstance(node, ast.Name) and node.id not in vars_list:
                raise ValueError("Неизвестная переменная")
            if isinstance(node, ast.Constant) and (type(node.value) not in (int, bool) or node.value not in (0, 1)):
                raise ValueError("Допустимы только 0 и 1")
        code = compile(tree, "<logic>", "eval")
        header = "| " + " | ".join(vars_list) + " | **F** |"
        sep = "|" + "|".join(["---"] * (len(vars_list) + 1)) + "|"
        rows_all = [header, sep]
        rows_true = [header, sep]
        rows_false = [header, sep]

        for combo in itertools.product([0, 1], repeat=len(vars_list)):
            env = {v: bool(val) for v, val in zip(vars_list, combo)}
            res = 1 if bool(eval(code, {"__builtins__": {}}, env)) else 0
            line = "| " + " | ".join(str(val) for val in combo) + f" | **{res}** |"
            rows_all.append(line)
            if res == 1:
                rows_true.append(line)
            else:
                rows_false.append(line)

        md = [
            f"### Таблица истинности (Информатика ОГЭ / ЕГЭ №2)\n",
            f"**Выражение:** `{raw_expr}`\n",
            "**Полная таблица истинности:**\n" + "\n".join(rows_all),
        ]
        if len(rows_true) > 2 and len(vars_list) >= 3:
            md.append("\n**Строки, где $F = 1$ (удобно для задания №2 ЕГЭ):**\n" + "\n".join(rows_true))
        if len(rows_false) > 2 and len(vars_list) >= 3:
            md.append("\n**Строки, где $F = 0$:**\n" + "\n".join(rows_false))
        return {"ok": True, "markdown": "\n".join(md)}
    except Exception as exc:
        return {"ok": False, "error": f"Не удалось вычислить логическую функцию. Проверьте скобки и знаки операций. ({exc})"}


def try_sympy_auto_verify(task_text: str) -> str:
    """Best-effort check: if homework text contains an explicit single equation, compute exact roots with SymPy."""
    if not task_text or len(task_text) > 500:
        return ""
    # Look for clean equation line without Cyrillic letters inside math part
    lines = [ln.strip() for ln in task_text.splitlines() if "=" in ln]
    for ln in lines:
        # Strip Russian prefix like "Решите уравнение:"
        cleaned_ln = re.sub(r"^[А-Яа-яЁё\s:,.\-№0-9\)]+(?=[:\s])", "", ln).strip()
        m = re.search(r"([0-9xXyYzZaAbB\+\-\*\/\^\(\)\s²³]{3,}=[0-9xXyYzZaAbB\+\-\*\/\^\(\)\s²³\-]{1,})", ln)
        candidate = m.group(1).strip() if m else cleaned_ln
        if "=" in candidate and re.search(r"[xXyY]", candidate):
            try:
                lhs_s, rhs_s = _clean_math_input(candidate).split("=", 1)
                lhs = parse_expr(lhs_s, transformations=TRANSFORMATIONS)
                rhs = parse_expr(rhs_s, transformations=TRANSFORMATIONS)
                syms = sorted(list((lhs - rhs).free_symbols), key=lambda z: z.name)
                if len(syms) == 1:
                    sols = [s for s in sp.solve(sp.Eq(lhs, rhs), syms[0]) if s.is_real is not False]
                    if sols:
                        roots_str = ", ".join(f"{syms[0]} = {sp.latex(s)}" for s in sols)
                        return f"Точная проверка SymPy для `{candidate}`: ${roots_str}$"
            except Exception:
                continue
    return ""
