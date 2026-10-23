-- Initial schema: brews, their authors, and site notifications.
-- Dates are ISO 8601 strings (UTC), which sort chronologically as text.
-- JSON columns hold arrays or objects serialized with JSON.stringify.

CREATE TABLE brews (
	id              INTEGER PRIMARY KEY,
	share_id        TEXT    NOT NULL UNIQUE,
	edit_id         TEXT    NOT NULL UNIQUE,
	title           TEXT    NOT NULL DEFAULT '',
	text_bin        BLOB,                           -- brew text, deflate-raw compressed
	page_count      INTEGER NOT NULL DEFAULT 1,
	description     TEXT    NOT NULL DEFAULT '',
	tags            TEXT    NOT NULL DEFAULT '[]',  -- JSON array of strings
	lang            TEXT    NOT NULL DEFAULT 'en',
	renderer        TEXT    NOT NULL DEFAULT '',
	invited_authors TEXT    NOT NULL DEFAULT '[]',  -- JSON array of usernames
	published       INTEGER NOT NULL DEFAULT 0,
	thumbnail       TEXT    NOT NULL DEFAULT '',
	created_at      TEXT    NOT NULL,
	updated_at      TEXT    NOT NULL,
	last_viewed     TEXT    NOT NULL,
	views           INTEGER NOT NULL DEFAULT 0,
	version         INTEGER NOT NULL DEFAULT 1,
	lock            TEXT                            -- JSON object, NULL when unlocked
);

CREATE INDEX brews_published_title ON brews (published, title);
CREATE INDEX brews_updated_viewed  ON brews (updated_at, last_viewed);
CREATE INDEX brews_locked          ON brews (id) WHERE lock IS NOT NULL;

-- Authors in order; position 0 is the owner.
CREATE TABLE brew_authors (
	brew_id  INTEGER NOT NULL REFERENCES brews (id) ON DELETE CASCADE,
	position INTEGER NOT NULL,
	username TEXT    NOT NULL,
	PRIMARY KEY (brew_id, position)
);

CREATE INDEX brew_authors_username ON brew_authors (username, brew_id);

CREATE TABLE notifications (
	dismiss_key TEXT PRIMARY KEY,
	title       TEXT NOT NULL DEFAULT '',
	text        TEXT NOT NULL DEFAULT '',
	created_at  TEXT NOT NULL,
	start_at    TEXT NOT NULL,
	stop_at     TEXT NOT NULL
);
