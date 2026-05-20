create or replace function public.admin_write_log(
  p_action_type text,
  p_target_id text,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payload jsonb;
begin
  v_payload := jsonb_build_object(
    'target_id', p_target_id,
    'details', coalesce(p_details, '{}'::jsonb)
  );

  return public.log_admin_action(p_action_type, v_payload);
end;
$$;

revoke execute on function public.is_admin(uuid) from public;
revoke execute on function public.get_admin_role(uuid) from public;
revoke execute on function public.require_super_admin(uuid) from public;
revoke execute on function public.log_admin_action(text, jsonb) from public;
revoke execute on function public.admin_write_log(text, text, jsonb) from public;

grant execute on function public.is_admin(uuid) to authenticated;
grant execute on function public.get_admin_role(uuid) to authenticated;
grant execute on function public.require_super_admin(uuid) to authenticated;
grant execute on function public.log_admin_action(text, jsonb) to authenticated;
grant execute on function public.admin_write_log(text, text, jsonb) to authenticated;