// Cloudflare Worker entry point: the Hono app handles fetch events; BrewUpdates is the Durable Object
// class behind live share-page updates.

import createApp from '../server/app.js';

export { BrewUpdates } from './brewUpdates.js';

export default createApp();
