# Smart Doc: AI-Native Full Stack Developer Assignment

A lightweight collaborative document editor in the spirit of Google Docs. I put the depth into the parts that make shared docs trustworthy: reliable saving, a clear access model, and safe concurrent editing. All five optional stretch features are also implemented.

## Links

| | |
| --- | --- |
| **Live app** | https://smart-doc-indol-gamma.vercel.app/ |
| **Source code** | https://github.com/amirsaeed671/smart-doc |
| **Google Drive folder** | _TODO: Drive folder link_ |
| **Walkthrough video** | _TODO: Loom / YouTube link_ (also in `VIDEO_URL.txt`) |

## Test accounts

All passwords are **`demo1234`**. The login page also has one-click buttons for each account.

| Account | Seeded state |
| --- | --- |
| `alice@ajaia.dev` (Alice Chen) | Owns **Q4 Planning Notes**, shared with Bob as Editor and with a sample comment thread. Bob's **Team Offsite Ideas** is shared with her as Viewer. |
| `bob@ajaia.dev` (Bob Patel) | Owns **Team Offsite Ideas**. Is an Editor on Alice's **Q4 Planning Notes**. |
| `carol@ajaia.dev` (Carol Diaz) | Starts with nothing; use her to try sharing (e.g. as a Commenter) from scratch. |

**Fastest way to review collaboration:** sign in as Alice in one browser and Bob in a private window, then open *Q4 Planning Notes* in both. You'll see each other's avatars, a "Bob is editing…" indicator while he types, and his changes appearing for you within about a second.

## What's working end to end

**Core requirements**
- **Documents:** create, rename, rich-text editing, autosave with a visible save state, reopen, delete. Bold, italic, underline, strikethrough, H1–H3, bulleted and numbered lists, quotes, code blocks, links, undo/redo.
- **File upload:** import `.txt`, `.md` or `.docx` (≤ 2 MB) as a new editable document. Formatting is kept, unsafe HTML is removed, and unsupported or corrupt files get a clear error.
- **Sharing:** an owner per document; share by email; "My documents" vs "Shared with me"; change or revoke access, with revocation taking effect live.
- **Persistence:** Postgres on Supabase. Content is stored as structured JSON and validated against the editor schema on every save.
- **Engineering quality:** validation and error handling throughout, 23 unit/integration tests plus a three-browser end-to-end test, CI, and documented setup and deploy.

**Optional stretch features (all five)**
1. **Real-time collaboration indicators:** presence avatars, a live "X is editing…" indicator with a pulsing ring, live sync of saved changes, and conflict detection with a "load theirs / keep mine" choice instead of silent overwrites.
2. **Commenting:** select text → comment. Highlights in the document, threaded replies, resolve/reopen, delete, live sync. Comments survive later edits to the text and are flagged when the quoted text changes.
3. **Version history:** editing-session snapshots, read-only preview, and restore (which adds a new version, so nothing is lost).
4. **Export:** Markdown download, and PDF through the print dialog with a clean print layout.
5. **Role-based permissions:** Viewer < Commenter < Editor < Owner, from one permission table enforced by the API and reflected in the UI.

## What I deliberately did not build

- **Character-level simultaneous co-editing (CRDT/Yjs).** This is the main scope cut. Concurrent edits are detected and resolved explicitly, not merged keystroke by keystroke. It's the right next step, but doing it properly would have used most of the timebox.
- **Suggestion mode / tracked changes.** It needs the same position-mapping machinery as CRDT co-editing, so it belongs with that work.
- **Sign-up, password reset, email invites.** Seeded accounts are enough to demonstrate the sharing model.

## Known limitations

- Live presence and the "is editing" indicator use Supabase Realtime. Without it (local dev with no keys), the app falls back to polling every 5 s.
- If a commented phrase appears twice in a document, the first occurrence is highlighted.

## What I'd build next (2–4 hours)

1. Yjs co-editing over Supabase Broadcast, with live cursors and exact comment anchors.
2. Visual diffs between versions.
3. @mentions in comments with notifications.
4. End-to-end tests in CI against preview deployments.

## Key technical decisions

- **Next.js + TipTap + Postgres** in one deployable on Vercel. The editor schema is defined once and used by the browser, server validation and the importer.
- **Access control in one SQL query.** Documents you can't access return 404, so their existence isn't revealed.
- **Optimistic locking** (a version number plus a conditional update) instead of last-write-wins.
- **The realtime channel carries signals, never content.** Peers announce "version N saved" and re-fetch through the authenticated API.
- **Comments are anchored by quoted text and drawn as decorations,** so commenting never modifies the document (a Commenter can't edit).
- **Versioned, idempotent migrations,** tested against the first-release schema the live database was created with.

## AI usage (summary)

Built with Claude Code as a pair programmer. I made the scope and architecture calls, and every change was verified with tests, a scripted three-browser run and screenshot review. The browser runs caught six real bugs in generated code, each fixed at the root rather than retried away. One example: a TipTap plugin silently editing the document caused read-only users to attempt saves. Details are in `AI_WORKFLOW.md`.

## What's in the Drive folder / repository

| File | Contents |
| --- | --- |
| `README.md` | Features, local setup (zero-config with embedded Postgres), tests, deploy steps |
| `ARCHITECTURE.md` | Architecture note: priorities, decisions, tradeoffs, next steps |
| `AI_WORKFLOW.md` | AI workflow note |
| `SUBMISSION.md` | This file |
| `VIDEO_URL.txt` | Walkthrough video link |
| `docs/screenshots/` | Screenshots of every main flow, made by the e2e test |
| `src/`, `tests/`, `e2e/` | Application source, unit/integration tests, browser test |

**Run locally:** `npm install && npm run dev`, then open http://localhost:3000. No database or accounts are needed.
