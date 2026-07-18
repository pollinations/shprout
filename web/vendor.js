import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const zlibPath = fileURLToPath(new URL('./zlib-browser.js', import.meta.url));

export async function buildJustBashBundle() {
  const result = await build({
    bundle: true,
    format: 'esm',
    legalComments: 'none',
    minify: true,
    platform: 'browser',
    plugins: [{
      name: 'browser-zlib',
      setup(builder) {
        builder.onResolve({ filter: /^node:zlib$/ }, () => ({ path: zlibPath }));
      },
    }],
    stdin: {
      contents: "export { Bash } from 'just-bash/browser';",
      loader: 'js',
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      sourcefile: 'just-bash-entry.js',
    },
    target: 'es2022',
    treeShaking: true,
    write: false,
  });

  return result.outputFiles[0].contents;
}
