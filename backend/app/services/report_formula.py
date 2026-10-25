"""Safe formula engine for Report Builder calculated columns.

A small, purpose-built expression language — user formulas are *never*
evaluated with ``eval``/SQL.  The text is tokenised, parsed into an AST by a
recursive-descent parser and evaluated per row with ``Decimal`` arithmetic so
accounting figures do not pick up binary-float noise.

Language (Excel-flavoured, plain-English friendly)::

    [gsv_bbl] - [nsv_bbl]
    [variance_bbl] % [received_bbl]                 -> percent of (a / b * 100)
    IF([status] = "Approved", [nsv_bbl], 0)
    IFS([nsv_bbl] >= 1000, "Large", [nsv_bbl] >= 100, "Medium", "Small")
    IFERROR([a] / [b], 0)
    AND([bsW] <= 0.5, OR([loc] = "BONNY", [loc] = "ESC"))

Rules worth knowing
-------------------
* ``[column_key]`` references another report column (data or calculated).
* Binary ``%`` means "percent of" (``a % b == a / b * 100``) because that is
  what terminal accountants mean by "% of two columns".  Use ``MOD(a, b)``
  for the programming remainder and the column *format* to show a ``%`` sign.
* Blank (missing) values stay blank through arithmetic (``5 + blank`` is
  blank, not 5) unless the formula opts out with ``COALESCE``/``IFERROR`` or
  an aggregating function (``SUM``/``AVG``/``MIN``/``MAX``/``COUNT`` ignore
  blanks).  This keeps "no reading taken" visibly different from zero.
* Division by zero raises a per-cell error (the cell renders blank with a
  warning) instead of crashing the report; ``IFERROR`` can substitute a value.
* Comparisons try numbers first (payload values often arrive as text such as
  ``"28"``), then dates, then case-insensitive text.
"""

from __future__ import annotations

import re
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, getcontext

getcontext().prec = 28

MAX_FORMULA_LENGTH = 2000
MAX_AST_NODES = 400

FUNCTIONS = {
    "IF", "IFS", "AND", "OR", "NOT", "ISBLANK", "ISNULL", "COALESCE", "IFNULL",
    "IFERROR", "ABS", "ROUND", "MIN", "MAX", "SUM", "AVG", "AVERAGE", "COUNT",
    "MOD", "PCT", "CONCAT", "UPPER", "LOWER", "TRIM", "LEN", "LEFT", "RIGHT",
    "YEAR", "MONTH", "DAY", "DATEDIFF", "TODAY",
}

# Plain-English help used by the builder UI (served by the catalog endpoint).
FUNCTION_HELP = [
    {"name": "IF", "syntax": "IF(condition, value if true, value if false)", "example": 'IF([status] = "Approved", [nsv_bbl], 0)', "description": "Choose between two values depending on a condition."},
    {"name": "IFS", "syntax": "IFS(condition1, value1, condition2, value2, …, default)", "example": 'IFS([nsv_bbl] >= 1000, "Large", [nsv_bbl] >= 100, "Medium", "Small")', "description": "Test conditions in order; the first true one wins. An odd last value is the default."},
    {"name": "AND", "syntax": "AND(condition1, condition2, …)", "example": "AND([bSW] <= 0.5, [nsv_bbl] > 0)", "description": "True only when every condition is true."},
    {"name": "OR", "syntax": "OR(condition1, condition2, …)", "example": 'OR([location] = "BONNY", [location] = "ESC")', "description": "True when at least one condition is true."},
    {"name": "NOT", "syntax": "NOT(condition)", "example": 'NOT([status] = "Draft")', "description": "Reverses a condition."},
    {"name": "ISBLANK", "syntax": "ISBLANK(value)", "example": "IF(ISBLANK([water_bbl]), 0, [water_bbl])", "description": "True when the value is empty / not recorded."},
    {"name": "COALESCE", "syntax": "COALESCE(value1, value2, …)", "example": "COALESCE([closing_bbl], 0)", "description": "First value that is not blank."},
    {"name": "IFERROR", "syntax": "IFERROR(formula, value if error)", "example": "IFERROR([variance] % [received], 0)", "description": "Use a fallback when the formula cannot be calculated (for example divide by zero)."},
    {"name": "ABS", "syntax": "ABS(number)", "example": "ABS([loss_gain])", "description": "Positive value (removes a minus sign)."},
    {"name": "ROUND", "syntax": "ROUND(number, decimals)", "example": "ROUND([nsv_bbl], 3)", "description": "Round to the given number of decimal places."},
    {"name": "SUM", "syntax": "SUM(value1, value2, …)", "example": "SUM([oil_bbl], [water_bbl])", "description": "Add values in this row, ignoring blanks."},
    {"name": "AVG", "syntax": "AVG(value1, value2, …)", "example": "AVG([temp_before], [temp_after])", "description": "Average of the values in this row, ignoring blanks."},
    {"name": "MIN / MAX", "syntax": "MIN(value1, …) / MAX(value1, …)", "example": "MAX([opening], [closing])", "description": "Smallest / largest value in this row, ignoring blanks."},
    {"name": "PCT", "syntax": "PCT(part, whole)", "example": "PCT([variance_bbl], [received_bbl])", "description": "Percentage: part ÷ whole × 100. Same as [part] % [whole]."},
    {"name": "MOD", "syntax": "MOD(number, divisor)", "example": "MOD([total], 100)", "description": "Remainder after division."},
    {"name": "CONCAT", "syntax": "CONCAT(value1, value2, …)", "example": 'CONCAT([location], " - ", [tank])', "description": "Join text values together."},
    {"name": "DATEDIFF", "syntax": "DATEDIFF(later date, earlier date)", "example": "DATEDIFF([closing_date], [opening_date])", "description": "Whole days between two dates."},
    {"name": "YEAR / MONTH / DAY", "syntax": "YEAR(date)", "example": "MONTH([accounting_date])", "description": "Part of a date, as a number."},
]

OPERATOR_HELP = [
    {"symbol": "+", "meaning": "Add", "example": "[oil] + [water]"},
    {"symbol": "-", "meaning": "Subtract", "example": "[closing] - [opening]"},
    {"symbol": "*", "meaning": "Multiply", "example": "[volume] * [factor]"},
    {"symbol": "/", "meaning": "Divide", "example": "[total] / [count]"},
    {"symbol": "%", "meaning": "Percent of (left ÷ right × 100)", "example": "[variance] % [received]"},
    {"symbol": "^", "meaning": "Power", "example": "[value] ^ 2"},
    {"symbol": "=", "meaning": "Equal to", "example": '[status] = "Approved"'},
    {"symbol": "<>", "meaning": "Not equal to", "example": '[status] <> "Draft"'},
    {"symbol": ">  >=  <  <=", "meaning": "Greater / less comparisons", "example": "[bSW] <= 0.5"},
]


class FormulaError(ValueError):
    """Parse-time or cell-level evaluation error."""

    def __init__(self, message: str, code: str = "VALUE", position: int | None = None):
        super().__init__(message)
        self.code = code
        self.position = position


# ---------------------------------------------------------------------------
# Tokeniser
# ---------------------------------------------------------------------------

_TOKEN_RE = re.compile(
    r"""
    (?P<ws>\s+)
  | (?P<col>\[[A-Za-z_][A-Za-z0-9_]*\])
  | (?P<number>\d+(?:\.\d+)?|\.\d+)
  | (?P<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')
  | (?P<op><>|!=|>=|<=|&&|\|\||[()+\-*/%^,=<>])
  | (?P<ident>[A-Za-z_][A-Za-z0-9_]*)
    """,
    re.VERBOSE,
)


class _Token:
    __slots__ = ("kind", "value", "pos")

    def __init__(self, kind, value, pos):
        self.kind = kind
        self.value = value
        self.pos = pos


def _tokenise(text: str) -> list[_Token]:
    tokens: list[_Token] = []
    pos = 0
    while pos < len(text):
        match = _TOKEN_RE.match(text, pos)
        if not match:
            raise FormulaError(f"Unexpected character {text[pos]!r}", code="PARSE", position=pos)
        kind = match.lastgroup
        raw = match.group()
        start = pos
        pos = match.end()
        if kind == "ws":
            continue
        if kind == "col":
            tokens.append(_Token("COL", raw[1:-1], start))
        elif kind == "number":
            tokens.append(_Token("NUMBER", raw, start))
        elif kind == "string":
            body = raw[1:-1].replace('\\"', '"').replace("\\'", "'").replace("\\\\", "\\")
            tokens.append(_Token("STRING", body, start))
        elif kind == "op":
            tokens.append(_Token("OP", raw, start))
        else:
            tokens.append(_Token("IDENT", raw, start))
    tokens.append(_Token("EOF", "", len(text)))
    return tokens


# ---------------------------------------------------------------------------
# Parser (recursive descent).  AST nodes are tuples: (kind, ...)
# ---------------------------------------------------------------------------

class _Parser:
    def __init__(self, tokens: list[_Token]):
        self.tokens = tokens
        self.i = 0
        self.nodes = 0

    def _peek(self) -> _Token:
        return self.tokens[self.i]

    def _next(self) -> _Token:
        token = self.tokens[self.i]
        self.i += 1
        return token

    def _count(self):
        self.nodes += 1
        if self.nodes > MAX_AST_NODES:
            raise FormulaError("Formula is too complex.", code="PARSE")

    def _expect_op(self, value: str):
        token = self._peek()
        if token.kind != "OP" or token.value != value:
            raise FormulaError(f"Expected '{value}'.", code="PARSE", position=token.pos)
        self._next()

    def _is_keyword(self, word: str) -> bool:
        token = self._peek()
        return token.kind == "IDENT" and token.value.upper() == word

    def parse(self):
        node = self._parse_or()
        token = self._peek()
        if token.kind != "EOF":
            raise FormulaError("Unexpected extra text at the end of the formula.", code="PARSE", position=token.pos)
        return node

    def _parse_or(self):
        node = self._parse_and()
        while self._is_keyword("OR") or (self._peek().kind == "OP" and self._peek().value == "||"):
            self._next()
            right = self._parse_and()
            node = ("or", node, right)
            self._count()
        return node

    def _parse_and(self):
        node = self._parse_not()
        while self._is_keyword("AND") or (self._peek().kind == "OP" and self._peek().value == "&&"):
            self._next()
            right = self._parse_not()
            node = ("and", node, right)
            self._count()
        return node

    def _parse_not(self):
        if self._is_keyword("NOT"):
            self._next()
            self._count()
            return ("not", self._parse_not())
        return self._parse_comparison()

    def _parse_comparison(self):
        node = self._parse_additive()
        token = self._peek()
        if token.kind == "OP" and token.value in ("=", "<>", "!=", ">=", "<=", ">", "<"):
            self._next()
            right = self._parse_additive()
            op = "<>" if token.value == "!=" else token.value
            node = ("cmp", op, node, right)
            self._count()
        return node

    def _parse_additive(self):
        node = self._parse_multiplicative()
        while self._peek().kind == "OP" and self._peek().value in ("+", "-"):
            op = self._next().value
            right = self._parse_multiplicative()
            node = ("bin", op, node, right)
            self._count()
        return node

    def _parse_multiplicative(self):
        node = self._parse_power()
        while self._peek().kind == "OP" and self._peek().value in ("*", "/", "%"):
            op = self._next().value
            right = self._parse_power()
            node = ("bin", op, node, right)
            self._count()
        return node

    def _parse_power(self):
        node = self._parse_unary()
        if self._peek().kind == "OP" and self._peek().value == "^":
            self._next()
            right = self._parse_unary()
            node = ("bin", "^", node, right)
            self._count()
        return node

    def _parse_unary(self):
        token = self._peek()
        if token.kind == "OP" and token.value in ("-", "+"):
            self._next()
            self._count()
            operand = self._parse_unary()
            return ("neg", operand) if token.value == "-" else operand
        return self._parse_primary()

    def _parse_primary(self):
        token = self._next()
        self._count()
        if token.kind == "NUMBER":
            return ("num", token.value)
        if token.kind == "STRING":
            return ("str", token.value)
        if token.kind == "COL":
            return ("col", token.value)
        if token.kind == "OP" and token.value == "(":
            node = self._parse_or()
            self._expect_op(")")
            return node
        if token.kind == "IDENT":
            word = token.value.upper()
            if word == "TRUE":
                return ("bool", True)
            if word == "FALSE":
                return ("bool", False)
            if word in ("NULL", "BLANK"):
                return ("null",)
            if word in ("AND", "OR", "NOT") and not (
                self._peek().kind == "OP" and self._peek().value == "("
            ):
                raise FormulaError(f"'{word}' needs values on both sides, or use {word}(…).", code="PARSE", position=token.pos)
            # Function call
            self._expect_op("(")
            args = []
            if not (self._peek().kind == "OP" and self._peek().value == ")"):
                while True:
                    args.append(self._parse_or())
                    if self._peek().kind == "OP" and self._peek().value == ",":
                        self._next()
                        continue
                    break
            self._expect_op(")")
            if word not in FUNCTIONS:
                raise FormulaError(f"Unknown function {word}(…).", code="NAME", position=token.pos)
            return ("call", word, tuple(args))
        raise FormulaError("Expected a value, a [column] or a function.", code="PARSE", position=token.pos)


def parse_formula(text: str):
    """Parse formula text into an AST. Raises :class:`FormulaError`."""
    cleaned = str(text or "").strip()
    if cleaned.startswith("="):
        cleaned = cleaned[1:].strip()
    if not cleaned:
        raise FormulaError("The formula is empty.", code="PARSE", position=0)
    if len(cleaned) > MAX_FORMULA_LENGTH:
        raise FormulaError("The formula is too long.", code="PARSE")
    return _Parser(_tokenise(cleaned)).parse()


def referenced_columns(node) -> set[str]:
    found: set[str] = set()

    def walk(current):
        if not isinstance(current, tuple) or not current:
            return
        if current[0] == "col":
            found.add(current[1])
            return
        for part in current[1:]:
            if isinstance(part, tuple):
                # ("call", name, args-tuple): walk each arg
                if part and isinstance(part[0], tuple):
                    for sub in part:
                        walk(sub)
                else:
                    walk(part)

    walk(node)
    return found


# ---------------------------------------------------------------------------
# Value coercion helpers
# ---------------------------------------------------------------------------

def is_blank(value) -> bool:
    return value is None or (isinstance(value, str) and value.strip() == "")


def to_decimal(value) -> Decimal | None:
    """Best-effort Decimal from a cell value; None when blank/non-numeric."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        try:
            return Decimal(str(value))
        except InvalidOperation:
            return None
    if isinstance(value, str):
        cleaned = value.strip().replace(",", "")
        if not cleaned:
            return None
        if cleaned.endswith("%"):
            cleaned = cleaned[:-1].strip()
        try:
            return Decimal(cleaned)
        except InvalidOperation:
            return None
    return None


def _to_date(value) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str):
        # Local import: reuse the application's payload date parser so that
        # "21/10/2026", "2026-10-21" etc. behave exactly as in other reports.
        from app.services.operation_datetime import parse_date_value

        return parse_date_value(value)
    return None


def truthy(value) -> bool:
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    number = to_decimal(value)
    if number is not None:
        return number != 0
    if isinstance(value, str):
        return value.strip().casefold() in {"true", "yes", "y", "1"}
    return bool(value)


def _compare(op: str, left, right) -> bool:
    if is_blank(left) or is_blank(right):
        # Blank only equals blank.
        both_blank = is_blank(left) and is_blank(right)
        if op == "=":
            return both_blank
        if op == "<>":
            return not both_blank
        return False
    left_num, right_num = to_decimal(left), to_decimal(right)
    if left_num is not None and right_num is not None:
        a, b = left_num, right_num
    else:
        left_date, right_date = _to_date(left), _to_date(right)
        if left_date is not None and right_date is not None:
            a, b = left_date, right_date
        elif isinstance(left, bool) or isinstance(right, bool):
            a, b = truthy(left), truthy(right)
        else:
            a, b = str(left).strip().casefold(), str(right).strip().casefold()
    if op == "=":
        return a == b
    if op == "<>":
        return a != b
    if op == ">":
        return a > b
    if op == ">=":
        return a >= b
    if op == "<":
        return a < b
    if op == "<=":
        return a <= b
    raise FormulaError(f"Unknown comparison {op!r}.", code="PARSE")


def _num(value, what: str = "value") -> Decimal:
    number = to_decimal(value)
    if number is None:
        raise FormulaError(f"'{value}' is not a number ({what}).", code="TYPE")
    return number


def _text_of(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, Decimal):
        return format(value.normalize(), "f") if value == value.to_integral() else format(value, "f")
    if isinstance(value, float):
        return str(int(value)) if float(value).is_integer() else str(value)
    if isinstance(value, (date, datetime)):
        return value.isoformat()[:19] if isinstance(value, datetime) else value.isoformat()
    return str(value)


# ---------------------------------------------------------------------------
# Evaluator
# ---------------------------------------------------------------------------

def _eval(node, row: dict, today: date):
    kind = node[0]
    if kind == "num":
        return Decimal(node[1])
    if kind == "str":
        return node[1]
    if kind == "bool":
        return node[1]
    if kind == "null":
        return None
    if kind == "col":
        return row.get(node[1])
    if kind == "neg":
        value = _eval(node[1], row, today)
        if is_blank(value):
            return None
        return -_num(value, "cannot negate text")
    if kind == "not":
        return not truthy(_eval(node[1], row, today))
    if kind == "and":
        return truthy(_eval(node[1], row, today)) and truthy(_eval(node[2], row, today))
    if kind == "or":
        return truthy(_eval(node[1], row, today)) or truthy(_eval(node[2], row, today))
    if kind == "cmp":
        return _compare(node[1], _eval(node[2], row, today), _eval(node[3], row, today))
    if kind == "bin":
        op = node[1]
        left = _eval(node[2], row, today)
        right = _eval(node[3], row, today)
        if is_blank(left) or is_blank(right):
            return None
        a, b = _num(left), _num(right)
        if op == "+":
            return a + b
        if op == "-":
            return a - b
        if op == "*":
            return a * b
        if op == "/":
            if b == 0:
                raise FormulaError("Division by zero.", code="DIV0")
            return a / b
        if op == "%":  # percent of
            if b == 0:
                raise FormulaError("Division by zero in percentage.", code="DIV0")
            return (a / b) * Decimal(100)
        if op == "^":
            try:
                return a ** b
            except Exception as exc:  # Decimal overflow etc.
                raise FormulaError("Power calculation failed.", code="NUM") from exc
        raise FormulaError(f"Unknown operator {op!r}.", code="PARSE")
    if kind == "call":
        return _eval_call(node[1], node[2], row, today)
    raise FormulaError("Invalid formula.", code="PARSE")


def _arity(name: str, args, minimum: int, maximum: int | None = None):
    if len(args) < minimum or (maximum is not None and len(args) > maximum):
        expected = f"at least {minimum}" if maximum is None else f"{minimum}" if minimum == maximum else f"{minimum} to {maximum}"
        raise FormulaError(f"{name} needs {expected} value(s), got {len(args)}.", code="ARITY")


def _eval_call(name: str, args, row: dict, today: date):
    # Lazy functions first (IF/IFS/IFERROR/COALESCE/AND/OR must not evaluate
    # every branch — a dead branch may legitimately divide by zero).
    if name == "IF":
        _arity(name, args, 2, 3)
        if truthy(_eval(args[0], row, today)):
            return _eval(args[1], row, today)
        return _eval(args[2], row, today) if len(args) == 3 else None
    if name == "IFS":
        _arity(name, args, 2)
        index = 0
        while index + 1 < len(args):
            if truthy(_eval(args[index], row, today)):
                return _eval(args[index + 1], row, today)
            index += 2
        if index < len(args):  # trailing default
            return _eval(args[index], row, today)
        return None
    if name == "IFERROR":
        _arity(name, args, 2, 2)
        try:
            return _eval(args[0], row, today)
        except FormulaError:
            return _eval(args[1], row, today)
    if name in ("COALESCE", "IFNULL"):
        _arity(name, args, 1)
        for arg in args:
            value = _eval(arg, row, today)
            if not is_blank(value):
                return value
        return None
    if name == "AND":
        _arity(name, args, 1)
        return all(truthy(_eval(arg, row, today)) for arg in args)
    if name == "OR":
        _arity(name, args, 1)
        return any(truthy(_eval(arg, row, today)) for arg in args)
    if name == "NOT":
        _arity(name, args, 1, 1)
        return not truthy(_eval(args[0], row, today))
    if name in ("ISBLANK", "ISNULL"):
        _arity(name, args, 1, 1)
        return is_blank(_eval(args[0], row, today))
    if name == "TODAY":
        _arity(name, args, 0, 0)
        return today

    values = [_eval(arg, row, today) for arg in args]

    if name == "ABS":
        _arity(name, args, 1, 1)
        return None if is_blank(values[0]) else abs(_num(values[0]))
    if name == "ROUND":
        _arity(name, args, 1, 2)
        if is_blank(values[0]):
            return None
        places = int(_num(values[1])) if len(values) == 2 and not is_blank(values[1]) else 0
        quantum = Decimal(1).scaleb(-places)
        return _num(values[0]).quantize(quantum)
    if name in ("SUM", "AVG", "AVERAGE", "MIN", "MAX", "COUNT"):
        _arity(name, args, 1)
        numbers = [n for v in values if (n := to_decimal(v)) is not None]
        if name == "COUNT":
            return Decimal(sum(1 for v in values if not is_blank(v)))
        if not numbers:
            return None
        if name == "SUM":
            return sum(numbers, Decimal(0))
        if name in ("AVG", "AVERAGE"):
            return sum(numbers, Decimal(0)) / Decimal(len(numbers))
        if name == "MIN":
            return min(numbers)
        return max(numbers)
    if name == "MOD":
        _arity(name, args, 2, 2)
        if is_blank(values[0]) or is_blank(values[1]):
            return None
        divisor = _num(values[1])
        if divisor == 0:
            raise FormulaError("Division by zero in MOD.", code="DIV0")
        return _num(values[0]) % divisor
    if name == "PCT":
        _arity(name, args, 2, 2)
        if is_blank(values[0]) or is_blank(values[1]):
            return None
        whole = _num(values[1])
        if whole == 0:
            raise FormulaError("Division by zero in percentage.", code="DIV0")
        return (_num(values[0]) / whole) * Decimal(100)
    if name == "CONCAT":
        _arity(name, args, 1)
        return "".join(_text_of(v) for v in values)
    if name == "UPPER":
        _arity(name, args, 1, 1)
        return _text_of(values[0]).upper()
    if name == "LOWER":
        _arity(name, args, 1, 1)
        return _text_of(values[0]).lower()
    if name == "TRIM":
        _arity(name, args, 1, 1)
        return _text_of(values[0]).strip()
    if name == "LEN":
        _arity(name, args, 1, 1)
        return Decimal(len(_text_of(values[0])))
    if name == "LEFT":
        _arity(name, args, 2, 2)
        return _text_of(values[0])[: int(_num(values[1]))]
    if name == "RIGHT":
        _arity(name, args, 2, 2)
        count = int(_num(values[1]))
        return _text_of(values[0])[-count:] if count > 0 else ""
    if name in ("YEAR", "MONTH", "DAY"):
        _arity(name, args, 1, 1)
        parsed = _to_date(values[0])
        if parsed is None:
            return None
        return Decimal(getattr(parsed, name.lower()))
    if name == "DATEDIFF":
        _arity(name, args, 2, 2)
        later, earlier = _to_date(values[0]), _to_date(values[1])
        if later is None or earlier is None:
            return None
        return Decimal((later - earlier).days)
    raise FormulaError(f"Unknown function {name}(…).", code="NAME")


def evaluate(node, row: dict, today: date | None = None):
    """Evaluate a parsed formula against one row dict (column key -> value)."""
    return _eval(node, row or {}, today or date.today())


def validate_formula(text: str, known_columns: set[str] | None = None) -> dict:
    """Parse + reference-check a formula. Returns a JSON-friendly verdict."""
    try:
        node = parse_formula(text)
    except FormulaError as exc:
        return {"valid": False, "error": str(exc), "code": exc.code, "position": exc.position, "referenced_columns": []}
    refs = sorted(referenced_columns(node))
    if known_columns is not None:
        unknown = [ref for ref in refs if ref not in known_columns]
        if unknown:
            return {
                "valid": False,
                "error": "Unknown column(s): " + ", ".join(f"[{u}]" for u in unknown),
                "code": "NAME",
                "position": None,
                "referenced_columns": refs,
            }
    return {"valid": True, "error": None, "code": None, "position": None, "referenced_columns": refs}


def to_json_value(value):
    """Convert an evaluated cell value to a JSON-safe primitive."""
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return value
