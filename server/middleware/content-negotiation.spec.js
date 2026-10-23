import { Hono } from 'hono';
import contentNegotiation from './content-negotiation.js';

describe('content-negotiation middleware', ()=>{
	const app = new Hono().use(contentNegotiation).get('*', (c)=>c.text('page'));
	const request = (accept)=>app.request('/somewhere', { headers: { Accept: accept } });

	it('answers 406 to image requests', async ()=>{
		const res = await request('image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8');

		expect(res.status).toBe(406);
		expect(await res.json()).toEqual({ message: 'Request for image at this URL is not supported' });
	});

	it('passes other requests on', async ()=>{
		const res = await request('text,image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8');
		expect(await res.text()).toBe('page');
	});
});
