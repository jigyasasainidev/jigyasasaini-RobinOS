do $$
begin
  if exists (select 1 from pg_type where typname = 'withdrawal_status') then
    if not exists (
      select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      where t.typname = 'withdrawal_status' and e.enumlabel = 'reviewing'
    ) then
      alter type public.withdrawal_status add value 'reviewing' after 'pending';
    end if;
  end if;
end $$;