import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   ALTER TABLE "sessions" ADD COLUMN "display_title" varchar;
  CREATE INDEX "sessions_display_title_idx" ON "sessions" USING btree ("display_title");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP INDEX "sessions_display_title_idx";
  ALTER TABLE "sessions" DROP COLUMN "display_title";`)
}
