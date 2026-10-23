// SHA-256 hex digest of a string's UTF-8 bytes, via WebCrypto (available in browsers, Workers and Node).
// Client and server both hash the last saved brew text to detect when their copies have diverged.
const sha256 = async (text)=>{
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), (byte)=>byte.toString(16).padStart(2, '0')).join('');
};

export { sha256 };
