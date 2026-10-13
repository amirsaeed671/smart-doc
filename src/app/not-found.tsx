import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="center-page">
      <h1>Document not found</h1>
      <p className="muted">It may have been deleted, or it hasn&apos;t been shared with you.</p>
      <Link className="btn btn-primary" href="/">
        Back to documents
      </Link>
    </main>
  )
}
