import { notFound, redirect } from 'next/navigation'
import { currentUser } from '@/lib/api'
import { getDb } from '@/lib/db'
import { getDocument } from '@/lib/documents'
import { AppError } from '@/lib/errors'
import { DocumentEditor } from '@/components/DocumentEditor'

export const dynamic = 'force-dynamic'

export default async function DocPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const db = await getDb()
  const user = await currentUser(db)
  if (!user) redirect(`/login?next=/docs/${id}`)
  try {
    const doc = await getDocument(db, user.id, id)
    return <DocumentEditor user={user} initial={doc} />
  } catch (err) {
    if (err instanceof AppError && err.status === 404) notFound()
    throw err
  }
}
