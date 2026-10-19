import { defineConfig } from 'vite';

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
    // `hmr: false` instead.
    hmr: { clientPort: 443 },
  },
});
