do $$
begin
  if exists (select 1 from pg_type where typname = 'plan_tier') then
    if not exists (
      select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'plan_tier' and e.enumlabel = 'free'
    ) then
      alter type public.plan_tier add value 'free' before 'creator';
    end if;

    if not exists (
      select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
      where t.typname = 'plan_tier' and e.enumlabel = 'pro'
    ) then
      alter type public.plan_tier add value 'pro' after 'creator';
    end if;
  end if;
end $$;