/*eslint max-lines: ["warn", {"max": 300, "skipBlankLines": true, "skipComments": true}]*/
// Admin tools and the lock/notification APIs. Everything here except the review request and the public
// notification list sits behind HTTP basic auth with ADMIN_USER / ADMIN_PASSWORD.

import { Hono }            from 'hono';
import { basicAuth }       from 'hono/basic-auth';
import { timingSafeEqual } from 'hono/utils/buffer';
import { getBrew }         from './homebrew.api.js';
import { renderPage }      from './render.js';
import { hbError }         from './errors.js';

// Admin access is off unless an admin password is configured
const adminOnly = basicAuth({
	verifyUser : async (username, password, c)=>{
		const { adminUser, adminPassword } = c.get('config');
		if(!adminPassword) return false;
		const [userMatches, passwordMatches] = await Promise.all([
			timingSafeEqual(username, adminUser),
			timingSafeEqual(password, adminPassword)
		]);
		return userMatches && passwordMatches;
	},
	invalidUserMessage : { HBErrorCode: '52', message: 'Access denied' }
});

const brews = (c)=>c.get('stores').brews;

const router = new Hono();

router.get('/admin', adminOnly, (c)=>renderPage(c, { url: new URL(c.req.url).pathname }));

//==== Brew maintenance ====//

router.get('/admin/cleanupJunk', adminOnly, async (c)=>{
	const brewCollection = await brews(c).listJunk();
	return c.json({ count: brewCollection.length, brewCollection });
});
router.post('/admin/cleanupJunk', adminOnly, async (c)=>c.json({ count: await brews(c).deleteJunk() }));

router.get('/admin/cleanupLost', adminOnly, async (c)=>{
	const brewCollection = await brews(c).listLost();
	return c.json({ count: brewCollection.length, brewCollection });
});
router.post('/admin/cleanupLost', adminOnly, async (c)=>c.json({ count: await brews(c).deleteLost() }));

// Finds a brew by edit or share id
router.get('/admin/lookup/:id', adminOnly, async (c)=>c.json(await getBrew(c, 'admin')));

// Strips `<script` and `</script>` from a brew's text, description and title
router.put('/admin/clean/script/:id', adminOnly, async (c)=>{
	const brew = await brews(c).getByAnyId(c.req.param('id'));
	if(!brew) throw hbError({ name: 'Brew Not Found', message: 'Cannot find brew to clean', status: 404, HBErrorCode: '05', brewId: c.req.param('id') });
	console.log(`[ADMIN] Cleaning script tags from ShareID ${brew.shareId}`);

	const cleanText = (text)=>text.replaceAll(/(<\/?s)cript/gi, '');
	const saved = await brews(c).update(brew.editId, {
		text        : cleanText(brew.text),
		title       : cleanText(brew.title),
		description : cleanText(brew.description),
		version     : brew.version + 1,
		updatedAt   : new Date()
	});
	return c.json({ ...saved, text: undefined });
});

router.get('/admin/user/list/:user', adminOnly, async (c)=>{
	const username = c.req.param('user');
	console.log(`[ADMIN] Get brew list for ${username}`);
	return c.json(await brews(c).listByUser(username, { includeUnpublished: true }));
});

router.get('/admin/stats', adminOnly, async (c)=>c.json(await brews(c).stats()));

//==== Locks ====//

router.get('/api/lock/count', adminOnly, async (c)=>c.json({ count: await brews(c).countLocked() }));

router.get('/api/locks', adminOnly, async (c)=>c.json({ lockedDocuments: await brews(c).listLocked() }));

router.get('/api/lock/reviews', adminOnly, async (c)=>c.json({ reviewDocuments: await brews(c).listLocked({ reviewRequested: true }) }));

router.post('/api/lock/:id', adminOnly, async (c)=>{
	const shareId = c.req.param('id');
	const { overwrite, ...lock } = await c.req.json();
	lock.applied = new Date();

	const brew = await brews(c).getByShareId(shareId);
	if(!brew) throw hbError({ name: 'Brew Not Found', message: 'Cannot find brew to lock', shareId, status: 404, HBErrorCode: '63' });
	if(brew.lock && !overwrite)
		throw hbError({ name: 'Already Locked', message: 'Lock already exists on brew', shareId, title: brew.title, status: 409, HBErrorCode: '64' });

	await brews(c).setLock(shareId, lock);
	return c.json({ name: 'LOCKED', message: `Lock applied to brew ID ${brew.shareId} - ${brew.title}`, ...lock });
});

router.put('/api/unlock/:id', adminOnly, async (c)=>{
	const shareId = c.req.param('id');
	const brew = await brews(c).getByShareId(shareId);
	if(!brew) throw hbError({ name: 'Brew Not Found', message: 'Cannot find brew to unlock', shareId, status: 404, HBErrorCode: '66' });
	if(!brew.lock) throw hbError({ name: 'Not Locked', message: 'Cannot unlock as brew is not locked', shareId, status: 409, HBErrorCode: '67' });

	await brews(c).setLock(shareId, null);
	return c.json({ name: 'Unlocked', message: `Lock removed from brew ID ${shareId}` });
});

// Not admin only: any user can ask for a review of their locked brew
router.put('/api/lock/review/request/:id', async (c)=>{
	const shareId = c.req.param('id');
	const brew = await brews(c).getByShareId(shareId);
	if(!brew?.lock) throw hbError({ name: 'Brew Not Found', message: `Cannot find a locked brew with ID ${shareId}`, status: 404, HBErrorCode: '70' });
	if(brew.lock.reviewRequested)
		throw hbError({ name: 'Review Already Requested', message: `Review already requested for brew ${brew.shareId} - ${brew.title}`, status: 409, HBErrorCode: '71' });

	await brews(c).setLock(shareId, { ...brew.lock, reviewRequested: new Date() });
	return c.json({ name: 'Review Requested', message: `Review requested on brew ID ${brew.shareId} - ${brew.title}` });
});

router.put('/api/lock/review/remove/:id', adminOnly, async (c)=>{
	const shareId = c.req.param('id');
	const brew = await brews(c).getByShareId(shareId);
	if(!brew?.lock?.reviewRequested)
		throw hbError({ name: 'Can Not Clear Review Request', message: `Brew ID ${shareId} does not have a review pending!`, status: 404, HBErrorCode: '73' });

	const lock = { ...brew.lock };
	delete lock.reviewRequested;
	await brews(c).setLock(shareId, lock);
	return c.json({ name: 'Review Request Cleared', message: `Review request removed for brew ID ${brew.shareId} - ${brew.title}` });
});

//==== Notifications ====//

// Public: the site navbar shows current notifications
router.get('/admin/notification/all', async (c)=>c.json(await c.get('stores').notifications.getAll()));

router.post('/admin/notification/add', adminOnly, async (c)=>{
	try {
		return c.json(await c.get('stores').notifications.add(await c.req.json()), 201);
	} catch (error) {
		return c.json({ message: error.message }, 400);
	}
});

router.delete('/admin/notification/delete/:id', adminOnly, async (c)=>{
	const notification = await c.get('stores').notifications.remove(c.req.param('id'));
	if(!notification) return c.json({ message: 'Notification not found' }, 404);
	return c.json(notification);
});

export default router;
