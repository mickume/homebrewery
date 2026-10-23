import { createTestApp } from '../tests/support/testApp.js';
import createBrewStore from './storage/brewStore.js';

describe('Vault API', ()=>{
	let t;

	const search = async (query)=>(await t.request(`/api/vault?${new URLSearchParams(query)}`)).json();
	const total = async (query)=>(await (await t.request(`/api/vault/total?${new URLSearchParams(query)}`)).json()).totalBrews;

	beforeEach(async ()=>{
		t = await createTestApp();
		const brews = createBrewStore(t.db);
		await brews.create({ title: 'Dragon Lair', authors: ['alice'], published: true, renderer: 'V3', views: 3 });
		await brews.create({ title: 'Dragon Hoard', authors: ['someone@example.com'], published: true, renderer: 'legacy', views: 9 });
		await brews.create({ title: 'Secret Dragon', authors: ['alice'], published: false, renderer: 'V3' });
	});

	afterEach(()=>t.close());

	it('searches published brews by title and hides editIds', async ()=>{
		const { brews, page } = await search({ title: 'dragon' });

		expect(page).toBe(1);
		expect(brews.map((brew)=>brew.title)).toEqual(['Dragon Hoard', 'Dragon Lair']);
		expect(brews.every((brew)=>brew.editId === undefined)).toBe(true);
		expect(await total({ title: 'dragon' })).toBe(2);
	});

	it('hides authors whose username is an email address', async ()=>{
		const { brews } = await search({ title: 'hoard' });
		expect(brews[0].authors).toEqual(['hidden']);
	});

	it('filters by renderer and author, and sorts', async ()=>{
		expect((await search({ v3: 'true' })).brews.map((brew)=>brew.title)).toEqual(['Dragon Lair']);
		expect((await search({ legacy: 'true' })).brews.map((brew)=>brew.title)).toEqual(['Dragon Hoard']);
		expect((await search({ legacy: 'true', v3: 'true', author: 'alice' })).brews.map((brew)=>brew.title)).toEqual(['Dragon Lair']);
		expect((await search({ sort: 'views', dir: 'desc' })).brews.map((brew)=>brew.title)).toEqual(['Dragon Hoard', 'Dragon Lair']);
		expect(await total({ v3: 'true' })).toBe(1);
	});
});
