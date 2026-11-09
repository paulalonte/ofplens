import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Drizzle table definitions. `pnpm db:generate` turns changes here into SQL migrations in
 * packages/db/migrations; review the SQL before committing it.
 */

/** The pilot using the app. Single row until multi-user support (see PLAN.md non-goals). */
export const pilots = pgTable(
  'pilots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    simbriefUsername: text('simbrief_username').notNull().unique(),
    /** SimBrief's numeric Pilot ID, learned from the first imported OFP (params.user_id). */
    simbriefPilotId: text('simbrief_pilot_id'),
    weightUnit: text('weight_unit', { enum: ['kgs', 'lbs'] })
      .notNull()
      .default('kgs'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [check('pilots_weight_unit_check', sql`${t.weightUnit} in ('kgs', 'lbs')`)],
);

export type PilotRow = typeof pilots.$inferSelect;
