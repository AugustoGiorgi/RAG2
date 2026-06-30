create schema if not exists rag_private;

create extension if not exists pgcrypto;

create table if not exists rag_private.app_users (
  username text primary key,
  password_hash text not null,
  role text not null default 'user' check (role in ('admin', 'user')),
  display_name text not null,
  active boolean not null default true,
  spend_limit_usd numeric(12, 4),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_password_change_at timestamptz
);

create table if not exists rag_private.oauth_tokens (
  provider text not null,
  username text not null,
  account_key text not null default 'default',
  encrypted_payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (provider, username, account_key)
);

create table if not exists rag_private.clients (
  client_id text primary key,
  owner_username text,
  display_name text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists rag_private.cost_log_entries (
  id bigserial primary key,
  source_index integer,
  username text,
  action text,
  model text,
  input_tokens integer,
  output_tokens integer,
  total_cost_usd numeric(14, 6),
  occurred_at timestamptz,
  payload jsonb not null,
  imported_at timestamptz not null default now(),
  unique (source_index)
);

create table if not exists rag_private.audit_log_entries (
  id bigserial primary key,
  source_index integer,
  username text,
  action text,
  occurred_at timestamptz,
  payload jsonb not null,
  imported_at timestamptz not null default now(),
  unique (source_index)
);

create table if not exists rag_private.access_requests (
  id uuid primary key default gen_random_uuid(),
  source_index integer unique,
  email text,
  name text,
  estimated_returns text,
  payload jsonb not null,
  created_at timestamptz,
  imported_at timestamptz not null default now()
);

create table if not exists rag_private.app_json_snapshots (
  snapshot_key text primary key,
  payload jsonb not null,
  imported_at timestamptz not null default now()
);

create or replace function rag_private.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists app_users_touch_updated_at on rag_private.app_users;
create trigger app_users_touch_updated_at
before update on rag_private.app_users
for each row execute function rag_private.touch_updated_at();

drop trigger if exists oauth_tokens_touch_updated_at on rag_private.oauth_tokens;
create trigger oauth_tokens_touch_updated_at
before update on rag_private.oauth_tokens
for each row execute function rag_private.touch_updated_at();

drop trigger if exists clients_touch_updated_at on rag_private.clients;
create trigger clients_touch_updated_at
before update on rag_private.clients
for each row execute function rag_private.touch_updated_at();

alter table rag_private.app_users enable row level security;
alter table rag_private.oauth_tokens enable row level security;
alter table rag_private.clients enable row level security;
alter table rag_private.cost_log_entries enable row level security;
alter table rag_private.audit_log_entries enable row level security;
alter table rag_private.access_requests enable row level security;
alter table rag_private.app_json_snapshots enable row level security;

revoke all on schema rag_private from anon, authenticated;
revoke all on all tables in schema rag_private from anon, authenticated;
revoke all on all sequences in schema rag_private from anon, authenticated;
