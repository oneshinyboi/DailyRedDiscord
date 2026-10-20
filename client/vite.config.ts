import { statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// VITE_DEV_AUTH is set by `npm run dev:client:local`, which opens the app
// directly in a browser rather than through Discord's reverse proxy.
const localDev = process.env.VITE_DEV_AUTH === '1';

// Discord's activity proxy overwrites Cache-Control on static-looking URLs
// (.css, .png, ...) with `public, max-age=14400`. Vite serves CSS imports at
// bare URLs like /src/App.css, so after a dev-server restart (which resets its
// `?t=` timestamps) Discord keeps serving a stale stylesheet for up to 4 hours.
// Version project CSS imports by mtime so the URL changes with the content.
function versionCssImports(): Plugin {
  const cssImport = /(\bimport\s+|\bfrom\s+)(["'])(\.{1,2}\/[^"'?]+\.css)\2/g;
  return {
    name: 'version-css-imports',
    apply: 'serve',
    enforce: 'post',
    transform(code, id) {
      if (id.includes('/node_modules/') || !/\.[cm]?[jt]sx?$/.test(id.split('?')[0])) {
        return null;
      }
      let changed = false;
      const out = code.replace(cssImport, (match, kw: string, quote: string, spec: string) => {
        try {
          const mtime = Math.floor(statSync(resolve(dirname(id.split('?')[0]), spec)).mtimeMs);
          changed = true;
          return `${kw}${quote}${spec}?v=${mtime}${quote}`;
        } catch {
          return match;
        }
      });
      return changed ? { code: out, map: null } : null;
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  envDir: '../',
  plugins: [versionCssImports()],
  server: {
    // Served to Discord via the reverse proxy, which forwards to this
    // machine's LAN IP. Vite only listens on loopback by default, so bind
    // all interfaces for the proxy.
    host: '0.0.0.0',
    // The proxy keeps the public Host header; Vite blocks unknown hosts by
    // default (403 on the whole document -> blank page).
    allowedHosts: ['.veryshiny.net', '.discordsays.com'],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        ws: true,
      },
    },
    // HMR runs over the reverse proxy, so the client connects on port 443.
    // Requires the proxy to forward WebSocket upgrades. If it can't, use
    // `hmr: false` instead. Direct browser dev uses Vite's normal HMR.
    hmr: localDev ? undefined : { clientPort: 443 },
  },
});
