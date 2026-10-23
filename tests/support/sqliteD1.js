// A D1-shaped database over node:sqlite for tests: prepare().bind().first()/all()/run(), batch() and exec().
// Like D1, it enforces foreign keys, rejects undefined and boolean parameters, and returns BLOBs as plain
// arrays of bytes. It starts empty; apply the schema with server/storage/migrate.js.

import { DatabaseSync } from 'node:sqlite';

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
