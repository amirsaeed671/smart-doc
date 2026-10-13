import type { JSONContent } from '@tiptap/core'

/**
 * Serialise editor JSON to GitHub-flavoured Markdown.
 * Covers every node/mark the editor schema allows. Underline has no Markdown
 * equivalent, so it is emitted as inline <u> HTML, which most renderers accept.
 */

const escapeText = (s: string) => s.replace(/([\\`*_[\]#<>|])/g, '\\$1')

type Mark = NonNullable<JSONContent['marks']>[number]

function wrap(text: string, mark: Mark): string {
  switch (mark.type) {
    case 'bold':
      return `**${text}**`
    case 'italic':
      return `_${text}_`
    case 'strike':
      return `~~${text}~~`
    case 'underline':
      return `<u>${text}</u>`
    case 'link':
      return `[${text}](${String(mark.attrs?.href ?? '').replace(/\)/g, '%29')})`
    default:
      return text
  }
}

function inline(nodes: JSONContent[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === 'hardBreak') return '  \n'
      if (n.type !== 'text' || !n.text) return ''
      const marks = n.marks ?? []
      if (marks.some((m) => m.type === 'code')) {
        const fence = n.text.includes('`') ? '``' : '`'
        return marks.filter((m) => m.type === 'link').reduce((t, m) => wrap(t, m), `${fence}${n.text}${fence}`)
      }
      // Keep surrounding whitespace outside the markers (`** bold**` is not bold in Markdown).
      const [, lead, core, trail] = n.text.match(/^(\s*)([\s\S]*?)(\s*)$/)!
      if (!core) return n.text
      // Apply link last so emphasis ends up inside the link text.
      const ordered = [...marks.filter((m) => m.type !== 'link'), ...marks.filter((m) => m.type === 'link')]
      return lead + ordered.reduce((t, m) => wrap(t, m), escapeText(core)) + trail
    })
    .join('')
}

const indent = (text: string, prefix: string) =>
  text
    .split('\n')
    .map((line, i) => (i === 0 ? line : line ? ' '.repeat(prefix.length) + line : line))
    .join('\n')

function block(node: JSONContent): string {
  switch (node.type) {
    case 'paragraph':
      return inline(node.content)
    case 'heading':
      return `${'#'.repeat(Number(node.attrs?.level ?? 1))} ${inline(node.content)}`
    case 'blockquote':
      return blocks(node.content)
        .split('\n')
        .map((l) => (l ? `> ${l}` : '>'))
        .join('\n')
    case 'codeBlock': {
      const text = (node.content ?? []).map((n) => n.text ?? '').join('')
      return `\`\`\`${node.attrs?.language ?? ''}\n${text}\n\`\`\``
    }
    case 'horizontalRule':
      return '---'
    case 'bulletList':
    case 'orderedList': {
      const start = Number(node.attrs?.start ?? 1)
      return (node.content ?? [])
        .map((item, i) => {
          const prefix = node.type === 'bulletList' ? '- ' : `${start + i}. `
          // Tight list: join an item's blocks with single newlines.
          const body = (item.content ?? []).map(block).join('\n')
          return prefix + indent(body, prefix)
        })
        .join('\n')
    }
    default:
      return node.content ? blocks(node.content) : ''
  }
}

function blocks(nodes: JSONContent[] = []): string {
  return nodes.map(block).join('\n\n')
}

export function docToMarkdown(doc: JSONContent, title?: string): string {
  const body = blocks(doc.content).replace(/\n{3,}/g, '\n\n').trim()
  const firstHeading = doc.content?.[0]?.type === 'heading' ? inline(doc.content[0].content) : null
  // Prepend the title unless the document already starts with it as a heading.
  const head = title && firstHeading !== escapeText(title) ? `# ${escapeText(title)}\n\n` : ''
  return `${head}${body}\n`
}
