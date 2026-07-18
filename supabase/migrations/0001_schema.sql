-- Section 4 frozen schema. Additive-only changes allowed (external_id below is additive).
create table companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  stage text not null,
  sector text not null,
  ask_amount numeric,
  pre_money numeric,
  arr numeric not null,
  arr_growth_yoy numeric not null,          -- percent, e.g. 62
  gross_margin numeric not null,            -- percent, e.g. 71
  net_burn_monthly numeric not null,
  net_new_arr_monthly numeric not null,
  cash_on_hand numeric not null,
  cac numeric not null,
  ltv numeric not null,
  cac_payback_months numeric not null,
  cac_payback_months_prior numeric not null,
  top3_pct_arr numeric not null,            -- percent of ARR from top 3 customers
  largest_customer_pct_arr numeric not null,
  largest_customer_renewal_months numeric,
  multi_year_contracts boolean not null default false,
  cohort_m1 numeric, cohort_m6 numeric, cohort_m12 numeric,
  arr_proj_12mo numeric, arr_proj_18mo numeric
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  phone_number text not null unique,        -- identity key across channels
  channel_last_used text,
  last_company_id uuid references companies(id),
  last_metrics_discussed text,
  updated_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversations(id),
  channel text not null,
  direction text not null check (direction in ('in', 'out')),
  content text not null,
  external_id text,                          -- additive: webhook idempotency
  created_at timestamptz not null default now()
);
create unique index messages_external_id_key on messages (external_id) where external_id is not null;
create index messages_conversation_created_idx on messages (conversation_id, created_at desc);

create table calendar_slots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  contact_name text not null,
  contact_role text not null check (contact_role in ('CFO', 'customer_reference')),
  slot_start timestamptz not null,
  slot_end timestamptz not null,
  is_booked boolean not null default false
);

create table calendar_bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references calendar_slots(id) unique,
  phone_number text not null,
  purpose text not null,
  created_at timestamptz not null default now()
);
