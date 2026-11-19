import fs from 'node:fs'
import path from 'node:path'
import type { CollectionConfig, Field } from 'payload'
import { describe, expect, it } from 'vitest'

import { Attendees } from '@/collections/Attendees'
import { Events } from '@/collections/Events'
import { Registrations } from '@/collections/Registrations'
import { Sessions } from '@/collections/Sessions'

// The README's ER diagram is the schema reviewers read first. This keeps it from drifting:
// every stored column of the domain tables must be in the diagram, and nothing else.

const PAYLOAD_TIMESTAMPS = new Set(['created_at', 'updated_at'])

const snakeCase = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

/** Columns Postgres stores for these fields: virtual and join fields are computed on read. */
function storedColumns(fields: Field[]): string[] {
  return fields.flatMap((field) => {
    if (field.type === 'row' || field.type === 'collapsible') return storedColumns(field.fields)
    if (field.type === 'join' || field.type === 'ui' || !('name' in field)) return []
    if ('virtual' in field && field.virtual) return []
    const column = snakeCase(field.name)
    return [field.type === 'relationship' || field.type === 'upload' ? `${column}_id` : column]
  })
}

function diagramColumns(): Map<string, string[]> {
  const readme = fs.readFileSync(path.resolve('README.md'), 'utf8')
  const diagram = /## Data model\s+```mermaid\n([\s\S]*?)```/.exec(readme)?.[1]
  if (!diagram) throw new Error('README.md has no Mermaid diagram under "## Data model"')
  const tables = new Map<string, string[]>()
  for (const [, table, body] of diagram.matchAll(/^\s*(\w+)\s*\{\n([\s\S]*?)^\s*\}/gm)) {
    const columns = body
      .split('\n')
      .map((line) => line.trim().split(/\s+/)[1])
      .filter((column): column is string => Boolean(column))
    tables.set(table, columns)
  }
  return tables
}

describe('README data model diagram', () => {
  const diagram = diagramColumns()

  it.each<CollectionConfig>([Events, Sessions, Attendees, Registrations])('lists every stored column of $slug', (collection) => {
    const documented = (diagram.get(collection.slug) ?? []).filter((column) => column !== 'id')
    const stored = storedColumns(collection.fields).filter((column) => !PAYLOAD_TIMESTAMPS.has(column))
    expect(documented.sort()).toEqual(stored.sort())
  })

  it('draws the many-to-many between attendees and sessions through registrations', () => {
    const readme = fs.readFileSync(path.resolve('README.md'), 'utf8')
    expect(readme).toMatch(/sessions \|\|--o\{ registrations/)
    expect(readme).toMatch(/attendees \|\|--o\{ registrations/)
  })
})
