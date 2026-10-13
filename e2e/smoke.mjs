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
// ProseMirror ignores DOM selection changes for ~50ms after it sets the selection itself (e.g. on
// focus). Real users never click-then-type that fast; pause like a human so the test isn't racing it.
const humanPause = (page) => page.waitForTimeout(120)
async function toEnd(page) {
  await page.locator('.prose > *:last-child').click()
  await humanPause(page)
  await page.keyboard.press('Control+End')
  await page.keyboard.press('End')
  await humanPause(page)
}
async function session(email) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => errors.push(`${email}: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && errors.push(`${email} console: ${m.text()}`))
  page.on('response', (r) => r.status() >= 400 && errors.push(`${email} ${r.request().method()} ${new URL(r.url()).pathname} ${r.status()}`))
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

// ---- Stretch features on the seeded "Q4 Planning Notes" doc ------------------------------
await alice.goto(BASE + '/')
await alice.click('text=Q4 Planning Notes')
await alice.waitForURL(/\/docs\//)
const q4Url = alice.url()
await alice.waitForSelector('.comment-mark') // seeded thread is highlighted in the text
log('seeded comment highlighted:', await alice.locator('.comment-mark').first().innerText())

// Role ladder: share with Carol as Commenter.
await alice.click('button:has-text("Share")')
await alice.fill('.share-form input', 'carol@ajaia.dev')
await alice.locator('.share-form select').selectOption('commenter')
await alice.click('.share-form button')
await alice.waitForSelector('.share-list >> text=Carol Diaz')
await alice.keyboard.press('Escape')
await alice.waitForSelector('.modal', { state: 'detached' })

await carol.goto(q4Url)
await carol.waitForSelector('.banner >> text=You can comment but not edit')
if ((await carol.locator('.prose').getAttribute('contenteditable')) !== 'false') throw new Error('commenter can edit')
await carol.locator('.prose li p', { hasText: 'Ship the doc editor pilot' }).click({ clickCount: 3 })
await carol.click('.tb-comment')
await carol.fill('.composer textarea', 'Which teams are in the pilot?')
await carol.click('.composer button:has-text("Comment")')
await carol.waitForSelector('.thread >> text=Which teams are in the pilot?')
log('commenter added an anchored comment:', await carol.locator('.thread', { hasText: 'Which teams' }).locator('.quote').innerText())
await carol.screenshot({ path: `${shots}/07-comments.png` })

// Alice sees it live, replies, and resolves it.
await alice.click('button:has-text("Comments")')
const carolThread = alice.locator('.thread', { hasText: 'Which teams are in the pilot?' })
await carolThread.waitFor({ timeout: 15000 })
await carolThread.click()
await carolThread.locator('.reply-form input').fill('Sales and Support')
await carolThread.locator('.reply-form button').click()
await carolThread.locator('text=Sales and Support').waitFor()
await carol.waitForSelector('.thread >> text=Sales and Support', { timeout: 15000 })
log('reply synced to commenter')
await carolThread.locator('button:has-text("Resolve")').click()
await alice.waitForSelector('text=Show 1 resolved')
log('thread resolved')

// Version history: make an edit, then restore the original from history.
await alice.click('button:has-text("Comments")') // close panel
await toEnd(alice)
await alice.keyboard.press('Enter')
await alice.keyboard.type('Temporary line to be rolled back')
await alice.waitForSelector('text=All changes saved')
const fullText = (await alice.locator('.page .prose').innerText()).trim()
if (!fullText.endsWith('Temporary line to be rolled back')) throw new Error('cursor jumped; text starts: ' + fullText.slice(0, 60))
await alice.click('button:has-text("History")')
await alice.waitForFunction(() => document.querySelectorAll('.version-row').length >= 2)
await alice.screenshot({ path: `${shots}/08-history.png` })
await alice.locator('.version-row').last().click()
await alice.waitForSelector('.version-preview .prose')
await alice.click('button:has-text("Restore this version")')
await alice.waitForSelector('text=Version restored')
if (await alice.locator('.page .prose >> text=Temporary line to be rolled back').count()) throw new Error('restore did not roll back')
log('restored original version; history now has', await alice.locator('.version-row').count(), 'entries')

// Export: Markdown download and print (PDF) layout.
const md = await (await alice.request.get(`${q4Url.replace(/\?.*/, '')}`.replace('/docs/', '/api/documents/') + '/export?format=md')).text()
if (!md.startsWith('# Q4 Planning Notes') || !md.includes('- Do we need comments in v1?')) throw new Error('bad markdown: ' + md)
log('markdown export ok:', md.split('\n').length, 'lines')
await alice.emulateMedia({ media: 'print' })
if (await alice.locator('.toolbar').isVisible()) throw new Error('toolbar visible in print layout')
await alice.screenshot({ path: `${shots}/09-print.png` })
await alice.emulateMedia({ media: 'screen' })
log('print layout hides app chrome')

const unexpected = errors.filter((e) => !/40[49]|ERR_INTERNET_DISCONNECTED/.test(e)) // 404/409/offline are provoked on purpose
if (unexpected.length) { console.error('Unexpected browser errors:', unexpected); process.exitCode = 1 }
console.log('All e2e checks passed.')
await browser.close()
