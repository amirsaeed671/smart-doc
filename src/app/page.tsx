import { redirect } from 'next/navigation'
import { currentUser } from '@/lib/api'
import { getDb } from '@/lib/db'
import { listDocuments } from '@/lib/documents'
import { Dashboard } from '@/components/Dashboard'

export const dynamic = 'force-dynamic'

export default async function HomePage() {
  const db = await getDb()
  const user = await currentUser(db)
  if (!user) redirect('/login')
  const docs = await listDocuments(db, user.id)
  return <Dashboard user={user} initial={docs} />
}
