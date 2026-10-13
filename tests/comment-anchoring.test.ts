import { getSchema } from '@tiptap/core'
import { Node } from '@tiptap/pm/model'
import { describe, expect, it } from 'vitest'
import { findQuote } from '@/lib/comment-highlights'
import { baseExtensions } from '@/lib/editor-schema'

const schema = getSchema(baseExtensions)
const p = (...content: object[]) => ({ type: 'paragraph', content })
const t = (text: string, marks: string[] = []) => ({ type: 'text', text, marks: marks.map((type) => ({ type })) })

describe('comment anchoring', () => {
  const doc = Node.fromJSON(schema, {
    type: 'doc',
    content: [p(t('Ship the '), t('doc editor', ['bold']), t(' pilot')), p(t('Second paragraph'))],
  })

  it('finds quotes across differently formatted text and returns exact positions', () => {
    const range = findQuote(doc, 'the doc editor')!
    expect(doc.textBetween(range.from, range.to)).toBe('the doc editor')
  })

  it('matches quotes spanning blocks the same way the editor extracts them', () => {
    const range = findQuote(doc, 'pilot\nSecond')!
    expect(doc.textBetween(range.from, range.to, '\n')).toBe('pilot\nSecond')
  })

  it('returns null when the quoted text no longer exists', () => {
    expect(findQuote(doc, 'deleted words')).toBeNull()
  })
})
