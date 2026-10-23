import { sign } from 'hono/jwt';
import { createTestApp, pageProps, JWT_SECRET } from '../support/testApp.js';
import createBrewStore from '../../server/storage/brewStore.js';

describe('Pages', ()=>{
	let t;

	beforeEach(async ()=>{
		t = await createTestApp();
	});

	afterEach(()=>t.close());

	it.each([
		['/', 'Homepage'],
		['/legacy', 'Homepage (Legacy)'],
		['/migrate', 'v3 Migration Guide'],
		['/changelog', 'Changelog'],
		['/faq', 'FAQ']
	])('%s renders its markdown document', async (url, title)=>{
		const res = await t.request(url);
		const props = await pageProps(res);

		expect(res.status).toBe(200);
		expect(props.brew.text.length).toBeGreaterThan(100);
		expect(props.ogMeta.title).toBe(title);
		expect(props.url).toBe(url);
		expect(props.config).toMatchObject({ environment: 'production', local: false, baseUrl: 'http://localhost' });
	});

	it('renders the share page, counts the view and escapes og tags', async ()=>{
		const brew = await createBrewStore(t.db).create({ title: 'A "quoted" <title>', text: 'Hi', authors: ['alice'] });

		const res = await t.request(`/share/${brew.shareId}`);
		const html = await res.clone().text();
		const props = await pageProps(res);

		expect(props.brew).toMatchObject({ shareId: brew.shareId, title: 'A "quoted" <title>' });
		expect(props.brew.editId).toBeUndefined();
		expect(html).toContain('content="A &quot;quoted&quot; &lt;title> - alice"');
		expect((await createBrewStore(t.db).getByShareId(brew.shareId)).views).toBe(1);
	});

	it('renders the user page with unpublished brews only for the owner', async ()=>{
		const brews = createBrewStore(t.db);
		await brews.create({ title: 'Public', authors: ['alice'], published: true });
		await brews.create({ title: 'Private', authors: ['alice'] });

		const visitor = await pageProps(await t.request('/user/alice'));
		const owner = await pageProps(await t.request('/user/alice', { headers: { cookie: await t.session('alice') } }));

		expect(visitor.brews.map((brew)=>brew.title)).toEqual(['Public']);
		expect(visitor.brews[0].editId).toBeUndefined();
		expect(owner.brews.map((brew)=>brew.title)).toEqual(['Public', 'Private']);
		expect(owner.brews[0].editId).toBeDefined();
	});

	it('renders the account page for signed-in users and an error page otherwise', async ()=>{
		await createBrewStore(t.db).create({ authors: ['alice'] });

		const signedIn = await pageProps(await t.request('/account', { headers: { cookie: await t.session('alice') } }));
		expect(signedIn.brew.accountDetails).toMatchObject({ username: 'alice', brewCount: 1 });

		const res = await t.request('/account');
		expect(res.status).toBe(401);
		expect((await pageProps(res)).brew).toMatchObject({ HBErrorCode: '50', status: 401 });
	});

	it('renders the new page, also as a clone of a shared brew', async ()=>{
		const brew = await createBrewStore(t.db).create({ title: 'Original', text: 'Clone me' });

		expect((await t.request('/new')).status).toBe(200);
		expect((await pageProps(await t.request(`/new/${brew.shareId}`))).brew).toMatchObject({ title: 'CLONE - Original', text: 'Clone me' });
	});

	it('ignores session cookies signed with another key', async ()=>{
		const forged = await sign({ username: 'alice' }, `not-${JWT_SECRET}`, 'HS256');
		const props = await pageProps(await t.request('/vault', { headers: { cookie: `nc_session=${forged}` } }));
		expect(props.account).toBeUndefined();
	});

	it('redirects unknown pages home and answers unknown API routes with 404', async ()=>{
		const page = await t.request('/no/such/page');
		expect(page.status).toBe(302);
		expect(page.headers.get('Location')).toBe('/');
		expect((await t.request('/api/no-such-route')).status).toBe(404);
	});

	it('only offers local login in local development', async ()=>{
		const login = (app)=>app.request('/local/login', { method: 'POST', body: JSON.stringify({ username: 'dev' }) });
		expect((await login(t)).status).toBe(404);

		const local = await createTestApp({ ENVIRONMENT: 'local', JWT_SECRET: undefined });
		const res = await login(local);
		expect(res.status).toBe(200);
		const props = await pageProps(await local.request('/vault', { headers: { cookie: `nc_session=${await res.json()}` } }));
		expect(props.account.username).toBe('dev');
		local.close();
	});

	it('fails loudly when the D1 binding is missing', async ()=>{
		const broken = await createTestApp({ DB: undefined });
		const res = await broken.request('/api/vault');
		expect(res.status).toBe(503);
		expect(await res.json()).toMatchObject({ HBErrorCode: '13' });
		broken.close();
	});

	it('answers image requests for missing files with 406', async ()=>{
		const res = await t.request('/missing.png', { headers: { Accept: 'image/avif,image/webp,image/*,*/*;q=0.8' } });
		expect(res.status).toBe(406);
		expect((await t.request('/vault', { headers: { Accept: 'text/html,image/avif,*/*;q=0.8' } })).status).toBe(200);
	});
});
