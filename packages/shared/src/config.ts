/**
 * @module config
 * Zod-based configuration schemas for parsing and validating environment
 * variables used by the MimDB MCP servers.
 *
 * Two top-level parse functions are provided:
 * - {@link parsePublicConfig} - for the project-scoped public MCP server
 * - {@link parseAdminConfig} - for the platform-wide admin MCP server
 */

import { z } from 'zod'

// ---------------------------------------------------------------------------
// Feature allowlists
// ---------------------------------------------------------------------------

/**
 * Feature flags available to the public (project-scoped) MCP server.
 */
export type PublicFeature =
  | 'database'
  | 'storage'
  | 'cron'
  | 'vectors'
  | 'development'
  | 'debugging'
  | 'docs'

/**
 * Feature flags available to the admin MCP server.
 * Superset of {@link PublicFeature}, adding platform-management features.
 */
export type AdminFeature = PublicFeature | 'account' | 'rls' | 'logs' | 'keys'

const PUBLIC_FEATURES: PublicFeature[] = [
  'database',
  'storage',
  'cron',
  'vectors',
  'development',
  'debugging',
  'docs',
]

const ADMIN_FEATURES: AdminFeature[] = [
  ...PUBLIC_FEATURES,
  'account',
  'rls',
  'logs',
  'keys',
]

// ---------------------------------------------------------------------------
// Shared field schemas
// ---------------------------------------------------------------------------

/**
 * Validates a MIMDB_URL env var: must be a valid URL, trailing slash stripped.
 */
const urlSchema = z
  .string({ required_error: 'MIMDB_URL is required' })
  .url({ message: 'MIMDB_URL must be a valid URL' })
  .transform((u) => u.replace(/\/+$/, ''))

/**
 * Validates a MIMDB_PROJECT_REF: exactly 16 lowercase hex characters.
 */
const projectRefSchema = z
  .string({ required_error: 'MIMDB_PROJECT_REF is required' })
  .regex(/^[0-9a-f]{16}$/, {
    message: 'MIMDB_PROJECT_REF must be exactly 16 lowercase hex characters',
  })

/**
 * Validates a non-empty string secret.
 * @param fieldName - Used in the error message.
 */
const secretSchema = (fieldName: string) =>
  z
    .string({ required_error: `${fieldName} is required` })
    .min(1, { message: `${fieldName} must not be empty` })

/**
 * Parses the optional MIMDB_READ_ONLY env var.
 * Accepts "true" or "false" (case-sensitive), defaults to false.
 */
const readOnlySchema = z
  .enum(['true', 'false'], {
    message: 'MIMDB_READ_ONLY must be "true" or "false"',
  })
  .optional()
  .transform((v) => v === 'true')

/**
 * Parses a comma-separated MIMDB_FEATURES list against a provided allowlist.
 * @param allowed - The set of valid feature strings to validate against.
 */
function featuresSchema<T extends string>(allowed: readonly T[]) {
  return z
    .string()
    .optional()
    .transform((raw, ctx) => {
      if (!raw) return undefined

      const items = raw.split(',').map((s) => s.trim())
      const invalid = items.filter((item) => !(allowed as readonly string[]).includes(item))

      if (invalid.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Invalid feature(s): ${invalid.join(', ')}. Allowed: ${allowed.join(', ')}`,
        })
        return z.NEVER
      }

      return items as T[]
    })
}

// ---------------------------------------------------------------------------
// Config interfaces
// ---------------------------------------------------------------------------

/**
 * Validated configuration for the public (project-scoped) MCP server.
 */
export interface PublicConfig {
  /** Base URL of the MimDB instance (no trailing slash). */
  url: string
  /** 16-character hex project reference. */
  projectRef: string
  /** Service role JWT for privileged project access. */
  serviceRoleKey: string
  /** When true, the server will only allow read operations. */
  readOnly: boolean
  /** Subset of feature groups to expose as MCP tools. Undefined means all. */
  features?: PublicFeature[]
}

/**
 * Validated configuration for the admin (platform-wide) MCP server.
 */
export interface AdminConfig {
  /** Base URL of the MimDB instance (no trailing slash). */
  url: string
  /** Platform admin secret for privileged admin API access. */
  adminSecret: string
  /** Optional 16-character hex project reference for project-scoped ops. */
  projectRef?: string
  /** Optional service role JWT when operating in project context. */
  serviceRoleKey?: string
  /** When true, the server will only allow read operations. */
  readOnly: boolean
  /** Subset of feature groups to expose as MCP tools. Undefined means all. */
  features?: AdminFeature[]
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const publicEnvSchema = z.object({
  MIMDB_URL: urlSchema,
  MIMDB_PROJECT_REF: projectRefSchema,
  MIMDB_SERVICE_ROLE_KEY: secretSchema('MIMDB_SERVICE_ROLE_KEY'),
  MIMDB_READ_ONLY: readOnlySchema,
  MIMDB_FEATURES: featuresSchema(PUBLIC_FEATURES),
})

const adminEnvSchema = z.object({
  MIMDB_URL: urlSchema,
  MIMDB_ADMIN_SECRET: secretSchema('MIMDB_ADMIN_SECRET'),
  MIMDB_PROJECT_REF: projectRefSchema.optional(),
  MIMDB_SERVICE_ROLE_KEY: secretSchema('MIMDB_SERVICE_ROLE_KEY').optional(),
  MIMDB_READ_ONLY: readOnlySchema,
  MIMDB_FEATURES: featuresSchema(ADMIN_FEATURES),
})

// ---------------------------------------------------------------------------
// Parse functions
// ---------------------------------------------------------------------------

/**
 * Parses and validates environment variables for the public MCP server.
 *
 * Required env vars: `MIMDB_URL`, `MIMDB_PROJECT_REF`, `MIMDB_SERVICE_ROLE_KEY`
 * Optional env vars: `MIMDB_READ_ONLY`, `MIMDB_FEATURES`
 *
 * @param env - A plain object of environment variable key-value pairs
 *              (e.g. `process.env`).
 * @returns Validated {@link PublicConfig}.
 * @throws `ZodError` when any required variable is absent or invalid.
 *
 * @example
 * ```ts
 * const config = parsePublicConfig(process.env)
 * console.log(config.url, config.projectRef)
 * ```
 */
export function parsePublicConfig(env: Record<string, string | undefined>): PublicConfig {
  const parsed = publicEnvSchema.parse(env)

  return {
    url: parsed.MIMDB_URL,
    projectRef: parsed.MIMDB_PROJECT_REF,
    serviceRoleKey: parsed.MIMDB_SERVICE_ROLE_KEY,
    readOnly: parsed.MIMDB_READ_ONLY ?? false,
    features: parsed.MIMDB_FEATURES,
  }
}

/**
 * Parses and validates environment variables for the admin MCP server.
 *
 * Required env vars: `MIMDB_URL`, `MIMDB_ADMIN_SECRET`
 * Optional env vars: `MIMDB_PROJECT_REF`, `MIMDB_SERVICE_ROLE_KEY`,
 *                    `MIMDB_READ_ONLY`, `MIMDB_FEATURES`
 *
 * The admin server supports two operating modes:
 * - **Platform-only**: supply only `MIMDB_URL` + `MIMDB_ADMIN_SECRET`
 * - **Platform + project**: additionally supply `MIMDB_PROJECT_REF` and
 *   `MIMDB_SERVICE_ROLE_KEY` to enable project-scoped operations
 *
 * @param env - A plain object of environment variable key-value pairs.
 * @returns Validated {@link AdminConfig}.
 * @throws `ZodError` when any required variable is absent or invalid.
 *
 * @example
 * ```ts
 * const config = parseAdminConfig(process.env)
 * if (config.projectRef) {
 *   // project-scoped operations available
 * }
 * ```
 */
export function parseAdminConfig(env: Record<string, string | undefined>): AdminConfig {
  const parsed = adminEnvSchema.parse(env)

  return {
    url: parsed.MIMDB_URL,
    adminSecret: parsed.MIMDB_ADMIN_SECRET,
    projectRef: parsed.MIMDB_PROJECT_REF,
    serviceRoleKey: parsed.MIMDB_SERVICE_ROLE_KEY,
    readOnly: parsed.MIMDB_READ_ONLY ?? false,
    features: parsed.MIMDB_FEATURES,
  }
}
