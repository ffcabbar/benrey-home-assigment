import { FIELD_HELP_COLLECTIONS } from '@/ai/rules'

type ModalState = Record<string, { isOpen?: boolean } | undefined>

const isHelpCollection = (slug: string) => (FIELD_HELP_COLLECTIONS as readonly string[]).includes(slug)

/** The open document drawer nested deepest, if any. `key` is also the drawer element's DOM id. */
export function topDocumentDrawer(modalState: ModalState): { key: string; slug: string; depth: number } | null {
  let top: { key: string; slug: string; depth: number } | null = null
  for (const [key, modal] of Object.entries(modalState)) {
    if (!modal?.isOpen) continue
    const match = /^doc-drawer_(.+?)_(\d+)(?:_|$)/.exec(key)
    if (!match) continue
    const depth = Number(match[2])
    if (!top || depth > top.depth) top = { key, slug: match[1], depth }
  }
  return top
}

/**
 * Which form the field-help widget should describe. Payload opens related documents
 * (e.g. a session inside an event) in a drawer without changing the URL, so the
 * topmost open document drawer wins over the path. Drawer slugs look like
 * `doc-drawer_<collection>_<depth>[_<id>]_<uuid>`.
 */
export function resolveFieldHelpCollection({
  pathname,
  adminRoute,
  modalState,
}: {
  pathname: string | null
  adminRoute: string
  modalState: ModalState
}): string | null {
  const top = topDocumentDrawer(modalState)
  // A drawer for a form the assistant doesn't know: say nothing rather than describe the page behind it.
  if (top) return isHelpCollection(top.slug) ? top.slug : null

  if (!pathname) return null
  const prefix = `${adminRoute === '/' ? '' : adminRoute}/collections/`
  if (!pathname.startsWith(prefix)) return null
  const slug = pathname.slice(prefix.length).split('/')[0]
  return isHelpCollection(slug) ? slug : null
}
