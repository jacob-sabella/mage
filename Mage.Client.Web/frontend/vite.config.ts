import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The build outputs straight into the gateway's static dir, so
// `mvn -Pweb-client exec:java` serves the latest UI. In dev, run `npm run dev`
// and Vite proxies the gateway's API + WebSocket on :8090.
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../src/main/resources/web',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8090',
      '/ws': { target: 'ws://localhost:8090', ws: true },
    },
  },
})
