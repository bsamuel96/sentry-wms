import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const mobileDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const rawBasePath = option('--base-path', '/');
const basePath = rawBasePath === '/' ? '' : `/${rawBasePath.replace(/^\/+|\/+$/g, '')}`;
const outputDir = path.resolve(mobileDir, option('--output-dir', 'dist-pwa'));
const publicDir = path.join(mobileDir, 'public');

await rm(outputDir, { recursive: true, force: true });

const executable = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const result = spawnSync(
  executable,
  ['expo', 'export', '--platform', 'web', '--output-dir', outputDir],
  { cwd: mobileDir, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } },
);
if (result.status !== 0) process.exit(result.status ?? 1);

await mkdir(outputDir, { recursive: true });
await cp(publicDir, outputDir, { recursive: true, force: true });

const manifestPath = path.join(outputDir, 'manifest.webmanifest');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.id = `${basePath || ''}/`;
manifest.start_url = `${basePath || ''}/`;
manifest.scope = `${basePath || ''}/`;
manifest.icons = manifest.icons.map((icon) => ({
  ...icon,
  src: `${basePath}${icon.src}`,
}));
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

const indexPath = path.join(outputDir, 'index.html');
let html = await readFile(indexPath, 'utf8');
html = html
  .replace('<html lang="en">', '<html lang="ro">')
  .replaceAll('href="/favicon.ico"', `href="${basePath}/favicon.ico"`)
  .replaceAll('src="/_expo/', `src="${basePath}/_expo/`)
  .replace(
    '<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover" />',
  )
  .replace(
    '</head>',
    `    <meta name="theme-color" content="#0b63d6" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="Sentry WMS" />
    <link rel="manifest" href="${basePath}/manifest.webmanifest" />
    <link rel="apple-touch-icon" href="${basePath}/icons/sentry-192.png" />
    <link rel="stylesheet" href="${basePath}/pwa.css" />
    <script>
      window.addEventListener('beforeinstallprompt', function (event) {
        event.preventDefault();
        window.__sentryPwaInstallPrompt = event;
        window.dispatchEvent(new Event('sentry-pwa-install-ready'));
      });
      if ('serviceWorker' in navigator) {
        window.addEventListener('load', function () {
          navigator.serviceWorker.register('${basePath}/sw.js', { scope: '${basePath || '/'}/' }).catch(function () {});
        });
      }
    </script>
  </head>`,
  );
await writeFile(indexPath, html);

console.log(`PWA exported to ${path.relative(mobileDir, outputDir)}`);
