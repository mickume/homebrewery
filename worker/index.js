// Cloudflare Worker entry point.
// Runs an Express app on workerd via the Node.js HTTP server compatibility layer:
// app.listen() registers the app under a routing key instead of opening a socket,
// and httpServerHandler() turns incoming fetch events into Node requests for it.
//
// Transitional: only the home page and a health check are served from here while the
// server is migrated off MongoDB and the filesystem. All other page and API routes
// answer 503 until they are ported.

import { httpServerHandler } from 'cloudflare:node';
import { env }               from 'cloudflare:workers';
import express               from 'express';
import packageJSON           from '../package.json' with { type: 'json' };
import { splitTextStyleAndMetadata } from '../shared/helpers.js';
import welcomeText           from '../client/homebrew/pages/homePage/welcome_msg.md';

const PORT = 8080;
const version = packageJSON.version;

const defaultMetaTags = {
	site_name   : 'The Homebrewery - Make your Homebrew content look legit!',
	title       : 'The Homebrewery',
	description : 'A NaturalCrit Tool for creating authentic Homebrews using Markdown.',
	type        : 'website'
};

const renderPage = async (req, props)=>{
	const baseUrl = `${req.protocol}://${req.get('host')}`;
	const htmlResponse = await env.ASSETS.fetch(new Request(`${baseUrl}/index.html`));
	const html = await htmlResponse.text();

	const ogTags = Object.entries(props.ogMeta ?? {})
		.filter(([, value])=>value)
		.map(([key, value])=>`<meta property="og:${key}" content="${value}">`)
		.join('\n');

	const safeProps = JSON.stringify({
		version,
		url    : req.originalUrl,
		config : { local: false, publicUrl: baseUrl, baseUrl, environment: 'production', deployment: '', developmentStyle: false },
		...props
	}).replace(/<(?=\/?script)/ig, '\\u003c');

	//Replace must use a function instead of string, else brews with `$` in contents are treated as replacement patterns
	return html.replace('<head>', ()=>`<head>\n<script id="props">window.__INITIAL_PROPS__ = ${safeProps}</script>\n${ogTags}`);
};

const app = express();
app.set('trust proxy', 1);

app.get('/api/health', (req, res)=>{
	res.json({ status: 'ok', version });
});

app.get('/', async (req, res)=>{
	const brew = { text: welcomeText, renderer: 'V3', theme: '5ePHB' };
	splitTextStyleAndMetadata(brew);

	res.send(await renderPage(req, {
		brew,
		ogMeta : { ...defaultMetaTags, title: 'Homepage', description: 'Homepage' }
	}));
});

app.use((req, res)=>{
	res.status(503).json({ message: 'This route has not been migrated to Cloudflare Workers yet.' });
});

app.listen(PORT);
export default httpServerHandler({ port: PORT });
