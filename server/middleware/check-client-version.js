import packageJSON from '../../package.json' with { type: 'json' };

// Rejects writes from a client bundle older than the server, so stale editors cannot save
export default async (c, next)=>{
	const userVersion = c.req.header('Homebrewery-Version');
	const version = packageJSON.version;

	if(userVersion !== version) {
		return c.json({
			message : `Client version ${userVersion} is out of date. Please save your changes elsewhere and refresh to pick up client version ${version}.`
		}, 412);
	}

	await next();
};
