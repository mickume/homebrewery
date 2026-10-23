// Live brew updates: one Durable Object per shareId. Share pages connect a WebSocket (accepted with the
// hibernation API, so idle connections do not keep the object running); after a save, the Worker calls
// broadcast() and every open share page of that brew reloads it.

import { DurableObject } from 'cloudflare:workers';

// eslint-disable-next-line no-restricted-syntax -- Durable Objects are classes by definition
export class BrewUpdates extends DurableObject {
	constructor(ctx, env) {
		super(ctx, env);
		// Answer client keep-alive pings without waking the object
		ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
	}

	async fetch(request) {
		if(request.headers.get('Upgrade') !== 'websocket')
			return new Response('Expected a WebSocket upgrade', { status: 426 });

		const [client, server] = Object.values(new WebSocketPair());
		this.ctx.acceptWebSocket(server);
		return new Response(null, { status: 101, webSocket: client });
	}

	async broadcast(message) {
		const data = JSON.stringify(message);
		for (const socket of this.ctx.getWebSockets()) {
			try {
				socket.send(data);
			} catch (error) {
				console.warn('Dropping closed share page socket:', error.message);
			}
		}
	}

	// Share pages only listen; anything they send other than the auto-answered ping is ignored
	async webSocketMessage() {}

	async webSocketClose(socket, code, reason) {
		try {
			socket.close(code, reason);
		} catch {
			// Already closed by the runtime
		}
	}
}
