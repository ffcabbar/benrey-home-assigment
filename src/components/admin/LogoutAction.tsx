'use client'

import { useAuth, useConfig } from '@payloadcms/ui'
import Link from 'next/link'
import { formatAdminURL } from 'payload/shared'
import React from 'react'

// Payload's own logout is an unlabelled icon at the bottom of the collapsed nav.
export function LogoutAction() {
  const { user } = useAuth()
  const {
    config: {
      admin: {
        routes: { logout },
      },
      routes: { admin: adminRoute },
    },
  } = useConfig()
  if (!user) return null

  const name = typeof user.name === 'string' && user.name ? user.name : user.email
  const role = typeof user.role === 'string' ? user.role : null

  return (
    <div className="logout-action" style={{ display: 'flex', alignItems: 'center', gap: 12, whiteSpace: 'nowrap', marginRight: 8 }}>
      <style>{'@media (max-width: 640px) { .logout-action__who { display: none; } }'}</style>
      <span className="logout-action__who" style={{ color: 'var(--theme-elevation-600)', fontSize: 13 }}>
        {name}
        {role ? ` · ${role}` : ''}
      </span>
      <Link
        href={formatAdminURL({ adminRoute, path: logout })}
        prefetch={false}
        data-testid="header-logout"
        style={{
          padding: '4px 12px',
          border: '1px solid var(--theme-elevation-250)',
          borderRadius: 'var(--style-radius-s)',
          color: 'var(--theme-text)',
          textDecoration: 'none',
          fontSize: 13,
        }}
      >
        Log out
      </Link>
    </div>
  )
}
