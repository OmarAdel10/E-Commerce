-- Customer erasure's work outside the database (see ../0186_customer_erasure_tasks.sql;
-- rules/privacy/erasure-*.md): one row a buyer image to delete from storage
-- and one a saved payment method to detach at its provider, written in the
-- erasure batch and drained after the response and by the minute cron.
CREATE TABLE "customer_erasure_tasks" (
	"id" text COLLATE "C" PRIMARY KEY NOT NULL,
	"customer_id" text COLLATE "C" NOT NULL,
	"kind" text COLLATE "C" NOT NULL,
	"provider_id" text COLLATE "C",
	"ref" text COLLATE "C" NOT NULL,
	"attempts" bigint DEFAULT 0 NOT NULL,
	"next_attempt_at" bigint DEFAULT (cast(strftime('%s','now') as bigint)) NOT NULL,
	"last_error" text COLLATE "C",
	"created_at" bigint DEFAULT (cast(strftime('%s','now') as bigint)) NOT NULL,
	CONSTRAINT "customer_erasure_tasks_kind_check" CHECK("customer_erasure_tasks"."kind" IN ('delete_file', 'detach_payment_method')),
	CONSTRAINT "customer_erasure_tasks_shape" CHECK(("customer_erasure_tasks"."kind" = 'delete_file' AND "customer_erasure_tasks"."provider_id" IS NULL AND substr("customer_erasure_tasks"."ref", 1, 22) = 'private/conversations/') OR ("customer_erasure_tasks"."kind" = 'detach_payment_method' AND "customer_erasure_tasks"."provider_id" IS NOT NULL AND length("customer_erasure_tasks"."ref") >= 1)),
	CONSTRAINT "customer_erasure_tasks_attempts_check" CHECK("customer_erasure_tasks"."attempts" >= 0),
	CONSTRAINT "customer_erasure_tasks_last_error_length" CHECK("customer_erasure_tasks"."last_error" IS NULL OR length("customer_erasure_tasks"."last_error") BETWEEN 1 AND 64)
);
--> statement-breakpoint
CREATE INDEX "customer_erasure_tasks_due_idx" ON "customer_erasure_tasks" ("next_attempt_at");
--> statement-breakpoint
CREATE INDEX "customer_erasure_tasks_customer_idx" ON "customer_erasure_tasks" ("customer_id");
--> statement-breakpoint
INSERT INTO scalius_schema_migrations (version, name, source_sha256) VALUES (186, '0186_customer_erasure_tasks', '64047a0022abdc6a33259d5f9bde85d1846d392ac6c4bb929f9f47b5a8106587');
