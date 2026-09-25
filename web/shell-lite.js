import { Bash } from '/vendor/just-bash.js';
import { shellQuote } from './workshop-runtime.js';
export async function createLiteShell({ terminal, source, model = 'claude-large', complete, status, ready }) {
  const bash = new Bash({ files: { '/home/user/shprout': source }, cwd: '/home/user',
    env: { OPENAI_API_KEY: 'managed-by-browser', MODEL: model, OPENAI_BASE_URL: 'https://gen.pollinations.ai/v1',
      SHPROUT_RUNTIME: 'just-bash 3.4.2 in this browser: virtual files and supported shell commands; no native Linux binaries. Output is a terminal. No DOM.' },
    fetch: complete, executionLimits: { maxCommandCount: 20000, maxLoopIterations: 20000 },
  });
  let line = '', active = null;
  const prompt = () => { terminal.write('\r\n\x1b[32mshprout\x1b[0m $ '); ready(); };
  const execute = async (command, env) => {
    if (active) return;
    active = new AbortController(); status('Running in just-bash');
    const timer = setTimeout(() => active?.abort(), 90000);
    try {
      const r = await bash.exec(command, { signal: active.signal, env });
      terminal.write(r.stdout); terminal.write(r.stderr);
      if (r.exitCode) terminal.writeln(`\r\n[exit ${r.exitCode}]`);
    } finally { clearTimeout(timer); active = null; prompt(); }
  };
  terminal.writeln('just-bash · browser-only shell subset; output is returned when a command ends.'); prompt();
  return {
    input(text) {
      for (const char of text) {
        if (char === '\x03') { active?.abort(); line = ''; terminal.write('^C'); if (!active) prompt(); }
        else if (!active && char === '\r') { const cmd = line; line = ''; terminal.write('\r\n'); void execute(cmd).catch(error => terminal.writeln(error.message)); }
        else if (!active && char === '\x7f') { if (line) { line = line.slice(0, -1); terminal.write('\b \b'); } }
        else if (!active && char >= ' ') { line += char; terminal.write(char); }
      }
    },
    setSource: text => bash.writeFile('/home/user/shprout', text),
    run: (task, { model: selectedModel = model } = {}) => { terminal.writeln(`bash shprout ${shellQuote(task)}`); return execute(`bash /home/user/shprout ${shellQuote(task)}`, { MODEL: selectedModel }); },
    resize() {}, stop() { active?.abort(); },
  };
}
