import { APIError, type CollectionBeforeDeleteHook, type CollectionSlug } from 'payload'

export const preventDeleteWhenReferenced =
  (refs: Array<{ collection: CollectionSlug; field: string; label: string }>): CollectionBeforeDeleteHook =>
  async ({ id, req }) => {
    for (const ref of refs) {
      const { totalDocs } = await req.payload.count({
        collection: ref.collection,
        where: { [ref.field]: { equals: id } },
        req,
        overrideAccess: true,
      })
      if (totalDocs > 0) {
        throw new APIError(
          `This record still has ${totalDocs} ${ref.label}. Delete or move them first.`,
          409,
          null,
          true,
        )
      }
    }
  }

export const slugify = (value: string): string =>
  value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)

export const relationId = (value: unknown): number | string | undefined => {
  if (value === null || value === undefined) return undefined
  if (typeof value === 'number' || typeof value === 'string') return value
  if (typeof value === 'object' && 'id' in value) return (value as { id: number | string }).id
  return undefined
}
