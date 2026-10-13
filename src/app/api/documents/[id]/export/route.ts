import { withUser } from '@/lib/api'
import { getDocument } from '@/lib/documents'
import { badRequest } from '@/lib/errors'
import { docToMarkdown } from '@/lib/markdown'

// Markdown export. PDF export is done client-side through the browser's print
// pipeline (print stylesheet), which needs no headless browser on the server.
export const GET = withUser<{ id: string }>(async ({ req, db, user, params }) => {
  const format = new URL(req.url).searchParams.get('format') ?? 'md'
  if (format !== 'md') throw badRequest('Supported export formats: md.')
  const doc = await getDocument(db, user.id, params.id)
  const filename = (doc.title.replace(/[^\w\- ]+/g, '').trim() || 'document').slice(0, 80)
  return new Response(docToMarkdown(doc.content, doc.title), {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}.md"; filename*=UTF-8''${encodeURIComponent(doc.title)}.md`,
      'Cache-Control': 'no-store',
    },
  })
})
