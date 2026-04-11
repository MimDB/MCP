/**
 * @module tools
 * Tool group registry for MimDB MCP servers.
 *
 * Tool groups are organized into two sets:
 * - {@link PUBLIC_TOOL_GROUPS} - project-scoped tools available to all
 *   authenticated callers (database, storage, cron, etc.)
 * - {@link ADMIN_TOOL_GROUPS} - platform-level tools that require an admin
 *   secret (account management, RLS, logs, API key management)
 *
 * Each group is loaded dynamically so unused modules are never parsed at
 * startup. Use {@link registerToolGroups} to mount a filtered subset of
 * groups onto an MCP server instance.
 *
 * @example
 * ```ts
 * await registerToolGroups(server, client, PUBLIC_TOOL_GROUPS, ['database', 'storage'])
 * await registerToolGroups(server, client, ADMIN_TOOL_GROUPS)
 * ```
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { MimDBClient } from '../client/index.js'

// ---------------------------------------------------------------------------
// ToolRegistrar
// ---------------------------------------------------------------------------

/**
 * Function signature every tool group module must export as `register`.
 *
 * @param server - The MCP server instance to attach tools to.
 * @param client - The MimDB client used by tool handlers for API calls.
 * @param readOnly - When `true`, tools that mutate data should either be
 *   omitted or self-enforce read-only behaviour.
 */
export type ToolRegistrar = (server: McpServer, client: MimDBClient, readOnly?: boolean) => void

// ---------------------------------------------------------------------------
// Tool group maps
// ---------------------------------------------------------------------------

/**
 * Lazily-imported tool groups available in the public (project-scoped) MCP
 * server. Each entry maps a feature name to a dynamic import returning the
 * group's `register` function.
 */
export const PUBLIC_TOOL_GROUPS: Record<string, () => Promise<{ register: ToolRegistrar }>> = {
  database: () => import('./database.js'),
  storage: () => import('./storage.js'),
  cron: () => import('./cron.js'),
  vectors: () => import('./vectors.js'),
  debugging: () => import('./debugging.js'),
  development: () => import('./development.js'),
  docs: () => import('./docs.js'),
}

/**
 * Lazily-imported tool groups available only in the admin MCP server.
 * These require platform-level credentials to operate.
 */
export const ADMIN_TOOL_GROUPS: Record<string, () => Promise<{ register: ToolRegistrar }>> = {
  account: () => import('./account.js'),
  rls: () => import('./rls.js'),
  logs: () => import('./logs.js'),
  keys: () => import('./keys.js'),
}

// ---------------------------------------------------------------------------
// registerToolGroups
// ---------------------------------------------------------------------------

/**
 * Iterates `groups`, optionally filtering by `enabledFeatures`, and calls
 * each group's `register` function against the given server and client.
 *
 * Groups are loaded sequentially to preserve registration order. Dynamic
 * imports are parallelisable in principle, but sequential loading simplifies
 * error tracing when a group fails to mount.
 *
 * @param server - MCP server to attach tools to.
 * @param client - MimDB client passed to each group's `register` function.
 * @param groups - Map of feature name -> dynamic import returning `{ register }`.
 * @param enabledFeatures - Optional allowlist; when provided only groups whose
 *   name appears in this array are loaded. Omit to load all groups.
 * @param readOnly - Passed through to each group's `register` function.
 *
 * @example
 * ```ts
 * // Load only database and storage tools in read-only mode:
 * await registerToolGroups(server, client, PUBLIC_TOOL_GROUPS, ['database', 'storage'], true)
 * ```
 */
export async function registerToolGroups(
  server: McpServer,
  client: MimDBClient,
  groups: Record<string, () => Promise<{ register: ToolRegistrar }>>,
  enabledFeatures?: string[],
  readOnly = false,
): Promise<void> {
  for (const [name, loader] of Object.entries(groups)) {
    if (enabledFeatures && !enabledFeatures.includes(name)) continue
    const mod = await loader()
    mod.register(server, client, readOnly)
  }
}
