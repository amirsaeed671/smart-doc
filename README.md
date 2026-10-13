# Smart Doc

A lightweight collaborative document editor inspired by Google Docs. You can create, format, import, share, comment on and co-edit documents, with live presence, version history and export.

**Live demo:** https://smart-doc-indol-gamma.vercel.app/ · **Demo accounts:** `alice@ajaia.dev`, `bob@ajaia.dev`, `carol@ajaia.dev`, all with password **`demo1234`**. The login screen also has one-click buttons for each.

![Editor](docs/screenshots/02-editor.png)

## What it does

| Area | What works |
| --- | --- |
| **Documents** | Create, rename (click the title), edit, delete (owner only). Changes autosave about 0.8 s after you stop typing. <kbd>Ctrl/⌘+S</kbd> saves immediately, and you're warned if you try to leave with unsaved changes. |
| **Rich text** | Bold, italic, underline, strikethrough, headings H1–H3, bulleted and numbered lists, quotes, code blocks, links, undo/redo. Content is stored as structured JSON (ProseMirror), so formatting round-trips exactly. |
| **File import** | Upload a **`.txt`, `.md` or `.docx`** file (max 2 MB) from the dashboard and it becomes a new editable document. Headings, lists, bold/italic and links are kept. Other file types are rejected with a clear message. |
| **Sharing & roles** | Every document has one **owner**, who shares by email with one of three roles and can change or revoke access at any time:<br>**Viewer**: read and export · **Commenter**: also comment · **Editor**: also edit and restore versions · **Owner**: also share and delete.<br>The dashboard splits **My documents** from **Shared with me**, with role badges. The same permission table drives both API enforcement and the UI. |
| **Live collaboration** | People who have the doc open appear as avatars, and a pulsing ring plus "Bob is editing…" shows who is typing right now. Saved changes appear for others within about a second. If two people edit at once, the second save is **detected, not silently overwritten**: they choose "load theirs" or "keep mine". Revoked users are told straight away. |
| **Comments** | Select text → **💬 Comment** (or <kbd>Ctrl+Alt+M</kbd>). Commented text is highlighted, and clicking a highlight opens its thread. Threads have replies and resolve/reopen. Authors can delete their own comments and owners can delete any. If the quoted text is later edited away, the comment stays and is marked "text changed". Comments sync live. |
| **Version history** | 🕘 **History** lists editing sessions (autosaves by one person within 10 minutes are grouped, like Google Docs). Preview any version read-only and **restore** it (editors). A restore is added as a new version, so it can be undone too. |
| **Export** | ⤓ **Export** → **Markdown** (server-side conversion that keeps headings, lists, emphasis, links, quotes and code) or **PDF** through the browser's print dialog, with a print stylesheet that removes all app chrome. |
| **Persistence** | Postgres (Supabase in production, embedded PGlite locally). Documents, formatting and shares survive refreshes and redeploys. |

## Run locally

Requirements: Node 20+ (tested on 22). No database or accounts needed.

```bash
npm install
npm run dev          # http://localhost:3000
```

With no `DATABASE_URL` set, the app uses **PGlite** (Postgres compiled to WASM) and stores data in `./.data/pglite`. Tables and demo users are created on first request. Delete `.data/` to reset.

To try sharing, sign in as Alice in one browser and as Bob in another (or a private window).

Optional `.env.local` (see [`.env.example`](.env.example)):

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Use a real Postgres instead of PGlite. |
| `SESSION_SECRET` | Signs session cookies. **Required on Vercel**. Locally a dev default is used. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Turn on Supabase Realtime for presence and instant sync. Without them, open documents poll for changes every 5 s, so live sync still works locally but presence avatars are off. |

### Tests

```bash
npm test             # unit/integration tests (Vitest + in-memory Postgres)
npm run typecheck
npm run e2e          # browser smoke test; needs a running server (see below)
```

- `tests/documents.test.ts` covers the access-control and persistence rules against a real (in-memory) Postgres: who can see, edit, share and delete; rich-text round-trips; optimistic-locking conflicts; schema validation of saved content.
- `tests/importer.test.ts` covers Markdown, text and docx import, including dropping `<script>` and rejecting bad, empty and oversized files.
- `tests/collaboration.test.ts` covers the role ladder, comment threads and permissions, session grouping in version history, and restore.
- `tests/markdown.test.ts` and `tests/comment-anchoring.test.ts` cover Markdown export for every node and mark type, and finding commented text across formatting and blocks.
- `tests/migrations.test.ts` upgrades a database in the first-release schema (like the live one) and checks that nothing is lost.
- `e2e/smoke.mjs` drives three real browsers (Alice, Bob, Carol) through create → format → reload → share → live sync both ways → viewer read-only → edit conflict → import → revoke → commenter role → comment, reply, resolve → version restore → Markdown export → print layout. To run it: `rm -rf .data && npm run build && npm start`, then in another terminal `npx playwright install chromium` (first time only) and `npm run e2e`.

## Deploy (Vercel + Supabase, both free tiers)

1. **Supabase**: create a project. In **Connect → Connection string → Transaction pooler**, copy the URI (port `6543`) and fill in your DB password. In **Project Settings → API**, copy the Project URL and the `anon` public key.
2. **Initialise the DB** (optional; the app also does this on first request):
   `DATABASE_URL="postgresql://…:6543/postgres" npm run db:setup`
3. **Vercel**: import the GitHub repo (framework: Next.js, defaults are fine). Add these environment variables:
   - `DATABASE_URL`: the pooler URI from step 1
   - `SESSION_SECRET`: output of `openssl rand -hex 32`
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`: from step 1
4. Deploy. Open the URL, sign in as Alice in one browser and as Bob in another, and open "Q4 Planning Notes".

> **Use the pooler URI, not the direct one.** `db.<ref>.supabase.co` is IPv6-only, and Vercel can't reach it (`getaddrinfo ENOTFOUND`). The app now fails with an explicit message if it sees that host on Vercel.

Realtime uses public Broadcast and Presence channels, which new Supabase projects allow by default. Only "version N was saved" notices go over them, never document content (see the architecture note).

## Project layout

```
src/
  app/                    Next.js App Router pages + API route handlers
    api/documents/…       CRUD, sharing, import endpoints
  components/             Dashboard, DocumentEditor, Toolbar, ShareDialog
  lib/
    documents.ts          Domain logic: access control, sharing, optimistic locking
    permissions.ts        Role → capability table (shared by API and UI)
    comments.ts           Comment threads
    versions.ts           Version history (session snapshots, restore)
    markdown.ts           Markdown export
    comment-highlights.ts Editor plugin that highlights commented text
    migrations.ts         Versioned, idempotent schema migrations
    content.ts            Schema validation + HTML → document conversion
    importer.ts           .txt/.md/.docx import
    db.ts                 Postgres (pg) or PGlite behind one tiny interface; schema
    realtime.ts           Supabase presence + change notifications
    session.ts            Signed-cookie sessions (jose)
tests/                    Vitest suites
e2e/                      Playwright smoke test
```

## Docs

- [ARCHITECTURE.md](ARCHITECTURE.md): what I prioritised and why, plus tradeoffs and next steps
- [AI_WORKFLOW.md](AI_WORKFLOW.md): how AI tools were used and checked
- [SUBMISSION.md](SUBMISSION.md): what's included and what's working or incomplete
