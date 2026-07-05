-- ============================================================
-- Greyhaven Real Estate — EDITOR ROLES upgrade.
-- Run this ONCE in the Supabase SQL Editor (after the original
-- supabase_re_setup.sql).
--
-- Before: anyone with the app URL could read AND write the map.
-- After:  anyone can VIEW the map. To edit, people request an
--         account in the app (username + password, no email),
--         which starts PENDING. An admin approves or rejects
--         requests in the app's ADMIN panel.
--
-- Dashboard settings needed (Authentication → Sign In / Providers):
--   * "Allow new users to sign up"  → ON  (requests come from the app)
--   * Email provider → "Confirm email" → OFF (accounts are
--     username-based; there is no real inbox to confirm)
--
-- Bootstrapping the FIRST admin (one time):
--   1. Request access in the app with your own username.
--   2. Dashboard → Table Editor → re_editors → your row →
--      set approved = true and admin = true.
--   All later approvals happen in the app.
-- ============================================================

-- ---------- editor roster ----------
create table if not exists public.re_editors (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  username     text unique not null,
  approved     boolean not null default false,
  admin        boolean not null default false,
  requested_at timestamptz default now()
);

alter table public.re_editors enable row level security;

-- SECURITY DEFINER so policies can consult the roster without
-- tripping over re_editors' own row level security (recursion).
create or replace function public.re_is_editor() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.re_editors
                  where user_id = auth.uid() and approved) $$;

create or replace function public.re_is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select exists (select 1 from public.re_editors
                  where user_id = auth.uid() and approved and admin) $$;

-- ---------- roster policies ----------
drop policy if exists "re_editors_request"      on public.re_editors;
drop policy if exists "re_editors_see"          on public.re_editors;
drop policy if exists "re_editors_admin_update" on public.re_editors;
drop policy if exists "re_editors_admin_delete" on public.re_editors;

-- Anyone logged in may file their own request — but only ever
-- as unapproved and non-admin.
create policy "re_editors_request" on public.re_editors
  for insert to authenticated
  with check (user_id = auth.uid() and approved = false and admin = false);

-- You can see your own row (to know if you're approved);
-- admins see everyone.
create policy "re_editors_see" on public.re_editors
  for select to authenticated
  using (user_id = auth.uid() or public.re_is_admin());

-- Only admins approve, revoke, or remove.
create policy "re_editors_admin_update" on public.re_editors
  for update to authenticated
  using (public.re_is_admin()) with check (public.re_is_admin());

create policy "re_editors_admin_delete" on public.re_editors
  for delete to authenticated
  using (public.re_is_admin());

-- ---------- map data policies ----------
-- Remove the old open-to-everyone policies.
drop policy if exists "re_properties_all" on public.re_properties;
drop policy if exists "re_zones_all"      on public.re_zones;

-- (re-runnable: drop ours too before recreating)
drop policy if exists "re_properties_read"   on public.re_properties;
drop policy if exists "re_properties_insert" on public.re_properties;
drop policy if exists "re_properties_update" on public.re_properties;
drop policy if exists "re_properties_delete" on public.re_properties;
drop policy if exists "re_zones_read"        on public.re_zones;
drop policy if exists "re_zones_insert"      on public.re_zones;
drop policy if exists "re_zones_update"      on public.re_zones;
drop policy if exists "re_zones_delete"      on public.re_zones;

-- Everyone can view the map.
create policy "re_properties_read" on public.re_properties
  for select to anon, authenticated using (true);
create policy "re_zones_read" on public.re_zones
  for select to anon, authenticated using (true);

-- Only APPROVED editors can change it.
create policy "re_properties_insert" on public.re_properties
  for insert to authenticated with check (public.re_is_editor());
create policy "re_properties_update" on public.re_properties
  for update to authenticated using (public.re_is_editor()) with check (public.re_is_editor());
create policy "re_properties_delete" on public.re_properties
  for delete to authenticated using (public.re_is_editor());

create policy "re_zones_insert" on public.re_zones
  for insert to authenticated with check (public.re_is_editor());
create policy "re_zones_update" on public.re_zones
  for update to authenticated using (public.re_is_editor()) with check (public.re_is_editor());
create policy "re_zones_delete" on public.re_zones
  for delete to authenticated using (public.re_is_editor());
