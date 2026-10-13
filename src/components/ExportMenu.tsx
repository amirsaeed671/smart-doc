'use client'

import { useEffect, useRef, useState } from 'react'

export function ExportMenu({ docId, title }: { docId: string; title: string }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  function printPdf() {
    setOpen(false)
    // The browser's "Save as PDF" uses document.title as the default file name.
    const previous = document.title
    document.title = title
    window.print()
    document.title = previous
  }

  return (
    <div className="menu" ref={ref}>
      <button className="btn btn-sm" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        ⤓ Export
      </button>
      {open && (
        <div className="menu-list" role="menu">
          <a role="menuitem" href={`/api/documents/${docId}/export?format=md`} onClick={() => setOpen(false)} download>
            Markdown (.md)
          </a>
          <button role="menuitem" onClick={printPdf}>
            PDF (via print dialog)
          </button>
        </div>
      )}
    </div>
  )
}
