'use client'

import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import { useEffect, useRef, useState } from 'react'
import type { PublicUser } from './types'

/**
 * Presence + change notifications over Supabase Realtime.
 *
 * Deliberately, no document content travels over the socket: peers only
 * announce "I saved version N" (or "title/sharing changed"), and receivers
 * re-fetch through the authenticated API. The socket channel is therefore not
 * an access-control boundary; the REST API remains the only path to data.
 */

export type DocEvent =
  | { type: 'saved'; version: number; by: string }
  | { type: 'title'; title: string; by: string }
  | { type: 'access'; by: string }
  | { type: 'comments'; by: string }
  /** "I'm typing right now" pulse, throttled by the sender; drives the live editing indicator. */
  | { type: 'activity'; userId: string; name: string }

export interface PresenceUser {
  id: string
  name: string
  color: string
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
export const realtimeEnabled = Boolean(url && anonKey)

let client: SupabaseClient | null = null
function getClient() {
  if (!realtimeEnabled) return null
  client ??= createClient(url!, anonKey!, { auth: { persistSession: false } })
  return client
}

export function useDocumentChannel(docId: string, me: PublicUser & { color: string }, onEvent: (e: DocEvent) => void) {
  const [peers, setPeers] = useState<PresenceUser[]>([])
  const [connected, setConnected] = useState(false)
  const channelRef = useRef<RealtimeChannel | null>(null)
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    const supabase = getClient()
    if (!supabase) return
    const channel = supabase.channel(`doc:${docId}`, {
      config: { presence: { key: me.id }, broadcast: { self: false } },
    })
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresenceUser>()
        const unique = new Map<string, PresenceUser>()
        for (const metas of Object.values(state)) for (const m of metas) if (m.id !== me.id) unique.set(m.id, m)
        setPeers([...unique.values()])
      })
      .on('broadcast', { event: 'doc' }, ({ payload }) => onEventRef.current(payload as DocEvent))
      .subscribe(async (status) => {
        setConnected(status === 'SUBSCRIBED')
        if (status === 'SUBSCRIBED') await channel.track({ id: me.id, name: me.name, color: me.color })
      })
    channelRef.current = channel
    return () => {
      channelRef.current = null
      supabase.removeChannel(channel)
    }
  }, [docId, me.id, me.name, me.color])

  const broadcast = (event: DocEvent) => {
    channelRef.current?.send({ type: 'broadcast', event: 'doc', payload: event })
  }

  return { peers, connected, broadcast }
}
