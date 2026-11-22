"""Cloze answer leak check; the tokenizer mirrors tokenize in apps/api/src/grading/cloze.ts."""

import re

_WHITESPACE = frozenset(
    "\t\n\v\f\r \xa0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009"
    "\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
)
_IDENT_OR_NUMBER = re.compile(r"[A-Za-z_$][A-Za-z0-9_$]*|[0-9][A-Za-z0-9_.]*")
_QUOTES = frozenset("\"'`")
_DIGITS = frozenset("0123456789")
_ASCII_UPPER = {c: c + 32 for c in range(ord("A"), ord("Z") + 1)}


def scan_tokens(src: str) -> tuple[list[str], list[str]]:
    """Return the grader's tokens of `src` and the texts nested inside its comments and quotes."""
    tokens: list[str] = []
    nested: list[str] = []
    i = 0
    while i < len(src):
        c = src[i]
        line_start = src.rfind("\n", 0, i) + 1
        line_indent = src[line_start:i]
        if (src.startswith("```", i) or src.startswith("~~~", i)) and re.fullmatch(
            r" {0,3}", line_indent
        ):
            marker = src[i : i + 3]
            close = src.find(f"\n{marker}", i + 3)
            end = len(src) if close == -1 else close
            nested.append(src[i + 3 : end])
            i = len(src) if close == -1 else end + 4
        elif c in _WHITESPACE:
            i += 1
        elif src.startswith("//", i):
            nl = src.find("\n", i)
            end = len(src) if nl == -1 else nl
            nested.append(src[i + 2 : end])
            i = end
        elif src.startswith("/*", i):
            close = src.find("*/", i + 2)
            nested.append(src[i + 2 : len(src) if close == -1 else close])
            i = len(src) if close == -1 else close + 2
        elif c in _QUOTES and not (
            c == "'" and i > 0 and (src[i - 1].isalnum() or src[i - 1] in "_$")
        ):
            j = i + 1
            while j < len(src) and src[j] != c:
                j += 2 if src[j] == "\\" else 1
            tokens.append(src[i : j + 1])
            nested.append(src[i + 1 : min(j, len(src))])
            i = j + 1
        else:
            m = _IDENT_OR_NUMBER.match(src, i)
            tokens.append(m.group(0) if m else c)
            i += len(m.group(0)) if m else 1
    return tokens, nested


def _fold(tokens: list[str]) -> list[str]:
    return [t if t[:1] in "\"'`" else t.translate(_ASCII_UPPER) for t in tokens]


def _same_token(token: str, wanted: str, prose: bool) -> bool:
    return token == wanted or (
        prose and token[:1] in _DIGITS and token.endswith(".") and token.rstrip(".") == wanted
    )


def _has_run(tokens: list[str], run: list[str], prose: bool) -> bool:
    return any(
        all(_same_token(t, w, prose) for t, w in zip(tokens[i : i + len(run)], run, strict=True))
        for i in range(len(tokens) - len(run) + 1)
    )


def contains_answer(text: str, answer: str, prose: bool = True) -> bool:
    """Whether `text` gives `answer` away; kept in step with containsAnswer in answer-leak.ts."""
    answer_tokens = scan_tokens(answer)[0]
    run = _fold(answer_tokens) if prose else answer_tokens
    if not run:
        return False
    pending = [(text, prose)]
    while pending:
        src, prose = pending.pop()
        tokens, nested = scan_tokens(src)
        if _has_run(_fold(tokens) if prose else tokens, run, prose):
            return True
        pending.extend((nested_src, False) for nested_src in nested)
    return False
