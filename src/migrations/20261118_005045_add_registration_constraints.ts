import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE UNIQUE INDEX "registrations_one_confirmed_per_attendee_session"
      ON "registrations" ("attendee_id", "session_id")
      WHERE "status" = 'confirmed';

    CREATE INDEX "registrations_session_status_idx" ON "registrations" ("session_id", "status");

    ALTER TABLE "sessions" ADD CONSTRAINT "sessions_capacity_positive_integer"
      CHECK ("capacity" > 0 AND "capacity" = trunc("capacity"));
    ALTER TABLE "sessions" ADD CONSTRAINT "sessions_ends_after_starts" CHECK ("ends_at" > "starts_at");
    ALTER TABLE "events" ADD CONSTRAINT "events_ends_after_starts" CHECK ("ends_at" > "starts_at");

    CREATE FUNCTION "registrations_enforce_rules"() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      seat_limit numeric;
      taken integer;
    BEGIN
      IF TG_OP = 'UPDATE' AND OLD."status" = 'cancelled' AND NEW."status" = 'confirmed' THEN
        RAISE EXCEPTION 'REGISTRATION_CANCELLED: registration % was cancelled and cannot be confirmed again', OLD."id"
          USING ERRCODE = 'BR002';
      END IF;

      IF NEW."status" <> 'confirmed' THEN
        RETURN NEW;
      END IF;

      -- Row lock: concurrent bookings for this session wait here and then count committed seats.
      SELECT "capacity" INTO seat_limit FROM "sessions" WHERE "id" = NEW."session_id" FOR UPDATE;
      IF NOT FOUND THEN
        RETURN NEW; -- the foreign key reports a missing session
      END IF;

      SELECT count(*) INTO taken
        FROM "registrations"
       WHERE "session_id" = NEW."session_id"
         AND "status" = 'confirmed'
         AND "id" IS DISTINCT FROM NEW."id";

      IF taken >= seat_limit THEN
        RAISE EXCEPTION 'SESSION_FULL: session % has no free seats (capacity %)', NEW."session_id", seat_limit
          USING ERRCODE = 'BR001';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER "registrations_enforce_rules"
      BEFORE INSERT OR UPDATE OF "status", "session_id" ON "registrations"
      FOR EACH ROW EXECUTE FUNCTION "registrations_enforce_rules"();

    CREATE FUNCTION "sessions_enforce_capacity_floor"() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      taken integer;
    BEGIN
      IF NEW."capacity" >= OLD."capacity" THEN
        RETURN NEW;
      END IF;
      SELECT count(*) INTO taken
        FROM "registrations"
       WHERE "session_id" = NEW."id" AND "status" = 'confirmed';
      IF NEW."capacity" < taken THEN
        RAISE EXCEPTION 'CAPACITY_BELOW_CONFIRMED: session % has % confirmed registrations', NEW."id", taken
          USING ERRCODE = 'BR003';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER "sessions_enforce_capacity_floor"
      BEFORE UPDATE OF "capacity" ON "sessions"
      FOR EACH ROW EXECUTE FUNCTION "sessions_enforce_capacity_floor"();
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TRIGGER IF EXISTS "sessions_enforce_capacity_floor" ON "sessions";
    DROP FUNCTION IF EXISTS "sessions_enforce_capacity_floor"();
    DROP TRIGGER IF EXISTS "registrations_enforce_rules" ON "registrations";
    DROP FUNCTION IF EXISTS "registrations_enforce_rules"();
    ALTER TABLE "events" DROP CONSTRAINT IF EXISTS "events_ends_after_starts";
    ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_ends_after_starts";
    ALTER TABLE "sessions" DROP CONSTRAINT IF EXISTS "sessions_capacity_positive_integer";
    DROP INDEX IF EXISTS "registrations_session_status_idx";
    DROP INDEX IF EXISTS "registrations_one_confirmed_per_attendee_session";
  `)
}
