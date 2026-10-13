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

**Roles are one ordered ladder in one file.** `permissions.ts` defines Viewer < Commenter < Editor < Owner and maps each capability (comment, edit, manage) to the minimum role. The API enforces with `can(role, …)` and the UI uses the same function to decide what to show, so a button can't appear for an action the server would reject. The Commenter role is what makes comments useful in practice: reviewers can give feedback without being able to change the text.

**Comments are anchored by quoted text, drawn as decorations.** The obvious design stores a comment mark inside the document, but then *adding a comment edits the document*, which a Commenter isn't allowed to do, and it would conflict with concurrent edits. Instead each thread stores the text it quoted. An editor plugin finds that text in the current document and highlights it with a view-only decoration. If the text is later rewritten, the thread survives and is flagged "text changed" rather than vanishing. The tradeoff: if the same phrase appears twice, the first occurrence is highlighted. The proper fix is position mapping through a CRDT (see below).

**Version history groups autosaves into sessions.** Autosave runs about once a second, so a snapshot per save would bury the history. Saves by the same person within 10 minutes update one session snapshot, and a different author, a restore, or a gap starts a new one, which matches what Google Docs shows. Restoring never deletes anything: it writes the old content as a new version and records a "Restored from …" milestone, so a restore can be undone.

**Exports: Markdown on the server, PDF through the browser.** Markdown is a small serializer over the document JSON, unit-tested for every node and mark type. PDF uses the browser's print engine with a print stylesheet. Server-side PDF would mean running headless Chrome in a serverless function (slow cold starts and large bundles) for output that's no better.

**Defence in depth on Supabase: RLS on, no policies.** Supabase serves the `public` schema over a REST API to anyone holding the anon key, and that key is public because the browser uses it for Realtime. Every table therefore has row-level security enabled with no policies, which denies the anon and authenticated roles everything. The server connects as the table owner (which bypasses RLS) and enforces access in the API, so there is exactly one way in to the data.

**Schema changes go through versioned migrations.** The live database was created by the first release, so `migrations.ts` records applied migrations and rewrites the role CHECK constraint in place. Every statement is idempotent, so two cold starts racing on a fresh database are harmless. A test upgrades a first-release schema and checks nothing is lost.

**Import creates a new document.** Of the options in the brief, "upload a file → get an editable doc" is the one people actually use when migrating notes. `.txt`, `.md` and `.docx` (via `mammoth`) cover common sources. 2 MB limit, with errors for unsupported, empty and corrupt files.

## What I deliberately did not build

- **Character-level co-editing (CRDT/OT, e.g. Yjs).** It's the right long-term answer, but doing it properly means a persistent sync server or provider, awareness cursors, and reworking persistence into CRDT updates. That's more than the timebox allows. Save-level sync with conflict detection covers the realistic "two people in one doc" case honestly, and the data model (JSON snapshots + version) migrates cleanly to Yjs later.
- **Sign-up, password reset, email invites.** Seeded accounts are enough to demonstrate sharing. You can only share with existing users, and the dialog suggests them from a directory.
- **Suggestion mode (tracked changes), images and tables.** Suggestion mode needs the same position-mapping machinery as CRDT co-editing, so it belongs with that work, not as a one-off.
- **Realtime channel authorization.** Not needed, because no content goes over the channel (see above). With Supabase Auth, private channels + RLS would be the next step.

## Known limitations

- If two people edit simultaneously, the second saver has to choose between versions; there's no merge. Usually that's a short window, because autosave runs every ~0.8 s and remote changes apply immediately to anyone without unsaved edits.
- Presence shows who has the doc open and who is typing, not where their cursor is. Live cursors need the CRDT layer.
- The "is editing" indicator, presence avatars and instant comment sync use Supabase Realtime. Without it (local dev with no keys) the app polls every 5 s for content and comments, and presence is hidden.
- A comment quoting text that appears twice highlights the first occurrence.
- Sessions are stateless JWTs (7 days), so there's no server-side "log out everywhere".

## With another 2–4 hours

1. **Yjs over Supabase Broadcast** for true simultaneous editing (`y-prosemirror`), saving a JSON snapshot alongside the Yjs state.
2. **Live cursors and selections** from Yjs awareness, which also gives exact comment anchors (relative positions) and makes suggestion mode practical.
3. **Version diffs**: highlight what changed between two versions rather than only previewing them.
4. **Notifications**: email or in-app notices for @mentions in comments and new shares.
5. Playwright e2e in CI against a preview deployment.
