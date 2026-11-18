import { APIError, type CollectionConfig } from 'payload'

import { isAdmin, isStaff } from '@/access/roles'

export const MEDIA_MAX_BYTES = 2 * 1024 * 1024
export const MEDIA_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export const Media: CollectionConfig = {
  slug: 'media',
  labels: { singular: 'Image', plural: 'Images' },
  admin: {
    group: 'Events',
    useAsTitle: 'alt',
    defaultColumns: ['filename', 'alt', 'filesize', 'updatedAt'],
    listSearchableFields: ['alt', 'filename'],
    description: 'Event banner images (JPEG, PNG or WebP, up to 2 MB). Files are stored in the S3 bucket.',
  },
  access: {
    read: isStaff,
    create: isAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  upload: {
    disableLocalStorage: true,
    mimeTypes: MEDIA_MIME_TYPES,
    crop: false,
    focalPoint: false,
  },
  hooks: {
    beforeOperation: [
      // The body-parser limit only covers REST uploads; this also covers the Local API.
      ({ operation, req }) => {
        if ((operation === 'create' || operation === 'update') && req.file && req.file.size > MEDIA_MAX_BYTES) {
          throw new APIError('Images must be 2 MB or smaller.', 400, null, true)
        }
      },
    ],
  },
  fields: [
    {
      name: 'alt',
      type: 'text',
      required: true,
      admin: {
        description:
          'Short description of the image for screen readers, e.g. "Main hall with audience". Required.',
      },
    },
  ],
}
