import type { CollectionConfig } from 'payload'

import { nobody } from '@/access/roles'

export const AiUsage: CollectionConfig = {
  slug: 'ai-usage',
  labels: { singular: 'Assistant usage', plural: 'Assistant usage' },
  admin: { hidden: true, group: 'System' },
  access: {
    read: nobody,
    create: nobody,
    update: nobody,
    delete: nobody,
  },
  fields: [
    {
      name: 'user',
      type: 'relationship',
      relationTo: 'users',
      required: true,
      index: true,
      admin: { description: 'Who asked.' },
    },
    {
      name: 'collectionSlug',
      type: 'text',
      admin: { description: 'Which form the question was about.' },
    },
  ],
  timestamps: true,
}
