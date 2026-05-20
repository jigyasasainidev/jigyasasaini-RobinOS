create or replace function public.audit_admin_role_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor uuid := coalesce(auth.uid(), coalesce(new.user_id, old.user_id));
  v_action text;
  v_metadata jsonb;
begin
  if tg_op = 'INSERT' then
    v_action := 'role_change';
    v_metadata := jsonb_build_object(
      'operation', 'insert',
      'target_user_id', new.user_id,
      'new_role', new.role,
      'permissions', new.permissions
    );
  elsif tg_op = 'UPDATE' then
    v_action := 'role_change';
    v_metadata := jsonb_build_object(
      'operation', 'update',
      'target_user_id', new.user_id,
      'old_role', old.role,
      'new_role', new.role,
      'old_permissions', old.permissions,
      'new_permissions', new.permissions
    );
  else
    v_action := 'role_change';
    v_metadata := jsonb_build_object(
      'operation', 'delete',
      'target_user_id', old.user_id,
      'old_role', old.role,
      'old_permissions', old.permissions
    );
  end if;

  insert into public.admin_audit_logs (admin_user_id, action, metadata)
  values (v_actor, v_action, v_metadata);

  return coalesce(new, old);
end;
$$;

drop trigger if exists admin_roles_audit_trigger on public.admin_roles;
create trigger admin_roles_audit_trigger
after insert or update or delete on public.admin_roles
for each row execute function public.audit_admin_role_changes();

revoke execute on function public.audit_admin_role_changes() from public;
grant execute on function public.audit_admin_role_changes() to authenticated;