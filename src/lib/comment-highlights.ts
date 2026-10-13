import { Extension, type Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'

/**
 * Comment anchoring by quoted text, rendered as editor decorations.
 *
 * Why not a mark stored in the document? Commenters don't have edit rights,
 * so adding a comment must not modify document content. Decorations are a
 * view-only layer: we search the current document for each comment's quote
 * and highlight the first match. If the quoted text is later edited away,
 * the comment survives and is shown as "original text changed".
 */

export interface HighlightedComment {
  id: string
  quote: string
}

interface PluginState {
  comments: HighlightedComment[]
  activeId: string | null
  decorations: DecorationSet
}

export const commentHighlightsKey = new PluginKey<PluginState>('commentHighlights')

/** Locate `quote` in the document. Blocks are joined with '\n', matching `textBetween(…, '\n')`. */
export function findQuote(doc: PMNode, quote: string): { from: number; to: number } | null {
  if (!quote) return null
  let text = ''
  const positions: number[] = []
  doc.descendants((node, pos) => {
    if (node.isText) {
      for (let i = 0; i < node.text!.length; i++) {
        text += node.text![i]
        positions.push(pos + i)
      }
    } else if ((node.isBlock || node.type.name === 'hardBreak') && text && !text.endsWith('\n')) {
      text += '\n'
      positions.push(-1)
    }
    return true
  })
  const index = text.indexOf(quote)
  if (index === -1) return null
  const from = positions[index]
  const last = positions[index + quote.length - 1]
  return from >= 0 && last >= 0 ? { from, to: last + 1 } : null
}

function buildDecorations(doc: PMNode, comments: HighlightedComment[], activeId: string | null) {
  const decorations: Decoration[] = []
  for (const c of comments) {
    const range = findQuote(doc, c.quote)
    if (!range) continue
    decorations.push(
      Decoration.inline(
        range.from,
        range.to,
        { class: `comment-mark${c.id === activeId ? ' is-active' : ''}`, 'data-comment-id': c.id },
        { commentId: c.id },
      ),
    )
  }
  return DecorationSet.create(doc, decorations)
}

/** Replace the highlighted comments / active comment without touching the document. */
export function setCommentHighlights(editor: Editor, comments: HighlightedComment[], activeId: string | null) {
  editor.view.dispatch(editor.state.tr.setMeta(commentHighlightsKey, { comments, activeId }))
}

/** The current selection as quotable text. Also works in read-only editors, where PM may not track selection. */
export function selectedQuote(editor: Editor): string {
  let { from, to } = editor.state.selection
  if (from === to && typeof window !== 'undefined') {
    const sel = window.getSelection()
    if (sel && !sel.isCollapsed && sel.anchorNode && editor.view.dom.contains(sel.anchorNode) && sel.focusNode) {
      try {
        const a = editor.view.posAtDOM(sel.anchorNode, sel.anchorOffset)
        const b = editor.view.posAtDOM(sel.focusNode, sel.focusOffset)
        ;[from, to] = a < b ? [a, b] : [b, a]
      } catch {
        return ''
      }
    }
  }
  return from === to ? '' : editor.state.doc.textBetween(from, to, '\n').trim().slice(0, 500)
}

export const CommentHighlights = Extension.create<{ onActivate: { current: (id: string) => void } }>({
  name: 'commentHighlights',

  addOptions() {
    return { onActivate: { current: () => {} } }
  },

  addProseMirrorPlugins() {
    const { onActivate } = this.options
    return [
      new Plugin<PluginState>({
        key: commentHighlightsKey,
        state: {
          init: (_, { doc }) => ({ comments: [], activeId: null, decorations: DecorationSet.create(doc, []) }),
          apply(tr, prev) {
            const meta = tr.getMeta(commentHighlightsKey) as Partial<PluginState> | undefined
            if (!meta && !tr.docChanged) return prev
            const next = { ...prev, ...meta }
            return { ...next, decorations: buildDecorations(tr.doc, next.comments, next.activeId) }
          },
        },
        props: {
          decorations: (state) => commentHighlightsKey.getState(state)?.decorations,
          handleClick(view, pos) {
            const found = commentHighlightsKey.getState(view.state)?.decorations.find(pos, pos)
            const id = found?.[0]?.spec.commentId as string | undefined
            if (id) onActivate.current(id)
            return false
          },
        },
      }),
    ]
  },
})
