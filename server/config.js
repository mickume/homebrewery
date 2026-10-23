// Runtime configuration from the Worker's bindings: `vars` in wrangler.jsonc and secrets set with
// `wrangler secret put`. See docs/configuration.md.

const getConfig = (env = {})=>{
	const environment = env.ENVIRONMENT || 'production';
	const isLocal = environment === 'local';
	return {
		environment,
		isLocal,
		// Signing key of the nc_session JWT cookie. Without it no one is signed in (except locally).
		jwtSecret     : env.JWT_SECRET || (isLocal ? 'local-development-secret' : undefined),
		// Basic auth for /admin. Admin routes are disabled unless ADMIN_PASSWORD is set.
		adminUser     : env.ADMIN_USER || 'admin',
		adminPassword : env.ADMIN_PASSWORD || undefined
	};
};

export default getConfig;
