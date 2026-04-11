/**
 * @module index
 * Public MCP server entry point for the MimDB project-scoped server.
 *
 * Reads configuration from environment variables, initialises the MimDB client,
 * registers the public tool groups, and connects via stdio transport.
 *
 * Required env vars: `MIMDB_URL`, `MIMDB_PROJECT_REF`, `MIMDB_SERVICE_ROLE_KEY`
 * Optional env vars: `MIMDB_READ_ONLY`, `MIMDB_FEATURES`
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  parsePublicConfig,
  MimDBClient,
  PUBLIC_TOOL_GROUPS,
  registerToolGroups,
} from 'shared'

/**
 * Bootstraps the public MimDB MCP server.
 *
 * Parses environment configuration, constructs the API client, registers
 * the project-scoped tool groups, and starts listening on stdio.
 *
 * @returns A promise that resolves once the server is connected to the transport.
 */
async function main(): Promise<void> {
  const config = parsePublicConfig(process.env as Record<string, string>)

  const client = new MimDBClient({
    baseUrl: config.url,
    serviceRoleKey: config.serviceRoleKey,
    projectRef: config.projectRef,
  })

  const server = new McpServer({
    name: 'mimdb',
    version: '0.1.0',
  })

  await registerToolGroups(
    server,
    client,
    PUBLIC_TOOL_GROUPS,
    config.features,
    config.readOnly,
  )

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((err) => {
  console.error('MimDB MCP server failed to start:', err.message)
  process.exit(1)
})
