import { describe, it, expect } from 'vitest'
import { parsePublicConfig, parseAdminConfig } from '../src/config.js'

// ---------------------------------------------------------------------------
// parsePublicConfig
// ---------------------------------------------------------------------------

describe('parsePublicConfig', () => {
  const validEnv = {
    MIMDB_URL: 'https://example.mimdb.io',
    MIMDB_PROJECT_REF: 'abcdef1234567890',
    MIMDB_SERVICE_ROLE_KEY: 'super-secret-key',
  }

  it('parses a valid env successfully', () => {
    const cfg = parsePublicConfig(validEnv)
    expect(cfg.url).toBe('https://example.mimdb.io')
    expect(cfg.projectRef).toBe('abcdef1234567890')
    expect(cfg.serviceRoleKey).toBe('super-secret-key')
    expect(cfg.readOnly).toBe(false)
    expect(cfg.features).toEqual([])
  })

  it('strips trailing slash from URL', () => {
    const cfg = parsePublicConfig({ ...validEnv, MIMDB_URL: 'https://example.mimdb.io/' })
    expect(cfg.url).toBe('https://example.mimdb.io')
  })

  it('throws when MIMDB_URL is missing', () => {
    const env = { ...validEnv }
    delete env['MIMDB_URL' as keyof typeof env]
    expect(() => parsePublicConfig(env)).toThrow()
  })

  it('throws when MIMDB_URL is not a valid URL', () => {
    expect(() => parsePublicConfig({ ...validEnv, MIMDB_URL: 'not-a-url' })).toThrow()
  })

  it('throws when MIMDB_PROJECT_REF is not 16 hex chars', () => {
    expect(() => parsePublicConfig({ ...validEnv, MIMDB_PROJECT_REF: 'tooshort' })).toThrow()
    expect(() => parsePublicConfig({ ...validEnv, MIMDB_PROJECT_REF: 'abcdef123456789g' })).toThrow()
    expect(() => parsePublicConfig({ ...validEnv, MIMDB_PROJECT_REF: 'abcdef12345678901' })).toThrow()
  })

  it('throws when MIMDB_PROJECT_REF is missing', () => {
    const env = { ...validEnv }
    delete env['MIMDB_PROJECT_REF' as keyof typeof env]
    expect(() => parsePublicConfig(env)).toThrow()
  })

  it('throws when MIMDB_SERVICE_ROLE_KEY is empty', () => {
    expect(() => parsePublicConfig({ ...validEnv, MIMDB_SERVICE_ROLE_KEY: '' })).toThrow()
  })

  it('throws when MIMDB_SERVICE_ROLE_KEY is missing', () => {
    const env = { ...validEnv }
    delete env['MIMDB_SERVICE_ROLE_KEY' as keyof typeof env]
    expect(() => parsePublicConfig(env)).toThrow()
  })

  it('parses MIMDB_READ_ONLY=true', () => {
    const cfg = parsePublicConfig({ ...validEnv, MIMDB_READ_ONLY: 'true' })
    expect(cfg.readOnly).toBe(true)
  })

  it('parses MIMDB_READ_ONLY=false', () => {
    const cfg = parsePublicConfig({ ...validEnv, MIMDB_READ_ONLY: 'false' })
    expect(cfg.readOnly).toBe(false)
  })

  it('throws when MIMDB_READ_ONLY is an invalid value', () => {
    expect(() => parsePublicConfig({ ...validEnv, MIMDB_READ_ONLY: 'yes' })).toThrow()
  })

  it('parses a valid comma-separated MIMDB_FEATURES list', () => {
    const cfg = parsePublicConfig({ ...validEnv, MIMDB_FEATURES: 'database,storage,cron' })
    expect(cfg.features).toEqual(['database', 'storage', 'cron'])
  })

  it('parses all valid public features', () => {
    const features = 'database,storage,cron,vectors,development,debugging,docs'
    const cfg = parsePublicConfig({ ...validEnv, MIMDB_FEATURES: features })
    expect(cfg.features).toHaveLength(7)
  })

  it('throws when MIMDB_FEATURES contains an invalid feature name', () => {
    expect(() =>
      parsePublicConfig({ ...validEnv, MIMDB_FEATURES: 'database,account' }),
    ).toThrow()
  })

  it('throws when MIMDB_FEATURES contains an unknown feature', () => {
    expect(() =>
      parsePublicConfig({ ...validEnv, MIMDB_FEATURES: 'database,unknown_feature' }),
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// parseAdminConfig
// ---------------------------------------------------------------------------

describe('parseAdminConfig', () => {
  const platformOnlyEnv = {
    MIMDB_URL: 'https://admin.mimdb.io',
    MIMDB_ADMIN_SECRET: 'my-admin-secret',
  }

  const fullEnv = {
    ...platformOnlyEnv,
    MIMDB_PROJECT_REF: 'abcdef1234567890',
    MIMDB_SERVICE_ROLE_KEY: 'project-service-key',
  }

  it('parses platform-only mode (no project ref or service key)', () => {
    const cfg = parseAdminConfig(platformOnlyEnv)
    expect(cfg.url).toBe('https://admin.mimdb.io')
    expect(cfg.adminSecret).toBe('my-admin-secret')
    expect(cfg.projectRef).toBeUndefined()
    expect(cfg.serviceRoleKey).toBeUndefined()
    expect(cfg.readOnly).toBe(false)
    expect(cfg.features).toEqual([])
  })

  it('parses platform + project mode', () => {
    const cfg = parseAdminConfig(fullEnv)
    expect(cfg.projectRef).toBe('abcdef1234567890')
    expect(cfg.serviceRoleKey).toBe('project-service-key')
  })

  it('strips trailing slash from URL', () => {
    const cfg = parseAdminConfig({ ...platformOnlyEnv, MIMDB_URL: 'https://admin.mimdb.io/' })
    expect(cfg.url).toBe('https://admin.mimdb.io')
  })

  it('throws when MIMDB_ADMIN_SECRET is missing', () => {
    const env = { ...platformOnlyEnv }
    delete env['MIMDB_ADMIN_SECRET' as keyof typeof env]
    expect(() => parseAdminConfig(env)).toThrow()
  })

  it('throws when MIMDB_ADMIN_SECRET is empty', () => {
    expect(() => parseAdminConfig({ ...platformOnlyEnv, MIMDB_ADMIN_SECRET: '' })).toThrow()
  })

  it('throws when MIMDB_URL is missing', () => {
    const env = { ...platformOnlyEnv }
    delete env['MIMDB_URL' as keyof typeof env]
    expect(() => parseAdminConfig(env)).toThrow()
  })

  it('accepts admin-only features like account, rls, logs, keys', () => {
    const cfg = parseAdminConfig({
      ...platformOnlyEnv,
      MIMDB_FEATURES: 'database,account,rls,logs,keys',
    })
    expect(cfg.features).toContain('account')
    expect(cfg.features).toContain('rls')
    expect(cfg.features).toContain('logs')
    expect(cfg.features).toContain('keys')
  })

  it('throws when MIMDB_PROJECT_REF is present but invalid', () => {
    expect(() =>
      parseAdminConfig({ ...platformOnlyEnv, MIMDB_PROJECT_REF: 'bad-ref' }),
    ).toThrow()
  })
})
