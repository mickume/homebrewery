// Databases the storage and route tests run against: node:sqlite behind a D1-shaped wrapper, and a real
// local D1 (workerd, through Wrangler's platform proxy). Both get the schema from the migration runner.
// Usage: describe.each(testDatabases)('%s', (name, openDatabase)=>{ ... }) with resetDatabase between tests.

import path from 'path';
import { fileURLToPath } from 'url';
import { getPlatformProxy } from 'wrangler';
import createSqliteD1 from './sqliteD1.js';
import { migrate } from '../../server/storage/migrate.js';

const SUPPORT_DIR = path.dirname(fileURLToPath(import.meta.url));

const openSqlite = async ()=>{
	const db = createSqliteD1();
	await migrate(db);
	return { db, close: async ()=>db.close() };
};

const openLocalD1 = async ()=>{
	const proxy = await getPlatformProxy({ configPath: path.join(SUPPORT_DIR, 'wrangler.test.jsonc'), persist: false, remoteBindings: false });
	const db = proxy.env.DB;
	await migrate(db);
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

export { testDatabases, resetDatabase, openSqlite };
