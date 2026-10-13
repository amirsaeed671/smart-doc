import { describe, expect, it } from 'vitest'
import { importFile } from '@/lib/importer'
import { AppError } from '@/lib/errors'

const types = (doc: { content?: { type?: string }[] }) => doc.content?.map((n) => n.type)

describe('file import', () => {
  it('converts markdown structure into editor nodes and drops unsafe HTML', async () => {
    const md = '# Plan\n\nSome **bold** and _italic_.\n\n- one\n- two\n\n1. first\n\n<script>alert(1)</script>'
    const { title, content } = await importFile('team_plan.md', Buffer.from(md))
    expect(title).toBe('team plan')
    expect(types(content)).toEqual(['heading', 'paragraph', 'bulletList', 'orderedList'])
    expect(JSON.stringify(content)).toContain('"type":"bold"')
    expect(JSON.stringify(content)).not.toContain('alert')
  })

  it('turns plain text paragraphs into paragraphs', async () => {
    const { content } = await importFile('notes.txt', Buffer.from('first line\nsame para\n\nsecond <b>para</b>'))
    expect(types(content)).toEqual(['paragraph', 'paragraph'])
    // Text files are text: angle brackets must survive as literal characters, not markup.
    expect(JSON.stringify(content)).toContain('second <b>para</b>')
  })

  it('rejects unsupported, empty and oversized files with a clear message', async () => {
    await expect(importFile('image.png', Buffer.from('x'))).rejects.toThrow(/Unsupported file type/)
    await expect(importFile('empty.txt', Buffer.alloc(0))).rejects.toBeInstanceOf(AppError)
    await expect(importFile('big.txt', Buffer.alloc(3 * 1024 * 1024, 'a'))).rejects.toThrow(/2 MB/)
    await expect(importFile('broken.docx', Buffer.from('not a zip'))).rejects.toThrow(/docx/)
  })
})
