"""Micro-bench task suite: small, deterministic, offline-checkable agent tasks.

Each task gives the agent a purpose string and verifies the outcome
programmatically — no LLM judge. Tasks run in a fresh temp workdir under the
Seatbelt sandbox, so file-creation checks are safe and hermetic.

Design constraints:
  - solvable by a mid-tier runtime model in 1-3 turns (fast + cheap)
  - checkable from (workdir, stdout) alone, deterministically
  - collectively cover: compute+print, file write, multi-step composition,
    pipe usage, and error recovery — the behaviors that make an agent loop
    an agent loop.
"""
from __future__ import annotations
import os
from dataclasses import dataclass, field
from typing import Callable


@dataclass
class Task:
    name: str
    purpose: str
    check: Callable[[str, str], bool]  # (workdir, stdout) -> passed
    timeout: int = 90


def _file_is(workdir: str, rel: str, want: str) -> bool:
    p = os.path.join(workdir, rel)
    try:
        return open(p).read().strip() == want
    except OSError:
        return False


def _file_has_all(workdir: str, rel: str, needles: list[str]) -> bool:
    p = os.path.join(workdir, rel)
    try:
        text = open(p).read()
    except OSError:
        return False
    return all(n in text for n in needles)


TASKS: list[Task] = [
    Task(
        name="hash8",
        purpose=(
            "Print the first 8 hex chars of the sha256 of the exact string shprout "
            "with no trailing newline — use printf %s shprout | shasum -a 256. "
            "Then say exit."
        ),
        check=lambda wd, out: "f017597f" in out,
    ),
    Task(
        name="mkfile",
        purpose=(
            "Create a file named hello.txt in the current directory containing "
            "exactly the text: hello shprout. Then say exit."
        ),
        check=lambda wd, out: _file_is(wd, "hello.txt", "hello shprout"),
    ),
    Task(
        name="arith",
        purpose=(
            "Use a bash command to compute 1234*5678 and print the result. Then say exit."
        ),
        check=lambda wd, out: "7006652" in out,
    ),
    Task(
        name="grepcount",
        purpose=(
            "Using seq and grep, print how many integers from 1 to 999 contain "
            "the digit 7. Print just the number. Then say exit."
        ),
        check=lambda wd, out: "271" in out,
    ),
    Task(
        name="multistep",
        purpose=(
            "Create a directory named out. Write out/a.txt containing the word alpha "
            "and out/b.txt containing the word beta. Concatenate both files into "
            "out/ab.txt. Then say exit."
        ),
        check=lambda wd, out: _file_has_all(wd, "out/ab.txt", ["alpha", "beta"]),
    ),
    Task(
        name="recover",
        purpose=(
            "Run the command frobnicate99 --go (it does not exist). Observe the "
            "error, then print the single word RECOVERED and say exit."
        ),
        check=lambda wd, out: "RECOVERED" in out,
    ),
]


if __name__ == "__main__":
    for t in TASKS:
        print(f"{t.name:<10} {t.purpose[:80]}")
