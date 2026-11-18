import { postgresAdapter } from '@payloadcms/db-postgres'
import { s3Storage } from '@payloadcms/storage-s3'
import path from 'path'
import { buildConfig, type Config } from 'payload'
import sharp from 'sharp'
import { fileURLToPath } from 'url'

import { fieldHelpEndpoint } from './ai/fieldHelp'
import { AiUsage } from './collections/AiUsage'
import { Attendees } from './collections/Attendees'
import { Events } from './collections/Events'
import { Media, MEDIA_MAX_BYTES } from './collections/Media'
import { Registrations } from './collections/Registrations'
import { Sessions } from './collections/Sessions'
import { Users } from './collections/Users'
import { getServerEnv, getServerURL } from './lib/env'
import { migrations } from './migrations'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

const env = getServerEnv()
const serverURL = getServerURL(env)

export default buildConfig({
  serverURL,
  secret: env.PAYLOAD_SECRET,
  csrf: [serverURL],
  cors: [serverURL],
  admin: {
    user: Users.slug,
    meta: { titleSuffix: ' · Event Registration' },
    importMap: { baseDir: path.resolve(dirname) },
    components: {
      providers: ['@/components/admin/FieldHelpProvider#FieldHelpProvider'],
    },
  },
  collections: [Events, Sessions, Attendees, Registrations, Media, Users, AiUsage],
  endpoints: [fieldHelpEndpoint],
  upload: { limits: { fileSize: MEDIA_MAX_BYTES } },
  typescript: { outputFile: path.resolve(dirname, 'payload-types.ts') },
  graphQL: { disable: true },
  loggingLevels: { RuleViolationError: 'info' } as Config['loggingLevels'],
  telemetry: false,
  db: postgresAdapter({
    pool: { connectionString: env.DATABASE_URL, max: 10 },
    // Migrations are the only source of truth; dev push would drop the hand-written triggers.
    push: false,
    migrationDir: path.resolve(dirname, 'migrations'),
    prodMigrations: process.env.PAYLOAD_MIGRATE_ON_INIT === 'true' ? migrations : undefined,
  }),
  sharp,
  plugins: [
    s3Storage({
      collections: { media: true },
      bucket: env.S3_BUCKET,
      disableLocalStorage: true,
      config: {
        endpoint: env.S3_ENDPOINT,
        region: env.S3_REGION,
        // Supabase Storage and MinIO need path-style URLs.
        forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY_ID,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY,
        },
      },
    }),
  ],
})
