import { Database } from 'bun:sqlite';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { BunSQLiteDatabase, drizzle } from 'drizzle-orm/bun-sqlite';
import { seedTestDb } from '../__tests__/seed';
import { DB_PATH, DRIZZLE_PATH } from '../helpers/paths';
import { IS_E2E } from '../utils/env';
import { seedDatabase } from './seed';

let db: BunSQLiteDatabase;

const ensureMessageBusinessIdColumn = (sqlite: Database) => {
  const columns = sqlite
    .query('PRAGMA table_info(messages)')
    .all() as Array<{ name: string }>;

  if (!columns.some((column) => column.name === 'message_id')) {
    sqlite.run('ALTER TABLE messages ADD COLUMN message_id text;');
  }

  sqlite.run(
    "UPDATE messages SET message_id = 'm_' || lower(hex(randomblob(6))) WHERE message_id IS NULL OR length(message_id) > 18;"
  );

  sqlite.run(
    'CREATE UNIQUE INDEX IF NOT EXISTS messages_message_id_idx ON messages (message_id);'
  );
};

const loadDb = async () => {
  const sqlite = new Database(DB_PATH, { create: true, strict: true });

  sqlite.run('PRAGMA foreign_keys = ON;');

  db = drizzle({ client: sqlite });

  await migrate(db, { migrationsFolder: DRIZZLE_PATH });
  ensureMessageBusinessIdColumn(sqlite);

  if (!IS_E2E) {
    await seedDatabase();
  } else {
    await seedTestDb(db);
  }
};

export { db, loadDb };
