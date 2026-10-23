// Page routes: each renders the app shell with the page's props (see render.js).

import _        from 'lodash';
import { Hono } from 'hono';
import { splitTextStyleAndMetadata } from '../shared/helpers.js';
import { DEFAULT_BREW }              from './brewDefaults.js';
import { getBrew, getUsersBrewThemes, sanitizeBrew } from './homebrew.api.js';
import { renderPage } from './render.js';
import { hbError }    from './errors.js';

import welcomeText       from '../client/homebrew/pages/homePage/welcome_msg.md';
import welcomeTextLegacy from '../client/homebrew/pages/homePage/welcome_msg_legacy.md';
import migrateText       from '../client/homebrew/pages/homePage/migrate.md';
import changelogText     from '../changelog.md';
import faqText           from '../faq.md';

const router = new Hono();

// Pages showing a markdown document from the repository
const staticBrewPage = (path, brew, ogMeta)=>{
	router.get(path, (c)=>{
		const pageBrew = { ...brew };
		splitTextStyleAndMetadata(pageBrew);
		return renderPage(c, { brew: pageBrew, ogMeta });
	});
};

staticBrewPage('/', { text: welcomeText, renderer: 'V3', theme: '5ePHB' },
	{ title: 'Homepage', description: 'Homepage' });
staticBrewPage('/legacy', { text: welcomeTextLegacy, renderer: 'legacy', theme: '5ePHB' },
	{ title: 'Homepage (Legacy)', description: 'Homepage' });
staticBrewPage('/migrate', { text: migrateText, renderer: 'V3', theme: '5ePHB' },
	{ title: 'v3 Migration Guide', description: 'A brief guide to converting Legacy documents to the v3 renderer.' });
staticBrewPage('/changelog', { title: 'Changelog', text: changelogText, renderer: 'V3', theme: '5ePHB' },
	{ title: 'Changelog', description: 'Development changelog.' });
staticBrewPage('/faq', { title: 'FAQ', text: faqText, renderer: 'V3', theme: '5ePHB' },
	{ title: 'FAQ', description: 'Frequently Asked Questions' });

const NEW_PAGE_META = { title: 'New', description: 'Start crafting your homebrew on the Homebrewery!' };

router.get('/new', async (c)=>{
	return renderPage(c, { userThemes: await getUsersBrewThemes(c), ogMeta: NEW_PAGE_META });
});

// New brew cloned from a shared one
router.get('/new/:id', async (c)=>{
	const source = await getBrew(c, 'share');
	const brew = _.defaults({
		shareId  : source.shareId,
		title    : `CLONE - ${source.title}`,
		text     : source.text,
		style    : source.style,
		renderer : source.renderer,
		theme    : source.theme,
		tags     : source.tags,
		snippets : source.snippets
	}, DEFAULT_BREW);
	return renderPage(c, { brew, userThemes: await getUsersBrewThemes(c), ogMeta: NEW_PAGE_META });
});

router.get('/edit/:id', async (c)=>{
	const brew = await getBrew(c, 'edit');
	const ogMeta = {
		title       : brew.title || 'Untitled Brew',
		description : brew.description || 'No description.',
		image       : brew.thumbnail || undefined,
		locale      : brew.lang,
		type        : 'article'
	};
	sanitizeBrew(brew, 'edit');
	c.header('Cache-Control', 'no-cache, no-store'); // Reload the latest saved brew on back navigation, not a cached copy
	return renderPage(c, { brew, userThemes: await getUsersBrewThemes(c), ogMeta });
});

router.get('/share/:id', async (c)=>{
	const brew = await getBrew(c, 'share');
	const isAuthor = brew.authors.includes(c.get('account')?.username);
	const ogMeta = {
		title       : `${brew.title || 'Untitled Brew'} - ${brew.authors[0] || 'No author.'}`,
		description : brew.description || 'No description.',
		image       : brew.thumbnail || undefined,
		type        : 'article'
	};

	// Count visits, but not the authors' own
	if(!isAuthor) await c.get('stores').brews.incrementViews(brew.shareId);

	sanitizeBrew(brew, isAuthor ? 'shareAuthor' : 'share');
	return renderPage(c, { brew, ogMeta });
});

const USER_PAGE_FIELDS = ['title', 'pageCount', 'description', 'authors', 'lang', 'published', 'views', 'shareId',
	'editId', 'createdAt', 'updatedAt', 'lastViewed', 'thumbnail', 'tags'];

router.get('/user/:username', async (c)=>{
	const { username } = c.req.param();
	const ownAccount = c.get('account')?.username === username;

	const brews = (await c.get('stores').brews.listByUser(username, { includeUnpublished: ownAccount }))
		.map((brew)=>{
			const listed = _.pick(brew, USER_PAGE_FIELDS);
			listed.title = listed.title?.trim();
			listed.description = listed.description?.trim();
			return sanitizeBrew(listed, ownAccount ? 'edit' : 'share');
		});

	return renderPage(c, {
		brews,
		ogMeta : { title: `${username}'s Collection`, description: 'View my collection of homebrew on the Homebrewery.' }
	});
});

router.get('/account', async (c)=>{
	const account = c.get('account');
	if(!account) {
		c.header('WWW-Authenticate', 'Bearer realm="Authorization Required"');
		throw hbError({ name: 'Error', message: 'No valid account', status: 401, HBErrorCode: '50', page: 'Account Information Page' });
	}

	const brew = {
		title          : 'Account Information Page',
		accountDetails : {
			username  : account.username,
			issued    : account.issued,
			brewCount : await c.get('stores').brews.countByUser(account.username)
		}
	};
	return renderPage(c, { brew, ogMeta: { title: 'Account Page', description: null } });
});

router.get('/vault', (c)=>{
	return renderPage(c, { ogMeta: { title: 'The Vault', description: 'Search for Brews' } });
});

export default router;
