/* eslint-disable max-lines */
import { gzipSync, strToU8 } from 'fflate';
import { createTestApp, createFakeUpdates } from '../tests/support/testApp.js';
import { sha256 } from '../shared/hash.js';
import { splitTextStyleAndMetadata } from '../shared/helpers.js';
import createBrewStore from './storage/brewStore.js';

describe('Brew API', ()=>{
	let t;

	const createBrew = async (body, as)=>(await t.send('POST', '/api', { body, as })).json();
	const storedBrew = (editId)=>t.db.prepare('SELECT * FROM brews WHERE edit_id = ?').bind(editId).first();

	// The brew as the editor holds it: stored text split into metadata, style and markdown
	const editorCopy = async (editId)=>{
		const brew = await createBrewStore(t.db).getByEditId(editId);
		splitTextStyleAndMetadata(brew);
		return brew;
	};

	// Saves like the editor: the full brew plus the hash of the last saved text and that text's version
	const saveBrew = async (editId, changes, { as } = {})=>{
		const current = await editorCopy(editId);
		const body = { ...current, ...changes, hash: changes.hash ?? await sha256(current.text.normalize('NFC')), version: changes.version ?? current.version };
		return t.send('PUT', `/api/update/${editId}`, { body, as });
	};

	beforeEach(async ()=>{
		t = await createTestApp({ BREW_UPDATES: createFakeUpdates() });
	});

	afterEach(()=>t.close());

	describe('POST /api (create)', ()=>{
		it('creates a brew owned by the signed-in user, titled from its text', async ()=>{
			const res = await t.send('POST', '/api', { body: { text: '# Dragon Lair\n\nA lair.', tags: ['monster'] }, as: 'alice' });
			const brew = await res.json();

			expect(res.status).toBe(200);
			expect(brew).toMatchObject({ title: 'Dragon Lair', authors: ['alice'], tags: ['monster'], renderer: 'V3', version: 1 });
			expect(brew.editId).toMatch(/^[\w-]{12}$/);
			expect(brew.text).toContain('```metadata\ntitle: Dragon Lair');
		});

		it('creates anonymous brews without authors and ignores ids and counters from the client', async ()=>{
			const brew = await createBrew({ text: 'Hi', editId: 'chosen000001', shareId: 'chosen000002', views: 99, version: 7, lock: { code: 1 } });

			expect(brew.authors).toEqual([]);
			expect(brew.editId).not.toBe('chosen000001');
			expect(brew).toMatchObject({ views: 0, version: 1 });
			expect(brew.lock).toBeUndefined();
		});

		it('requires the current client version', async ()=>{
			const res = await t.send('POST', '/api', { body: { text: 'x' }, headers: { 'Homebrewery-Version': '0.0.1' } });
			expect(res.status).toBe(412);
		});

		it('rejects bodies that are not a JSON object', async ()=>{
			const invalid = await t.send('POST', '/api', { body: strToU8('not json'), headers: { 'Content-Type': 'application/json' } });
			const notAnObject = await t.send('POST', '/api', { body: 'a string' });
			expect(invalid.status).toBe(400);
			expect(notAnObject.status).toBe(400);
		});
	});

	describe('PUT /api/update/:id (save)', ()=>{
		let brew;
		beforeEach(async ()=>{
			brew = await createBrew({ text: 'Original text', title: 'Saved' }, 'alice');
		});

		it('saves new text, bumps the version and notifies share pages', async ()=>{
			const res = await saveBrew(brew.editId, { text: 'Changed text' }, { as: 'alice' });
			const saved = await res.json();

			expect(res.status).toBe(200);
			expect(saved).toMatchObject({ editId: brew.editId, shareId: brew.shareId, version: 2 });
			expect(saved).not.toHaveProperty('text');
			expect(t.env.BREW_UPDATES.broadcasts).toEqual([
				{ id: brew.shareId, message: expect.objectContaining({ event: 'brewUpdated', shareId: brew.shareId, version: 2 }) }
			]);

			const fetched = await (await t.request(`/api/fetch/${brew.shareId}`)).json();
			expect(fetched.brew.text).toBe('Changed text');
		});

		it('accepts gzip-compressed bodies like the editor sends', async ()=>{
			const current = await editorCopy(brew.editId);
			const body = gzipSync(strToU8(JSON.stringify({ ...current, text: 'Zipped', hash: await sha256(current.text), version: 1 })));

			const res = await t.send('PUT', `/api/update/${brew.editId}`, { body, as: 'alice', headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' } });

			expect(res.status).toBe(200);
			expect((await (await t.request(`/api/fetch/${brew.shareId}`)).json()).brew.text).toBe('Zipped');
		});

		it('rejects a save based on an older version', async ()=>{
			await saveBrew(brew.editId, { text: 'First' }, { as: 'alice' });
			const res = await saveBrew(brew.editId, { text: 'Second', version: 1 }, { as: 'alice' });

			expect(res.status).toBe(409);
			expect((await res.json()).message).toMatch(/version is out of sync/);
		});

		it('rejects a save whose hash does not match the stored text', async ()=>{
			const res = await saveBrew(brew.editId, { text: 'x', hash: 'not-the-hash' }, { as: 'alice' });
			expect(res.status).toBe(409);
			expect((await res.json()).message).toMatch(/copy is out of sync/);
		});

		it('ignores protected fields sent by the client', async ()=>{
			await t.db.prepare(`UPDATE brews SET lock = '{"code":455}', views = 5 WHERE edit_id = ?`).bind(brew.editId).run();
			await saveBrew(brew.editId, { text: 'x', lock: null, views: 0, shareId: 'stolen000001' }, { as: 'alice' });

			expect(await storedBrew(brew.editId)).toMatchObject({ lock: '{"code":455}', views: 5, share_id: brew.shareId });
		});

		it('adds an invited author who saves to the authors', async ()=>{
			await t.db.prepare(`UPDATE brews SET invited_authors = '["bob"]' WHERE edit_id = ?`).bind(brew.editId).run();
			const res = await saveBrew(brew.editId, { text: 'Bob was here' }, { as: 'bob' });

			expect(await res.json()).toMatchObject({ authors: ['alice', 'bob'], invitedAuthors: [] });
		});

		it('refuses users who are not authors', async ()=>{
			const res = await saveBrew(brew.editId, { text: 'x' }, { as: 'mallory' });
			expect(res.status).toBe(401);
			expect(await res.json()).toMatchObject({ HBErrorCode: '03' });
		});

		it('refuses anonymous saves of an authored brew', async ()=>{
			const res = await saveBrew(brew.editId, { text: 'x' });
			expect(res.status).toBe(401);
			expect(await res.json()).toMatchObject({ HBErrorCode: '04' });
		});

		it('rejects text too large for D1 with error 14', async ()=>{
			const huge = Array.from({ length: 400_000 }, ()=>Math.random().toString(36).slice(2)).join('');
			const res = await saveBrew(brew.editId, { text: huge }, { as: 'alice' });
			expect(res.status).toBe(413);
			expect(await res.json()).toMatchObject({ HBErrorCode: '14' });
		});
	});

	describe('DELETE /api/:id', ()=>{
		it('deletes a brew whose only author removes it', async ()=>{
			const brew = await createBrew({ text: 'Mine' }, 'alice');

			expect((await t.send('DELETE', `/api/${brew.editId}`, { as: 'alice' })).status).toBe(204);
			expect(await storedBrew(brew.editId)).toBeNull();
		});

		it('only removes the user when other authors remain', async ()=>{
			const brew = await createBrew({ text: 'Shared' }, 'alice');
			await t.db.prepare(`INSERT INTO brew_authors (brew_id, position, username) SELECT id, 1, 'bob' FROM brews WHERE edit_id = ?`).bind(brew.editId).run();

			expect((await t.send('DELETE', `/api/${brew.editId}`, { as: 'bob' })).status).toBe(204);
			expect((await (await t.request(`/metadata/${brew.shareId}`)).json()).authors).toEqual(['alice']);
		});

		it('deletes anonymous brews for anyone with the edit id', async ()=>{
			const brew = await createBrew({ text: 'Anon' });
			expect((await t.send('DELETE', `/api/${brew.editId}`)).status).toBe(204);
		});

		it('refuses non-authors', async ()=>{
			const brew = await createBrew({ text: 'Mine' }, 'alice');
			expect((await t.send('DELETE', `/api/${brew.editId}`, { as: 'mallory' })).status).toBe(401);
		});
	});

	describe('read-only endpoints', ()=>{
		let brew;
		beforeEach(async ()=>{
			brew = await createBrew({ text: 'Hello <b>&</b>', style: '.page { color: red; }', title: 'Hello: World?' }, 'alice');
		});

		it('fetches a brew by share id without its edit id, unless the author asks', async ()=>{
			const anonymous = (await (await t.request(`/api/fetch/${brew.shareId}`)).json()).brew;
			const author = (await (await t.send('GET', `/api/fetch/${brew.shareId}`, { as: 'alice' })).json()).brew;

			expect(anonymous).toMatchObject({ shareId: brew.shareId, text: 'Hello <b>&</b>', style: '.page { color: red; }\n' });
			expect(anonymous.editId).toBeUndefined();
			expect(author.editId).toBe(brew.editId);
		});

		it('serves metadata, css, escaped source and a download', async ()=>{
			expect(await (await t.request(`/metadata/${brew.shareId}`)).json()).toMatchObject({ title: 'Hello: World?', authors: ['alice'], shareId: brew.shareId });

			const css = await t.request(`/css/${brew.shareId}`);
			expect(css.headers.get('Content-Type')).toBe('text/css');
			expect(await css.text()).toBe('.page { color: red; }\n');

			expect(await (await t.request(`/source/${brew.shareId}`)).text()).toContain('Hello &lt;b&gt;&amp;&lt;/b&gt;');

			const download = await t.request(`/download/${brew.shareId}`);
			expect(download.headers.get('Content-Disposition')).toBe(`attachment; filename*=UTF-8''HB-HelloWorld.txt`);
			expect(await download.text()).toBe('Hello <b>&</b>');
		});

		it('answers 404 for a brew without style and for unknown or malformed ids', async ()=>{
			const plain = await createBrew({ text: 'No style' });
			expect((await t.request(`/css/${plain.shareId}`)).status).toBe(404);
			expect(await (await t.request('/api/fetch/unknown00001')).json()).toMatchObject({ HBErrorCode: '05' });
			expect(await (await t.request('/api/fetch/bad!id')).json()).toMatchObject({ HBErrorCode: '11' });
		});

		it('refuses to share a locked brew', async ()=>{
			await t.db.prepare(`UPDATE brews SET lock = '{"code":455,"shareMessage":"Locked"}' WHERE edit_id = ?`).bind(brew.editId).run();
			const res = await t.request(`/api/fetch/${brew.shareId}`);
			expect(res.status).toBe(455);
			expect(await res.json()).toMatchObject({ HBErrorCode: '51', message: 'Locked' });
		});
	});

	describe('GET /api/theme/:renderer/:id', ()=>{
		it('returns a static theme with its parents, oldest first', async ()=>{
			const bundle = await (await t.request('/api/theme/V3/5eDMG')).json();

			expect(bundle.name).toBe('5eDMG');
			expect(bundle.snippets).toEqual(['V3_Blank', 'V3_5ePHB', 'V3_5eDMG']);
			expect(bundle.styles.map((style)=>style.split('\n')[0])).toEqual(['/* From Theme Blank */', '/* From Theme 5ePHB */', '/* From Theme 5eDMG */']);
		});

		it('chains user themes onto static themes', async ()=>{
			const base = await createBrew({ text: 'x', title: 'Base Theme', style: '.base{}', tags: ['meta:theme'], theme: '5ePHB' }, 'alice');
			const child = await createBrew({ text: 'x', title: 'Child Theme', style: '.child{}', tags: ['meta:theme'], theme: base.shareId }, 'alice');

			const bundle = await (await t.request(`/api/theme/V3/${child.shareId}`)).json();

			expect(bundle).toMatchObject({ name: 'Child Theme', author: 'alice' });
			expect(bundle.styles.at(-1)).toContain('.child{}');
			expect(bundle.styles.at(-2)).toContain('.base{}');
			expect(bundle.snippets.slice(0, 2)).toEqual(['V3_Blank', 'V3_5ePHB']);
		});

		it('fails for missing themes and brews without the meta:theme tag', async ()=>{
			const notATheme = await createBrew({ text: 'x', title: 'Plain' });

			expect(await (await t.request('/api/theme/V3/missing0001a')).json()).toMatchObject({ HBErrorCode: '09' });
			const res = await t.request(`/api/theme/V3/${notATheme.shareId}`);
			expect(res.status).toBe(422);
			expect(await res.json()).toMatchObject({ HBErrorCode: '10' });
		});
	});

	describe('PUT /api/user/rename', ()=>{
		it('renames the signed-in user on their brews', async ()=>{
			const brew = await createBrew({ text: 'x' }, 'old-name');
			const res = await t.send('PUT', '/api/user/rename', { body: { username: 'old-name', newUsername: 'new-name' }, as: 'new-name' });

			expect(res.status).toBe(200);
			expect((await (await t.request(`/metadata/${brew.shareId}`)).json()).authors).toEqual(['new-name']);
		});

		it('only lets users rename to their own account', async ()=>{
			const res = await t.send('PUT', '/api/user/rename', { body: { username: 'a', newUsername: 'b' }, as: 'c' });
			expect(res.status).toBe(403);
		});
	});

	describe('live updates', ()=>{
		it('forwards WebSocket upgrades to the brew\'s Durable Object', async ()=>{
			const res = await t.request('/api/stream/share0000001', { headers: { Upgrade: 'websocket' } });
			expect(await res.text()).toBe('upgraded');
		});

		it('asks for an upgrade, and answers 204 when live updates are not configured', async ()=>{
			expect((await t.request('/api/stream/share0000001')).status).toBe(426);

			const withoutUpdates = await createTestApp();
			expect((await withoutUpdates.request('/api/stream/share0000001', { headers: { Upgrade: 'websocket' } })).status).toBe(204);
			withoutUpdates.close();
		});
	});
});
