import type { JSONContent } from '@tiptap/core'

export type Role = 'owner' | 'editor' | 'commenter' | 'viewer'
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

export interface Comment {
  id: string
  author: PublicUser
  body: string
  createdAt: string
}

export interface CommentThread extends Comment {
  /** Text the comment was anchored to when it was created (null for general comments). */
  quote: string | null
  resolvedAt: string | null
  resolvedByName: string | null
  replies: Comment[]
}

export interface VersionSummary {
  id: string
  version: number
  title: string
  authorName: string | null
  label: string | null
  createdAt: string
  updatedAt: string
}

export interface VersionDetail extends VersionSummary {
  content: JSONContent
}
