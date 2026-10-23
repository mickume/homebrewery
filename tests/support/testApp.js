// The Worker app wired to a test environment: an in-memory D1 (node:sqlite), an ASSETS binding that
// serves the repository's index.html, and optional fakes for the other bindings.

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { sign } from 'hono/jwt';
import createApp from '../../server/app.js';
import { openSqlite } from './testDatabases.js';
import packageJSON from '../../package.json' with { type: 'json' };

const INDEX_HTML = fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../index.html'), 'utf8');

const JWT_SECRET = 'test-jwt-secret';
const ADMIN_PASSWORD = 'test-admin-password';
const CLIENT_VERSION = packageJSON.version;

const assets = { fetch: async ()=>new Response(INDEX_HTML, { headers: { 'Content-Type': 'text/html' } }) };

// A BREW_UPDATES namespace that records broadcasts instead of running a Durable Object
const createFakeUpdates = ()=>{
	const broadcasts = [];
	return {
		broadcasts,
		idFromName : (name)=>name,
		get        : (id)=>({
			broadcast : async (message)=>{ broadcasts.push({ id, message }); },
			fetch     : async ()=>new Response('upgraded', { status: 200 })
		})
	};
};

const createTestApp = async (envOverrides = {})=>{
	const database = await openSqlite();
	const env = { DB: database.db, ASSETS: assets, JWT_SECRET, ADMIN_PASSWORD, ...envOverrides };
	const app = createApp();

	const request = (url, init = {})=>app.request(url, init, env);
	const session = async (username)=>`nc_session=${await sign({ username, issued: new Date() }, JWT_SECRET, 'HS256')}`;

	// JSON request helpers; `as` signs the request in as that user
	const send = async (method, url, { body, as, headers = {} } = {})=>{
		const allHeaders = { 'Homebrewery-Version': CLIENT_VERSION, ...headers };
		if(as) allHeaders.cookie = await session(as);
		if(body !== undefined && !(body instanceof Uint8Array)) allHeaders['Content-Type'] ??= 'application/json';
		return request(url, { method, headers: allHeaders, body: body instanceof Uint8Array || body === undefined ? body : JSON.stringify(body) });
	};

	return { app, env, db: database.db, request, send, session, close: database.close };
};

// The page props a rendered page carries
const pageProps = async (response)=>{
	const html = await response.text();
	return JSON.parse(html.match(/window.__INITIAL_PROPS__ = (.*?)<\/script>/s)[1]);
};

const adminAuth = (password = ADMIN_PASSWORD)=>({ Authorization: `Basic ${btoa(`admin:${password}`)}` });

export { createTestApp, createFakeUpdates, pageProps, adminAuth, JWT_SECRET, CLIENT_VERSION };
