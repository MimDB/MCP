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
 * Use {@link registerToolGroups} to mount a filtered subset of groups
 * onto an MCP server instance.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { MimDBClient } from '../client/index.js'

import { register as registerDatabase } from './database.js'
import { register as registerStorage } from './storage.js'
import { register as registerCron } from './cron.js'
import { register as registerVectors } from './vectors.js'
import { register as registerDebugging } from './debugging.js'
import { register as registerDevelopment } from './development.js'
import { register as registerDocs } from './docs.js'
import { register as registerAccount } from './account.js'
import { register as registerRls } from './rls.js'
import { register as registerLogs } from './logs.js'
import { register as registerKeys } from './keys.js'

// ---------------------------------------------------------------------------
// ToolRegistrar
// ---------------------------------------------------------------------------

/**
 * Function signature every tool group module must export as `register`.
 */
export type ToolRegistrar = (server: McpServer, client: MimDBClient, readOnly?: boolean) => void

// ---------------------------------------------------------------------------
// Tool group maps
// ---------------------------------------------------------------------------

/**
 * Tool groups available in the public (project-scoped) MCP server.
 */
export const PUBLIC_TOOL_GROUPS: Record<string, ToolRegistrar> = {
  database: registerDatabase,
  storage: registerStorage,
  cron: registerCron,
  vectors: registerVectors,
  debugging: registerDebugging,
  development: registerDevelopment,
  docs: registerDocs,
}

/**
 * Tool groups available only in the admin MCP server.
 * These require platform-level credentials to operate.
 */
export const ADMIN_TOOL_GROUPS: Record<string, ToolRegistrar> = {
  account: registerAccount,
  rls: registerRls,
  logs: registerLogs,
  keys: registerKeys,
}

// ---------------------------------------------------------------------------
// registerToolGroups
// ---------------------------------------------------------------------------

/**
 * Register tool groups on an MCP server, optionally filtered by feature list.
 *
 * @param server - MCP server to attach tools to.
 * @param client - MimDB client passed to each group's `register` function.
 * @param groups - Map of feature name -> register function.
 * @param enabledFeatures - Optional allowlist; when provided only groups whose
 *   name appears in this array are registered. Omit to register all groups.
 * @param readOnly - Passed through to each group's `register` function.
 */
export function registerToolGroups(
  server: McpServer,
  client: MimDBClient,
  groups: Record<string, ToolRegistrar>,
  enabledFeatures?: string[],
  readOnly = false,
): void {
  for (const [name, register] of Object.entries(groups)) {
    if (enabledFeatures && !enabledFeatures.includes(name)) continue
    register(server, client, readOnly)
  }
}
