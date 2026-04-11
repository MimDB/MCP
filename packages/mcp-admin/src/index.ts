/**
 * @module index
 * Admin MCP server entry point for the MimDB platform-wide admin server.
 *
 * Reads configuration from environment variables, initialises the MimDB client,
 * registers public tool groups (when project ref and service role key are
 * configured) and admin tool groups, then connects via stdio transport.
 *
 * Required env vars: `MIMDB_URL`, `MIMDB_ADMIN_SECRET`
 * Optional env vars: `MIMDB_PROJECT_REF`, `MIMDB_SERVICE_ROLE_KEY`,
 *                    `MIMDB_READ_ONLY`, `MIMDB_FEATURES`
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  parseAdminConfig,
  MimDBClient,
  PUBLIC_TOOL_GROUPS,
  ADMIN_TOOL_GROUPS,
  registerToolGroups,
} from 'shared'

/**
 * Bootstraps the admin MimDB MCP server.
 *
 * Parses environment configuration, constructs the API client, conditionally
 * registers project-scoped public tools (when `projectRef` and `serviceRoleKey`
 * are both set), always registers admin tools, and starts listening on stdio.
 *
 * @returns A promise that resolves once the server is connected to the transport.
 */
async function main(): Promise<void> {
  const config = parseAdminConfig(process.env as Record<string, string>)

  const client = new MimDBClient({
    baseUrl: config.url,
    adminSecret: config.adminSecret,
    serviceRoleKey: config.serviceRoleKey,
    projectRef: config.projectRef,
  })

  const server = new McpServer({
    name: 'mimdb-admin',
    version: '0.1.0',
  })

  // Register project-scoped tools only if project ref + service key are configured
  if (config.projectRef && config.serviceRoleKey) {
    await registerToolGroups(server, client, PUBLIC_TOOL_GROUPS, config.features, config.readOnly)
  }

  // Admin tools are always available
  await registerToolGroups(server, client, ADMIN_TOOL_GROUPS, config.features, config.readOnly)

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('MimDB Admin MCP server failed to start:', err.message)
  process.exit(1)
})
