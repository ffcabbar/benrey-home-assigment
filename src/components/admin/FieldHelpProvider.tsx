'use client'

import { useConfig, useModal } from '@payloadcms/ui'
import { usePathname } from 'next/navigation'
import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { resolveFieldHelpCollection, topDocumentDrawer } from './fieldHelpTarget'

export function FieldHelpProvider({ children }: { children?: React.ReactNode }) {
  const pathname = usePathname()
  const { modalState } = useModal()
  const {
    config: {
      routes: { admin },
    },
  } = useConfig()
  const slug = resolveFieldHelpCollection({ pathname, adminRoute: admin, modalState })
  const drawerKey = topDocumentDrawer(modalState)?.key ?? null

  // A drawer covers the page and traps focus, so the widget has to live inside it to be usable.
  // The drawer element is mounted in the same commit that opens it, so look it up a frame later.
  const [drawerElement, setDrawerElement] = useState<HTMLElement | null>(null)
  useEffect(() => {
    if (!drawerKey) return
    const frame = requestAnimationFrame(() => setDrawerElement(document.getElementById(drawerKey)))
    return () => cancelAnimationFrame(frame)
  }, [drawerKey])
  const portalTarget = drawerKey && drawerElement?.id === drawerKey ? drawerElement : null

  const widget = slug ? <FieldHelpWidget key={`${drawerKey ?? 'page'}:${slug}`} slug={slug} /> : null
  if (!drawerKey) return <>{children}{widget}</>
  return (
    <>
      {children}
      {portalTarget && widget ? createPortal(widget, portalTarget) : null}
    </>
  )
}

const OFFLINE_MESSAGE = 'Assistant is offline — hints are shown under each field.'

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'answer'; text: string }
  | { kind: 'notice'; text: string }

function FieldHelpWidget({ slug }: { slug: string }) {
  const {
    config: {
      routes: { api },
      serverURL,
    },
  } = useConfig()
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [state, setState] = useState<State>({ kind: 'idle' })
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const ask = async (event: React.FormEvent) => {
    event.preventDefault()
    // Inside a drawer the widget is portalled into Payload's dialog, and React lets this submit
    // reach the document form behind the drawer, which would save that document.
    event.stopPropagation()
    const trimmed = question.trim()
    if (!trimmed || state.kind === 'loading') return
    setState({ kind: 'loading' })
    try {
      const response = await fetch(`${serverURL}${api}/field-help`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ collection: slug, question: trimmed }),
      })
      const body = (await response.json().catch(() => ({}))) as { answer?: string; error?: string; message?: string }
      if (response.ok && typeof body.answer === 'string') {
        setState({ kind: 'answer', text: body.answer })
      } else if (response.status === 429) {
        setState({ kind: 'notice', text: 'You have asked a lot of questions this hour. Try again later — hints are shown under each field.' })
      } else if (response.status === 400) {
        setState({ kind: 'notice', text: body.message ?? 'Please rephrase the question (1–500 characters).' })
      } else {
        setState({ kind: 'notice', text: OFFLINE_MESSAGE })
      }
    } catch {
      setState({ kind: 'notice', text: OFFLINE_MESSAGE })
    }
  }

  return (
    <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 50, maxWidth: 'calc(100vw - 40px)' }}>
      {open ? (
        <section
          aria-label="Ask about this form"
          style={{
            width: 360,
            maxWidth: '100%',
            background: 'var(--theme-elevation-0)',
            color: 'var(--theme-text)',
            border: '1px solid var(--theme-elevation-150)',
            borderRadius: 'var(--style-radius-m)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.18)',
            padding: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <strong>Ask about this form</strong>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              style={{ background: 'none', border: 0, cursor: 'pointer', color: 'inherit', fontSize: 18 }}
            >
              ×
            </button>
          </div>
          <form onSubmit={ask} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <textarea
              ref={inputRef}
              value={question}
              maxLength={500}
              rows={3}
              placeholder="e.g. Why can't I register this attendee?"
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) ask(e)
              }}
              style={{
                width: '100%',
                resize: 'vertical',
                font: 'inherit',
                padding: 8,
                background: 'var(--theme-input-bg)',
                color: 'inherit',
                border: '1px solid var(--theme-elevation-150)',
                borderRadius: 'var(--style-radius-s)',
              }}
            />
            <button
              type="submit"
              disabled={state.kind === 'loading' || question.trim() === ''}
              style={{
                alignSelf: 'flex-end',
                padding: '6px 14px',
                cursor: 'pointer',
                border: 0,
                borderRadius: 'var(--style-radius-s)',
                background: 'var(--theme-elevation-800)',
                color: 'var(--theme-elevation-0)',
              }}
            >
              {state.kind === 'loading' ? 'Thinking…' : 'Ask'}
            </button>
          </form>
          {state.kind === 'answer' || state.kind === 'notice' ? (
            <p
              role="status"
              style={{
                margin: 0,
                whiteSpace: 'pre-wrap',
                color: state.kind === 'notice' ? 'var(--theme-elevation-600)' : 'inherit',
              }}
            >
              {state.text}
            </p>
          ) : null}
          <small style={{ color: 'var(--theme-elevation-500)' }}>
            Answers come from this form&apos;s field definitions and may be incomplete.
          </small>
        </section>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          style={{
            padding: '10px 16px',
            borderRadius: 999,
            border: '1px solid var(--theme-elevation-150)',
            background: 'var(--theme-elevation-800)',
            color: 'var(--theme-elevation-0)',
            cursor: 'pointer',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          }}
        >
          Ask about this form
        </button>
      )}
    </div>
  )
}
