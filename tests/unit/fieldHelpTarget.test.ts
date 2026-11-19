import { describe, expect, it } from 'vitest'

import { resolveFieldHelpCollection } from '@/components/admin/fieldHelpTarget'

const onEvent = { pathname: '/admin/collections/events/12', adminRoute: '/admin' }

describe('resolveFieldHelpCollection', () => {
  it('uses the collection in the URL when no drawer is open', () => {
    expect(resolveFieldHelpCollection({ ...onEvent, modalState: {} })).toBe('events')
  })

  it('describes a session opened in a drawer from its event, not the event behind it', () => {
    const modalState = { 'doc-drawer_sessions_1_40_abc123': { isOpen: true } }
    expect(resolveFieldHelpCollection({ ...onEvent, modalState })).toBe('sessions')
  })

  it('reads real drawer keys, with and without a document id ("Add new")', () => {
    const editing = { 'doc-drawer_sessions_1_1__R_2iqmenajpbn5ritmb6jd9etb_': { isOpen: true } }
    const creating = { 'doc-drawer_sessions_1__R_2iqmenajpbn5ritmb6jd9etb_': { isOpen: true } }
    expect(resolveFieldHelpCollection({ ...onEvent, modalState: editing })).toBe('sessions')
    expect(resolveFieldHelpCollection({ ...onEvent, modalState: creating })).toBe('sessions')
  })

  it('ignores drawers that were closed', () => {
    const modalState = { 'doc-drawer_sessions_1_40_abc123': { isOpen: false } }
    expect(resolveFieldHelpCollection({ ...onEvent, modalState })).toBe('events')
  })

  it('picks the deepest of nested drawers', () => {
    const modalState = {
      'doc-drawer_sessions_1_40_abc': { isOpen: true },
      'doc-drawer_media_2_def': { isOpen: true },
    }
    expect(resolveFieldHelpCollection({ ...onEvent, modalState })).toBe('media')
  })

  it('ignores other modals such as confirmations and list drawers', () => {
    const modalState = {
      'cancel-selected-registrations': { isOpen: true },
      'list-drawer_1_sessions': { isOpen: true },
    }
    expect(resolveFieldHelpCollection({ ...onEvent, modalState })).toBe('events')
  })

  it('stays quiet for a drawer of a collection it has no rules for', () => {
    const modalState = { 'doc-drawer_payload-preferences_1_xyz': { isOpen: true } }
    expect(resolveFieldHelpCollection({ ...onEvent, modalState })).toBeNull()
  })

  it('returns null outside collection views and handles a root admin route', () => {
    expect(resolveFieldHelpCollection({ pathname: '/admin', adminRoute: '/admin', modalState: {} })).toBeNull()
    expect(resolveFieldHelpCollection({ pathname: '/collections/sessions', adminRoute: '/', modalState: {} })).toBe('sessions')
  })
})
