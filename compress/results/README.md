# compress/results — saved gen samples

Snapshots from the generator-comparison experiment. Task: SHA256("shprout") → `f017597f`. Runtime: `claude`. n=3–5 sandboxed e2e runs per config.

## Files

| file | gen model | bytes | passes e2e | notes |
|------|-----------|-------|------------|-------|
| `sample-claude-large-2596B.sh` | claude-large | 2596 | ✅ | smallest passing claude-large output (no brevity hint) |
| `sample-opus-4.7-brevity-395B.sh` | claude-opus-4.7 | 395 | ✅ | "minimal golfed bash agent (under 1KB, single-letter vars)" |
| `sample-opus-4.7-think-392B.sh` | claude-opus-4.7 | 392 | ✅ | "think carefully ... golf to under 500 bytes" |
| `show_compare.py` | — | — | — | renders the comparison dashboard via the `show` skill |
| `results.json` | — | — | — | structured run metrics |

## Headline

opus-4.7 + brevity hint produces a **395B** passing bash → 2.30× smaller than the 910B `shprout` reference. The 288B prompt + 395B bash totals **683B** vs shipping shprout (910B).

claude-large defaults to verbose enterprise bash (~2740B avg) regardless of prompt brevity. Only opus-4.7 actually golfs when asked.

## Reproduce the dashboard

```
python3 compress/results/show_compare.py | node ~/.claude/skills/show/show.js
```

(Paths inside `show_compare.py` reference `/tmp/sample_*_keep.sh` from the original run; either symlink the files in this folder or edit the paths.)
