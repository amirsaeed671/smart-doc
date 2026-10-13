import 'server-only'
import { getSchema, type JSONContent } from '@tiptap/core'
import { Node as PMNode } from '@tiptap/pm/model'
import { generateJSON } from '@tiptap/html/server'
import { baseExtensions } from './editor-schema'
import { badRequest } from './errors'

const schema = getSchema(baseExtensions)

export const MAX_CONTENT_BYTES = 1_000_000

/** Throws a 400 unless `content` is a well-formed document for our editor schema. */
export function assertValidContent(content: unknown): JSONContent {
  if (!content || typeof content !== 'object' || (content as JSONContent).type !== 'doc') {
    throw badRequest('Content must be a document object.')
  }
  if (JSON.stringify(content).length > MAX_CONTENT_BYTES) {
    throw badRequest('Document is too large (max ~1 MB).')
  }
  try {
    PMNode.fromJSON(schema, content).check()
  } catch (err) {
    throw badRequest('Content does not match the editor schema.', String(err))
  }
  return content as JSONContent
}

/**
 * Convert arbitrary HTML into editor JSON. Parsing goes through the editor
 * schema, so anything we don't support (scripts, styles, iframes, unknown
 * tags) is dropped rather than stored.
 */
export function htmlToDoc(html: string): JSONContent {
  return generateJSON(html, baseExtensions)
}

/** Plain text of a document, used for list previews. */
export function docToPlainText(content: JSONContent, limit = 200): string {
  const parts: string[] = []
  let length = 0
  const walk = (node: JSONContent) => {
    if (length >= limit) return
    if (node.text) {
      parts.push(node.text)
      length += node.text.length
    }
    node.content?.forEach(walk)
    if (node.type === 'paragraph' || node.type === 'heading') parts.push(' ')
  }
  walk(content)
  return parts.join('').replace(/\s+/g, ' ').trim().slice(0, limit)
}
