// End-to-end smoke test that drives three real browser sessions (Alice, Bob, Carol)
// through the main flows. Run against a fresh local server:
//   rm -rf .data && npm run build && npm start   (in one terminal)
//   npm run e2e                                    (in another)
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import path from 'node:path'

const BASE = process.env.BASE_URL ?? 'http://localhost:3000'
const shots = process.argv[2] ?? 'e2e/screenshots'
const sampleFile = process.argv[3] ?? path.join(import.meta.dirname, 'sample.md')
mkdirSync(shots, { recursive: true })
const browser = await chromium.launch()
const errors = []
async function toEnd(page) {
  await page.locator('.prose > *:last-child').click()
  await page.keyboard.press('Control+End'); await page.keyboard.press('End')
}
async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${email}: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && errors.push(`${email} console: ${m.text()}`))
  await page.goto(BASE + '/login')
  await page.fill('input[type=email]', email)
  await page.fill('input[type=password]', 'demo1234')
  await page.click('button:has-text("Sign in")')
  await page.waitForURL(BASE + '/')
  return page
}
const log = (...a) => console.log('✔', ...a)

const alice = await session('alice@ajaia.dev')
await alice.screenshot({ path: `${shots}/01-dashboard.png` })
log('alice dashboard: owned', await alice.locator('.doc-section').nth(0).locator('.doc-row').count(), 'shared', await alice.locator('.doc-section').nth(1).locator('.doc-row').count())

// Create + rename + format
await alice.click('text=+ New document')
await alice.waitForURL(/\/docs\//)
const docUrl = alice.url().replace(/\?.*/, '')
await alice.locator('.title-input').fill('Launch Brief')
await alice.keyboard.press('Enter')
await alice.keyboard.type('Overview')
await alice.locator('.tb-select').selectOption('h1')
await alice.keyboard.press('End'); await alice.keyboard.press('Enter')
await alice.click('[aria-label="Bold (Ctrl+B)"]'); await alice.keyboard.type('Bold start')
await alice.click('[aria-label="Bold (Ctrl+B)"]'); await alice.keyboard.press('Enter')
await alice.click('[aria-label="Underline (Ctrl+U)"]'); await alice.keyboard.type('underlined'); await alice.click('[aria-label="Underline (Ctrl+U)"]')
await alice.keyboard.press('Enter')
await alice.click('[aria-label="Bulleted list"]'); await alice.keyboard.type('point one'); await alice.keyboard.press('Enter'); await alice.keyboard.type('point two')
await alice.waitForSelector('text=All changes saved', { timeout: 5000 })
await alice.screenshot({ path: `${shots}/02-editor.png` })
log('created + formatted + saved')

// Reopen
await alice.reload()
const html = await alice.locator('.prose').innerHTML()
if (!html.includes('<h1>Overview</h1>') || !html.includes('<strong>Bold start</strong>') || !html.includes('<u>underlined</u>') || !html.includes('<ul>')) throw new Error('formatting lost: ' + html)
if ((await alice.locator('.title-input').inputValue()) !== 'Launch Brief') throw new Error('title lost')
log('reload preserves title + formatting')

// Share with Bob as editor, Carol as viewer
await alice.click('button:has-text("Share")')
await alice.fill('.share-form input', 'bob@ajaia.dev'); await alice.click('.share-form button')
await alice.waitForSelector('.share-list >> text=Bob Patel')
await alice.fill('.share-form input', 'carol@ajaia.dev'); await alice.locator('.share-form select').selectOption('viewer'); await alice.click('.share-form button')
await alice.waitForSelector('.share-list >> text=Carol Diaz')
await alice.fill('.share-form input', 'ghost@ajaia.dev'); await alice.click('.share-form button')
await alice.waitForSelector('.modal .error')
log('share error shown:', await alice.locator('.modal .error').innerText())
await alice.screenshot({ path: `${shots}/03-share.png` })
await alice.keyboard.press('Escape')
await alice.waitForSelector('.modal', { state: 'detached' })

// Bob sees it in Shared with me, and live sync from Alice
const bob = await session('bob@ajaia.dev')
const sharedRow = bob.locator('.doc-section').nth(1).locator('.doc-row', { hasText: 'Launch Brief' })
log('bob sees shared doc with badge:', await sharedRow.locator('.badge').first().innerText())
await bob.goto(docUrl)
await toEnd(alice); await alice.keyboard.press('Enter'); await alice.keyboard.type('live from alice')
await bob.waitForSelector('.prose >> text=live from alice', { timeout: 15000 })
log('bob received alice edit live')
await toEnd(bob); await bob.keyboard.type(' and bob')
await alice.waitForSelector('.prose >> text=and bob', { timeout: 15000 })
log('alice received bob edit live')

// Carol: viewer, read-only
const carol = await session('carol@ajaia.dev')
await carol.goto(docUrl)
const editable = await carol.locator('.prose').getAttribute('contenteditable')
log('carol contenteditable =', editable, '| banner:', await carol.locator('.banner').first().innerText())
await carol.screenshot({ path: `${shots}/04-viewer.png` })

// Conflict: make bob dirty but force a stale version by blocking his autosave via offline
await bob.context().setOffline(true)
await toEnd(bob); await bob.keyboard.type(' offline-edit')
await toEnd(alice); await alice.keyboard.type(' alice-wins')
await alice.waitForSelector('text=All changes saved')
await bob.context().setOffline(false)
await bob.waitForSelector('.banner-warn', { timeout: 20000 })
log('conflict banner:', (await bob.locator('.banner-warn').innerText()).replace(/\n/g, ' '))
await bob.screenshot({ path: `${shots}/05-conflict.png` })
await bob.click('text=Keep mine (overwrite)')
await bob.waitForSelector('text=All changes saved', { timeout: 10000 })
await alice.waitForSelector('.prose >> text=offline-edit', { timeout: 15000 })
log('conflict resolved via keep mine; alice synced')

// Upload
await alice.goto(BASE + '/')
await alice.setInputFiles('input[type=file]', sampleFile)
await alice.waitForURL(/\/docs\//)
await alice.waitForSelector('.prose h1')
log('import -> title', await alice.locator('.title-input').inputValue(), '| h1', await alice.locator('.prose h1').innerText())
await alice.screenshot({ path: `${shots}/06-imported.png` })

// Revoke carol, she loses access
await alice.goto(docUrl)
await alice.click('button:has-text("Share")')
await alice.locator('.share-list li', { hasText: 'Carol' }).locator('button:has-text("Remove")').click()
await alice.waitForFunction(() => !document.querySelector('.share-list')?.textContent?.includes('Carol'))
await carol.waitForSelector('text=You no longer have access', { timeout: 15000 })
log('carol access revoked live')

const unexpected = errors.filter((e) => !/40[49]|ERR_INTERNET_DISCONNECTED/.test(e)) // 404/409/offline are provoked on purpose
if (unexpected.length) { console.error('Unexpected browser errors:', unexpected); process.exitCode = 1 }
console.log('All e2e checks passed.')
await browser.close()
