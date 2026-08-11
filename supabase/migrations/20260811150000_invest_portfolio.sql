-- gastos-domesticos — carteira separada para Meta de Curto/Médio Prazo (Fase C)
-- invest_classes ganha uma "portfolio" (independencia | meta) — mesma tabela,
-- mesma estrutura de invest_ledger (liga por class_id, não muda). Contas já
-- existentes têm todas as classes marcadas 'independencia' (valor padrão),
-- então nada muda pra quem já usa o app. Idempotente.

alter table public.invest_classes
  add column if not exists portfolio text not null default 'independencia';

-- A unicidade de "key" precisa valer só DENTRO de cada carteira — Meta e
-- Independência podem ter as duas uma classe "renda_fixa", por exemplo.
-- Encontra o nome real da constraint antiga (user_id, key) em vez de supor
-- o nome que o Postgres teria gerado sozinho, pra não depender de acertar
-- um nome interno.
do $$
declare
  cname text;
begin
  select con.conname into cname
  from pg_constraint con
  where con.conrelid = 'public.invest_classes'::regclass
    and con.contype = 'u'
    and (
      select array_agg(attname::text order by attname)
      from pg_attribute
      where attrelid = con.conrelid and attnum = any(con.conkey)
    ) = array['key', 'user_id']::text[];

  if cname is not null then
    execute format('alter table public.invest_classes drop constraint %I', cname);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.invest_classes'::regclass
      and conname = 'invest_classes_user_id_key_portfolio_key'
  ) then
    alter table public.invest_classes
      add constraint invest_classes_user_id_key_portfolio_key unique (user_id, key, portfolio);
  end if;
end $$;
