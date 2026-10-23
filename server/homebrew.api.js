/* eslint-disable max-lines */
// Brew API: create, load, save, delete, theme bundles, and the read-only brew endpoints
// (fetch, metadata, css, source, download).

import _                    from 'lodash';
import { Hono }             from 'hono';
import { applyPatches, parsePatch } from '@sanity/diff-match-patch';
import sanitizeFilename     from 'sanitize-filename';
import { splitTextStyleAndMetadata, debugTextMismatch } from '../shared/helpers.js';
import { sha256 }           from '../shared/hash.js';
import { DEFAULT_BREW, DEFAULT_BREW_LOAD } from './brewDefaults.js';
import { mergeBrewText, getGoodBrewTitle } from './brewText.js';
import { hbError }          from './errors.js';
import { notifyBrewUpdated } from './stream.api.js';
import checkClientVersion   from './middleware/check-client-version.js';
import Themes               from '../themes/themes.json' with { type: 'json' };

const isStaticTheme = (renderer, themeName)=>Themes[renderer]?.[themeName] !== undefined;

// Fields a client cannot set through a save
const PROTECTED_FIELDS = ['views', 'lastViewed', 'lock', 'createdAt', 'shareId', 'editId'];

const sanitizeBrew = (brew, accessType)=>{
	if(accessType !== 'edit' && accessType !== 'shareAuthor')
		brew.editId = undefined;
	return brew;
};

// Validates a brew id from the URL: 12 characters, letters, digits, - and _
const getId = (id)=>{
	if(!id?.match(/^[a-zA-Z0-9-_]{7,14}$/))
		throw hbError({ name: 'ID Error', message: 'Invalid ID', status: 404, HBErrorCode: '11', brewId: id });
	return id;
};

// JSON request body; the editor sends saves gzip-compressed with Content-Encoding: gzip
const readJsonBody = async (c)=>{
	let bytes = new Uint8Array(await c.req.arrayBuffer());
	const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
	if(c.req.header('Content-Encoding') === 'gzip' && isGzip) {
		const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
		bytes = new Uint8Array(await new Response(stream).arrayBuffer());
	}
	let body;
	try {
		body = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		throw hbError({ name: 'Request Error', message: 'Request body is not valid JSON', status: 400 });
	}
	if(!_.isPlainObject(body))
		throw hbError({ name: 'Request Error', message: 'Request body must be a JSON object', status: 400 });
	return body;
};

const loadStoredBrew = (brews, accessType, id)=>{
	if(accessType === 'edit')  return brews.getByEditId(id);
	if(accessType === 'share') return brews.getByShareId(id);
	return brews.getByAnyId(id);
};

// Loads a brew and checks access. accessType: 'edit' (authors and invited authors), 'share' (anyone,
// unless locked) or 'admin' (by edit or share id, no checks; admin routes are behind basic auth).
const getBrew = async (c, accessType, id = c.req.param('id'))=>{
	id = getId(id);
	const stored = await loadStoredBrew(c.get('stores').brews, accessType, id);
	const username = c.get('account')?.username;

	const isOwner   = (accessType === 'edit' && (!stored || stored.authors.length === 0)) || (username && stored?.authors[0] === username);
	const isAuthor  = username && stored?.authors.includes(username);
	const isInvited = username && stored?.invitedAuthors.includes(username);

	if(accessType === 'edit' && !(isOwner || isAuthor || isInvited)) {
		const accessError = { name: 'Access Error', status: 401, authors: stored?.authors, brewTitle: stored?.title, shareId: stored?.shareId };
		if(c.get('account'))
			throw hbError({ ...accessError, message: 'User is not an Author', HBErrorCode: '03' });
		throw hbError({ ...accessError, message: 'User is not logged in', HBErrorCode: '04' });
	}

	if(stored?.lock && accessType === 'share')
		throw hbError({ HBErrorCode: '51', code: stored.lock.code, message: stored.lock.shareMessage, brewId: stored.shareId, brewTitle: stored.title, brewAuthors: stored.authors });

	if(!stored)
		throw hbError({ name: 'BrewLoad Error', message: 'Brew not found', status: 404, HBErrorCode: '05', accessType, brewId: id });

	// Fill in missing fields with defaults; an empty renderer means a legacy brew
	const brew = _.defaults({ ...stored, renderer: stored.renderer || undefined }, DEFAULT_BREW_LOAD);
	splitTextStyleAndMetadata(brew);
	return brew;
};

// The signed-in user's brews tagged meta:theme, grouped by renderer, for the theme picker
const getUsersBrewThemes = async (c)=>{
	const username = c.get('account')?.username;
	if(!username) return {};

	const brews = await c.get('stores').brews.listByUser(username, { includeUnpublished: true, tags: ['meta:theme', 'meta:Theme'] });
	const userThemes = {};
	for (const brew of brews) {
		userThemes[brew.renderer] ??= {};
		userThemes[brew.renderer][brew.shareId] = {
			name         : brew.title,
			renderer     : brew.renderer,
			baseTheme    : brew.theme,
			baseSnippets : false,
			author       : brew.authors[0],
			path         : brew.shareId,
			thumbnail    : brew.thumbnail || '/assets/naturalCritLogoWhite.svg'
		};
	}
	return userThemes;
};

const beforeNewSave = (account, brew)=>{
	if(!brew.title)
		brew.title = getGoodBrewTitle(brew.text);

	brew.authors = account?.username ? [account.username] : [];
	brew.text = mergeBrewText(brew);

	_.defaults(brew, DEFAULT_BREW);

	brew.title = brew.title.trim();
	brew.description = brew.description.trim();
};

const newBrew = async (c)=>{
	const brew = _.omit(await readJsonBody(c), ['editId', 'shareId', 'createdAt', 'updatedAt', 'lastViewed', 'views', 'lock', 'version']);
	beforeNewSave(c.get('account'), brew);

	const saved = await c.get('stores').brews.create(brew);
	return c.json(saved);
};

// Applies the client's patches to the stored text and logs when they do not reproduce the client's
// full text. The full text remains authoritative; the patches are verified only for diagnostics.
const verifyPatches = (brewFromClient, storedText)=>{
	try {
		const [patchedText, applied] = applyPatches(parsePatch(brewFromClient.patches), encodeURI(storedText));
		const failedPatchCount = applied.filter((patchApplied)=>!patchApplied).length;
		if(failedPatchCount)
			throw new Error(`Patch failure: ${failedPatchCount}/${applied.length} did not apply`);
		if(decodeURI(patchedText) !== brewFromClient.text) {
			debugTextMismatch(brewFromClient.text, decodeURI(patchedText), `edit/${brewFromClient.editId}`);
			throw new Error('Patches did not apply cleanly, text mismatch detected');
		}
	} catch (error) {
		console.error('Failed to apply patches:', { brewId: brewFromClient.editId || 'unknown', error: error.message });
	}
};

const outOfSync = (c, message)=>c.json({ message }, 409);

const updateBrew = async (c)=>{
	const brewFromServer = await getBrew(c, 'edit');
	const brewFromClient = _.omit(await readJsonBody(c), PROTECTED_FIELDS);

	if(brewFromServer.version !== brewFromClient.version) {
		console.log(`Version mismatch on brew ${brewFromServer.editId}`);
		return outOfSync(c, 'The server version is out of sync with the saved brew. Please save your changes elsewhere, refresh, and try again.');
	}

	const serverText = brewFromServer.text.normalize('NFC');
	if(await sha256(serverText) !== brewFromClient.hash) {
		console.log(`Hash mismatch on brew ${brewFromServer.editId}`);
		debugTextMismatch(brewFromClient.text, serverText, `edit/${brewFromServer.editId}`);
		return outOfSync(c, 'The server copy is out of sync with the saved brew. Please save your changes elsewhere, refresh, and try again.');
	}

	if(brewFromClient.patches) verifyPatches(brewFromClient, serverText);

	const brew = _.assign(brewFromServer, brewFromClient);
	const account = c.get('account');
	brew.title       = brew.title.trim();
	brew.description = brew.description.trim() || '';
	brew.text        = mergeBrewText(brew);
	brew.updatedAt   = new Date();
	brew.version     = brewFromServer.version + 1;
	if(account?.username) {
		brew.authors = _.uniq([...brew.authors, account.username]);
		brew.invitedAuthors = brew.invitedAuthors.filter((author)=>author !== account.username);
	}

	// The version guard makes the check above and this write atomic: a concurrent save wins, this one gets 409
	const saved = await c.get('stores').brews.update(brewFromServer.editId, brew, { expectedVersion: brewFromClient.version });
	if(!saved)
		return outOfSync(c, 'The brew was saved from somewhere else in the meantime. Please save your changes elsewhere, refresh, and try again.');

	notifyBrewUpdated(c, saved);
	return c.json(_.omit(saved, ['text']));
};

// Removes the signed-in user from the brew's authors; deletes the brew when no authors remain
const deleteBrew = async (c)=>{
	const brew = await getBrew(c, 'edit');
	const username = c.get('account')?.username;
	const remainingAuthors = brew.authors.filter((author)=>author !== username);
	const brews = c.get('stores').brews;

	if(remainingAuthors.length === 0)
		await brews.delete(brew.editId);
	else
		await brews.update(brew.editId, { authors: remainingAuthors });

	return c.body(null, 204);
};

/* getThemeBundle: collects a theme and all its parent themes.
	Returns { styles, snippets, name, author } with styles and snippets in render order (oldest parent first).
	:id is the shareId of a user theme or the name of a static theme; :renderer is the markdown renderer. */
const getThemeBundle = async (c)=>{
	let renderer = _.upperFirst(c.req.param('renderer'));
	let id = c.req.param('id');
	const { origin } = new URL(c.req.url);
	const completeStyles   = [];
	const completeSnippets = [];
	let themeName;
	let themeAuthor;

	while (id) {
		if(!isStaticTheme(renderer, id)) {
			//=== User Themes ===//
			const theme = await getBrew(c, 'share', id).catch((error)=>{
				if(error.HBErrorCode === '05')
					throw hbError({ ...error, name: 'ThemeLoad Error', message: 'Theme Not Found', HBErrorCode: '09' });
				throw error;
			});
			if(!theme.tags.some((tag)=>tag === 'meta:theme' || tag === 'meta:Theme'))
				throw hbError({ brewId: id, name: 'Invalid Theme Selected', message: 'Selected theme does not have the meta:theme tag', status: 422, HBErrorCode: '10' });
			themeName   ??= theme.title;
			themeAuthor ??= theme.authors?.[0];

			if(theme.snippets) completeSnippets.push({ name: theme.title, snippets: theme.snippets });
			if(theme.style) completeStyles.push(`/* From Brew: ${origin}/share/${id} */\n\n${theme.style}`);

			id       = theme.theme;
			renderer = theme.renderer;
		} else {
			//=== Static Themes ===//
			themeName ??= id;
			completeSnippets.push(`${renderer}_${id}`); // Just the name; the client loads the snippets
			completeStyles.push(`/* From Theme ${id} */\n\n@import url("/themes/${renderer}/${id}/style.css");`);

			id = Themes[renderer][id].baseTheme;
		}
	}

	return c.json({
		styles   : completeStyles.reverse(),
		snippets : completeSnippets.reverse(),
		name     : themeName,
		author   : themeAuthor
	});
};

//==== Read-only brew endpoints ====//

const isAuthorOf = (c, brew)=>brew.authors.includes(c.get('account')?.username);

const fetchBrew = async (c)=>{
	const brew = await getBrew(c, 'share');
	sanitizeBrew(brew, isAuthorOf(c, brew) ? 'shareAuthor' : 'share');
	return c.json({ brew });
};

const METADATA_FIELDS = ['title', 'pageCount', 'description', 'authors', 'lang', 'published', 'views', 'shareId',
	'createdAt', 'updatedAt', 'lastViewed', 'thumbnail', 'tags'];

const getMetadata = async (c)=>{
	const brew = await getBrew(c, 'share');
	return c.json(_.pickBy(_.pick(brew, METADATA_FIELDS), (value)=>value !== undefined));
};

const getCSS = async (c)=>{
	const brew = await getBrew(c, 'share');
	if(!brew.style) return c.body('', 404);
	return c.body(brew.style, 200, { 'Cache-Control': 'no-cache', 'Content-Type': 'text/css' });
};

const getSource = async (c)=>{
	const brew = await getBrew(c, 'share');
	const text = brew.text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
	return c.html(`<code><pre style="white-space: pre-wrap;">${text}</pre></code>`);
};

const encodeRFC3986ValueChars = (str)=>encodeURIComponent(str).replace(/[!'()*]/g, (char)=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`);

const downloadBrew = async (c)=>{
	const brew = await getBrew(c, 'share');
	const prefix = 'HB - ';
	let fileName = sanitizeFilename(`${prefix}${brew.title}`).replaceAll(' ', '');
	if(!fileName) fileName = `${prefix}-Untitled-Brew`;
	return c.body(brew.text, 200, {
		'Cache-Control'       : 'no-cache',
		'Content-Type'        : 'text/plain; charset=utf-8',
		'Content-Disposition' : `attachment; filename*=UTF-8''${encodeRFC3986ValueChars(fileName)}.txt`
	});
};

// Renames the signed-in user on all their brews after a username change
const renameUser = async (c)=>{
	const { username, newUsername } = await c.req.json();
	if(!username || !newUsername)
		return c.json({ error: 'Username and newUsername are required.' }, 400);
	if(c.get('account')?.username !== newUsername)
		return c.json({ error: 'Must be logged in to change your username' }, 403);

	await c.get('stores').brews.renameAuthor(username, newUsername);
	return c.json({ success: true, message: `Brews for ${username} renamed to ${newUsername}.` });
};

const router = new Hono();

router.post('/api', checkClientVersion, newBrew);
router.put('/api/update/:id', checkClientVersion, updateBrew);
router.delete('/api/:id', checkClientVersion, deleteBrew);
router.get('/api/theme/:renderer/:id', getThemeBundle);
router.get('/api/fetch/:id', fetchBrew);
router.put('/api/user/rename', renameUser);
router.get('/metadata/:id', getMetadata);
router.get('/css/:id', getCSS);
router.get('/source/:id', getSource);
router.get('/download/:id', downloadBrew);

export default router;
export { getBrew, getUsersBrewThemes, sanitizeBrew, beforeNewSave, readJsonBody, PROTECTED_FIELDS };
