import 'server-only'
import type { JSONContent } from '@tiptap/core'
import { marked } from 'marked'
import { htmlToDoc } from './content'
import { badRequest } from './errors'

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024
export const SUPPORTED_EXTENSIONS = ['.txt', '.md', '.markdown', '.docx'] as const

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot).toLowerCase()
}

function titleFromFilename(filename: string): string {
  const base = filename.replace(/^.*[\\/]/, '')
  const dot = base.lastIndexOf('.')
  return (dot > 0 ? base.slice(0, dot) : base).replace(/[_-]+/g, ' ').trim().slice(0, 200) || 'Imported document'
}

/** Plain text: blank lines separate paragraphs, single newlines become line breaks. */
export function textToHtml(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((para) => para.trim())
    .filter(Boolean)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br>')}</p>`)
    .join('')
}

/**
 * Turn an uploaded file into a title + editor content.
 * Every format is normalised to HTML first and then parsed through the editor
 * schema, which doubles as sanitisation (unknown tags/attributes are dropped).
 */
export async function importFile(filename: string, data: Buffer): Promise<{ title: string; content: JSONContent }> {
  if (data.byteLength === 0) throw badRequest('The file is empty.')
  if (data.byteLength > MAX_UPLOAD_BYTES) throw badRequest('File is too large. The limit is 2 MB.')

  const ext = extensionOf(filename)
  let html: string
  switch (ext) {
    case '.txt':
      html = textToHtml(data.toString('utf8'))
      break
    case '.md':
    case '.markdown':
      html = await marked.parse(data.toString('utf8'), { gfm: true })
      break
    case '.docx': {
      const mammoth = await import('mammoth')
      try {
        const result = await mammoth.convertToHtml({ buffer: data })
        html = result.value
      } catch {
        throw badRequest('Could not read that .docx file. Is it a valid Word document?')
      }
      break
    }
    default:
      throw badRequest(`Unsupported file type "${ext || 'none'}". Supported: ${SUPPORTED_EXTENSIONS.join(', ')}.`)
  }

  const content = htmlToDoc(html || '<p></p>')
  if (!content.content?.length) content.content = [{ type: 'paragraph' }]
  return { title: titleFromFilename(filename), content }
}
