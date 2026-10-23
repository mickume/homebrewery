/* eslint-disable max-lines */
import crypto from 'crypto';
import { testDatabases, resetDatabase } from '../../tests/support/testDatabases.js';
import createBrewStore from './brewStore.js';

const NOW = new Date('2026-10-23T12:00:00.000Z');
const daysBefore = (days)=>new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

describe.each(testDatabases)('brewStore on %s', (name, openDatabase)=>{
	let database, db, store;

	beforeAll(async ()=>{
		database = await openDatabase();
		db = database.db;
	});

	beforeEach(async ()=>{
		await resetDatabase(db);
		store = createBrewStore(db, { now: ()=>new Date(NOW) });
	});

	afterAll(async ()=>database?.close());

	describe('create and get', ()=>{
		it('generates 12-character ids and fills defaults', async ()=>{
			const brew = await store.create({ text: '# Hello' });

			expect(brew.editId).toMatch(/^[\w-]{12}$/);
			expect(brew.shareId).toMatch(/^[\w-]{12}$/);
			expect(brew).toEqual({
				editId         : brew.editId,
				shareId        : brew.shareId,
				title          : '',
				text           : '# Hello',
				pageCount      : 1,
				description    : '',
				tags           : [],
				lang           : 'en',
				renderer       : '',
				authors        : [],
				invitedAuthors : [],
				published      : false,
				thumbnail      : '',
				createdAt      : NOW.toISOString(),
				updatedAt      : NOW.toISOString(),
				lastViewed     : NOW.toISOString(),
				views          : 0,
				version        : 1,
				lock           : undefined
			});
		});

		it('keeps given ids, fields and author order', async ()=>{
			await store.create({
				editId         : 'edit00000001', shareId        : 'share0000001', title          : 'A Title', text           : 'ünïcode ✨ text',
				authors        : ['owner', 'second', 'third'], tags           : ['meta:theme', 'system:D&D 5e'], published      : true,
				renderer       : 'V3', pageCount      : 3, invitedAuthors : ['guest']
			});

			const brew = await store.getByEditId('edit00000001');
			expect(brew).toMatchObject({
				shareId        : 'share0000001', title          : 'A Title', text           : 'ünïcode ✨ text',
				authors        : ['owner', 'second', 'third'], tags           : ['meta:theme', 'system:D&D 5e'], published      : true,
				renderer       : 'V3', pageCount      : 3, invitedAuthors : ['guest']
			});
		});

		it('finds brews by share id, edit id or either, and returns null when missing', async ()=>{
			await store.create({ editId: 'edit00000001', shareId: 'share0000001', title: 'Found' });

			expect((await store.getByShareId('share0000001')).title).toBe('Found');
			expect((await store.getByAnyId('share0000001')).title).toBe('Found');
			expect((await store.getByAnyId('edit00000001')).title).toBe('Found');
			expect(await store.getByShareId('edit00000001')).toBeNull();
			expect(await store.getByEditId('missing00001')).toBeNull();
		});

		it('stores the text compressed', async ()=>{
			const text = 'The quick brown fox. '.repeat(1000);
			await store.create({ editId: 'edit00000001', text });

			const size = await db.prepare(`SELECT length(text_bin) AS size FROM brews WHERE edit_id = 'edit00000001'`).first('size');
			expect(size).toBeLessThan(text.length / 10);
			expect((await store.getByEditId('edit00000001')).text).toBe(text);
		});

		it('rejects text that does not fit in a D1 row', async ()=>{
			const text = crypto.randomBytes(3_000_000).toString('base64');

			await expect(store.create({ text })).rejects.toMatchObject({ status: 413, HBErrorCode: '14' });
			expect(await store.stats()).toEqual({ totalBrews: 0, totalPublishedBrews: 0 });
		});

		it('rejects duplicate edit ids', async ()=>{
			await store.create({ editId: 'edit00000001' });
			await expect(store.create({ editId: 'edit00000001' })).rejects.toThrow(/UNIQUE/);
		});
	});

	describe('update', ()=>{
		beforeEach(async ()=>{
			await store.create({ editId: 'edit00000001', shareId: 'share0000001', title: 'Old', text: 'old text', authors: ['owner'], version: 4 });
		});

		it('changes the given fields and leaves the rest', async ()=>{
			const updated = await store.update('edit00000001', { text: 'new text', published: true, version: 5, updatedAt: daysBefore(-1) });

			expect(updated).toMatchObject({ title: 'Old', text: 'new text', published: true, version: 5, authors: ['owner'], updatedAt: daysBefore(-1) });
		});

		it('replaces the author list when given', async ()=>{
			const updated = await store.update('edit00000001', { authors: ['owner', 'coauthor'] });

			expect(updated.authors).toEqual(['owner', 'coauthor']);
			expect(await store.countByUser('coauthor')).toBe(1);
		});

		it('applies only when the stored version matches expectedVersion', async ()=>{
			expect(await store.update('edit00000001', { title: 'Stale', authors: ['intruder'], version: 4 }, { expectedVersion: 3 })).toBeNull();
			expect(await store.getByEditId('edit00000001')).toMatchObject({ title: 'Old', authors: ['owner'], version: 4 });

			expect(await store.update('edit00000001', { title: 'Fresh', version: 5 }, { expectedVersion: 4 })).toMatchObject({ title: 'Fresh', version: 5 });
		});

		it('never changes views, lastViewed or the lock', async ()=>{
			await store.setLock('share0000001', { code: 455 });
			await store.incrementViews('share0000001');

			const updated = await store.update('edit00000001', { views: 99, lastViewed: daysBefore(100), lock: null, title: 'New' });

			expect(updated).toMatchObject({ title: 'New', views: 1, lastViewed: NOW.toISOString(), lock: { code: 455 } });
		});

		it('returns null for an unknown brew', async ()=>{
			expect(await store.update('missing00001', { title: 'x' })).toBeNull();
		});
	});

	describe('delete', ()=>{
		it('removes the brew and its authors', async ()=>{
			await store.create({ editId: 'edit00000001', authors: ['owner', 'other'] });

			expect(await store.delete('edit00000001')).toBe(true);
			expect(await store.getByEditId('edit00000001')).toBeNull();
			expect(await db.prepare('SELECT count(*) AS count FROM brew_authors').first('count')).toBe(0);
			expect(await store.delete('edit00000001')).toBe(false);
		});
	});

	describe('views', ()=>{
		it('counts a view and records when it happened', async ()=>{
			await store.create({ shareId: 'share0000001', lastViewed: daysBefore(10) });

			expect(await store.incrementViews('share0000001')).toBe(true);
			expect(await store.getByShareId('share0000001')).toMatchObject({ views: 1, lastViewed: NOW.toISOString() });
			expect(await store.incrementViews('missing00001')).toBe(false);
		});
	});

	describe('users', ()=>{
		beforeEach(async ()=>{
			await store.create({ editId: 'edit00000001', title: 'Published', authors: ['alice'], published: true, tags: ['meta:theme'] });
			await store.create({ editId: 'edit00000002', title: 'Draft', authors: ['alice', 'bob'], text: 'secret' });
			await store.create({ editId: 'edit00000003', title: 'Bobs', authors: ['bob'], published: true });
		});

		it('lists published brews by default, without text', async ()=>{
			const brews = await store.listByUser('alice');

			expect(brews.map((brew)=>brew.title)).toEqual(['Published']);
			expect(brews[0]).not.toHaveProperty('text');
		});

		it('lists unpublished brews on request, including co-authored ones', async ()=>{
			expect((await store.listByUser('alice', { includeUnpublished: true })).map((brew)=>brew.title)).toEqual(['Published', 'Draft']);
			expect((await store.listByUser('bob', { includeUnpublished: true })).map((brew)=>brew.title)).toEqual(['Draft', 'Bobs']);
		});

		it('filters by tags', async ()=>{
			const brews = await store.listByUser('alice', { includeUnpublished: true, tags: ['meta:theme', 'meta:Theme'] });
			expect(brews.map((brew)=>brew.title)).toEqual(['Published']);
		});

		it('counts all brews of a user', async ()=>{
			expect(await store.countByUser('alice')).toBe(2);
			expect(await store.countByUser('nobody')).toBe(0);
		});

		it('renames an author on all their brews', async ()=>{
			expect(await store.renameAuthor('alice', 'alicia')).toBe(2);

			expect(await store.countByUser('alice')).toBe(0);
			expect((await store.getByEditId('edit00000002')).authors).toEqual(['alicia', 'bob']);
		});
	});

	describe('vault search', ()=>{
		beforeEach(async ()=>{
			await store.create({ title: 'The Dragon Lair', authors: ['alice'], published: true, renderer: 'V3', views: 5, createdAt: daysBefore(3) });
			await store.create({ title: 'dragon hoard', authors: ['bob'], published: true, renderer: 'legacy', views: 50, createdAt: daysBefore(2) });
			await store.create({ title: 'Secret Dragon', authors: ['alice'], published: false, renderer: 'V3' });
			await store.create({ title: '100% Goblins', authors: ['carol'], published: true, renderer: 'V3', createdAt: daysBefore(1) });
			await store.create({ title: '1000 Goblins', authors: ['carol'], published: true, renderer: 'V3' });
		});

		const titles = (brews)=>brews.map((brew)=>brew.title);

		it('finds published brews whose title contains every word, ignoring case', async ()=>{
			expect(titles(await store.search({ title: 'DRAGON' }))).toEqual(['dragon hoard', 'The Dragon Lair']);
			expect(titles(await store.search({ title: 'dragon lair' }))).toEqual(['The Dragon Lair']);
			expect(await store.countSearch({ title: 'dragon' })).toBe(2);
		});

		it('treats LIKE wildcards in the title as plain text', async ()=>{
			expect(titles(await store.search({ title: '100%' }))).toEqual(['100% Goblins']);
			expect(titles(await store.search({ title: '_' }))).toEqual([]);
		});

		it('filters by author and renderer', async ()=>{
			expect(titles(await store.search({ author: 'alice' }))).toEqual(['The Dragon Lair']);
			expect(titles(await store.search({ renderer: 'legacy' }))).toEqual(['dragon hoard']);
			expect(await store.countSearch({ renderer: 'V3' })).toBe(3);
		});

		it('sorts, pages and leaves out edit ids and text', async ()=>{
			const byViews = await store.search({ sort: 'views', dir: 'desc', count: 2 });
			expect(titles(byViews)).toEqual(['dragon hoard', 'The Dragon Lair']);
			expect(byViews[0]).not.toHaveProperty('editId');
			expect(byViews[0]).not.toHaveProperty('text');

			expect(titles(await store.search({ sort: 'createdAt', dir: 'asc', count: 2, page: 2 }))).toEqual(['100% Goblins', '1000 Goblins']);
		});

		it('falls back to title order for unknown sort fields', async ()=>{
			expect(titles(await store.search({ sort: 'text; DROP TABLE brews' }))).toEqual(['100% Goblins', '1000 Goblins', 'dragon hoard', 'The Dragon Lair']);
		});
	});

	describe('admin', ()=>{
		it('counts total and published brews', async ()=>{
			await store.create({ published: true });
			await store.create({});

			expect(await store.stats()).toEqual({ totalBrews: 2, totalPublishedBrews: 1 });
		});

		it('lists and deletes tiny brews untouched for 30 days', async ()=>{
			const old = { updatedAt: daysBefore(31), lastViewed: daysBefore(31) };
			await store.create({ ...old, shareId: 'junk00000001', text: 'x', authors: ['someone'] });
			await store.create({ ...old, shareId: 'long00000001', text: crypto.randomBytes(200).toString('hex') });
			await store.create({ updatedAt: daysBefore(31), lastViewed: daysBefore(5), shareId: 'seen00000001', text: 'x' });

			const junk = await store.listJunk();
			expect(junk).toEqual([{ shareId: 'junk00000001', textBinSize: expect.any(Number), updatedAt: daysBefore(31), lastViewed: daysBefore(31) }]);

			expect(await store.deleteJunk()).toBe(1);
			expect(await store.getByShareId('junk00000001')).toBeNull();
			expect(await store.stats()).toMatchObject({ totalBrews: 2 });
		});

		it('lists and deletes authorless brews untouched for 2 years', async ()=>{
			const old = { updatedAt: daysBefore(800), lastViewed: daysBefore(800) };
			await store.create({ ...old, shareId: 'lost00000001' });
			await store.create({ ...old, shareId: 'kept00000001', authors: ['someone'] });
			await store.create({ shareId: 'new000000001' });

			expect((await store.listLost()).map((brew)=>brew.shareId)).toEqual(['lost00000001']);
			expect(await store.deleteLost()).toBe(1);
			expect(await store.stats()).toMatchObject({ totalBrews: 2 });
		});
	});

	describe('locks', ()=>{
		beforeEach(async ()=>{
			await store.create({ editId: 'edit00000001', shareId: 'share0000001', title: 'Locked' });
			await store.create({ editId: 'edit00000002', shareId: 'share0000002', title: 'Reviewed' });
			await store.create({ editId: 'edit00000003', shareId: 'share0000003', title: 'Free' });
		});

		it('sets, lists, counts and clears locks', async ()=>{
			expect(await store.setLock('share0000001', { code: 455, shareMessage: 'Locked' })).toBe(true);
			expect(await store.setLock('share0000002', { code: 455, reviewRequested: NOW.toISOString() })).toBe(true);
			expect(await store.setLock('missing00001', { code: 1 })).toBe(false);

			expect(await store.countLocked()).toBe(2);
			expect((await store.getByShareId('share0000001')).lock).toEqual({ code: 455, shareMessage: 'Locked' });
			expect((await store.listLocked()).map((brew)=>brew.title)).toEqual(['Locked', 'Reviewed']);
			expect(await store.listLocked({ reviewRequested: true })).toEqual([
				{ shareId: 'share0000002', editId: 'edit00000002', title: 'Reviewed', lock: { code: 455, reviewRequested: NOW.toISOString() } }
			]);

			await store.setLock('share0000001', null);
			expect(await store.countLocked()).toBe(1);
			expect((await store.getByShareId('share0000001')).lock).toBeUndefined();
		});
	});
});
