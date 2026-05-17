"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { api } from "@/lib/api";
import type { RawColonyConfig } from "@/lib/types";
import { RestartBanner } from "@/components/RestartBanner";
import { Save, AlertCircle, Info } from "lucide-react";
import { cn } from "@/lib/utils";

interface FormState {
  name: string;
  pollInterval: string;
  gitUserName: string;
  gitUserEmail: string;
  monitoringPort: string;
  discordToken: string;
  discordGuild: string;
  discordWebhookUrl: string;
}

function toFormState(c: RawColonyConfig): FormState {
  return {
    name: c.name,
    pollInterval: c.defaults?.poll_interval ?? "",
    gitUserName: c.defaults?.git?.user_name ?? "",
    gitUserEmail: c.defaults?.git?.user_email ?? "",
    monitoringPort: c.monitoring?.port != null ? String(c.monitoring.port) : "",
    discordToken: c.integrations?.discord?.token ?? "",
    discordGuild: c.integrations?.discord?.guild ?? "",
    discordWebhookUrl: c.integrations?.discord_webhook?.url ?? "",
  };
}

function toRawConfig(f: FormState): RawColonyConfig {
  const config: RawColonyConfig = { name: f.name.trim() || "colony" };

  const hasPollInterval = f.pollInterval.trim();
  const hasGit = f.gitUserName.trim() || f.gitUserEmail.trim();
  if (hasPollInterval || hasGit) {
    config.defaults = {};
    if (hasPollInterval) config.defaults.poll_interval = f.pollInterval.trim();
    if (hasGit) {
      config.defaults.git = {};
      if (f.gitUserName.trim()) config.defaults.git.user_name = f.gitUserName.trim();
      if (f.gitUserEmail.trim()) config.defaults.git.user_email = f.gitUserEmail.trim();
    }
  }

  const port = parseInt(f.monitoringPort, 10);
  if (!isNaN(port) && port > 0 && port <= 65535) {
    config.monitoring = { port };
  }

  const hasDiscord = f.discordToken.trim() && f.discordGuild.trim();
  const hasWebhook = f.discordWebhookUrl.trim();
  if (hasDiscord || hasWebhook) {
    config.integrations = {};
    if (hasDiscord) {
      config.integrations.discord = {
        token: f.discordToken.trim(),
        guild: f.discordGuild.trim(),
      };
    }
    if (hasWebhook) {
      config.integrations.discord_webhook = { url: f.discordWebhookUrl.trim() };
    }
  }

  return config;
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-sm font-medium">{label}</label>
      {hint && <p className="text-xs text-muted-foreground -mt-1">{hint}</p>}
      {children}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      {children}
    </div>
  );
}

export function ColonyConfigEditor() {
  const queryClient = useQueryClient();

  const { data: config, isLoading, error: fetchError } = useQuery({
    queryKey: ["config", "colony"],
    queryFn: api.configGet,
    retry: false,
    refetchInterval: false,
  });

  const [form, setForm] = useState<FormState | null>(null);
  const [dirty, setDirty] = useState(false);
  const [restartRequired, setRestartRequired] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (config && !dirty) setForm(toFormState(config));
  }, [config, dirty]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setDirty(true);
    setSaveError(null);
  };

  const saveMutation = useMutation({
    mutationFn: () => api.configUpdate(toRawConfig(form!)),
    onSuccess: ({ restartRequired: needsRestart }) => {
      setDirty(false);
      setSaveError(null);
      if (needsRestart) setRestartRequired(true);
      queryClient.invalidateQueries({ queryKey: ["config", "colony"] });
    },
    onError: (err: Error) => setSaveError(err.message),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-6">Loading config…</p>;
  }

  if (fetchError) {
    const msg = (fetchError as Error).message;
    const is503 = msg.startsWith("503");
    return (
      <div className="flex items-start gap-2 rounded-lg border border-border bg-secondary/30 p-4 text-sm">
        <Info className="size-4 text-muted-foreground shrink-0 mt-0.5" />
        <div>
          {is503 ? (
            <>
              <p className="font-medium">Config directory not available</p>
              <p className="text-muted-foreground mt-0.5">
                Make sure <code className="font-mono text-xs">monitoring.port</code> is set in{" "}
                <code className="font-mono text-xs">colony.yaml</code> and the runner is active.
              </p>
            </>
          ) : (
            <p>{msg}</p>
          )}
        </div>
      </div>
    );
  }

  if (!form) return null;

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      {restartRequired && (
        <RestartBanner onDismiss={() => setRestartRequired(false)} />
      )}

      {/* Identity */}
      <Section title="Identity">
        <Field label="Colony name">
          <Input
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="my-colony"
            className="w-64"
          />
        </Field>
      </Section>

      <Separator />

      {/* Defaults */}
      <Section title="Defaults">
        <Field
          label="Default poll interval"
          hint="Sleep between autonomous runs for ants with no schedule or triggers (e.g. 5m, 1h). Leave blank to run continuously."
        >
          <Input
            value={form.pollInterval}
            onChange={(e) => set("pollInterval", e.target.value)}
            placeholder="5m"
            className="w-32"
          />
        </Field>
        <Field
          label="Git user name"
          hint="All ant commits use this identity. Leave blank to use the repo's existing config."
        >
          <Input
            value={form.gitUserName}
            onChange={(e) => set("gitUserName", e.target.value)}
            placeholder="Jane Smith"
            className="w-64"
          />
        </Field>
        <Field label="Git email">
          <Input
            value={form.gitUserEmail}
            onChange={(e) => set("gitUserEmail", e.target.value)}
            placeholder="jane@example.com"
            className="w-64"
          />
        </Field>
      </Section>

      <Separator />

      {/* Monitoring */}
      <Section title="Dashboard">
        <Field
          label="Monitoring port"
          hint="HTTP port for the API server and inline dashboard. Leave blank to disable."
        >
          <Input
            type="number"
            value={form.monitoringPort}
            onChange={(e) => set("monitoringPort", e.target.value)}
            placeholder="8080"
            min={1}
            max={65535}
            className="w-32"
          />
        </Field>
      </Section>

      <Separator />

      {/* Discord */}
      <Section title="Discord integration">
        <p className="text-xs text-muted-foreground -mt-2">
          Use{" "}
          <code className="font-mono">{"${ENV_VAR}"}</code> to reference environment variables.
          Both token and server name are required together.
        </p>
        <Field label="Bot token">
          <Input
            value={form.discordToken}
            onChange={(e) => set("discordToken", e.target.value)}
            placeholder="${DISCORD_TOKEN}"
            className="font-mono text-sm w-72"
          />
        </Field>
        <Field label="Server name or ID">
          <Input
            value={form.discordGuild}
            onChange={(e) => set("discordGuild", e.target.value)}
            placeholder="My Server"
            className="w-64"
          />
        </Field>
        <Field
          label="Webhook URL (alternative)"
          hint="Send-only notifications without a full bot setup. Cannot receive commands."
        >
          <Input
            value={form.discordWebhookUrl}
            onChange={(e) => set("discordWebhookUrl", e.target.value)}
            placeholder="${DISCORD_WEBHOOK_URL}"
            className="font-mono text-sm w-72"
          />
        </Field>
      </Section>

      {/* Save bar */}
      <div
        className={cn(
          "flex items-center gap-3 rounded-lg border p-4 transition-colors",
          saveError ? "border-danger/30 bg-danger/5" : "border-border bg-secondary/20"
        )}
      >
        <Button
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !dirty}
        >
          <Save className="size-3.5" />
          {saveMutation.isPending ? "Saving…" : "Save changes"}
        </Button>

        {!dirty && !saveError && (
          <p className="text-xs text-muted-foreground">No unsaved changes.</p>
        )}
        {dirty && !saveError && (
          <p className="text-xs text-warning">Unsaved changes</p>
        )}
        {saveError && (
          <span className="flex items-center gap-1.5 text-xs text-danger">
            <AlertCircle className="size-3.5" />
            {saveError}
          </span>
        )}
      </div>
    </div>
  );
}
