-- Up Migration

CREATE TABLE sync_runs (
  id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  trigger              text NOT NULL CHECK (trigger IN ('schedule', 'manual')),
  status               text NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
  started_at           timestamptz NOT NULL DEFAULT now(),
  heartbeat_at         timestamptz NOT NULL DEFAULT now(),
  finished_at          timestamptz,
  page_size            integer NOT NULL CHECK (page_size > 0),
  total_expected       integer,
  pages_total          integer,
  pages_ok             integer NOT NULL DEFAULT 0,
  pages_failed         integer NOT NULL DEFAULT 0,
  products_inserted    integer NOT NULL DEFAULT 0,
  products_updated     integer NOT NULL DEFAULT 0,
  products_unchanged   integer NOT NULL DEFAULT 0,
  products_reactivated integer NOT NULL DEFAULT 0,
  products_deactivated integer NOT NULL DEFAULT 0,
  failed_pages         jsonb NOT NULL DEFAULT '[]',
  error                text,
  CONSTRAINT sync_runs_finished_iff_not_running CHECK ((status = 'running') = (finished_at IS NULL))
);

-- At most one running run, enforced by the database across all instances.
CREATE UNIQUE INDEX sync_runs_one_running ON sync_runs ((true)) WHERE status = 'running';
CREATE INDEX sync_runs_started_at ON sync_runs (started_at DESC);

CREATE TABLE products (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  external_id      bigint NOT NULL UNIQUE,
  sku              text NOT NULL,
  name             text NOT NULL,
  price_cents      integer NOT NULL CHECK (price_cents >= 0),
  erp_updated_at   timestamptz NOT NULL,
  active           boolean NOT NULL DEFAULT true,
  deactivated_at   timestamptz,
  first_seen_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  last_seen_run_id bigint NOT NULL REFERENCES sync_runs (id),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT products_deactivated_iff_inactive CHECK (active = (deactivated_at IS NULL))
);

-- Deactivation looks for active products not seen in the current run.
CREATE INDEX products_active_last_seen ON products (last_seen_run_id) WHERE active;

-- Down Migration

DROP TABLE products;
DROP TABLE sync_runs;
