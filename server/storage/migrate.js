// Applies pending schema migrations to a D1 database. Applied migrations are recorded in the same
// `d1_migrations` table `wrangler d1 migrations` uses, so both tools agree on the database state.
// Each migration runs in one batch (a transaction) together with its record, so a migration that
// another isolate applied concurrently fails here as a whole and is then found recorded.

import bundledMigrations from './migrations.js';

const CREATE_MIGRATIONS_TABLE = `CREATE TABLE IF NOT EXISTS d1_migrations (
	id         INTEGER PRIMARY KEY AUTOINCREMENT,
	name       TEXT UNIQUE,
	applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
)`;

// Splits a migration file into statements: comments removed, statements end with `;` at the end of a line
const splitStatements = (sql)=>sql
	.replace(/--.*$/gm, '')
	.split(/;\s*$/m)
	.map((statement)=>statement.trim())
	.filter(Boolean);

const appliedNames = async (db)=>{
	const { results } = await db.prepare('SELECT name FROM d1_migrations').all();
	return new Set(results.map((row)=>row.name));
};

const migrate = async (db, migrations = bundledMigrations)=>{
	await db.prepare(CREATE_MIGRATIONS_TABLE).run();
	let applied = await appliedNames(db);

	for (const { name, sql } of migrations) {
		if(applied.has(name)) continue;
		try {
			await db.batch([
				...splitStatements(sql).map((statement)=>db.prepare(statement)),
				db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').bind(name)
			]);
		} catch (error) {
			applied = await appliedNames(db);
			if(!applied.has(name)) throw error;
		}
	}
};

// Migrates each database once per isolate; concurrent requests share the pending run
const migrated = new WeakMap();
const ensureMigrated = (db)=>{
	if(!migrated.has(db)) {
		migrated.set(db, migrate(db).catch((error)=>{
			migrated.delete(db);
			throw error;
		}));
	}
	return migrated.get(db);
};

export { migrate, ensureMigrated, splitStatements };
