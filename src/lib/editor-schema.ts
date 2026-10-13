import StarterKit from '@tiptap/starter-kit'
import type { JSONContent } from '@tiptap/core'

/**
 * The single source of truth for which nodes/marks a document may contain.
 * Used by the browser editor, by server-side validation of saves, and by the
 * file importer, so all three agree on what "valid content" means.
 */
export const baseExtensions = [
  StarterKit.configure({
    heading: { levels: [1, 2, 3] },
    link: { openOnClick: false, autolink: true, defaultProtocol: 'https' },
  }),
]

export const EMPTY_DOC: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }
