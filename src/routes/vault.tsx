import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useRef, useCallback, useMemo, type DragEvent } from "react";
import {
  Shield, Upload, FolderPlus, Folder, FileIcon, Search, LogOut, Trash2, Download,
  Pencil, ChevronRight, HardDrive, HomeIcon, Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { formatBytes } from "@/lib/format";
import { toast } from "sonner";

export const Route = createFileRoute("/vault")({
  head: () => ({ meta: [{ title: "Your Vault — VaultX" }] }),
  component: VaultPage,
});

type FolderRow = { id: string; name: string; parent_id: string | null };
type FileRow = { id: string; name: string; storage_path: string; size_bytes: number; mime_type: string | null; folder_id: string | null; created_at: string };
type Storage = { used_bytes: number; quota_bytes: number };

function VaultPage() {
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();
  const [folders, setFolders] = useState<FolderRow[]>([]);
  const [files, setFiles] = useState<FileRow[]>([]);
  const [storage, setStorage] = useState<Storage | null>(null);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<FolderRow[]>([]);
  const [search, setSearch] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!loading && !user) navigate({ to: "/login", replace: true }); }, [user, loading, navigate]);

  const refresh = useCallback(async () => {
    if (!user) return;
    const [foldersRes, filesRes, storageRes] = await Promise.all([
      supabase.from("folders").select("*").order("name"),
      supabase.from("files").select("*").order("created_at", { ascending: false }),
      supabase.from("user_storage").select("used_bytes, quota_bytes").maybeSingle(),
    ]);
    if (foldersRes.data) setFolders(foldersRes.data as FolderRow[]);
    if (filesRes.data) setFiles(filesRes.data as FileRow[]);
    if (storageRes.data) setStorage(storageRes.data as Storage);
  }, [user]);

  useEffect(() => { void refresh(); }, [refresh]);

  // Breadcrumbs derived from currentFolder traversing up
  useEffect(() => {
    if (!currentFolder) { setBreadcrumbs([]); return; }
    const chain: FolderRow[] = [];
    let cur: FolderRow | undefined = folders.find((f) => f.id === currentFolder);
    while (cur) { chain.unshift(cur); cur = folders.find((f) => f.id === cur!.parent_id); }
    setBreadcrumbs(chain);
  }, [currentFolder, folders]);

  const visibleFolders = useMemo(
    () => folders.filter((f) => f.parent_id === currentFolder && f.name.toLowerCase().includes(search.toLowerCase())),
    [folders, currentFolder, search]
  );
  const visibleFiles = useMemo(
    () => files.filter((f) => f.folder_id === currentFolder && f.name.toLowerCase().includes(search.toLowerCase())),
    [files, currentFolder, search]
  );

  const uploadFiles = async (list: FileList | File[]) => {
    if (!user) return;
    const arr = Array.from(list);
    setUploading(true);
    try {
      for (const file of arr) {
        if (storage && storage.used_bytes + file.size > storage.quota_bytes) {
          toast.error(`Quota exceeded for ${file.name}`); continue;
        }
        const path = `${user.id}/${crypto.randomUUID()}-${file.name}`;
        const up = await supabase.storage.from("vault").upload(path, file, { upsert: false });
        if (up.error) { toast.error(`${file.name}: ${up.error.message}`); continue; }
        const ins = await supabase.from("files").insert({
          user_id: user.id, folder_id: currentFolder, name: file.name,
          storage_path: path, size_bytes: file.size, mime_type: file.type || null,
        });
        if (ins.error) {
          await supabase.storage.from("vault").remove([path]);
          toast.error(`${file.name}: ${ins.error.message}`);
        } else {
          toast.success(`Uploaded ${file.name}`);
        }
      }
      await refresh();
    } finally { setUploading(false); }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault(); setDragOver(false);
    if (e.dataTransfer.files?.length) void uploadFiles(e.dataTransfer.files);
  };

  const createFolder = async () => {
    const name = prompt("Folder name");
    if (!name?.trim() || !user) return;
    const { error } = await supabase.from("folders").insert({ user_id: user.id, name: name.trim(), parent_id: currentFolder });
    if (error) toast.error(error.message); else { toast.success("Folder created"); await refresh(); }
  };

  const deleteFile = async (f: FileRow) => {
    if (!confirm(`Delete ${f.name}?`)) return;
    await supabase.storage.from("vault").remove([f.storage_path]);
    const { error } = await supabase.from("files").delete().eq("id", f.id);
    if (error) toast.error(error.message); else { toast.success("Deleted"); await refresh(); }
  };

  const renameFile = async (f: FileRow) => {
    const name = prompt("New name", f.name);
    if (!name?.trim() || name === f.name) return;
    const { error } = await supabase.from("files").update({ name: name.trim() }).eq("id", f.id);
    if (error) toast.error(error.message); else { toast.success("Renamed"); await refresh(); }
  };

  const downloadFile = async (f: FileRow) => {
    const { data, error } = await supabase.storage.from("vault").createSignedUrl(f.storage_path, 60);
    if (error || !data) { toast.error("Could not get download link"); return; }
    window.open(data.signedUrl, "_blank");
  };

  const deleteFolder = async (folder: FolderRow) => {
    if (!confirm(`Delete folder "${folder.name}" and all its contents?`)) return;
    // collect descendant file paths
    const descendants = new Set<string>([folder.id]);
    let added = true;
    while (added) {
      added = false;
      for (const f of folders) if (f.parent_id && descendants.has(f.parent_id) && !descendants.has(f.id)) { descendants.add(f.id); added = true; }
    }
    const paths = files.filter((f) => f.folder_id && descendants.has(f.folder_id)).map((f) => f.storage_path);
    if (paths.length) await supabase.storage.from("vault").remove(paths);
    const { error } = await supabase.from("folders").delete().eq("id", folder.id);
    if (error) toast.error(error.message); else { toast.success("Folder deleted"); await refresh(); }
  };

  if (loading || !user) {
    return <div className="grid min-h-screen place-items-center bg-background"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  const usedPct = storage ? Math.min(100, (storage.used_bytes / storage.quota_bytes) * 100) : 0;

  return (
    <div className="flex min-h-screen bg-background bg-aurora">
      {/* Sidebar */}
      <aside className="hidden w-64 flex-col border-r border-sidebar-border bg-sidebar p-4 md:flex">
        <div className="mb-8 flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-brand shadow-elevated">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <span className="font-display text-xl font-bold">VaultX</span>
        </div>

        <button
          onClick={() => fileInput.current?.click()}
          className="mb-2 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-brand py-2.5 text-sm font-semibold text-white shadow-elevated hover:opacity-95"
        >
          <Upload className="h-4 w-4" /> Upload files
        </button>
        <button onClick={createFolder} className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card py-2 text-sm hover:bg-accent">
          <FolderPlus className="h-4 w-4" /> New folder
        </button>

        <nav className="mt-6 space-y-1">
          <NavBtn icon={HomeIcon} active={!currentFolder} onClick={() => setCurrentFolder(null)}>My Vault</NavBtn>
          <NavBtn icon={HardDrive} active={false} onClick={() => {}}>Storage</NavBtn>
        </nav>

        <div className="mt-auto rounded-xl border border-sidebar-border bg-card/50 p-4">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Storage</span>
            <span>{storage ? `${(storage.used_bytes / storage.quota_bytes * 100).toFixed(1)}%` : "—"}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-gradient-brand" style={{ width: `${usedPct}%` }} />
          </div>
          <div className="mt-2 text-xs text-muted-foreground">
            {storage ? `${formatBytes(storage.used_bytes)} of ${formatBytes(storage.quota_bytes)}` : "—"}
          </div>
          <button onClick={signOut} className="mt-3 flex w-full items-center justify-center gap-2 rounded-md py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground">
            <LogOut className="h-3.5 w-3.5" /> Sign out
          </button>
        </div>
      </aside>

      {/* Main */}
      <main
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className="relative flex-1 overflow-auto"
      >
        {dragOver && (
          <div className="pointer-events-none fixed inset-0 z-50 grid place-items-center bg-primary/10 backdrop-blur-sm">
            <div className="rounded-xl border-2 border-dashed border-primary px-12 py-8 text-center">
              <Upload className="mx-auto h-10 w-10 text-primary" />
              <p className="mt-2 font-display text-xl">Drop to upload</p>
            </div>
          </div>
        )}

        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/80 px-6 py-4 backdrop-blur">
          <div className="relative flex-1 max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search files & folders"
              className="w-full rounded-lg border border-border bg-input py-2 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>
          {uploading && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
          <div className="text-xs text-muted-foreground">{user.email}</div>
        </div>

        <div className="p-6">
          {/* Breadcrumbs */}
          <div className="mb-6 flex items-center gap-1 text-sm">
            <button onClick={() => setCurrentFolder(null)} className="rounded px-2 py-1 hover:bg-accent">My Vault</button>
            {breadcrumbs.map((b) => (
              <span key={b.id} className="flex items-center">
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
                <button onClick={() => setCurrentFolder(b.id)} className="rounded px-2 py-1 hover:bg-accent">{b.name}</button>
              </span>
            ))}
          </div>

          {visibleFolders.length === 0 && visibleFiles.length === 0 ? (
            <EmptyState onUpload={() => fileInput.current?.click()} />
          ) : (
            <>
              {visibleFolders.length > 0 && (
                <section className="mb-8">
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Folders</h2>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {visibleFolders.map((f) => (
                      <div key={f.id} className="group glass relative cursor-pointer rounded-xl p-4 transition hover:border-primary/40" onDoubleClick={() => setCurrentFolder(f.id)}>
                        <div className="flex items-center gap-3" onClick={() => setCurrentFolder(f.id)}>
                          <Folder className="h-6 w-6 text-primary" />
                          <span className="truncate font-medium">{f.name}</span>
                        </div>
                        <button onClick={(e) => { e.stopPropagation(); void deleteFolder(f); }} className="absolute right-2 top-2 rounded p-1 text-muted-foreground opacity-0 hover:bg-destructive/20 hover:text-destructive group-hover:opacity-100">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {visibleFiles.length > 0 && (
                <section>
                  <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Files</h2>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                    {visibleFiles.map((f) => (
                      <div key={f.id} className="group glass flex flex-col rounded-xl p-4 transition hover:border-primary/40">
                        <div className="mb-3 grid h-24 place-items-center rounded-lg bg-muted/40">
                          <FileIcon className="h-10 w-10 text-muted-foreground" />
                        </div>
                        <div className="truncate text-sm font-medium" title={f.name}>{f.name}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">{formatBytes(f.size_bytes)}</div>
                        <div className="mt-3 flex gap-1 opacity-0 transition group-hover:opacity-100">
                          <IconBtn onClick={() => downloadFile(f)} title="Download"><Download className="h-3.5 w-3.5" /></IconBtn>
                          <IconBtn onClick={() => renameFile(f)} title="Rename"><Pencil className="h-3.5 w-3.5" /></IconBtn>
                          <IconBtn onClick={() => deleteFile(f)} title="Delete" danger><Trash2 className="h-3.5 w-3.5" /></IconBtn>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        <input
          ref={fileInput} type="file" multiple className="hidden"
          onChange={(e) => { if (e.target.files) void uploadFiles(e.target.files); e.target.value = ""; }}
        />
      </main>
    </div>
  );
}

function NavBtn({ icon: Icon, children, active, onClick }: { icon: typeof HomeIcon; children: React.ReactNode; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${active ? "bg-sidebar-accent text-foreground" : "text-sidebar-foreground hover:bg-accent"}`}>
      <Icon className="h-4 w-4" /> {children}
    </button>
  );
}

function IconBtn({ children, onClick, title, danger }: { children: React.ReactNode; onClick: () => void; title: string; danger?: boolean }) {
  return (
    <button onClick={onClick} title={title} className={`rounded-md border border-border bg-card/60 p-1.5 hover:bg-accent ${danger ? "hover:border-destructive hover:text-destructive" : ""}`}>
      {children}
    </button>
  );
}

function EmptyState({ onUpload }: { onUpload: () => void }) {
  return (
    <div className="mt-20 grid place-items-center text-center">
      <div className="glass rounded-2xl p-10">
        <Upload className="mx-auto h-10 w-10 text-primary" />
        <h3 className="mt-4 font-display text-xl font-semibold">Your vault is empty</h3>
        <p className="mt-2 max-w-sm text-sm text-muted-foreground">Drag files anywhere on this page, or click upload to get started.</p>
        <button onClick={onUpload} className="mt-5 rounded-lg bg-gradient-brand px-5 py-2 text-sm font-semibold text-white shadow-elevated">Upload your first file</button>
      </div>
    </div>
  );
}
