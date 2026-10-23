// Live share-page updates through the BrewUpdates Durable Object (worker/brewUpdates.js).

import { Hono } from 'hono';

const SHARE_ID = /^[a-zA-Z0-9-_]{7,14}$/;

const updatesFor = (c, shareId)=>{
	const namespace = c.env?.BREW_UPDATES;
	return namespace ? namespace.get(namespace.idFromName(shareId)) : null;
};

const waitUntil = (c, promise)=>{
	try {
		c.executionCtx.waitUntil(promise);
	} catch {
		// No execution context (tests): the promise still runs, just untracked
	}
};

// Tells open share pages of a brew that a new version was saved. Does not delay the save response.
const notifyBrewUpdated = (c, brew)=>{
	const updates = updatesFor(c, brew.shareId);
	if(!updates) return;
	const message = { event: 'brewUpdated', shareId: brew.shareId, version: brew.version, time: new Date().toISOString() };
	waitUntil(c, updates.broadcast(message).catch((error)=>console.error('Could not broadcast brew update:', error)));
};

const router = new Hono();

// WebSocket for a share page. Without the Durable Object binding live updates are off: 204 tells
// clients not to retry.
router.get('/api/stream/:id', (c)=>{
	const shareId = c.req.param('id');
	if(!SHARE_ID.test(shareId)) return c.json({ message: 'Invalid ID' }, 404);

	const updates = updatesFor(c, shareId);
	if(!updates) return c.body(null, 204);
	if(c.req.header('Upgrade') !== 'websocket') return c.text('Expected a WebSocket upgrade', 426);

	return updates.fetch(c.req.raw);
});

export default router;
export { notifyBrewUpdated };
