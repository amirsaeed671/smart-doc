import { NextResponse } from 'next/server'
import { withUser } from '@/lib/api'
import { createDocument } from '@/lib/documents'
import { badRequest } from '@/lib/errors'
import { importFile } from '@/lib/importer'

export const POST = withUser(async ({ req, db, user }) => {
  const form = await req.formData().catch(() => {
    throw badRequest('Expected a multipart form upload.')
  })
  const file = form.get('file')
  if (!(file instanceof File)) throw badRequest('Attach a file in the "file" field.')

  const { title, content } = await importFile(file.name, Buffer.from(await file.arrayBuffer()))
  const document = await createDocument(db, user.id, { title, content })
  return NextResponse.json({ document }, { status: 201 })
})
