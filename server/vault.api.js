// Vault: search of published brews.

import { Hono } from 'hono';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const rendererFilter = (legacy, v3)=>{
	if(legacy === 'true' && v3 !== 'true') return 'legacy';
	if(v3 === 'true' && legacy !== 'true') return 'V3';
	return undefined; // Both or neither selected: no filter
};

const searchFilters = (c)=>({
	title    : c.req.query('title') || '',
	author   : c.req.query('author') || '',
	renderer : rendererFilter(c.req.query('legacy'), c.req.query('v3'))
});

const router = new Hono();

router.get('/api/vault', async (c)=>{
	const page  = Math.max(parseInt(c.req.query('page'))  || 1, 1);
	const count = Math.min(Math.max(parseInt(c.req.query('count')) || 20, 10), 100);

	const brews = await c.get('stores').brews.search({
		...searchFilters(c),
		sort : c.req.query('sort') || 'title',
		dir  : c.req.query('dir') || 'asc',
		page,
		count
	});

	// Authors who signed up with an email address as username stay anonymous
	for (const brew of brews)
		brew.authors = brew.authors.map((author)=>EMAIL.test(author) ? 'hidden' : author);

	return c.json({ brews, page });
});

router.get('/api/vault/total', async (c)=>{
	const totalBrews = await c.get('stores').brews.countSearch(searchFilters(c));
	return c.json({ totalBrews });
});

export default router;
