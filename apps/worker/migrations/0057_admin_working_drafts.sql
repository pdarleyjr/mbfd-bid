-- Private incomplete editor work. Never read by eligibility, publication or live commands.
CREATE TABLE admin_working_drafts (
 actor_subject TEXT NOT NULL, draft_key TEXT NOT NULL, revision INTEGER NOT NULL,
 content_json TEXT NOT NULL CHECK(json_valid(content_json)), updated_at INTEGER NOT NULL,
 PRIMARY KEY(actor_subject,draft_key)
);
