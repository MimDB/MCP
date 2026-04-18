import { describe, it, expect } from 'vitest'
import { classifyError, formatToolError, formatValidationError } from '../src/errors.js'

// ---------------------------------------------------------------------------
// classifyError
// ---------------------------------------------------------------------------

describe('classifyError', () => {
  it('classifies 401 as auth', () => {
    expect(classifyError(401)).toBe('auth')
  })

  it('classifies 403 as auth', () => {
    expect(classifyError(403)).toBe('auth')
  })

  it('classifies 500 as platform', () => {
    expect(classifyError(500)).toBe('platform')
  })

  it('classifies 503 as platform', () => {
    expect(classifyError(503)).toBe('platform')
  })

  it('classifies status 0 (network error) as platform', () => {
    expect(classifyError(0)).toBe('platform')
  })

  it('classifies 404 as operational', () => {
    expect(classifyError(404)).toBe('operational')
  })

  it('classifies 408 as operational', () => {
    expect(classifyError(408)).toBe('operational')
  })

  it('classifies 429 as operational', () => {
    expect(classifyError(429)).toBe('operational')
  })

  it('classifies 400 as operational', () => {
    expect(classifyError(400)).toBe('operational')
  })

  it('classifies 422 as operational', () => {
    expect(classifyError(422)).toBe('operational')
  })

  it('reclassifies 500 as operational when a structured apiError.code is present', () => {
    expect(
      classifyError(500, { code: 'SQL-0004', message: 'Query execution failed' }),
    ).toBe('operational')
  })

  it('reclassifies 503 as operational when a structured apiError.code is present', () => {
    expect(
      classifyError(503, { code: 'SQL-0008', message: 'Database pool overloaded' }),
    ).toBe('operational')
  })

  it('keeps 500 as platform when apiError has no code', () => {
    expect(classifyError(500, { code: '', message: 'unexpected' })).toBe('platform')
  })

  it('keeps status 0 as platform regardless of apiError', () => {
    expect(
      classifyError(0, { code: 'SQL-0004', message: 'Query execution failed' }),
    ).toBe('platform')
  })
})

// ---------------------------------------------------------------------------
// formatToolError
// ---------------------------------------------------------------------------

describe('formatToolError', () => {
  it('returns isError: true', () => {
    const result = formatToolError(500)
    expect(result.isError).toBe(true)
  })

  it('returns a single text content item', () => {
    const result = formatToolError(500)
    expect(result.content).toHaveLength(1)
    expect(result.content[0]!.type).toBe('text')
  })

  it('includes [Error: platform] tag for 500 errors', () => {
    const result = formatToolError(500)
    expect(result.content[0]!.text).toContain('[Error: platform]')
  })

  it('includes [Error: auth] tag for 401 errors', () => {
    const result = formatToolError(401)
    expect(result.content[0]!.text).toContain('[Error: auth]')
  })

  it('includes [Error: auth] tag for 403 errors', () => {
    const result = formatToolError(403)
    expect(result.content[0]!.text).toContain('[Error: auth]')
  })

  it('mentions MIMDB_SERVICE_ROLE_KEY for auth errors', () => {
    const result = formatToolError(401)
    expect(result.content[0]!.text).toContain('MIMDB_SERVICE_ROLE_KEY')
  })

  it('says "do not retry" for platform errors', () => {
    const result = formatToolError(500)
    const text = result.content[0]!.text.toLowerCase()
    expect(text).toContain('do not retry')
  })

  it('mentions MIMDB_URL for status 0 platform errors', () => {
    const result = formatToolError(0)
    expect(result.content[0]!.text).toContain('MIMDB_URL')
  })

  it('includes [Error: operational] tag for 404', () => {
    const result = formatToolError(404)
    expect(result.content[0]!.text).toContain('[Error: operational]')
  })

  it('provides list_tables hint for 404', () => {
    const result = formatToolError(404)
    expect(result.content[0]!.text).toContain('list_tables')
  })

  it('provides index hint for 408 timeout', () => {
    const result = formatToolError(408)
    expect(result.content[0]!.text.toLowerCase()).toContain('index')
  })

  it('provides retry hint for 429 rate limit', () => {
    const result = formatToolError(429)
    const text = result.content[0]!.text.toLowerCase()
    expect(text).toContain('try again')
  })

  it('includes the API error message when provided', () => {
    const apiError = { code: 'ERR_FORBIDDEN', message: 'Permission denied' }
    const result = formatToolError(403, apiError)
    expect(result.content[0]!.text).toContain('Permission denied')
  })

  it('includes baseUrl in platform error message when provided', () => {
    const result = formatToolError(503, undefined, 'https://example.mimdb.io')
    expect(result.content[0]!.text).toContain('https://example.mimdb.io')
  })

  it('includes the error code when provided', () => {
    const apiError = { code: 'SQL-0004', message: 'Query execution failed' }
    const result = formatToolError(500, apiError)
    expect(result.content[0]!.text).toContain('SQL-0004')
  })

  it('surfaces apiError.detail when provided', () => {
    const apiError = {
      code: 'SQL-0004',
      message: 'Query execution failed',
      detail: 'ERROR: relation "foo" already exists (SQLSTATE 42P07)',
    }
    const result = formatToolError(500, apiError)
    expect(result.content[0]!.text).toContain('already exists')
  })

  it('tags SQL-0004 500 responses as operational, not platform', () => {
    const apiError = { code: 'SQL-0004', message: 'Query execution failed' }
    const result = formatToolError(500, apiError)
    expect(result.content[0]!.text).toContain('[Error: operational]')
    expect(result.content[0]!.text.toLowerCase()).not.toContain('do not retry')
  })
})

// ---------------------------------------------------------------------------
// formatValidationError
// ---------------------------------------------------------------------------

describe('formatValidationError', () => {
  it('returns isError: true', () => {
    const result = formatValidationError('Missing required field: name')
    expect(result.isError).toBe(true)
  })

  it('returns a single text content item', () => {
    const result = formatValidationError('Missing required field: name')
    expect(result.content).toHaveLength(1)
    expect(result.content[0]!.type).toBe('text')
  })

  it('wraps message with [Error: validation] prefix', () => {
    const result = formatValidationError('Missing required field: name')
    expect(result.content[0]!.text).toContain('[Error: validation]')
    expect(result.content[0]!.text).toContain('Missing required field: name')
  })
})
