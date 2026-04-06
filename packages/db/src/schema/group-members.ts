import { pgTable, uuid, text, timestamp, primaryKey } from 'drizzle-orm/pg-core';
import { groups } from './groups.js';
import { users } from './users.js';

// ---------------------------------------------------------------------------
// SCIM Group Members
// ---------------------------------------------------------------------------

export const groupMembers = pgTable(
  'group_members',
  {
    groupId: uuid('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),

    addedBy: text('added_by').notNull().default('scim'),
  },
  (t) => [primaryKey({ columns: [t.groupId, t.userId] })],
);
