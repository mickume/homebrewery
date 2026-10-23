// Image requests that reach the Worker are for files that do not exist (existing files are served by
// Workers Static Assets first). Answer them with 406 instead of an HTML page the browser cannot render.
export default async (c, next)=>{
	const isImageRequest = c.req.header('Accept')?.split(',')
		?.filter((h)=>!h.includes('q='))
		?.every((h)=>/image\/.*/.test(h));
	if(isImageRequest) {
		return c.json({
			message : 'Request for image at this URL is not supported'
		}, 406);
	}

	await next();
};
