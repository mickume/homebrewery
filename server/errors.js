// Homebrewery errors carry display fields (HBErrorCode, status, brewId, ...) that the client's error page
// and error nav item read. They are real Error objects so Hono's error handler receives them.

const hbError = (fields)=>Object.assign(new Error(fields.message ?? fields.name ?? 'Unknown error'), fields);

// Copies an error's own fields into a plain object that survives JSON.stringify
const toPlainError = (error)=>{
	if(!(error instanceof Error)) return { ...error };
	const plain = {};
	for (const key of Object.getOwnPropertyNames(error))
		plain[key] = error[key];
	return plain;
};

// HTTP status for an error; HBError statuses outside the valid range fall back to 500
const errorStatus = (error)=>{
	const status = Number(error?.status ?? error?.code);
	return Number.isInteger(status) && status >= 400 && status <= 599 ? status : 500;
};

export { hbError, toPlainError, errorStatus };
