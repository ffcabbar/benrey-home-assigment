import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION "registrations_enforce_rules"() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      seat_limit numeric;
      session_start timestamptz;
      session_end timestamptz;
      taken integer;
      clash_session integer;
    BEGIN
      IF TG_OP = 'UPDATE' AND OLD."status" = 'cancelled' AND NEW."status" = 'confirmed' THEN
        RAISE EXCEPTION 'REGISTRATION_CANCELLED: registration % was cancelled and cannot be confirmed again', OLD."id"
          USING ERRCODE = 'BR002';
      END IF;

      IF NEW."status" <> 'confirmed' THEN
        RETURN NEW;
      END IF;

      -- Lock order is always attendee, then session, so the overlap and capacity checks can't
      -- deadlock and each sees the other transaction's committed row.
      PERFORM 1 FROM "attendees" WHERE "id" = NEW."attendee_id" FOR UPDATE;

      SELECT "capacity", "starts_at", "ends_at" INTO seat_limit, session_start, session_end
        FROM "sessions" WHERE "id" = NEW."session_id" FOR UPDATE;
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

      -- Same session is a duplicate, reported by the partial unique index instead.
      SELECT s."id" INTO clash_session
        FROM "registrations" r
        JOIN "sessions" s ON s."id" = r."session_id"
       WHERE r."attendee_id" = NEW."attendee_id"
         AND r."status" = 'confirmed'
         AND r."id" IS DISTINCT FROM NEW."id"
         AND r."session_id" <> NEW."session_id"
         AND s."starts_at" < session_end
         AND session_start < s."ends_at"
       LIMIT 1;

      IF clash_session IS NOT NULL THEN
        RAISE EXCEPTION 'ATTENDEE_OVERLAP: attendee % is already booked into overlapping session %', NEW."attendee_id", clash_session
          USING ERRCODE = 'BR004';
      END IF;
      RETURN NEW;
    END;
    $$;

    DROP TRIGGER "registrations_enforce_rules" ON "registrations";
    CREATE TRIGGER "registrations_enforce_rules"
      BEFORE INSERT OR UPDATE OF "status", "session_id", "attendee_id" ON "registrations"
      FOR EACH ROW EXECUTE FUNCTION "registrations_enforce_rules"();

    CREATE FUNCTION "sessions_enforce_no_attendee_overlap"() RETURNS trigger
    LANGUAGE plpgsql AS $$
    DECLARE
      clash_attendee integer;
    BEGIN
      IF NEW."starts_at" = OLD."starts_at" AND NEW."ends_at" = OLD."ends_at" THEN
        RETURN NEW;
      END IF;
      SELECT mine."attendee_id" INTO clash_attendee
        FROM "registrations" mine
        JOIN "registrations" other
          ON other."attendee_id" = mine."attendee_id"
         AND other."status" = 'confirmed'
         AND other."session_id" <> NEW."id"
        JOIN "sessions" s ON s."id" = other."session_id"
       WHERE mine."session_id" = NEW."id"
         AND mine."status" = 'confirmed'
         AND s."starts_at" < NEW."ends_at"
         AND NEW."starts_at" < s."ends_at"
       LIMIT 1;
      IF clash_attendee IS NOT NULL THEN
        RAISE EXCEPTION 'SESSION_TIME_CONFLICT: new times for session % overlap another booking of attendee %', NEW."id", clash_attendee
          USING ERRCODE = 'BR005';
      END IF;
      RETURN NEW;
    END;
    $$;

    CREATE TRIGGER "sessions_enforce_no_attendee_overlap"
      BEFORE UPDATE OF "starts_at", "ends_at" ON "sessions"
      FOR EACH ROW EXECUTE FUNCTION "sessions_enforce_no_attendee_overlap"();
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    DROP TRIGGER IF EXISTS "sessions_enforce_no_attendee_overlap" ON "sessions";
    DROP FUNCTION IF EXISTS "sessions_enforce_no_attendee_overlap"();

    CREATE OR REPLACE FUNCTION "registrations_enforce_rules"() RETURNS trigger
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

    DROP TRIGGER "registrations_enforce_rules" ON "registrations";
    CREATE TRIGGER "registrations_enforce_rules"
      BEFORE INSERT OR UPDATE OF "status", "session_id" ON "registrations"
      FOR EACH ROW EXECUTE FUNCTION "registrations_enforce_rules"();
  `)
}
