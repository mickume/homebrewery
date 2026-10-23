import { testDatabases, resetDatabase } from '../../tests/support/testDatabases.js';
import createNotificationStore from './notificationStore.js';

const NOW = new Date('2026-10-23T12:00:00.000Z');

describe.each(testDatabases)('notificationStore on %s', (name, openDatabase)=>{
	let database, db, store;

	beforeAll(async ()=>{
		database = await openDatabase();
		db = database.db;
	});

	beforeEach(async ()=>{
		await resetDatabase(db);
		store = createNotificationStore(db, { now: ()=>new Date(NOW) });
	});

	afterAll(async ()=>database?.close());

	it('adds a notification with defaults', async ()=>{
		expect(await store.add({ dismissKey: 'welcome' })).toEqual({
			dismissKey : 'welcome',
			title      : '',
			text       : '',
			createdAt  : NOW.toISOString(),
			startAt    : NOW.toISOString(),
			stopAt     : NOW.toISOString()
		});
	});

	it('lists all notifications', async ()=>{
		await store.add({ dismissKey: 'a', title: 'First', startAt: '2026-11-01', stopAt: '2026-11-02T10:00:00Z' });
		await store.add({ dismissKey: 'b', title: 'Second' });

		const notifications = await store.getAll();
		expect(notifications.map((notification)=>notification.dismissKey)).toEqual(['a', 'b']);
		expect(notifications[0]).toMatchObject({ startAt: '2026-11-01T00:00:00.000Z', stopAt: '2026-11-02T10:00:00.000Z' });
	});

	it('requires a unique dismiss key', async ()=>{
		await expect(store.add({ title: 'No key' })).rejects.toThrow('Dismiss key is required!');

		await store.add({ dismissKey: 'a' });
		await expect(store.add({ dismissKey: 'a' })).rejects.toThrow('already exists');
	});

	it('removes a notification and returns it', async ()=>{
		await store.add({ dismissKey: 'a', title: 'Gone' });

		expect(await store.remove('a')).toMatchObject({ dismissKey: 'a', title: 'Gone' });
		expect(await store.getAll()).toEqual([]);
		expect(await store.remove('a')).toBeNull();
	});
});
