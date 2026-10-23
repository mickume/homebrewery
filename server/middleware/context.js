// Per-request context: configuration, D1 stores (with the schema migrated) and the signed-in account.

import { getCookie }  from 'hono/cookie';
import { verify }     from 'hono/jwt';
import getConfig      from '../config.js';
import createBrewStore         from '../storage/brewStore.js';
import createNotificationStore from '../storage/notificationStore.js';
import { ensureMigrated }      from '../storage/migrate.js';
import { hbError }             from '../errors.js';

const SESSION_COOKIE = 'nc_session';

const config = async (c, next)=>{
	c.set('config', getConfig(c.env));
	await next();
};

const stores = async (c, next)=>{
	const db = c.env?.DB;
	if(!db) {
		throw hbError({ HBErrorCode: '13', name: 'Database Connection Error', message: 'The D1 binding DB is not configured', status: 503 });
	}
	await ensureMigrated(db);
	c.set('stores', {
		brews         : createBrewStore(db),
		notifications : createNotificationStore(db)
	});
	await next();
};

const account = async (c, next)=>{
	const token = getCookie(c, SESSION_COOKIE);
	const secret = c.get('config').jwtSecret;
	if(token && secret) {
		try {
			c.set('account', await verify(token, secret, 'HS256'));
		} catch (error) {
			console.warn('Ignoring invalid session cookie:', error.message);
		}
	}
	await next();
};

export { config, stores, account, SESSION_COOKIE };
