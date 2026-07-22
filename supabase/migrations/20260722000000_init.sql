-- gastos-domesticos — schema inicial (Fase 0)
-- Orçamento (JSONB) + investimentos (normalizado) + RLS por usuário.
-- Idempotente: pode rodar mais de uma vez sem erro.

-- 1. Orçamento mensal: renda + categorias + itens (payload espelha o modelo atual)
create table if not exists public.budget_months (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  year       smallint not null,
  month      smallint not null check (month between 1 and 12),
  renda      numeric(14,2) not null default 0,
  payload    jsonb not null default '{"cats":[]}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, year, month)
);

-- 2. Classes de investimento + retorno esperado (alimenta a projeção)
create table if not exists public.invest_classes (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users(id) on delete cascade,
  key                text not null,
  label              text not null,
  target_pct         numeric(5,2) not null default 0,
  expected_return_aa numeric(6,4) not null default 0,   -- 0.11 = 11% a.a.
  color              text not null default '#888780',
  position           smallint not null default 0,
  archived           boolean not null default false,
  unique (user_id, key)
);

-- 3. Razão de investimentos: aporte + saldo real por classe por mês (série imutável)
create table if not exists public.invest_ledger (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  class_id   uuid not null references public.invest_classes(id) on delete cascade,
  year       smallint not null,
  month      smallint not null check (month between 1 and 12),
  aporte     numeric(14,2) not null default 0,   -- o que foi alocado NAQUELE mês
  saldo_real numeric(14,2),                       -- opcional: marcação a mercado
  updated_at timestamptz not null default now(),
  unique (user_id, class_id, year, month)
);

create index if not exists idx_invest_ledger_user_period
  on public.invest_ledger (user_id, year, month);
create index if not exists idx_invest_classes_user
  on public.invest_classes (user_id) where archived = false;

-- Row Level Security: cada usuário só enxerga as próprias linhas.
-- (É isto que protege a anon key pública que está exposta no supabase.js.)
alter table public.budget_months  enable row level security;
alter table public.invest_classes enable row level security;
alter table public.invest_ledger  enable row level security;

drop policy if exists "own rows" on public.budget_months;
drop policy if exists "own rows" on public.invest_classes;
drop policy if exists "own rows" on public.invest_ledger;

create policy "own rows" on public.budget_months
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.invest_classes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own rows" on public.invest_ledger
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
