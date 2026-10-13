import type { JSONContent } from '@tiptap/core'

export type Role = 'owner' | 'editor' | 'viewer'
export type ShareRole = Exclude<Role, 'owner'>

export interface PublicUser {
  id: string
  email: string
  name: string
}

export interface DocumentSummary {
  id: string
  title: string
  role: Role
  owner: PublicUser
  preview: string
  updatedAt: string
  updatedByName: string | null
}

export interface DocumentDetail extends DocumentSummary {
  content: JSONContent
  version: number
}

export interface Share {
  user: PublicUser
  role: ShareRole
  createdAt: string
}
