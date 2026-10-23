// The Homebrewery Worker app (Hono). Static client files are served by Workers Static Assets before the
// Worker runs; everything else lands here. Bindings: DB (D1), ASSETS, BREW_UPDATES (Durable Object).

import { Hono }          from 'hono';
import { HTTPException } from 'hono/http-exception';
import { bodyLimit }     from 'hono/body-limit';
import { sign }          from 'hono/jwt';

import { config, stores, account } from './middleware/context.js';
import contentNegotiation from './middleware/content-negotiation.js';
import homebrewApi        from './homebrew.api.js';
import pageRoutes         from './page-routes.js';
import vaultApi           from './vault.api.js';
import adminApi           from './admin.api.js';
import streamApi          from './stream.api.js';
import { renderPage }     from './render.js';
import { toPlainError, errorStatus } from './errors.js';

const MAX_BODY_BYTES = 25 * 1024 * 1024;

const isApiRequest = (c)=>new URL(c.req.url).pathname.startsWith('/api');

// Error details for the client: everything the error page shows, without stack traces outside local dev
const errorDetails = (c, error)=>{
	const details = toPlainError(error);
	if(!c.get('config')?.isLocal) delete details.stack;
	return details;
};

const handleError = async (error, c)=>{
	if(error instanceof HTTPException) return error.getResponse();

	const status = errorStatus(error);
	if(status >= 500) console.error(error);
	else console.warn(`${status} ${new URL(c.req.url).pathname}: ${error.name ?? 'Error'}: ${error.message}`);
	const details = { ...errorDetails(c, error), originalUrl: new URL(c.req.url).pathname };

	if(isApiRequest(c)) return c.json(details, status);

	return renderPage(c, {
		url  : '/error',
		brew : {
			...details,
			title       : 'Error - Something went wrong!',
			text        : details.errors?.map((e)=>e.message).join('\n\n') || details.message || 'Unknown error!',
			status,
			HBErrorCode : details.HBErrorCode ?? '00',
			pureError   : details
		},
		ogMeta : { title: 'Error Page', description: 'Something went wrong!' }
	}, status).catch((renderError)=>{
		console.error('Could not render the error page:', renderError);
		return c.text(`${details.name ?? 'Error'}: ${details.message ?? 'Unknown error'}`, status);
	});
};

// Hono's error handler only receives Error instances; wrap anything else that is thrown
const errorsAsErrors = async (c, next)=>{
	try {
		await next();
	} catch (error) {
		if(error instanceof Error) throw error;
		throw Object.assign(new Error(error?.message ?? String(error)), error);
	}
};

export default function createApp() {
	const app = new Hono();

	app.use(errorsAsErrors);
	app.use(config);
	app.use(contentNegotiation);
	app.use(bodyLimit({ maxSize: MAX_BODY_BYTES }));
	app.use(stores);
	app.use(account);

	// Local development only: sign in as any username
	app.post('/local/login', async (c)=>{
		if(!c.get('config').isLocal) return c.json({ message: 'Not found' }, 404);
		const { username } = await c.req.json();
		if(!username) return c.json({ message: 'username is required' }, 400);
		return c.json(await sign({ username, issued: new Date() }, c.get('config').jwtSecret, 'HS256'));
	});

	app.route('/', homebrewApi);
	app.route('/', streamApi);
	app.route('/', vaultApi);
	app.route('/', adminApi);
	app.route('/', pageRoutes);

	// Unknown API routes are 404; unknown pages go to the home page
	app.notFound((c)=>isApiRequest(c) ? c.json({ message: 'Not found' }, 404) : c.redirect('/'));
	app.onError(handleError);

	return app;
}
