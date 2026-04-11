# @mimdb/mcp

MCP (Model Context Protocol) server that connects AI assistants to your [MimDB](https://mimdb.dev) projects. Query databases, manage storage, run SQL, search docs, and more - directly from Claude Code, Cursor, VS Code, or any MCP-compatible client.

## Quick Start

No installation required - run via `npx`:

```json
{
  "mcpServers": {
    "mimdb": {
      "command": "npx",
      "args": ["-y", "@mimdb/mcp"],
      "env": {
        "MIMDB_URL": "https://api.mimdb.cloud",
        "MIMDB_PROJECT_REF": "your-project-ref",
        "MIMDB_SERVICE_ROLE_KEY": "your-service-role-key"
      }
    }
  }
}
```

**Claude Code:** Add to `.mcp.json` in your project root.

**Cursor:** Add to `.cursor/mcp.json` in your project root.

**VS Code:** Add to `.vscode/mcp.json` with `"type": "stdio"` and `"command"` / `"args"` / `"env"` fields.

## Configuration

### Required

| Variable | Description |
|----------|-------------|
| `MIMDB_URL` | Your MimDB instance URL (e.g., `https://api.mimdb.cloud`) |
| `MIMDB_PROJECT_REF` | Project ref - 16-character hex string from your project settings |
| `MIMDB_SERVICE_ROLE_KEY` | Service role API key from your project settings |

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `MIMDB_READ_ONLY` | Set to `true` to disable all write operations | `false` |
| `MIMDB_FEATURES` | Comma-separated list of feature groups to enable | All enabled |

## Available Tools (28)

### Database (4 tools)
- `list_tables` - List all tables with column counts and row estimates
- `get_table_schema` - Get columns, types, constraints, foreign keys, and indexes
- `execute_sql` - Run parameterized SQL queries
- `execute_sql_dry_run` - Preview SQL in a read-only transaction (always rolls back)

### Storage (10 tools)
- `list_buckets` / `create_bucket` / `update_bucket` / `delete_bucket`
- `list_objects` / `upload_object` / `download_object` / `delete_object`
- `get_signed_url` / `get_public_url`

### Cron (5 tools)
- `list_jobs` / `create_job` / `get_job` / `delete_job` / `get_job_history`

### Vectors (5 tools)
- `list_vector_tables` / `create_vector_table` / `delete_vector_table`
- `create_vector_index` / `vector_search`

### Debugging (1 tool)
- `get_query_stats` - Slowest queries, call counts, execution times

### Development (2 tools)
- `get_project_url` - Get your project's API URL and ref
- `generate_types` - Generate TypeScript interfaces from your database schema

### Docs (1 tool)
- `search_docs` - Search MimDB documentation

## Permission Controls

**Read-only mode** (`MIMDB_READ_ONLY=true`): Write tools are completely removed - the AI never sees them. SQL is restricted to SELECT/EXPLAIN/SHOW with server-side enforcement via `SET TRANSACTION READ ONLY`.

**Feature filtering** (`MIMDB_FEATURES=database,docs`): Only register the listed groups. Valid groups: `database`, `storage`, `cron`, `vectors`, `development`, `debugging`, `docs`.

## Safety

- SQL results are wrapped with prompt injection mitigation markers
- Client-side SQL validation rejects writes in read-only mode before reaching the API
- `EXPLAIN ANALYZE` is blocked in read-only mode (it executes the query)
- Multi-statement SQL is rejected in read-only mode
- Destructive operations require explicit confirmation parameters
- All inputs validated with Zod schemas before reaching the API

## Links

- [MimDB Documentation](https://docs.mimdb.dev)
- [GitHub Repository](https://github.com/MimDB/MCP)
- [Report Issues](https://github.com/MimDB/MCP/issues)

## License

MIT
