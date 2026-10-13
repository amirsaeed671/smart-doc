import { NextResponse } from 'next/server'
import { readJson, withUser } from '@/lib/api'
import { createDocument, listDocuments } from '@/lib/documents'

export const GET = withUser(async ({ db, user }) => NextResponse.json(await listDocuments(db, user.id)))

export const POST = withUser(async ({ req, db, user }) => {
  const body = await readJson(req)
  const document = await createDocument(db, user.id, { title: body.title })
  return NextResponse.json({ document }, { status: 201 })
})
