"""shprout as a terminal-bench (harbor) installed agent.

Registers the ~900-byte self-prompting bash script as a first-class agent so
any shprout variant — the reference or a decompressed candidate from the
compression search — can be scored on terminal-bench@2.1 unchanged.

Usage (from the repo root; registry currently serves terminal-bench@2.0):
    harbor run -d terminal-bench@2.0 -a bench.shprout_agent:ShproutAgent \
        -i fix-git -n 2
    harbor run -d terminal-bench-sample@2.0 -a bench.shprout_agent:ShproutAgent

Which script and endpoint get used:
    SHPROUT_SCRIPT   host path to the agent script (default: repo ./shprout)
    EVAL_BASE_URL / EVAL_API_KEY / EVAL_RUNTIME_MODEL override the endpoint;
    otherwise compress/provider.py resolution applies (pollinations -> github).
"""
from __future__ import annotations
import hashlib, os, shlex, sys
from typing import override

from harbor.agents.installed.base import BaseInstalledAgent, with_prompt_template
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

_HERE = os.path.dirname(os.path.abspath(__file__))
_REPO = os.path.dirname(_HERE)
sys.path.insert(0, os.path.join(_REPO, "compress"))
from provider import resolve  # noqa: E402

INSTALL_TOOLS = """\
if command -v curl >/dev/null && command -v jq >/dev/null; then exit 0; fi
if command -v apt-get >/dev/null; then
  # corrupted cached lists (e.g. truncated by a full disk) break apt-get update;
  # clearing them and retrying recovers
  apt-get update -qq || { rm -rf /var/lib/apt/lists/*; apt-get update -qq; }
  apt-get install -y -qq curl jq ca-certificates;
elif command -v apk >/dev/null; then apk add --no-cache curl jq ca-certificates;
elif command -v yum >/dev/null; then yum install -y -q curl jq ca-certificates;
else echo "no known package manager" >&2; exit 1; fi
"""


class ShproutAgent(BaseInstalledAgent):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        script_path = os.environ.get("SHPROUT_SCRIPT", os.path.join(_REPO, "shprout"))
        self._script = open(script_path).read()
        digest = hashlib.sha256(self._script.encode()).hexdigest()[:8]
        self._version = f"{len(self._script)}B-{digest}"

    @staticmethod
    def name() -> str:
        return "shprout"

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        await self.exec_as_root(environment, INSTALL_TOOLS)
        # Heredoc with a quoted delimiter: no expansion, script lands verbatim.
        await self.exec_as_root(
            environment,
            "cat > /installed-agent/shprout <<'SHPROUT_EOF'\n"
            + self._script
            + "\nSHPROUT_EOF\nchmod 755 /installed-agent/shprout",
        )

    @with_prompt_template
    async def run(self, instruction: str, environment: BaseEnvironment,
                  context: AgentContext) -> None:
        p = resolve()
        model = os.environ.get("EVAL_RUNTIME_MODEL", p["runtime"])
        await self.exec_as_agent(
            environment,
            f"bash /installed-agent/shprout {shlex.quote(instruction)}",
            env={
                "OPENAI_API_KEY": p["key"],
                "OPENAI_BASE_URL": p["base"],
                "OPENAI_API_BASE": p["base"],  # some SDK conventions read this name
                "MODEL": model,
            },
        )
