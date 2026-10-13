'use client'

import { useEditorState, type Editor } from '@tiptap/react'

type Block = 'paragraph' | 'h1' | 'h2' | 'h3'

export function Toolbar({
  editor,
  disabled,
  canComment,
  hasSelection,
  onComment,
}: {
  editor: Editor
  disabled: boolean
  canComment: boolean
  hasSelection: boolean
  onComment: () => void
}) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      underline: e.isActive('underline'),
      strike: e.isActive('strike'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      code: e.isActive('codeBlock'),
      block: (e.isActive('heading', { level: 1 })
        ? 'h1'
        : e.isActive('heading', { level: 2 })
          ? 'h2'
          : e.isActive('heading', { level: 3 })
            ? 'h3'
            : 'paragraph') as Block,
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  })

  const chain = () => editor.chain().focus()
  const setBlock = (b: Block) => {
    if (b === 'paragraph') chain().setParagraph().run()
    else chain().setHeading({ level: Number(b[1]) as 1 | 2 | 3 }).run()
  }

  const Btn = ({ active, onClick, label, children, enabled = true }: {
    active?: boolean
    onClick: () => void
    label: string
    children: React.ReactNode
    enabled?: boolean
  }) => (
    <button
      type="button"
      className={`tb-btn${active ? ' is-active' : ''}`}
      onMouseDown={(e) => e.preventDefault()} // keep the editor selection
      onClick={onClick}
      disabled={disabled || !enabled}
      aria-pressed={active}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  )

  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <Btn label="Undo (Ctrl+Z)" onClick={() => chain().undo().run()} enabled={s.canUndo}>↶</Btn>
      <Btn label="Redo (Ctrl+Shift+Z)" onClick={() => chain().redo().run()} enabled={s.canRedo}>↷</Btn>
      <span className="tb-sep" />
      <select
        className="tb-select"
        value={s.block}
        onChange={(e) => setBlock(e.target.value as Block)}
        disabled={disabled}
        aria-label="Text style"
      >
        <option value="paragraph">Normal text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>
      <span className="tb-sep" />
      <Btn label="Bold (Ctrl+B)" active={s.bold} onClick={() => chain().toggleBold().run()}><b>B</b></Btn>
      <Btn label="Italic (Ctrl+I)" active={s.italic} onClick={() => chain().toggleItalic().run()}><i>I</i></Btn>
      <Btn label="Underline (Ctrl+U)" active={s.underline} onClick={() => chain().toggleUnderline().run()}><u>U</u></Btn>
      <Btn label="Strikethrough" active={s.strike} onClick={() => chain().toggleStrike().run()}><s>S</s></Btn>
      <span className="tb-sep" />
      <Btn label="Bulleted list" active={s.bullet} onClick={() => chain().toggleBulletList().run()}>• List</Btn>
      <Btn label="Numbered list" active={s.ordered} onClick={() => chain().toggleOrderedList().run()}>1. List</Btn>
      <Btn label="Quote" active={s.quote} onClick={() => chain().toggleBlockquote().run()}>❝</Btn>
      <Btn label="Code block" active={s.code} onClick={() => chain().toggleCodeBlock().run()}>{'</>'}</Btn>
      {canComment && (
        <>
          <span className="tb-sep" />
          <button
            type="button"
            className="tb-btn tb-comment"
            onMouseDown={(e) => e.preventDefault()} // keep the text selection
            onClick={onComment}
            disabled={!hasSelection}
            title={hasSelection ? 'Comment on selection (Ctrl+Alt+M)' : 'Select text to comment on it'}
          >
            💬 Comment
          </button>
        </>
      )}
    </div>
  )
}
