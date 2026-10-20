import { defineConfig } from 'vite';

// VITE_DEV_AUTH is set by `npm run dev:client:local`, which opens the app
// directly in a browser rather than through Discord's reverse proxy.
const localDev = process.env.VITE_DEV_AUTH === '1';

// https://vitejs.dev/config/
export default defineConfig({
  envDir: '../',
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
