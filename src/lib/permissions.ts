import type { Role } from './types'

/**
 * Role → capability table. Shared by API (enforcement) and UI (what to show),
 * so the two can't drift apart.
 *
 *            view  comment  edit/restore  share/delete
 *  viewer     ✓
 *  commenter  ✓      ✓
 *  editor     ✓      ✓          ✓
 *  owner      ✓      ✓          ✓              ✓
 */
export type Capability = 'view' | 'comment' | 'edit' | 'manage'

const RANK: Record<Role, number> = { viewer: 0, commenter: 1, editor: 2, owner: 3 }
const REQUIRED: Record<Capability, Role> = { view: 'viewer', comment: 'commenter', edit: 'editor', manage: 'owner' }

export const can = (role: Role, capability: Capability) => RANK[role] >= RANK[REQUIRED[capability]]

export const ROLE_LABELS: Record<Exclude<Role, 'owner'>, { label: string; description: string }> = {
  viewer: { label: 'Viewer', description: 'Can read and export' },
  commenter: { label: 'Commenter', description: 'Can read and comment' },
  editor: { label: 'Editor', description: 'Can edit, comment and restore versions' },
}
