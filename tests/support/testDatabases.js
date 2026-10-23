// Databases the storage tests run against: node:sqlite behind a D1-shaped wrapper, and a real local D1
// (workerd, through Wrangler's platform proxy). Both start from the schema in migrations/.
// Usage: describe.each(testDatabases)('%s', (name, openDatabase)=>{ ... }) with resetDatabase between tests.

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getPlatformProxy } from 'wrangler';
import createSqliteD1 from './sqliteD1.js';

const SUPPORT_DIR = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(SUPPORT_DIR, '../../migrations');

const migrationStatements = ()=>fs.readdirSync(MIGRATIONS_DIR)
	.filter((name)=>name.endsWith('.sql'))
	.sort()
	.flatMap((name)=>fs.readFileSync(path.join(MIGRATIONS_DIR, name), 'utf8')
		.replace(/--.*$/gm, '')
		.split(/;\s*$/m)
		.map((statement)=>statement.trim())
		.filter(Boolean));

const openSqlite = async ()=>{
	const db = createSqliteD1();
	return { db, close: async ()=>db.close() };
};

const openLocalD1 = async ()=>{
	const proxy = await getPlatformProxy({ configPath: path.join(SUPPORT_DIR, 'wrangler.test.jsonc'), persist: false, remoteBindings: false });
	const db = proxy.env.DB;
	for (const statement of migrationStatements())
		await db.prepare(statement).run();
	return { db, close: ()=>proxy.dispose() };
};

const testDatabases = [
	['node:sqlite', openSqlite],
	['local D1', openLocalD1]
];

const resetDatabase = (db)=>db.batch([
	db.prepare('DELETE FROM brew_authors'),
	db.prepare('DELETE FROM brews'),
	db.prepare('DELETE FROM notifications')
]);

export { testDatabases, resetDatabase };
