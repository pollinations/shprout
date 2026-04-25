"""Deterministic reconstruction scorer.

The compressor's job: emit a prompt that makes the gen reproduce REAL_SHPROUT
*exactly*, modulo whitespace and internal variable names.

normalize() strips noise that doesn't matter at runtime:
  - shebang line
  - full-line and trailing comments (# ...)
  - all whitespace collapsed to single space
  - internal $vars renamed to $V (anything not in PRESERVE_VARS)

PRESERVE_VARS stay literal because the runtime contract depends on them:
  $OPENAI_API_KEY, $MODEL, $OPENAI_BASE_URL, $0, $1, $i, $@, $*, $?, $#

Score = 1 - levenshtein(normalize(candidate), normalize(REAL_SHPROUT))
            / max(len(both)).
"""
from __future__ import annotations
import os, re

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHPROUT_PATH = os.path.join(REPO_ROOT, "shprout")
with open(SHPROUT_PATH) as f:
    REAL_SHPROUT = f.read()

PRESERVE_VARS = {
    "OPENAI_API_KEY", "MODEL", "OPENAI_BASE_URL",
    "0", "1", "2", "3", "@", "*", "?", "#", "!", "-",
}

_VAR_RE = re.compile(r"\$\{?([A-Za-z_][A-Za-z0-9_]*|[0-9@*?#!\-])\}?")
_ASSIGN_RE = re.compile(r"(?m)(?:^|[\s;&|`(])([A-Za-z_][A-Za-z0-9_]*)\+?=")
_COMMENT_RE = re.compile(r"(?m)(?:^|\s)#[^\n]*")
_SHEBANG_RE = re.compile(r"^#!.*\n")
_WS_RE = re.compile(r"\s+")


def normalize(bash: str) -> str:
    s = _SHEBANG_RE.sub("", bash, count=1)
    s = _COMMENT_RE.sub(" ", s)

    def repl_var(m: re.Match) -> str:
        name = m.group(1)
        return f"${name}" if name in PRESERVE_VARS else "$V"
    s = _VAR_RE.sub(repl_var, s)

    def repl_assign(m: re.Match) -> str:
        name = m.group(1)
        if name in PRESERVE_VARS: return m.group(0)
        # Preserve the leading boundary char, swap name for V, keep += or =
        full = m.group(0)
        return full.replace(name, "V", 1)
    s = _ASSIGN_RE.sub(repl_assign, s)

    s = _WS_RE.sub(" ", s).strip()
    return s


def _levenshtein(a: str, b: str) -> int:
    if a == b: return 0
    if not a: return len(b)
    if not b: return len(a)
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        curr = [i] + [0] * len(b)
        for j, cb in enumerate(b, 1):
            curr[j] = min(
                curr[j-1] + 1,
                prev[j] + 1,
                prev[j-1] + (ca != cb),
            )
        prev = curr
    return prev[-1]


_REF_NORM = normalize(REAL_SHPROUT)


def reconstruction_score(candidate: str) -> float:
    """0..1 — 1.0 = byte-identical after normalization."""
    cand = normalize(candidate)
    if not cand: return 0.0
    dist = _levenshtein(cand, _REF_NORM)
    return max(0.0, 1.0 - dist / max(len(cand), len(_REF_NORM)))


def score_with_diff(candidate: str) -> tuple[float, str, str]:
    """Returns (score, normalized_candidate, normalized_reference)."""
    cand = normalize(candidate)
    return reconstruction_score(candidate), cand, _REF_NORM


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1:
        with open(sys.argv[1]) as f: src = f.read()
    else:
        src = REAL_SHPROUT
    score, cn, rn = score_with_diff(src)
    print(f"score: {score:.3f}")
    print(f"normalized candidate ({len(cn)}B):\n  {cn}\n")
    print(f"normalized reference ({len(rn)}B):\n  {rn}")
