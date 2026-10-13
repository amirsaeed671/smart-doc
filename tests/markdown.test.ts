import { describe, expect, it } from 'vitest'
import { docToMarkdown } from '@/lib/markdown'

const t = (text: string, ...marks: string[]) => ({ type: 'text', text, marks: marks.map((type) => ({ type })) })
const p = (...content: object[]) => ({ type: 'paragraph', content })
const li = (...content: object[]) => ({ type: 'listItem', content })

describe('markdown export', () => {
  it('serialises every supported node and mark', () => {
    const md = docToMarkdown({
      type: 'doc',
      content: [
        { type: 'heading', attrs: { level: 1 }, content: [t('Plan')] },
        p(t('Some '), t('bold', 'bold'), t(' and '), t('italic ', 'italic'), t('u', 'underline'), t(' '), t('x', 'strike')),
        p({ type: 'text', text: 'site', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }, { type: 'bold' }] }),
        { type: 'bulletList', content: [li(p(t('one')), { type: 'orderedList', attrs: { start: 1 }, content: [li(p(t('nested')))] }), li(p(t('two')))] },
        { type: 'orderedList', attrs: { start: 3 }, content: [li(p(t('third')))] },
        { type: 'blockquote', content: [p(t('quoted'))] },
        { type: 'codeBlock', attrs: { language: 'ts' }, content: [t('const a = 1 * 2')] },
        p(t('1 * 2 = [x]', 'code')),
      ],
    }, 'Plan')

    expect(md).toBe(
      [
        '# Plan',
        '',
        'Some **bold** and _italic_ <u>u</u> ~~x~~',
        '',
        '[**site**](https://example.com)',
        '',
        '- one\n  1. nested\n- two',
        '',
        '3. third',
        '',
        '> quoted',
        '',
        '```ts\nconst a = 1 * 2\n```',
        '',
        '`1 * 2 = [x]`',
        '',
      ].join('\n'),
    )
  })

  it('adds the title when the doc does not start with it, and escapes markdown characters', () => {
    expect(docToMarkdown({ type: 'doc', content: [p(t('2 * 3 # not a heading'))] }, 'My_doc')).toBe(
      '# My\\_doc\n\n2 \\* 3 \\# not a heading\n',
    )
  })
})
