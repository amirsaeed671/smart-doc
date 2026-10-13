# Submission: Smart Doc

## Links

| What | Where |
| --- | --- |
| Live app | **TODO: Vercel URL** |
| Source code | https://github.com/amirsaeed671/smart-doc (also in this folder) |
| Walkthrough video | See [`VIDEO_URL.txt`](VIDEO_URL.txt) |

## Test accounts

All passwords are **`demo1234`**. The login page also has one-click buttons.

| User | Seeded state |
| --- | --- |
| `alice@ajaia.dev` (Alice Chen) | Owns **Q4 Planning Notes** (shared with Bob as *editor*). Has **Team Offsite Ideas** shared with her as *viewer*. |
| `bob@ajaia.dev` (Bob Patel) | Owns **Team Offsite Ideas**. Can edit Alice's **Q4 Planning Notes**. |
| `carol@ajaia.dev` (Carol Diaz) | Starts with nothing; use her to try sharing from scratch. |

**Fastest way to see sharing and live sync:** open the app as Alice in one browser and as Bob in a private window, then open *Q4 Planning Notes* in both and type.

## What's included

| File / folder | Contents |
| --- | --- |
| `README.md` | Features, local setup, tests, deploy steps |
| `ARCHITECTURE.md` | Architecture note: priorities, decisions, tradeoffs, next steps |
| `AI_WORKFLOW.md` | AI workflow note |
| `SUBMISSION.md` | This file |
| `VIDEO_URL.txt` | Walkthrough video link |
| `docs/screenshots/` | Screenshots of the main flows (made by the e2e test) |
| `src/` | Application source (Next.js app, API routes, domain logic) |
| `tests/` | Vitest suites (access control, persistence, conflicts, import) |
| `e2e/` | Playwright three-user smoke test |

## Status

**Working end to end**
- Create, rename, edit, autosave, reopen and delete documents
- Rich text: bold, italic, underline, strike, H1–H3, bulleted/numbered lists, quote, code block, links, undo/redo
- Import `.txt` / `.md` / `.docx` as a new document (2 MB limit, clear errors for anything else)
- Sharing: owner / editor / viewer, change role, revoke; "My documents" vs "Shared with me"; read-only mode for viewers
- Persistence in Postgres (Supabase)
- Stretch: live presence avatars, live sync of saved changes, edit-conflict detection and resolution, role-based permissions, live revocation

**Incomplete / intentionally out of scope**
- No simultaneous character-level co-editing (CRDT). Concurrent edits are detected and resolved, not merged.
- No sign-up or email invitations; sharing works with existing (seeded) users.
- No comments, version history or export.

**Next 2–4 hours:** Yjs-based co-editing over Supabase Broadcast, version history with restore, Markdown/PDF export. Details in `ARCHITECTURE.md`.
