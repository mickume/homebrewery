// Site notification persistence on Cloudflare D1. Notifications are keyed by their dismissKey.

const toNotification = (row)=>row && ({
	dismissKey : row.dismiss_key,
	title      : row.title,
	text       : row.text,
	createdAt  : row.created_at,
	startAt    : row.start_at,
	stopAt     : row.stop_at
});

const toDate = (value, fallback)=>value === undefined || value === null ? fallback : new Date(value).toISOString();

export default function createNotificationStore(db, { now = ()=>new Date() } = {}) {
	const get = async (dismissKey)=>{
		return toNotification(await db.prepare('SELECT * FROM notifications WHERE dismiss_key = ?').bind(dismissKey).first());
	};

	return {
		getAll : async ()=>{
			const { results } = await db.prepare('SELECT * FROM notifications ORDER BY created_at, dismiss_key').all();
			return results.map(toNotification);
		},

		// Throws when the dismissKey is missing or already used
		add : async (data)=>{
			if(!data?.dismissKey) throw new Error('Dismiss key is required!');
			if(await get(data.dismissKey)) throw new Error(`A notification with dismiss key "${data.dismissKey}" already exists`);

			const timestamp = now().toISOString();
			await db.prepare(`INSERT INTO notifications (dismiss_key, title, text, created_at, start_at, stop_at)
				VALUES (?, ?, ?, ?, ?, ?)`).bind(
				data.dismissKey, data.title ?? '', data.text ?? '', timestamp,
				toDate(data.startAt, timestamp), toDate(data.stopAt, timestamp)
			).run();
			return get(data.dismissKey);
		},

		// Returns the deleted notification, or null when none has this dismissKey
		remove : async (dismissKey)=>{
			const notification = await get(dismissKey);
			if(!notification) return null;
			await db.prepare('DELETE FROM notifications WHERE dismiss_key = ?').bind(dismissKey).run();
			return notification;
		}
	};
}
