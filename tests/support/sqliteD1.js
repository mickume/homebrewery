// A D1-shaped database over node:sqlite for tests: prepare().bind().first()/all()/run(), batch() and exec(),
// with the schema from migrations/ applied. Like D1, it enforces foreign keys, rejects undefined and boolean
// parameters, and returns BLOBs as plain arrays of bytes.

import { DatabaseSync } from 'node:sqlite';
import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

const checkParams = (params)=>{
	params.forEach((param, index)=>{
		if(param === undefined || typeof param === 'boolean')
			throw new Error(`D1_TYPE_ERROR: Type '${typeof param}' not supported for value '${param}' at parameter ${index + 1}`);
	});
};

const toD1Row = (row)=>{
	const result = {};
	for (const [key, value] of Object.entries(row))
		result[key] = value instanceof Uint8Array ? Array.from(value) : value;
	return result;
};

const createStatement = (sqlite, sql, params = [])=>{
	const execute = ()=>{
		checkParams(params);
		const statement = sqlite.prepare(sql);
		if(statement.columns().length > 0)
			return { results: statement.all(...params).map(toD1Row), success: true, meta: { changes: 0 } };
		const { changes, lastInsertRowid } = statement.run(...params);
		return { results: [], success: true, meta: { changes, last_row_id: Number(lastInsertRowid) } };
	};

	return {
		bind  : (...values)=>createStatement(sqlite, sql, values),
		all   : async ()=>execute(),
		run   : async ()=>execute(),
		first : async (column)=>{
			const [row] = execute().results;
			if(!row) return null;
			return column === undefined ? row : row[column];
		},
		execute
	};
};

export default function createTestDatabase() {
	const sqlite = new DatabaseSync(':memory:');
	sqlite.exec('PRAGMA foreign_keys = ON');
	for (const file of fs.readdirSync(MIGRATIONS_DIR).filter((name)=>name.endsWith('.sql')).sort())
		sqlite.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8'));

	return {
		prepare : (sql)=>createStatement(sqlite, sql),
		exec    : async (sql)=>{ sqlite.exec(sql); },
		batch   : async (statements)=>{
			sqlite.exec('BEGIN');
			try {
				const results = statements.map((statement)=>statement.execute());
				sqlite.exec('COMMIT');
				return results;
			} catch (error) {
				sqlite.exec('ROLLBACK');
				throw error;
			}
		},
		close : ()=>sqlite.close()
	};
}
