/**
 * loadConfig: per-machine overrides and older persona shapes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../live/config.js';

function plugin(cfg: object, local?: object): string {
  const dir = mkdtempSync(join(tmpdir(), 'wppqa-cfg-'));
  mkdirSync(join(dir, 'docs', 'qa'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'qa', 'qa-config.json'), JSON.stringify(cfg));
  if (local) writeFileSync(join(dir, 'docs', 'qa', 'qa-config.local.json'), JSON.stringify(local));
  return dir;
}

test('live config: string personas become autologin, null personas are dropped', () => {
  const c = loadConfig(plugin({ slug: 'x', base_url: 'http://a.local/', personas: { admin: 'qa_admin', moderator: null, member: { autologin: 'bob' } } }));
  assert.deepEqual(Object.keys(c.personas).sort(), ['admin', 'member']);
  assert.equal(c.personas.admin.autologin, 'qa_admin');
  assert.equal(c.personas.member.autologin, 'bob');
  assert.equal(c.base_url, 'http://a.local');
});

test('live config: qa-config.local.json overrides base_url and adds persona fields', () => {
  const c = loadConfig(plugin({ slug: 'x', base_url: 'http://a.local', personas: { admin: { autologin: '1' } } }, { base_url: 'http://localhost:10013/', personas: { admin: { password: 'pw' }, member_b: 'alice' } }));
  assert.equal(c.base_url, 'http://localhost:10013');
  assert.equal(c.personas.admin.autologin, '1');
  assert.equal(c.personas.admin.password, 'pw');
  assert.equal(c.personas.member_b.autologin, 'alice');
});
