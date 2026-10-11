import { defineConfig } from 'vite';

// The dev server is reached through an arbitrary preview hostname
// (https://<port>-<sandbox>.e2b.app), so host checking must be permissive.
export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: false,
    allowedHosts: true,
    cors: true,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
