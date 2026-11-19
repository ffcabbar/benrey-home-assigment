import type { Field, SanitizedCollectionPermission } from 'payload'

import { COLLECTION_RULES, type FieldHelpCollection } from './rules'

export type FieldInfo = {
  name: string
  label: string
  type: string
  required: boolean
  editable: boolean
  description?: string
  options?: string[]
  min?: number
  max?: number
  minLength?: number
  maxLength?: number
  relatesTo?: string
  calculated?: boolean
}

export type FormContext = {
  collection: string
  label: string
  description?: string
  permissions: { create: boolean; update: boolean; delete: boolean }
  fields: FieldInfo[]
  rules: string[]
}

type CollectionLike = {
  slug: string
  labels?: { singular?: unknown; plural?: unknown }
  admin?: { description?: unknown }
  fields: Field[]
}

const SKIPPED_FIELD_NAMES = new Set(['id', 'createdAt', 'updatedAt'])

const humanize = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (c) => c.toUpperCase())

const textOf = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() ? value : undefined)

type FieldPerm = SanitizedCollectionPermission['fields']

// Where-based access (e.g. staff updating only their own user) arrives as
// `{ permission: true, where }` rather than `true`.
export const isAllowed = (value: unknown): boolean =>
  value === true ||
  (typeof value === 'object' && value !== null && (value as { permission?: unknown }).permission === true)

const fieldPermission = (perms: FieldPerm | undefined, name: string) => {
  if (perms === true) return { read: true, write: true }
  const entry = perms?.[name]
  if (entry === true) return { read: true, write: true }
  if (!entry) return { read: false, write: false }
  return { read: isAllowed(entry.read), write: isAllowed(entry.update) || isAllowed(entry.create) }
}

type NamedField = Extract<Field, { name: string }>
type Permission = ReturnType<typeof fieldPermission>

/** The fields that hold data, with layout-only wrappers (rows, collapsibles, unnamed tabs) flattened away. */
function dataFields(fields: Field[]): Field[] {
  return fields.flatMap((field) => {
    if (field.type === 'row' || field.type === 'collapsible') return dataFields(field.fields)
    if (field.type === 'tabs') {
      return field.tabs.flatMap((tab) => ('name' in tab && tab.name ? [] : dataFields(tab.fields)))
    }
    return [field]
  })
}

/** Named, visible fields that are not system timestamps. Permissions are checked separately. */
function isShownField(field: Field): field is NamedField {
  if (field.type === 'ui' || !('name' in field) || !field.name) return false
  if (SKIPPED_FIELD_NAMES.has(field.name)) return false
  return !(field.hidden || field.admin?.hidden || field.admin?.disabled)
}

function describeField(field: NamedField, permission: Permission): FieldInfo {
  const admin = (field.admin ?? {}) as { description?: unknown; readOnly?: boolean }
  const isVirtual = 'virtual' in field && !!field.virtual
  const info: FieldInfo = {
    name: field.name,
    label: textOf(field.label) ?? humanize(field.name),
    type: field.type,
    required: 'required' in field && field.required === true,
    editable: permission.write && !admin.readOnly && !isVirtual,
  }
  const description = textOf(admin.description)
  if (description) info.description = description
  if (isVirtual) info.calculated = true

  if (field.type === 'select' || field.type === 'radio') {
    info.options = field.options.map((option) =>
      typeof option === 'string' ? option : `${option.value} (${textOf(option.label) ?? option.value})`,
    )
  }
  if (field.type === 'number') {
    if (typeof field.min === 'number') info.min = field.min
    if (typeof field.max === 'number') info.max = field.max
  }
  if (field.type === 'text' || field.type === 'textarea') {
    if (typeof field.minLength === 'number') info.minLength = field.minLength
    if (typeof field.maxLength === 'number') info.maxLength = field.maxLength
  }
  if (field.type === 'relationship' || field.type === 'upload') {
    info.relatesTo = Array.isArray(field.relationTo) ? field.relationTo.join(', ') : field.relationTo
  }
  if (field.type === 'join') {
    info.relatesTo = Array.isArray(field.collection) ? field.collection.join(', ') : field.collection
    info.editable = false
  }
  return info
}

/** What the assistant is told about each field this user can read. */
function describeFields(fields: Field[], perms: FieldPerm | undefined): FieldInfo[] {
  return dataFields(fields)
    .filter(isShownField)
    .flatMap((field) => {
      const permission = fieldPermission(perms, field.name)
      return permission.read ? [describeField(field, permission)] : []
    })
}

export function buildFormContext(
  collection: CollectionLike,
  permissions: SanitizedCollectionPermission | undefined,
): FormContext | null {
  if (!permissions || !isAllowed(permissions.read)) return null
  return {
    collection: collection.slug,
    label: textOf(collection.labels?.singular) ?? humanize(collection.slug),
    description: textOf(collection.admin?.description),
    permissions: {
      create: isAllowed(permissions.create),
      update: isAllowed(permissions.update),
      delete: isAllowed(permissions.delete),
    },
    fields: describeFields(collection.fields, permissions.fields),
    rules: COLLECTION_RULES[collection.slug as FieldHelpCollection] ?? [],
  }
}

export function renderFormContext(context: FormContext): string {
  const can = context.permissions
  const lines = [
    `Form: ${context.label} (collection "${context.collection}")`,
    context.description ? `About: ${context.description}` : null,
    `This user can: ${[can.create && 'create', can.update && 'edit', can.delete && 'delete'].filter(Boolean).join(', ') || 'only view'} records here.`,
    '',
    'Fields:',
    ...context.fields.map((f) => {
      const facts = [
        f.type,
        f.required ? 'required' : 'optional',
        f.editable ? null : 'read-only for this user',
        f.calculated ? 'calculated automatically' : null,
        f.relatesTo ? `links to ${f.relatesTo}` : null,
        f.options ? `options: ${f.options.join(', ')}` : null,
        f.min !== undefined ? `min ${f.min}` : null,
        f.max !== undefined ? `max ${f.max}` : null,
        f.minLength !== undefined ? `min length ${f.minLength}` : null,
        f.maxLength !== undefined ? `max length ${f.maxLength}` : null,
      ].filter(Boolean)
      return `- ${f.label} [${f.name}; ${facts.join('; ')}]${f.description ? `: ${f.description}` : ''}`
    }),
    '',
    'Rules:',
    ...context.rules.map((rule) => `- ${rule}`),
  ]
  return lines.filter((line) => line !== null).join('\n')
}
