
-- PROFILES
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "own profile read" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "own profile update" on public.profiles for update to authenticated using (auth.uid() = id);
create policy "own profile insert" on public.profiles for insert to authenticated with check (auth.uid() = id);

-- USER STORAGE QUOTA
create table public.user_storage (
  user_id uuid primary key references auth.users(id) on delete cascade,
  used_bytes bigint not null default 0,
  quota_bytes bigint not null default 1099511627776, -- 1 TB
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.user_storage to authenticated;
grant all on public.user_storage to service_role;
alter table public.user_storage enable row level security;
create policy "own storage read" on public.user_storage for select to authenticated using (auth.uid() = user_id);

-- FOLDERS
create table public.folders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  parent_id uuid references public.folders(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);
create index folders_user_parent_idx on public.folders(user_id, parent_id);
grant select, insert, update, delete on public.folders to authenticated;
grant all on public.folders to service_role;
alter table public.folders enable row level security;
create policy "own folders all" on public.folders for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- FILES
create table public.files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  folder_id uuid references public.folders(id) on delete cascade,
  name text not null,
  storage_path text not null unique,
  size_bytes bigint not null check (size_bytes >= 0),
  mime_type text,
  created_at timestamptz not null default now()
);
create index files_user_folder_idx on public.files(user_id, folder_id);
grant select, insert, update, delete on public.files to authenticated;
grant all on public.files to service_role;
alter table public.files enable row level security;
create policy "own files all" on public.files for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- TRIGGER: handle new user
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.email), new.raw_user_meta_data->>'avatar_url')
  on conflict (id) do nothing;
  insert into public.user_storage (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created
after insert on auth.users for each row execute function public.handle_new_user();

-- TRIGGER: enforce quota & track usage
create or replace function public.track_file_usage()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  current_used bigint;
  current_quota bigint;
begin
  if (tg_op = 'INSERT') then
    select used_bytes, quota_bytes into current_used, current_quota
      from public.user_storage where user_id = new.user_id for update;
    if current_used is null then
      insert into public.user_storage(user_id, used_bytes) values (new.user_id, 0)
        on conflict (user_id) do nothing;
      current_used := 0;
      current_quota := 1099511627776;
    end if;
    if current_used + new.size_bytes > current_quota then
      raise exception 'Storage quota exceeded';
    end if;
    update public.user_storage
      set used_bytes = used_bytes + new.size_bytes, updated_at = now()
      where user_id = new.user_id;
    return new;
  elsif (tg_op = 'DELETE') then
    update public.user_storage
      set used_bytes = greatest(0, used_bytes - old.size_bytes), updated_at = now()
      where user_id = old.user_id;
    return old;
  end if;
  return null;
end;
$$;
create trigger files_usage_ins after insert on public.files
  for each row execute function public.track_file_usage();
create trigger files_usage_del after delete on public.files
  for each row execute function public.track_file_usage();

-- STORAGE BUCKET
insert into storage.buckets (id, name, public) values ('vault', 'vault', false)
  on conflict (id) do nothing;

create policy "vault read own" on storage.objects for select to authenticated
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "vault insert own" on storage.objects for insert to authenticated
  with check (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "vault update own" on storage.objects for update to authenticated
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "vault delete own" on storage.objects for delete to authenticated
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = auth.uid()::text);
