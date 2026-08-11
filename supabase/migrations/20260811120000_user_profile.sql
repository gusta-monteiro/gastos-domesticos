-- gastos-domesticos — perfil financeiro (Fase B2)
-- Resultado do questionário de perfil/investidor: uma linha por usuário,
-- sobrescrita a cada vez que ele refaz o questionário. Idempotente.

create table if not exists public.user_profile (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  respostas  jsonb not null default '{}'::jsonb,  -- respostas brutas do questionário
  perfil_key text not null,                        -- ex: 'saindo_do_vermelho'
  cats_pct   jsonb not null default '{}'::jsonb,   -- {independencia:10, fixos:55, ...}
  risco      text not null,                        -- 'conservador' | 'moderado' | 'arrojado'
  updated_at timestamptz not null default now()
);

alter table public.user_profile enable row level security;

drop policy if exists "own rows" on public.user_profile;
create policy "own rows" on public.user_profile
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
