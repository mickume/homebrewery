/*eslint max-lines: ["warn", {"max": 300, "skipBlankLines": true, "skipComments": true}]*/
// Brew persistence on Cloudflare D1 (or any object with D1's prepare/bind/first/all/run/batch API).
// Takes and returns plain brew objects in the shape the routes and client use (camelCase fields,
// `authors` as an ordered array, `text` uncompressed). Rows are addressed by editId or shareId;
// the internal integer id never leaves this module.

import { nanoid } from 'nanoid';

// D1 rejects rows over 2,000,000 bytes; leave headroom for the other columns
const MAX_TEXT_BYTES = 1_900_000;

const JUNK_MAX_AGE_DAYS = 30;
const JUNK_MAX_TEXT_BYTES = 140;
const JUNK_LIMIT = 300;
const LOST_MAX_AGE_YEARS = 2;
const LOST_LIMIT = 500;

const SORT_COLUMNS = {
	title      : 'b.title COLLATE NOCASE',
	createdAt  : 'b.created_at',
	updatedAt  : 'b.updated_at',
	lastViewed : 'b.last_viewed',
	views      : 'b.views',
	pageCount  : 'b.page_count'
};

const AUTHORS_COLUMN = `(SELECT json_group_array(a.username ORDER BY a.position) FROM brew_authors a WHERE a.brew_id = b.id) AS authors`;
const META_COLUMNS = `b.share_id, b.edit_id, b.title, b.page_count, b.description, b.tags, b.lang, b.renderer,
	b.invited_authors, b.published, b.thumbnail, b.created_at, b.updated_at, b.last_viewed, b.views, b.version, b.lock,
	${AUTHORS_COLUMN}`;
const ALL_COLUMNS = `${META_COLUMNS}, b.text_bin`;

const nullable = (value)=>value === undefined ? null : value;
const toFlag = (value)=>value === undefined ? null : Number(Boolean(value));
const toJSON = (value)=>value === undefined ? null : JSON.stringify(value);
const toDate = (value)=>value === undefined ? null : new Date(value).toISOString();

// Runs bytes through a CompressionStream or DecompressionStream (web standard, no Node.js APIs needed)
const transformBytes = async (bytes, transform)=>{
	const stream = new Blob([bytes]).stream().pipeThrough(transform);
	return new Uint8Array(await new Response(stream).arrayBuffer());
};

const compressText = async (text)=>{
	const compressed = await transformBytes(new TextEncoder().encode(text), new CompressionStream('deflate-raw'));
	if(compressed.length > MAX_TEXT_BYTES) {
		const message = `Brew is too large to save: ${compressed.length} bytes compressed, the limit is ${MAX_TEXT_BYTES}`;
		throw Object.assign(new Error(message), { name: 'BrewSave Error', status: 413, HBErrorCode: '14' });
	}
	return compressed;
};

// D1 returns BLOBs as arrays of bytes or ArrayBuffers depending on the runtime; Uint8Array takes both
const decompressText = async (textBin)=>{
	const bytes = await transformBytes(new Uint8Array(textBin), new DecompressionStream('deflate-raw'));
	return new TextDecoder().decode(bytes);
};

const toBrew = (row)=>{
	if(!row) return null;
	const brew = {
		shareId        : row.share_id,
		editId         : row.edit_id,
		title          : row.title,
		pageCount      : row.page_count,
		description    : row.description,
		tags           : JSON.parse(row.tags),
		lang           : row.lang,
		renderer       : row.renderer,
		authors        : JSON.parse(row.authors ?? '[]'),
		invitedAuthors : JSON.parse(row.invited_authors),
		published      : Boolean(row.published),
		thumbnail      : row.thumbnail,
		createdAt      : row.created_at,
		updatedAt      : row.updated_at,
		lastViewed     : row.last_viewed,
		views          : row.views,
		version        : row.version,
		lock           : row.lock ? JSON.parse(row.lock) : undefined
	};
	return brew;
};

const escapeLike = (term)=>term.replace(/[\\%_]/g, (char)=>`\\${char}`);

// WHERE clause and parameters shared by the Vault search and its count
const searchConditions = ({ title, author, renderer })=>{
	const conditions = ['b.published = 1'];
	const params = [];
	if(renderer) {
		conditions.push('b.renderer = ?');
		params.push(renderer);
	}
	for (const word of (title || '').split(/\s+/).filter(Boolean)) {
		conditions.push(`b.title LIKE ? ESCAPE '\\'`);
		params.push(`%${escapeLike(word)}%`);
	}
	if(author) {
		conditions.push('EXISTS (SELECT 1 FROM brew_authors a WHERE a.brew_id = b.id AND a.username = ?)');
		params.push(author);
	}
	return { where: conditions.join(' AND '), params };
};

export default function createBrewStore(db, { now = ()=>new Date() } = {}) {
	const getOne = async (where, params)=>{
		const row = await db.prepare(`SELECT ${ALL_COLUMNS} FROM brews b WHERE ${where}`).bind(...params).first();
		const brew = toBrew(row);
		if(brew) brew.text = row.text_bin === null ? '' : await decompressText(row.text_bin);
		return brew;
	};

	const insertAuthorsStatement = (editId, authors)=>db.prepare(`INSERT INTO brew_authors (brew_id, position, username)
		SELECT b.id, j.key, j.value FROM brews b, json_each(?) j WHERE b.edit_id = ?`).bind(JSON.stringify(authors), editId);

	const replaceAuthorsStatements = (editId, authors)=>[
		db.prepare('DELETE FROM brew_authors WHERE brew_id = (SELECT id FROM brews WHERE edit_id = ?)').bind(editId),
		insertAuthorsStatement(editId, authors)
	];

	const deleteWhere = async (idSubquery, params)=>{
		const [, deleted] = await db.batch([
			db.prepare(`DELETE FROM brew_authors WHERE brew_id IN (${idSubquery})`).bind(...params),
			db.prepare(`DELETE FROM brews WHERE id IN (${idSubquery})`).bind(...params)
		]);
		return deleted.meta.changes;
	};

	const daysAgo = (days)=>new Date(now().getTime() - days * 24 * 60 * 60 * 1000).toISOString();
	const yearsAgo = (years)=>{
		const date = now();
		date.setUTCFullYear(date.getUTCFullYear() - years);
		return date.toISOString();
	};

	const junkQuery = ()=>({
		sql : `SELECT b.id FROM brews b
			WHERE b.updated_at < ? AND b.last_viewed < ? AND length(b.text_bin) < ? LIMIT ${JUNK_LIMIT}`,
		params : [daysAgo(JUNK_MAX_AGE_DAYS), daysAgo(JUNK_MAX_AGE_DAYS), JUNK_MAX_TEXT_BYTES]
	});

	const lostQuery = ()=>({
		sql : `SELECT b.id FROM brews b
			WHERE NOT EXISTS (SELECT 1 FROM brew_authors a WHERE a.brew_id = b.id)
			AND b.updated_at < ? AND b.last_viewed < ? LIMIT ${LOST_LIMIT}`,
		params : [yearsAgo(LOST_MAX_AGE_YEARS), yearsAgo(LOST_MAX_AGE_YEARS)]
	});

	const store = {
		getByEditId  : (editId)=>getOne('b.edit_id = ?', [editId]),
		getByShareId : (shareId)=>getOne('b.share_id = ?', [shareId]),
		getByAnyId   : (id)=>getOne('b.edit_id = ? OR b.share_id = ?', [id, id]),

		// A user's brews without their text; `tags` keeps only brews carrying at least one of the given tags
		listByUser : async (username, { includeUnpublished = false, tags = null } = {})=>{
			const conditions = ['b.id IN (SELECT brew_id FROM brew_authors WHERE username = ?)'];
			const params = [username];
			if(!includeUnpublished) conditions.push('b.published = 1');
			if(tags) {
				conditions.push('EXISTS (SELECT 1 FROM json_each(b.tags) t WHERE t.value IN (SELECT value FROM json_each(?)))');
				params.push(JSON.stringify(tags));
			}
			const { results } = await db.prepare(`SELECT ${META_COLUMNS} FROM brews b WHERE ${conditions.join(' AND ')} ORDER BY b.id`)
				.bind(...params).all();
			return results.map(toBrew);
		},

		countByUser : async (username)=>{
			return await db.prepare('SELECT count(DISTINCT brew_id) AS count FROM brew_authors WHERE username = ?')
				.bind(username).first('count');
		},

		// Inserts a brew; generates shareId and editId when missing. Returns the stored brew.
		create : async (brew)=>{
			const timestamp = now().toISOString();
			const editId  = brew.editId  || nanoid(12);
			const shareId = brew.shareId || nanoid(12);
			await db.batch([
				db.prepare(`INSERT INTO brews (share_id, edit_id, title, text_bin, page_count, description, tags, lang, renderer,
					invited_authors, published, thumbnail, created_at, updated_at, last_viewed, views, version)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
					shareId, editId, brew.title ?? '', await compressText(brew.text ?? ''), brew.pageCount ?? 1, brew.description ?? '',
					JSON.stringify(brew.tags ?? []), brew.lang ?? 'en', brew.renderer ?? '', JSON.stringify(brew.invitedAuthors ?? []),
					brew.published ? 1 : 0, brew.thumbnail ?? '', toDate(brew.createdAt) ?? timestamp, toDate(brew.updatedAt) ?? timestamp,
					toDate(brew.lastViewed) ?? timestamp, brew.views ?? 0, brew.version ?? 1
				),
				insertAuthorsStatement(editId, brew.authors ?? [])
			]);
			return store.getByEditId(editId);
		},

		// Updates the given fields of a brew; undefined fields are left unchanged, and `authors`, when given,
		// replaces the author list. With `expectedVersion`, the update only applies if the stored version
		// still matches. Views, lastViewed and lock are never changed here. Returns the stored brew, or
		// null when no brew matched.
		update : async (editId, brew, { expectedVersion } = {})=>{
			const textBin = brew.text === undefined ? null : await compressText(brew.text);
			const { meta } = await db.prepare(`UPDATE brews SET
				title = COALESCE(?, title), text_bin = COALESCE(?, text_bin), page_count = COALESCE(?, page_count),
				description = COALESCE(?, description), tags = COALESCE(?, tags), lang = COALESCE(?, lang),
				renderer = COALESCE(?, renderer), invited_authors = COALESCE(?, invited_authors),
				published = COALESCE(?, published), thumbnail = COALESCE(?, thumbnail),
				updated_at = COALESCE(?, updated_at), version = COALESCE(?, version)
				WHERE edit_id = ? AND (? IS NULL OR version = ?)`).bind(
				nullable(brew.title), textBin, nullable(brew.pageCount), nullable(brew.description), toJSON(brew.tags),
				nullable(brew.lang), nullable(brew.renderer), toJSON(brew.invitedAuthors), toFlag(brew.published),
				nullable(brew.thumbnail), toDate(brew.updatedAt), nullable(brew.version),
				editId, nullable(expectedVersion), nullable(expectedVersion)
			).run();
			if(meta.changes === 0) return null;

			if(brew.authors !== undefined)
				await db.batch(replaceAuthorsStatements(editId, brew.authors));
			return store.getByEditId(editId);
		},

		delete : async (editId)=>{
			return (await deleteWhere('SELECT id FROM brews WHERE edit_id = ?', [editId])) > 0;
		},

		incrementViews : async (shareId)=>{
			const { meta } = await db.prepare('UPDATE brews SET views = views + 1, last_viewed = ? WHERE share_id = ?')
				.bind(now().toISOString(), shareId).run();
			return meta.changes > 0;
		},

		renameAuthor : async (username, newUsername)=>{
			const { meta } = await db.prepare('UPDATE brew_authors SET username = ? WHERE username = ?')
				.bind(newUsername, username).run();
			return meta.changes;
		},

		//==== Vault ====//
		// Published brews whose title contains every word of `title`, without text or editId
		search : async ({ title, author, renderer, sort = 'title', dir = 'asc', page = 1, count = 20 } = {})=>{
			const { where, params } = searchConditions({ title, author, renderer });
			const order = `${SORT_COLUMNS[sort] ?? SORT_COLUMNS.title} ${dir === 'desc' ? 'DESC' : 'ASC'}, b.id`;
			const { results } = await db.prepare(`SELECT ${META_COLUMNS} FROM brews b WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`)
				.bind(...params, count, (page - 1) * count).all();
			return results.map((row)=>{
				const brew = toBrew(row);
				delete brew.editId;
				return brew;
			});
		},

		countSearch : async ({ title, author, renderer } = {})=>{
			const { where, params } = searchConditions({ title, author, renderer });
			return await db.prepare(`SELECT count(*) AS count FROM brews b WHERE ${where}`).bind(...params).first('count');
		},

		//==== Admin ====//
		stats : async ()=>{
			const row = await db.prepare('SELECT count(*) AS total, coalesce(sum(published), 0) AS published FROM brews').first();
			return { totalBrews: row.total, totalPublishedBrews: row.published };
		},

		// Brews not updated or viewed for 30 days whose compressed text is under 140 bytes (at most 300)
		listJunk : async ()=>{
			const { sql, params } = junkQuery();
			const { results } = await db.prepare(`SELECT b.share_id, length(b.text_bin) AS text_bin_size, b.updated_at, b.last_viewed
				FROM brews b WHERE b.id IN (${sql})`).bind(...params).all();
			return results.map((row)=>({ shareId: row.share_id, textBinSize: row.text_bin_size, updatedAt: row.updated_at, lastViewed: row.last_viewed }));
		},
		deleteJunk : async ()=>{
			const { sql, params } = junkQuery();
			return deleteWhere(sql, params);
		},

		// Brews without authors not updated or viewed for 2 years (at most 500)
		listLost : async ()=>{
			const { sql, params } = lostQuery();
			const { results } = await db.prepare(`SELECT ${META_COLUMNS} FROM brews b WHERE b.id IN (${sql})`).bind(...params).all();
			return results.map(toBrew);
		},
		deleteLost : async ()=>{
			const { sql, params } = lostQuery();
			return deleteWhere(sql, params);
		},

		//==== Locks ====//
		// Sets or (with null) clears the lock of a brew. Returns false when no brew has this shareId.
		setLock : async (shareId, lock)=>{
			const { meta } = await db.prepare('UPDATE brews SET lock = ? WHERE share_id = ?').bind(lock ? JSON.stringify(lock) : null, shareId).run();
			return meta.changes > 0;
		},

		countLocked : async ()=>{
			return await db.prepare('SELECT count(*) AS count FROM brews WHERE lock IS NOT NULL').first('count');
		},

		listLocked : async ({ reviewRequested = false } = {})=>{
			const condition = reviewRequested ? `json_extract(b.lock, '$.reviewRequested') IS NOT NULL` : 'b.lock IS NOT NULL';
			const { results } = await db.prepare(`SELECT b.share_id, b.edit_id, b.title, b.lock FROM brews b WHERE ${condition} ORDER BY b.id`).all();
			return results.map((row)=>({ shareId: row.share_id, editId: row.edit_id, title: row.title, lock: JSON.parse(row.lock) }));
		}
	};

	return store;
}

export { MAX_TEXT_BYTES };
