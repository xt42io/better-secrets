import { useState, useDeferredValue } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { motion } from "motion/react";
import { Search, ArrowLeft, Lock, Check } from "lucide-react";
import { FormSheet } from "./FormSheet";
import { useToast } from "./Toast";
import type { Repo } from "./types";

export function CopySecretsSheet({
  open,
  onClose,
  secretNames,
}: {
  open: boolean;
  onClose: () => void;
  secretNames: string[];
}) {
  const [selected, setSelected] = useState<Map<number, Repo>>(new Map());
  const [confirming, setConfirming] = useState(false);
  const [repoSearch, setRepoSearch] = useState("");
  const deferredSearch = useDeferredValue(repoSearch);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const { addToast } = useToast();

  const reposQuery = useQuery({
    queryKey: ["repos", 1],
    queryFn: async () => {
      const res = await fetch("/api/github/repos?page=1");
      if (!res.ok) throw new Error("Failed to fetch repos");
      return res.json() as Promise<{ repos: Repo[] }>;
    },
    enabled: open && !confirming,
  });

  const searchQuery = useQuery({
    queryKey: ["repos-search", deferredSearch],
    queryFn: async () => {
      const res = await fetch(
        `/api/github/repos/search?q=${encodeURIComponent(deferredSearch)}`
      );
      if (!res.ok) throw new Error("Search failed");
      return res.json() as Promise<{ repos: Repo[] }>;
    },
    enabled: open && !confirming && deferredSearch.length > 0,
  });

  const copyMutation = useMutation({
    mutationFn: async (targets: Repo[]) => {
      const results = await Promise.allSettled(
        targets.map(async (repo) => {
          const res = await fetch("/api/github/secrets", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              owner: repo.owner.login,
              repo: repo.name,
              secrets: secretNames.map((name) => ({ name, value: values[name] || "" })),
            }),
          });
          if (!res.ok) {
            const data = await res.json().catch(() => null) as { error?: string } | null;
            throw new Error(data?.error || "Copy failed");
          }
          return repo;
        })
      );
      const failed = targets.filter((_, i) => results[i].status === "rejected");
      if (failed.length) {
        // Keep only failed repos selected so a retry doesn't rewrite the ones that worked.
        setSelected(new Map(failed.map((r) => [r.id, r])));
        const done = targets.length - failed.length;
        throw new Error(
          `${done ? `Copied to ${done} repo${done > 1 ? "s" : ""}. ` : ""}Failed for ${failed
            .map((r) => r.full_name)
            .join(", ")}`
        );
      }
      return targets;
    },
    onSuccess: (targets) => {
      const count = `${secretNames.length} secret${secretNames.length > 1 ? "s" : ""}`;
      const only = targets.length === 1 ? targets[0] : null;
      addToast({
        message: `Copied ${count} to ${only ? only.full_name : `${targets.length} repos`}`,
        link: only
          ? {
              label: `Go to ${only.full_name} →`,
              to: "/dashboard/$owner/$repo",
              params: { owner: only.owner.login, repo: only.name },
            }
          : undefined,
      });
      handleClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to copy secrets"),
  });

  function handleClose() {
    setSelected(new Map());
    setConfirming(false);
    setRepoSearch("");
    setValues({});
    setError("");
    onClose();
  }

  function toggle(repo: Repo) {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(repo.id)) next.delete(repo.id);
      else next.set(repo.id, repo);
      return next;
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    for (const name of secretNames) {
      if (!values[name]) {
        setError(`Value is required for ${name}`);
        return;
      }
    }
    copyMutation.mutate([...selected.values()]);
  }

  const isSearching = deferredSearch.length > 0;
  const repos = isSearching
    ? (searchQuery.data?.repos ?? [])
    : (reposQuery.data?.repos ?? []);
  const loading = isSearching ? searchQuery.isLoading : reposQuery.isLoading;

  const secretCount = `${secretNames.length} secret${secretNames.length > 1 ? "s" : ""}`;
  const repoCount = `${selected.size} repo${selected.size > 1 ? "s" : ""}`;
  const title = confirming ? `Copy ${secretCount} to ${repoCount}` : `Copy ${secretCount}`;

  return (
    <FormSheet open={open} onClose={handleClose} title={title}>
      {!confirming ? (
        <div className="flex flex-col h-full gap-4">
          <div className="relative shrink-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-stone-500" />
            <input
              type="text"
              placeholder="Search repos..."
              value={repoSearch}
              onChange={(e) => setRepoSearch(e.target.value)}
              autoFocus
              className="w-full bg-stone-800 border border-stone-700 rounded-md pl-9 pr-4 py-2 text-sm text-stone-100 placeholder:text-stone-500 focus:outline-none focus:border-accent"
            />
          </div>
          {loading ? (
            <div className="text-stone-500 text-sm text-center py-8">Loading repos...</div>
          ) : repos.length === 0 ? (
            <div className="text-stone-500 text-sm text-center py-8">
              {repoSearch ? "No repos match" : "No repos found"}
            </div>
          ) : (
            <div className="grid gap-1.5 flex-1 overflow-y-auto min-h-0">
              {repos.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="checkbox"
                  aria-checked={selected.has(r.id)}
                  onClick={() => toggle(r)}
                  className={`flex items-center justify-between bg-stone-800/50 border rounded-lg px-4 py-3 hover:border-stone-500 transition-colors text-left w-full ${
                    selected.has(r.id) ? "border-accent" : "border-stone-700/50"
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img src={r.owner.avatar_url} alt="" className="w-6 h-6 rounded-full" />
                    <div className="min-w-0">
                      <div className="text-sm truncate">{r.full_name}</div>
                      {r.private && (
                        <div className="text-xs text-stone-500 flex items-center gap-1 mt-0.5">
                          <Lock className="w-3 h-3" /> Private
                        </div>
                      )}
                    </div>
                  </div>
                  <div
                    className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                      selected.has(r.id) ? "bg-accent border-accent" : "border-stone-600"
                    }`}
                  >
                    {selected.has(r.id) && <Check className="w-3 h-3 text-stone-950" />}
                  </div>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            disabled={selected.size === 0}
            onClick={() => setConfirming(true)}
            className="shrink-0 w-full bg-accent text-stone-950 py-2 rounded-md text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {selected.size ? `Continue with ${repoCount}` : "Select repos"}
          </button>
        </div>
      ) : (
        <motion.form
          onSubmit={handleSubmit}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          className="space-y-4"
        >
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-300 transition-colors mb-2"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Change repos
          </button>

          <div className="text-xs text-stone-400 space-y-0.5">
            {[...selected.values()].map((r) => (
              <div key={r.id} className="truncate">{r.full_name}</div>
            ))}
          </div>

          <div className="text-xs text-stone-500 bg-stone-800/50 border border-stone-700/50 rounded-md px-3 py-2">
            GitHub doesn't expose secret values. Enter the values for each secret to copy them.
          </div>

          <div className="space-y-3">
            {secretNames.map((name) => (
              <div key={name} className="bg-stone-800/50 border border-stone-700/50 rounded-lg p-3 space-y-2">
                <div className="text-xs font-mono text-stone-300">{name}</div>
                <textarea
                  value={values[name] || ""}
                  onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
                  placeholder="Enter secret value..."
                  rows={2}
                  className="w-full bg-stone-800 border border-stone-700 rounded-md px-3 py-2 text-sm font-mono text-stone-100 placeholder:text-stone-600 focus:outline-none focus:border-accent resize-none"
                />
              </div>
            ))}
          </div>

          {error && <div className="text-xs text-red-400">{error}</div>}

          <button
            type="submit"
            disabled={copyMutation.isPending}
            className="w-full bg-accent text-stone-950 py-2 rounded-md text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {copyMutation.isPending
              ? "Copying..."
              : `Copy ${secretCount} to ${repoCount}`}
          </button>
        </motion.form>
      )}
    </FormSheet>
  );
}
