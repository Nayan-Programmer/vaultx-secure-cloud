import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Shield, Cloud, Lock, Zap, ArrowRight } from "lucide-react";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VaultX — Your secure cloud vault" },
      { name: "description", content: "Private cloud storage with 1TB per user, Google sign-in, and end-to-end access control." },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => { if (!loading && user) navigate({ to: "/vault" }); }, [user, loading, navigate]);

  return (
    <div className="min-h-screen bg-background bg-aurora">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-gradient-brand shadow-elevated">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <span className="font-display text-xl font-bold">VaultX</span>
        </div>
        <Link to="/login" className="rounded-md px-4 py-2 text-sm font-medium hover:bg-accent">Sign in</Link>
      </header>

      <main className="mx-auto max-w-6xl px-6 pt-16 pb-24">
        <div className="mx-auto max-w-3xl text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-card/50 px-3 py-1 text-xs text-muted-foreground">
            <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
            End-to-end private. 1 TB per user.
          </div>
          <h1 className="mt-6 font-display text-5xl font-bold tracking-tight md:text-7xl">
            Your files,<br />
            <span className="bg-gradient-brand bg-clip-text text-transparent">in a vault.</span>
          </h1>
          <p className="mx-auto mt-6 max-w-xl text-lg text-muted-foreground">
            VaultX is a secure cloud storage system built for individuals and teams who care about privacy.
          </p>
          <div className="mt-10 flex items-center justify-center gap-3">
            <Link to="/login" className="group inline-flex items-center gap-2 rounded-lg bg-gradient-brand px-6 py-3 text-sm font-semibold text-white shadow-elevated hover:opacity-95">
              Open your vault
              <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
            </Link>
          </div>
        </div>

        <div className="mt-24 grid gap-4 md:grid-cols-3">
          {[
            { icon: Cloud, title: "1 TB free space", desc: "Each user gets a private 1TB vault with quota enforcement at the database layer." },
            { icon: Lock, title: "Zero trust by default", desc: "Row-level security ensures files are only ever accessible by their owner." },
            { icon: Zap, title: "Drive-style UI", desc: "Folders, drag-and-drop upload, instant search, and signed download links." },
          ].map(({ icon: Icon, title, desc }) => (
            <div key={title} className="glass rounded-xl p-6">
              <Icon className="h-6 w-6 text-primary" />
              <h3 className="mt-4 font-display text-lg font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
