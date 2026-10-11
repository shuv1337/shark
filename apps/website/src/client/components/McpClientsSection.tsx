import { API_TOKEN_SCOPE_DESCRIPTIONS, type OAuthClientGrantDto } from "@hark/contracts";
import { useCallback, useEffect, useState } from "react";
import { oauthApi } from "../lib/oauth-api";
import { useConfirm } from "./ConfirmDialog";
import {
  EmptyState,
  ErrorText,
  InlineCode,
  LIST_PANEL,
  SECTION,
  SectionHeading,
  SkeletonList,
} from "./DashboardKit";
import { rowDangerButton } from "./ui";

/**
 * Settings section listing MCP/OAuth clients connected to the account
 * (Claude, OpenCode, Cursor, …) with their permissions and a Disconnect
 * action that revokes their access and refresh tokens. Self-contained:
 * render `<McpClientsSection />` anywhere.
 */
export function McpClientsSection({ mcpUrl }: { mcpUrl?: string }) {
  const [clients, setClients] = useState<OAuthClientGrantDto[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();
  const endpoint = mcpUrl ?? `${window.location.origin}/mcp`;

  const load = useCallback(async () => {
    try {
      setClients((await oauthApi.listClients()).clients);
    } catch (err) {
      setClients([]);
      setError(err instanceof Error ? err.message : "Could not load connected clients");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const disconnect = async (client: OAuthClientGrantDto) => {
    const confirmed = await confirm({
      title: "Disconnect MCP client",
      message: `Disconnect “${client.name}”? Its access stops immediately and it must ask for your approval again to reconnect.`,
      confirmLabel: "Disconnect",
      destructive: true,
    });
    if (!confirmed) return;
    setBusyId(client.clientId);
    setError(null);
    try {
      await oauthApi.revokeClient(client.clientId);
      setClients((current) => current?.filter((item) => item.clientId !== client.clientId) ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not disconnect this client");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section aria-labelledby="mcp-clients-heading" className={`${SECTION} scroll-mt-24`} id="mcp">
      <SectionHeading
        id="mcp-clients-heading"
        title="Connected MCP clients"
        description={
          <>
            Add <InlineCode>{endpoint}</InlineCode> to Claude, OpenCode, Cursor, or any MCP client.
            It asks for your approval here first.
          </>
        }
      />
      {clients === null ? (
        <SkeletonList label="Loading connected MCP clients" rowClassName="h-16" rows={2} />
      ) : null}
      {clients?.length === 0 && !error ? (
        <EmptyState title="No MCP clients connected">
          Point an MCP client at the URL above. SHark asks you to approve it here, then the agent
          can send notifications and read your inbox with the permissions you granted.
        </EmptyState>
      ) : null}
      {clients && clients.length > 0 ? (
        <ul className={LIST_PANEL}>
          {clients.map((client) => (
            <li
              className="flex flex-wrap items-center gap-x-3 gap-y-2.5 py-3.5"
              key={client.clientId}
            >
              {client.iconUrl ? (
                <img
                  alt=""
                  className="size-9 shrink-0 rounded-full bg-surface object-cover ring-1 ring-line"
                  src={client.iconUrl}
                />
              ) : (
                <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-sm font-medium text-on-accent">
                  {client.name.slice(0, 1).toUpperCase()}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-ink">{client.name}</p>
                <p className="truncate text-[13px] text-ink-faint">
                  {client.lastUsedAt
                    ? `Last used ${new Date(client.lastUsedAt).toLocaleString()}`
                    : "Not used yet"}{" "}
                  · connected {new Date(client.createdAt).toLocaleDateString()}
                  {client.redirectHosts.length > 0 ? ` · ${client.redirectHosts.join(", ")}` : ""}
                </p>
                <p
                  className="mt-0.5 truncate text-[13px] text-ink-faint"
                  title={client.scopes.join(" ")}
                >
                  {client.scopes.length === 0
                    ? "No permissions"
                    : client.scopes
                        .map((scope) => API_TOKEN_SCOPE_DESCRIPTIONS[scope].label)
                        .join(" · ")}
                </p>
              </div>
              <button
                className={rowDangerButton}
                disabled={busyId === client.clientId}
                onClick={() => void disconnect(client)}
                type="button"
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <ErrorText>{error}</ErrorText>
      {dialog}
    </section>
  );
}
