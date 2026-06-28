// Records a small video of every Playwright test and packages them into the app
// as a viewable gallery: runs the suite with CLIPS=1 (video on), then copies each
// test's webm into public/test-clips/ with a manifest the secret in-app menu reads.
//
//   node scripts/build-clips.mjs
//
// The clips are committed (like the built assets) so they ship in the image.
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, copyFileSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = resolve(root, 'public/test-clips')
const reportFile = resolve(root, 'clips-report.json')

function slug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
}

// 1. run the suite once with video recording (CLIPS=1) + json report
console.log('▶ recording test videos (CLIPS=1)…')
try {
  execSync('npx playwright test --project=chromium --reporter=json', {
    cwd: root,
    stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, CLIPS: '1', PLAYWRIGHT_JSON_OUTPUT_NAME: reportFile },
    shell: true,
  })
} catch {
  // a failing test still produces a video + report; keep going
  console.warn('⚠ some tests failed — packaging whatever clips exist')
}
if (!existsSync(reportFile)) {
  console.error('✗ no report produced — aborting')
  process.exit(1)
}

const report = JSON.parse(readFileSync(reportFile, 'utf8'))

// 2. walk the suite tree collecting (title, file, video path, status)
const clips = []
function walk(suite, fileHint) {
  const file = suite.file || fileHint
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      for (const res of test.results ?? []) {
        const vid = (res.attachments ?? []).find((a) => a.name === 'video' && a.path)
        if (vid) {
          clips.push({ title: spec.title, file: (spec.file || file || '').replace(/^.*tests[\\/]/, ''), video: vid.path, ok: res.status === 'passed' })
        }
      }
    }
  }
  for (const child of suite.suites ?? []) walk(child, file)
}
for (const s of report.suites ?? []) walk(s, undefined)

// 3. copy each video into public/test-clips/ + write the manifest
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
const manifest = []
const seen = new Map()
for (const c of clips) {
  if (!existsSync(c.video)) continue
  let base = slug(c.title)
  const n = (seen.get(base) ?? 0) + 1
  seen.set(base, n)
  const fileName = `${n > 1 ? `${base}-${n}` : base}.webm`
  copyFileSync(c.video, resolve(outDir, fileName))
  manifest.push({ title: c.title, spec: c.file, file: fileName, ok: c.ok })
}
manifest.sort((a, b) => a.spec.localeCompare(b.spec) || a.title.localeCompare(b.title))
writeFileSync(resolve(outDir, 'manifest.json'), JSON.stringify({ clips: manifest }, null, 2))
rmSync(reportFile, { force: true })
console.log(`✓ packaged ${manifest.length} test clips → public/test-clips/`)
