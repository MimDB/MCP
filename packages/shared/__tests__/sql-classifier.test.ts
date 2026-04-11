import { describe, it, expect } from 'vitest'
import { classifySql, SqlClassification } from '../src/sql-classifier.js'

describe('classifySql - Read statements', () => {
  it('classifies SELECT as Read', () => {
    expect(classifySql('SELECT * FROM users')).toBe(SqlClassification.Read)
  })

  it('classifies CTE ending with SELECT as Read', () => {
    expect(
      classifySql('WITH active AS (SELECT * FROM users WHERE active) SELECT * FROM active')
    ).toBe(SqlClassification.Read)
  })

  it('classifies EXPLAIN as Read', () => {
    expect(classifySql('EXPLAIN SELECT * FROM users')).toBe(SqlClassification.Read)
  })

  it('classifies SHOW as Read', () => {
    expect(classifySql('SHOW search_path')).toBe(SqlClassification.Read)
  })

  it('classifies lowercase select as Read', () => {
    expect(classifySql('select id from users')).toBe(SqlClassification.Read)
  })

  it('classifies SELECT with leading whitespace as Read', () => {
    expect(classifySql('  \n  SELECT 1')).toBe(SqlClassification.Read)
  })

  it('does not treat semicolons inside string literals as multi-statement', () => {
    expect(classifySql("SELECT * FROM users WHERE name = 'a;b'")).toBe(SqlClassification.Read)
  })
})

describe('classifySql - Write statements', () => {
  it('classifies INSERT as Write', () => {
    expect(classifySql('INSERT INTO users (name) VALUES ($1)')).toBe(SqlClassification.Write)
  })

  it('classifies UPDATE as Write', () => {
    expect(classifySql('UPDATE users SET name = $1')).toBe(SqlClassification.Write)
  })

  it('classifies DELETE as Write', () => {
    expect(classifySql('DELETE FROM users WHERE id = $1')).toBe(SqlClassification.Write)
  })

  it('classifies DROP as Write', () => {
    expect(classifySql('DROP TABLE users')).toBe(SqlClassification.Write)
  })

  it('classifies CREATE as Write', () => {
    expect(classifySql('CREATE TABLE foo (id int)')).toBe(SqlClassification.Write)
  })

  it('classifies ALTER as Write', () => {
    expect(classifySql('ALTER TABLE users ADD COLUMN age int')).toBe(SqlClassification.Write)
  })

  it('classifies TRUNCATE as Write', () => {
    expect(classifySql('TRUNCATE users')).toBe(SqlClassification.Write)
  })

  it('classifies GRANT as Write', () => {
    expect(classifySql('GRANT ALL ON users TO public')).toBe(SqlClassification.Write)
  })

  it('classifies SELECT INTO as Write', () => {
    expect(classifySql('SELECT * INTO new_table FROM users')).toBe(SqlClassification.Write)
  })

  it('classifies EXPLAIN ANALYZE as Write', () => {
    expect(classifySql('EXPLAIN ANALYZE SELECT * FROM users')).toBe(SqlClassification.Write)
  })

  it('classifies multi-statement as Write', () => {
    expect(classifySql('SELECT 1; DROP TABLE users')).toBe(SqlClassification.Write)
  })

  it('classifies comment-wrapped DROP as Write', () => {
    expect(classifySql('/* harmless */ DROP TABLE users')).toBe(SqlClassification.Write)
  })

  it('classifies line-comment-wrapped DROP as Write', () => {
    expect(classifySql('-- just checking\nDROP TABLE users')).toBe(SqlClassification.Write)
  })

  it('classifies CREATE POLICY as Write', () => {
    expect(
      classifySql('CREATE POLICY read_own ON users USING (auth.uid() = id)')
    ).toBe(SqlClassification.Write)
  })

  it('classifies COPY as Write', () => {
    expect(classifySql('COPY users TO STDOUT')).toBe(SqlClassification.Write)
  })
})
