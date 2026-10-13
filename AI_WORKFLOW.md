# AI workflow note

> Draft written from the actual build log. Edit it into your own voice before submitting.

## Tools used

- **Claude Code** (agentic coding assistant in a cloud dev container) for scaffolding, implementation, running tests, and driving a headless browser against the running app.
- **Playwright** (scripted by the assistant) to check UX and multi-user behaviour in real browsers, with screenshots I reviewed.

## Where AI materially sped things up

- **Scaffolding and boilerplate.** Next.js config, route handlers, the CSS system, and the share dialog came out in minutes instead of an hour or two.
- **Library glue.** Wiring TipTap's schema into server-side validation (`getSchema` + `Node.fromJSON().check()`), the HTML → ProseMirror import path with `@tiptap/html/server`, and Supabase Presence/Broadcast. The assistant checked package internals (e.g. confirmed that `@tiptap/html/server` runs happy-dom with JavaScript evaluation disabled) instead of guessing.
- **Test scaffolding.** The Vitest suites run against in-memory Postgres (PGlite), and a three-user Playwright smoke test (Alice/Bob/Carol) exercises sharing, live sync, conflicts and revocation end to end.

## What I changed or rejected

- **Scope decisions stayed human.** I picked the deploy target (Vercel + Supabase) and the realtime depth: presence + live sync with conflict detection, **not** full CRDT co-editing. That kept the 4–6 h budget for the core loop.
- **Rejected sending document content over the realtime socket.** Public Supabase channels aren't an auth boundary, so the design broadcasts only "version N saved" and receivers re-fetch through the authorised API.
- **Rejected last-write-wins saving** (the simplest generated version) in favour of optimistic locking with a 409 and an explicit "load theirs / keep mine" choice.
- **Bugs that the e2e run caught in generated code, which I fixed:**
  - `editor.setEditable()` emits an update event by default, so just opening a document marked it dirty and triggered a pointless save. Fixed with `setEditable(editable, false)`.
  - TipTap's `commands.focus()` waits an animation frame, so pressing Enter in the title and typing straight away lost the first character into the title. Fixed by focusing the view synchronously.
  - The production `SESSION_SECRET` guard also blocked `npm start` locally. Narrowed to Vercel only.
- **Tooling version check.** The latest TypeScript (7.x) broke Next 15's config loader, so I pinned TypeScript 5.9.
- **Second round (optional features): three more bugs found by the browser test and fixed at the root:**
  - TipTap's *trailing-node* plugin appends an empty paragraph on **any** transaction, including the view-only one that draws comment highlights. That counted as an edit, so a read-only Commenter's editor tried to save (a 403 caught by the e2e error check), and an editor's would make a pointless save. Fixed by disabling the plugin and ignoring update events for read-only roles.
  - The version-preview modal opened inside the sticky side panel, which is its own stacking context, so it sat underneath the toolbar and hid the Restore button. Fixed with a portal.
  - `useEditor` re-applied its options on every React render because the `extensions` array and `editorProps` were built inline. That forced a `view.updateState()` each time, which can overwrite a DOM selection ProseMirror hasn't read yet. Made all options referentially stable.
- **Rejected the obvious comment design.** Storing comments as marks inside the document would mean a Commenter's comment edits the document. Comments are anchored by quote and drawn as decorations instead (see the architecture note).
- **Didn't accept "flaky" as an answer.** One intermittent e2e failure was traced to a real cause: the test typed `" + bob"` at the start of a paragraph, which triggers TipTap's `+ ` → bullet-list shortcut, and it raced a closing modal. I fixed the test rather than adding retries, and checked the product behaviour was correct (both clients converged on the same content).

## How correctness, UX and reliability were verified

- **Unit/integration tests** (`npm test`, 23 tests) on the rules that matter most: access control for each role, 404 for non-shared docs, share/revoke, rich-text round-trip, conflict detection, schema validation, import sanitisation, comment permissions, version grouping and restore, Markdown export, comment anchoring, and upgrading the live database schema.
- **Three-browser e2e run** (`npm run e2e`) repeated several times on a fresh DB: create → format → reload → share → live sync both directions → viewer read-only → offline edit conflict → resolve → import `.md` → revoke while the viewer has the doc open → commenter comments → owner replies and resolves → restore an old version → Markdown export → print layout. Any unexpected 4xx/5xx response fails the run.
- **One intermittent failure was investigated, not retried away.** Instrumenting ProseMirror transactions showed the test pressing keys within ~15 ms of a click, inside ProseMirror's deliberate 50 ms window for ignoring selection changes. A human can't do that, so the test now pauses like one; the same investigation turned up the real unstable-options bug above.
- **Screenshots reviewed by eye** for every main screen (dashboard, editor, share dialog, viewer mode, conflict banner, imported doc). Previews were adjusted after review (they repeated the title).
- `tsc --noEmit` and `next build` are clean.
