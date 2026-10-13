# Architecture note

## The product slice I chose

The brief asks for a Google Docs-like tool for "teams moving faster on shared work". Docs is valuable for **trusting that what you wrote is saved and that collaborators see the same thing**, not for its long list of formatting features. So I put the depth into:

1. **A reliable edit → save → reopen loop.** Autosave, a visible save state, structured storage, and server-side validation.
2. **A real access model.** Owner, editor and viewer, enforced in one place on the server and visible everywhere in the UI.
3. **Safe concurrency.** Live presence and sync, plus *conflict detection* so two people can never silently overwrite each other.

Formatting covers the brief's list plus a few cheap extras: quotes, code blocks, links and strikethrough.

## Stack

| Layer | Choice | Why |
| --- | --- | --- |
| App | **Next.js 15 (App Router)** + React 19 + TypeScript | One deployable unit for UI and API. Server components render the dashboard and editor with data on first paint. |
| Editor | **TipTap 3** (ProseMirror) | Mature schema-based editor. The *same* extension list defines the schema in the browser, in server validation, and in the importer. |
| Storage | **Postgres** via `pg` (Supabase) **or PGlite** (embedded WASM Postgres) | Same SQL and same `$1` placeholders on both, behind a 1-method `Db` interface. Reviewers can run locally with zero setup, and tests run against real Postgres semantics in memory. |
| Realtime | **Supabase Realtime** (Presence + Broadcast) | WebSockets don't fit Vercel functions. Supabase gives presence and pub/sub at no cost and comes with the DB. |
| Auth | Seeded users + scrypt passwords + **signed JWT cookie** (`jose`) | The brief allows simulated users. This is a real login flow (hashing, httpOnly cookie, server-side checks) without a signup/email pipeline. |
| Hosting | Vercel + Supabase free tiers | Nothing for reviewers to pay for. |

## Key design decisions

**Documents are stored as ProseMirror JSON (`jsonb`), not HTML.** It round-trips exactly. Every save is validated against the editor schema (`Node.fromJSON(schema).check()`), so the API can't be used to store arbitrary markup. Imports go HTML → schema → JSON, and that parse is also the sanitiser: `<script>`, styles and unknown tags never reach the database (covered by tests).

**Access control lives in one SQL fragment.** `ACCESSIBLE_DOCS_SQL` in `src/lib/documents.ts` returns a row only if you own the document or it's shared with you, and computes your role on the way. Every read and write starts from it. Documents you can't access return **404, not 403**, so the API doesn't reveal that they exist. Ownership-only actions (share, revoke, delete) and editor-only actions (save) are checked right after.

**Optimistic locking instead of last-write-wins.** Each document has a `version`. A save sends the `baseVersion` it was editing from, and `UPDATE … WHERE version = $base` only lands if nobody saved in between. Otherwise the API returns 409 with the latest document, and the UI offers "load theirs" or "keep mine". Renames don't bump the version, so renaming never causes a false conflict.

**Realtime carries signals, not data.** Peers broadcast "I saved version N", "title changed" or "sharing changed". Receivers then re-fetch through the authenticated REST API. So the public realtime channel isn't a security boundary: someone who guesses a channel name learns a version number and nothing more. A revoked user's next fetch gets a 404 and the UI tells them. Without Supabase configured, the editor polls every 5 s instead, so local dev still demonstrates sync.

**Import creates a new document.** Of the options in the brief, "upload a file → get an editable doc" is the one people actually use when migrating notes. `.txt`, `.md` and `.docx` (via `mammoth`) cover common sources. 2 MB limit, with errors for unsupported, empty and corrupt files.

## What I deliberately did not build

- **Character-level co-editing (CRDT/OT, e.g. Yjs).** It's the right long-term answer, but doing it properly means a persistent sync server or provider, awareness cursors, and reworking persistence into CRDT updates. That's more than the timebox allows. Save-level sync with conflict detection covers the realistic "two people in one doc" case honestly, and the data model (JSON snapshots + version) migrates cleanly to Yjs later.
- **Sign-up, password reset, email invites.** Seeded accounts are enough to demonstrate sharing. You can only share with existing users, and the dialog suggests them from a directory.
- **Comments, suggestions, version history, export, images and tables.** All valuable, all secondary to the core loop.
- **Realtime channel authorization.** Not needed, because no content goes over the channel (see above). With Supabase Auth, private channels + RLS would be the next step.

## Known limitations

- If two people edit simultaneously, the second saver has to choose between versions; there's no merge. Usually that's a short window, because autosave runs every ~0.8 s and remote changes apply immediately to anyone without unsaved edits.
- Presence shows who has the doc open, not where their cursor is.
- Sessions are stateless JWTs (7 days), so there's no server-side "log out everywhere".

## With another 2–4 hours

1. **Yjs over Supabase Broadcast** for true simultaneous editing (`y-prosemirror`), saving a JSON snapshot alongside the Yjs state.
2. **Version history**: append a row to `document_versions` on each save (we already have the version counter) and add a restore UI.
3. **Export to Markdown/PDF** and "import into the current document".
4. Playwright e2e in CI against a preview deployment.
