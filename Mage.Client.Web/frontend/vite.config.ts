import { execSync } from 'child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

function gitShortHash(): string {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim()
  } catch {
    return 'dev'
  }
}

interface ChangelogEntry {
  hash: string
  date: string
  msg: string
}

function buildChangelog(): ChangelogEntry[] {
  try {
    // Use separate git log calls to avoid shell quoting issues with format strings
    const hashes = execSync('git log --format=%h -40').toString().trim().split('\n')
    const dates = execSync('git log --format=%ad --date=format:%Y-%m-%d -40').toString().trim().split('\n')
    const msgs = execSync('git log --format=%s -40').toString().trim().split('\n')
    return hashes.flatMap((hash, i) => {
      const date = dates[i] ?? ''
      const msg = msgs[i] ?? ''
      if (!hash || !date || !msg) return []
      // Skip merge commits
      if (msg.startsWith('Merge pull request')) return []
      return [{ hash, date, msg }]
    })
  } catch {
    return []
  }
}

// The build outputs straight into the gateway's static dir, so
// `mvn -Pweb-client exec:java` serves the latest UI. In dev, run `npm run dev`
// and Vite proxies the gateway's API + WebSocket on :8090.
export default defineConfig({
  define: {
    __APP_COMMIT__: JSON.stringify(gitShortHash()),
    __APP_CHANGELOG__: JSON.stringify(buildChangelog()),
  },
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
