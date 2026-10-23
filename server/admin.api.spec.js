import { createTestApp, adminAuth } from '../tests/support/testApp.js';
import createBrewStore from './storage/brewStore.js';

describe('Admin API', ()=>{
	let t, brews;

	const json = async (res)=>({ status: res.status, body: await res.json() });
	const admin = (method, url, body)=>t.request(url, {
		method,
		headers : { ...adminAuth(), 'Content-Type': 'application/json' },
		body    : body === undefined ? undefined : JSON.stringify(body)
	});

	beforeEach(async ()=>{
		t = await createTestApp();
		brews = createBrewStore(t.db);
	});

	afterEach(()=>t.close());

	describe('access', ()=>{
		it('asks for basic auth, rejects wrong credentials and lets the admin in', async ()=>{
			const anonymous = await t.request('/admin/stats');
			expect(anonymous.status).toBe(401);
			expect(anonymous.headers.get('WWW-Authenticate')).toMatch(/^Basic/);

			expect((await t.request('/admin/stats', { headers: adminAuth('wrong') })).status).toBe(401);
			expect((await admin('GET', '/admin/stats')).status).toBe(200);
		});

		it('is disabled when no admin password is configured', async ()=>{
			const unconfigured = await createTestApp({ ADMIN_PASSWORD: undefined });
			expect((await unconfigured.request('/admin/stats', { headers: adminAuth('') })).status).toBe(401);
			unconfigured.close();
		});

		it('renders the admin page', async ()=>{
			const res = await admin('GET', '/admin');
			expect(res.status).toBe(200);
			expect(await res.text()).toContain('"url":"/admin"');
		});
	});

	describe('brews', ()=>{
		it('reports stats, looks up brews and lists a user\'s brews', async ()=>{
			const brew = await brews.create({ title: 'Found', authors: ['alice'], published: true });
			await brews.create({ title: 'Draft', authors: ['alice'] });

			expect(await json(await admin('GET', '/admin/stats'))).toEqual({ status: 200, body: { totalBrews: 2, totalPublishedBrews: 1 } });
			expect((await json(await admin('GET', `/admin/lookup/${brew.editId}`))).body.title).toBe('Found');
			expect((await json(await admin('GET', `/admin/lookup/${brew.shareId}`))).body.title).toBe('Found');
			expect((await json(await admin('GET', '/admin/user/list/alice'))).body.map((b)=>b.title)).toEqual(['Found', 'Draft']);
		});

		it('lists and deletes junk and lost brews', async ()=>{
			const old = { updatedAt: '2020-01-01T00:00:00Z', lastViewed: '2020-01-01T00:00:00Z' };
			await brews.create({ ...old, text: 'x', authors: ['someone'] });
			await brews.create({ ...old, text: 'lost brew with enough text to not count as junk at all, no author', authors: [] });

			expect((await json(await admin('GET', '/admin/cleanupJunk'))).body.count).toBe(2);
			expect((await json(await admin('GET', '/admin/cleanupLost'))).body.count).toBe(1);
			expect((await json(await admin('POST', '/admin/cleanupLost'))).body).toEqual({ count: 1 });
			expect((await json(await admin('POST', '/admin/cleanupJunk'))).body).toEqual({ count: 1 });
			expect((await brews.stats()).totalBrews).toBe(0);
		});

		it('strips script tags from a brew', async ()=>{
			const brew = await brews.create({ title: 'Bad <script>', text: 'Hi <script>alert(1)</script>', description: '' });

			const res = await admin('PUT', `/admin/clean/script/${brew.shareId}`);

			expect(res.status).toBe(200);
			expect(await brews.getByEditId(brew.editId)).toMatchObject({ title: 'Bad >', text: 'Hi >alert(1)>', version: 2 });
		});
	});

	describe('locks', ()=>{
		let brew;
		beforeEach(async ()=>{
			brew = await brews.create({ title: 'Lockable' });
		});

		it('locks, lists, reviews and unlocks a brew', async ()=>{
			const lock = await json(await admin('POST', `/api/lock/${brew.shareId}`, { code: 455, shareMessage: 'Locked', editMessage: 'Locked' }));
			expect(lock).toMatchObject({ status: 200, body: { name: 'LOCKED', code: 455 } });

			expect((await json(await admin('POST', `/api/lock/${brew.shareId}`, { code: 1 }))).body.HBErrorCode).toBe('64');
			expect((await json(await admin('POST', `/api/lock/${brew.shareId}`, { code: 2, overwrite: true }))).status).toBe(200);

			expect((await json(await admin('GET', '/api/lock/count'))).body).toEqual({ count: 1 });
			expect((await json(await admin('GET', '/api/locks'))).body.lockedDocuments[0]).toMatchObject({ shareId: brew.shareId, lock: { code: 2 } });

			// Any user may request a review, once
			expect((await t.request(`/api/lock/review/request/${brew.shareId}`, { method: 'PUT' })).status).toBe(200);
			expect((await json(await t.request(`/api/lock/review/request/${brew.shareId}`, { method: 'PUT' }))).body.HBErrorCode).toBe('71');
			expect((await json(await admin('GET', '/api/lock/reviews'))).body.reviewDocuments).toHaveLength(1);
			expect((await admin('PUT', `/api/lock/review/remove/${brew.shareId}`)).status).toBe(200);
			expect((await json(await admin('GET', '/api/lock/reviews'))).body.reviewDocuments).toHaveLength(0);

			expect((await admin('PUT', `/api/unlock/${brew.shareId}`)).status).toBe(200);
			expect((await json(await admin('PUT', `/api/unlock/${brew.shareId}`))).body.HBErrorCode).toBe('67');
		});

		it('reports unknown brews', async ()=>{
			expect((await json(await admin('POST', '/api/lock/missing00001', { code: 1 }))).body.HBErrorCode).toBe('63');
			expect((await json(await t.request('/api/lock/review/request/missing00001', { method: 'PUT' }))).body.HBErrorCode).toBe('70');
		});
	});

	describe('notifications', ()=>{
		it('adds, lists publicly and deletes notifications', async ()=>{
			expect((await admin('POST', '/admin/notification/add', { dismissKey: 'hello', title: 'Hi' })).status).toBe(201);
			expect((await json(await admin('POST', '/admin/notification/add', { dismissKey: 'hello' }))).status).toBe(400);
			expect((await t.request('/admin/notification/add', { method: 'POST', body: '{}' })).status).toBe(401);

			expect((await json(await t.request('/admin/notification/all'))).body).toEqual([expect.objectContaining({ dismissKey: 'hello', title: 'Hi' })]);

			expect((await admin('DELETE', '/admin/notification/delete/hello')).status).toBe(200);
			expect((await admin('DELETE', '/admin/notification/delete/hello')).status).toBe(404);
		});
	});
});
