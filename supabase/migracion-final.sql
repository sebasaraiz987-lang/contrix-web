-- ════════════════════════════════════════════════════════════
-- CONTRIX — Migración "Web Final"
-- Ejecutar DESPUÉS de supabase-schema.sql (el que ya corriste).
-- Supabase → SQL Editor → New query → pega todo → Run.
-- Es seguro correrlo más de una vez.
-- ════════════════════════════════════════════════════════════

-- ────────────────────────────────────────────────────────────
-- 1. Quitar datos de muestra que NO son reales
--    (XAXX010101AAA es el RFC genérico "público en general";
--     marcarlo como EFOS marcaría como riesgo cualquier factura
--     a público en general).
-- ────────────────────────────────────────────────────────────
delete from public.efos_blacklist
 where rfc in ('XAXX010101AAA','XEXX010101BBB')
   and razon_social like 'EJEMPLO EFOS%';

delete from public.indicadores_economicos
 where tipo_cambio_usd in (17.24,17.28,17.31)
   and inpc in (132.60,132.58,132.55);

-- ────────────────────────────────────────────────────────────
-- 2. Corrección de la política de EMPRESAS
--    En el esquema original "m.empresa_id = id" comparaba contra
--    miembros_empresa.id, por lo que los miembros invitados
--    nunca veían la empresa.
-- ────────────────────────────────────────────────────────────
drop policy if exists empresas_access on public.empresas;
create policy empresas_access on public.empresas
  for all using (
    owner_id = auth.uid() or
    exists (select 1 from public.miembros_empresa m
             where m.empresa_id = empresas.id and m.user_id = auth.uid())
  ) with check (owner_id = auth.uid());

-- ────────────────────────────────────────────────────────────
-- 3. Suscripción (Stripe) y rol de administrador en PROFILES
-- ────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists is_admin boolean default false;
alter table public.profiles add column if not exists stripe_customer_id text;
alter table public.profiles add column if not exists stripe_subscription_id text;
alter table public.profiles add column if not exists subscription_status text default 'trialing';
alter table public.profiles add column if not exists current_period_end timestamptz;

-- Un usuario NO puede cambiarse a sí mismo el plan, el estado de pago
-- ni hacerse admin. Solo el webhook de Stripe (service_role) o tú
-- desde el SQL Editor pueden hacerlo.
create or replace function public.proteger_campos_facturacion()
returns trigger language plpgsql as $$
begin
  if auth.uid() is not null then
    new.plan                   := old.plan;
    new.is_admin               := old.is_admin;
    new.stripe_customer_id     := old.stripe_customer_id;
    new.stripe_subscription_id := old.stripe_subscription_id;
    new.subscription_status    := old.subscription_status;
    new.current_period_end     := old.current_period_end;
    new.trial_ends_at          := old.trial_ends_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_proteger_facturacion on public.profiles;
create trigger trg_proteger_facturacion before update on public.profiles
  for each row execute function public.proteger_campos_facturacion();

-- ────────────────────────────────────────────────────────────
-- 4. Límite de empresas por plan (según ARQUITECTURA.md)
--    PYMES: 1 · Empresarial: 3 · Corporativo: ilimitadas
-- ────────────────────────────────────────────────────────────
create or replace function public.validar_limite_empresas()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_plan text; v_total int; v_max int;
begin
  select plan into v_plan from public.profiles where id = new.owner_id;
  select count(*) into v_total from public.empresas where owner_id = new.owner_id;
  v_max := case v_plan when 'pymes' then 1 when 'empresarial' then 3 else null end;
  if v_max is not null and v_total >= v_max then
    raise exception 'Tu plan % permite % empresa(s). Cambia de plan para agregar más.', v_plan, v_max;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_limite_empresas on public.empresas;
create trigger trg_limite_empresas before insert on public.empresas
  for each row execute function public.validar_limite_empresas();

-- ────────────────────────────────────────────────────────────
-- 5. CFDIs: borradores, versión y resultado de validación
-- ────────────────────────────────────────────────────────────
alter table public.cfdis drop constraint if exists cfdis_estado_check;
alter table public.cfdis add constraint cfdis_estado_check
  check (estado in ('vigente','cancelado','en_proceso_cancelacion','borrador'));

alter table public.cfdis add column if not exists version text;
alter table public.cfdis add column if not exists errores jsonb default '[]'::jsonb;
alter table public.cfdis add column if not exists exportacion text;
alter table public.cfdis add column if not exists sello_ultimos8 text;  -- para la liga de verificación del SAT

-- ────────────────────────────────────────────────────────────
-- 6. Documentos relacionados de complementos de pago (Pagos 2.0)
--    Permite saber qué facturas PPD siguen sin complemento.
-- ────────────────────────────────────────────────────────────
create table if not exists public.cfdi_pagos_doctos (
  id uuid primary key default gen_random_uuid(),
  empresa_id uuid not null references public.empresas(id) on delete cascade,
  cfdi_pago_id uuid not null references public.cfdis(id) on delete cascade,
  uuid_relacionado text not null,
  fecha_pago timestamptz,
  num_parcialidad int,
  imp_saldo_ant numeric(18,2),
  imp_pagado numeric(18,2),
  imp_saldo_insoluto numeric(18,2),
  moneda text,
  created_at timestamptz default now() not null
);
create index if not exists idx_pagos_doctos_empresa on public.cfdi_pagos_doctos(empresa_id);
create index if not exists idx_pagos_doctos_uuid on public.cfdi_pagos_doctos(uuid_relacionado);

alter table public.cfdi_pagos_doctos enable row level security;
drop policy if exists pagos_doctos_access on public.cfdi_pagos_doctos;
create policy pagos_doctos_access on public.cfdi_pagos_doctos
  for all using (public.user_has_access_to_empresa(empresa_id))
  with check (public.user_has_access_to_empresa(empresa_id));

-- ────────────────────────────────────────────────────────────
-- 7. Escritura de tablas globales solo para administradores
--    (lista 69-B del SAT, indicadores y noticias)
-- ────────────────────────────────────────────────────────────
create or replace function public.es_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

drop policy if exists efos_admin_write on public.efos_blacklist;
create policy efos_admin_write on public.efos_blacklist
  for all using (public.es_admin()) with check (public.es_admin());

drop policy if exists indicadores_admin_write on public.indicadores_economicos;
create policy indicadores_admin_write on public.indicadores_economicos
  for all using (public.es_admin()) with check (public.es_admin());

drop policy if exists noticias_admin_write on public.noticias;
create policy noticias_admin_write on public.noticias
  for all using (public.es_admin()) with check (public.es_admin());

-- ────────────────────────────────────────────────────────────
-- 8. Invitar colaboradores a una empresa (Portal Contador)
--    El invitado debe tener cuenta en Contrix.
--    Límite de usuarios por plan: PYMES 2 · Empresarial 10 · Corporativo ilimitados
-- ────────────────────────────────────────────────────────────
create or replace function public.invitar_miembro(p_empresa uuid, p_email text, p_rol text default 'colaborador')
returns text language plpgsql security definer set search_path = public as $$
declare v_owner uuid; v_plan text; v_user uuid; v_total int; v_max int;
begin
  select owner_id into v_owner from public.empresas where id = p_empresa;
  if v_owner is null then raise exception 'Empresa no encontrada'; end if;
  if v_owner <> auth.uid() and not exists (
       select 1 from public.miembros_empresa
        where empresa_id = p_empresa and user_id = auth.uid() and rol = 'admin') then
    raise exception 'Solo el dueño o un admin de la empresa puede invitar';
  end if;
  if p_rol not in ('admin','contador','colaborador','solo_lectura') then
    raise exception 'Rol no válido';
  end if;
  select plan into v_plan from public.profiles where id = v_owner;
  select count(*) + 1 into v_total from public.miembros_empresa where empresa_id = p_empresa;
  v_max := case v_plan when 'pymes' then 2 when 'empresarial' then 10 else null end;
  if v_max is not null and v_total >= v_max then
    raise exception 'Tu plan % permite % usuario(s) por empresa', v_plan, v_max;
  end if;
  select id into v_user from public.profiles where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No existe una cuenta Contrix con ese correo. Pídele que se registre primero.';
  end if;
  insert into public.miembros_empresa (empresa_id, user_id, rol, invitado_por)
  values (p_empresa, v_user, p_rol, auth.uid())
  on conflict (empresa_id, user_id) do update set rol = excluded.rol;
  return 'ok';
end;
$$;

grant execute on function public.invitar_miembro(uuid, text, text) to authenticated;

-- Lista de colaboradores de una empresa con su correo
-- (profiles solo deja ver tu propio perfil, por eso se expone así)
create or replace function public.miembros_de_empresa(p_empresa uuid)
returns table(user_id uuid, email text, nombre text, rol text, es_dueno boolean)
language plpgsql security definer set search_path = public as $$
begin
  if not public.user_has_access_to_empresa(p_empresa) then
    raise exception 'Sin acceso a esta empresa';
  end if;
  return query
    select p.id, p.email, p.nombre, coalesce(m.rol, 'admin'), (e.owner_id = p.id)
      from public.empresas e
      join public.profiles p on p.id = e.owner_id or p.id in (select mm.user_id from public.miembros_empresa mm where mm.empresa_id = e.id)
      left join public.miembros_empresa m on m.empresa_id = e.id and m.user_id = p.id
     where e.id = p_empresa;
end;
$$;

grant execute on function public.miembros_de_empresa(uuid) to authenticated;

-- ────────────────────────────────────────────────────────────
-- 9. Hazte administrador (cambia el correo por el tuyo y ejecuta
--    esta línea por separado después de registrarte en la web):
-- update public.profiles set is_admin = true where email = 'TU_CORREO@ejemplo.com';
-- ────────────────────────────────────────────────────────────
