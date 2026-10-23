// Page rendering. The client is a single-page app; the Worker answers page routes with the built
// index.html (read through the ASSETS binding) plus a script holding the page's props.

import packageJSON from '../package.json' with { type: 'json' };

const version = packageJSON.version;

const defaultMetaTags = (origin)=>({
	site_name   : 'The Homebrewery - Make your Homebrew content look legit!',
	title       : 'The Homebrewery',
	description : 'A NaturalCrit Tool for creating authentic Homebrews using Markdown.',
	image       : `${origin}/thumbnail.png`,
	type        : 'website'
});

const escapeAttribute = (value)=>String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

// index.html only changes with a deploy, which starts new isolates, so it is fetched once per isolate
let indexHtml;
const getIndexHtml = (c)=>{
	indexHtml ??= c.env.ASSETS.fetch(new URL('/index.html', c.req.url))
		.then((response)=>{
			if(!response.ok) throw new Error(`Could not load index.html from assets: ${response.status}`);
			return response.text();
		})
		.catch((error)=>{
			indexHtml = undefined;
			throw error;
		});
	return indexHtml;
};

// Renders the app shell with page props. `props` holds the page data: brew, brews, userThemes, ogMeta.
const renderPage = async (c, props = {}, status = 200)=>{
	const { origin } = new URL(c.req.url);
	const config = c.get('config');
	const url = new URL(c.req.url);

	const fullProps = {
		version,
		url     : props.url ?? `${url.pathname}${url.search}`,
		account : c.get('account'),
		config  : {
			local            : config.isLocal,
			publicUrl        : origin,
			baseUrl          : origin,
			environment      : config.environment,
			deployment       : config.environment === 'preview' ? 'Preview' : '',
			developmentStyle : false
		},
		...props,
		// Page values override the defaults; undefined ones keep the default (e.g. no thumbnail → site image)
		ogMeta : { ...defaultMetaTags(origin), ...Object.fromEntries(Object.entries(props.ogMeta ?? {}).filter(([, value])=>value !== undefined)) }
	};

	const ogTags = Object.entries(fullProps.ogMeta)
		.filter(([, value])=>value)
		.map(([key, value])=>`<meta property="og:${key}" content="${escapeAttribute(value)}">`)
		.join('\n');

	const safeProps = JSON.stringify(fullProps).replace(/<(?=\/?script)/ig, '\\u003c');
	const html = await getIndexHtml(c);

	//Replace must use a function instead of string, else brews with `$` in contents are treated as replacement patterns
	return c.html(html.replace('<head>', ()=>`<head>\n<script id="props">window.__INITIAL_PROPS__ = ${safeProps}</script>\n${ogTags}`), status);
};

export { renderPage, defaultMetaTags, version };
