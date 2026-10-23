import createSqliteD1 from '../../tests/support/sqliteD1.js';
import { migrate, ensureMigrated, splitStatements } from './migrate.js';

const tables = async (db)=>(await db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`).all())
	.results.map((row)=>row.name);
const applied = async (db)=>(await db.prepare('SELECT name FROM d1_migrations ORDER BY id').all()).results.map((row)=>row.name);

describe('migrate', ()=>{
	let db;

	beforeEach(()=>{
		db = createSqliteD1();
	});

	afterEach(()=>db.close());

	it('applies the bundled schema and records it like wrangler d1 migrations', async ()=>{
		await migrate(db);

		expect(await tables(db)).toEqual(['brew_authors', 'brews', 'd1_migrations', 'notifications']);
		expect(await applied(db)).toEqual(['0001_initial_schema.sql']);
	});

	it('is idempotent and applies only new migrations', async ()=>{
		const first  = { name: '0001_a.sql', sql: 'CREATE TABLE a (id INTEGER);' };
		const second = { name: '0002_b.sql', sql: '-- adds b\nCREATE TABLE b (id INTEGER);\nCREATE INDEX b_id ON b (id);' };

		await migrate(db, [first]);
		await migrate(db, [first]);
		await migrate(db, [first, second]);

		expect(await applied(db)).toEqual(['0001_a.sql', '0002_b.sql']);
		expect(await tables(db)).toEqual(['a', 'b', 'd1_migrations']);
	});

	it('rolls back a failing migration as a whole', async ()=>{
		const broken = { name: '0001_broken.sql', sql: 'CREATE TABLE ok (id INTEGER);\nCREATE TABLE ok (id INTEGER);' };

		await expect(migrate(db, [broken])).rejects.toThrow(/already exists/);
		expect(await tables(db)).toEqual(['d1_migrations']);
		expect(await applied(db)).toEqual([]);
	});

	it('tolerates a migration applied concurrently by another isolate', async ()=>{
		await Promise.all([migrate(db), migrate(db)]);
		expect(await applied(db)).toEqual(['0001_initial_schema.sql']);
	});

	it('migrates each database once per isolate', async ()=>{
		await Promise.all([ensureMigrated(db), ensureMigrated(db)]);
		await db.prepare('DROP TABLE notifications').run();
		await ensureMigrated(db);
		expect(await tables(db)).not.toContain('notifications');
	});

	it('splits statements on semicolons at line ends, ignoring comments', ()=>{
		expect(splitStatements('-- c;\nCREATE TABLE x (a TEXT DEFAULT \';\');\n\nINSERT INTO x VALUES (1);')).toEqual([
			'CREATE TABLE x (a TEXT DEFAULT \';\')',
			'INSERT INTO x VALUES (1)'
		]);
	});
});
