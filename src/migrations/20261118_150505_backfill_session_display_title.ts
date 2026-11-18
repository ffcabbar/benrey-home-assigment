import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    UPDATE "sessions" s
       SET "display_title" = s."title" || ' — ' || e."title"
      FROM "events" e
     WHERE e."id" = s."event_id";

    UPDATE "registrations" r
       SET "label" = a."full_name" || ' → ' || s."display_title"
      FROM "attendees" a, "sessions" s
     WHERE a."id" = r."attendee_id" AND s."id" = r."session_id";
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    UPDATE "registrations" r
       SET "label" = a."full_name" || ' → ' || s."title"
      FROM "attendees" a, "sessions" s
     WHERE a."id" = r."attendee_id" AND s."id" = r."session_id";
  `)
}
