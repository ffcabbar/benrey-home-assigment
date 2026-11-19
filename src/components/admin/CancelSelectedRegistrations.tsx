'use client'

import { Button, ConfirmationModal, toast, useConfig, useModal, useSelection } from '@payloadcms/ui'
import { useRouter } from 'next/navigation'
import React, { useState } from 'react'

const MODAL_SLUG = 'cancel-selected-registrations'

export function CancelSelectedRegistrations() {
  const { selectedIDs, selectAll, setSelection, count } = useSelection()
  const { openModal } = useModal()
  const {
    config: {
      routes: { api },
      serverURL,
    },
  } = useConfig()
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const acrossPages = selectAll === 'allAvailable'
  const selected = acrossPages ? 0 : selectedIDs.length
  const canCancel = selected > 0 && !busy

  const cancelSelected = async () => {
    const ids = [...selectedIDs]
    if (acrossPages || ids.length === 0) return
    setBusy(true)
    try {
      const response = await fetch(`${serverURL}${api}/registrations/cancel`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const body = (await response.json().catch(() => ({}))) as {
        cancelled?: number
        skipped?: number
        message?: string
      }
      if (!response.ok) {
        toast.error(body.message ?? 'Could not cancel the selected registrations.')
        return
      }
      toast.success(`Cancelled ${body.cancelled ?? 0}, skipped ${body.skipped ?? 0}`)
      for (const id of ids) setSelection(id)
      router.refresh()
    } catch {
      // The request may have reached the server before the connection dropped, so don't claim
      // either outcome. No automatic refresh: it would fail the same way while offline.
      // Retrying is safe, already cancelled rows are skipped.
      toast.error("We couldn't confirm the result. Reload the list to check the selected registrations before retrying.")
    } finally {
      setBusy(false)
    }
  }

  let hint = 'Tick registrations to cancel several at once. Already cancelled rows are skipped.'
  if (acrossPages) hint = `All ${count} matching rows are selected. Cancelling works on the rows of the current page: untick "select all" first.`
  else if (selected > 0) hint = `${selected} selected. Already cancelled rows are skipped.`

  return (
    <div
      data-testid="bulk-cancel-bar"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'calc(var(--base) * 0.75)',
        // Fixed height, so ticking a row never moves the table under the pointer.
        height: 44,
        overflow: 'hidden',
        boxSizing: 'border-box',
        marginBottom: 'calc(var(--base) * 0.75)',
        padding: 'calc(var(--base) * 0.25) calc(var(--base) * 0.75)',
        border: '1px solid var(--theme-elevation-150)',
        borderRadius: 'var(--style-radius-m)',
        background: 'var(--theme-elevation-50)',
      }}
    >
      <div style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>
        <Button
          buttonStyle="secondary"
          size="small"
          margin={false}
          disabled={!canCancel}
          onClick={() => openModal(MODAL_SLUG)}
        >
          {busy ? 'Cancelling…' : 'Cancel selected registrations'}
        </Button>
      </div>
      <span
        style={{
          color: 'var(--theme-elevation-600)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          minWidth: 0,
        }}
        title={hint}
      >
        {hint}
      </span>
      <ConfirmationModal
        modalSlug={MODAL_SLUG}
        heading="Cancel registrations?"
        body={`Cancel ${selected} registration(s)? This frees their seats and can't be undone; to book again, create a new registration.`}
        confirmLabel="Cancel registrations"
        cancelLabel="Keep them"
        confirmingLabel="Cancelling…"
        onConfirm={cancelSelected}
      />
    </div>
  )
}
