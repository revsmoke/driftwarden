/**
 * Git utility tests
 */

import { describe, test, expect } from 'bun:test';
import {
  getCommitHash,
  getBranch,
  isDirty,
  getGitContext,
  getGitMetadata,
  isGitRepo,
} from '../src/utils/git.js';

describe('Git Utilities', () => {
  test('isGitRepo returns true for this repo', () => {
    const result = isGitRepo();
    expect(result).toBe(true);
  });

  test('getCommitHash returns a short hash', () => {
    const hash = getCommitHash(true);
    expect(hash).not.toBeNull();
    expect(hash.length).toBeGreaterThanOrEqual(7);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  test('getCommitHash returns a full hash when short=false', () => {
    const hash = getCommitHash(false);
    expect(hash).not.toBeNull();
    expect(hash.length).toBe(40);
    expect(hash).toMatch(/^[a-f0-9]+$/);
  });

  test('getBranch returns current branch name', () => {
    const branch = getBranch();
    expect(branch).not.toBeNull();
    expect(branch.length).toBeGreaterThan(0);
  });

  test('isDirty returns boolean', () => {
    const dirty = isDirty();
    expect(typeof dirty).toBe('boolean');
  });

  test('getGitContext returns minimal context object', () => {
    const context = getGitContext();
    expect(context).toHaveProperty('commit');
    expect(context).toHaveProperty('branch');
    expect(context).toHaveProperty('dirty');
    expect(typeof context.commit).toBe('string');
    expect(typeof context.branch).toBe('string');
    expect(typeof context.dirty).toBe('boolean');
  });

  test('getGitMetadata returns full metadata object', () => {
    const metadata = getGitMetadata();
    expect(metadata).toHaveProperty('commitHash');
    expect(metadata).toHaveProperty('commitHashShort');
    expect(metadata).toHaveProperty('branch');
    expect(metadata).toHaveProperty('isDirty');
    expect(metadata).toHaveProperty('timestamp');
    expect(metadata.commitHashShort.length).toBe(7);
    expect(metadata.commitHash.length).toBe(40);
  });
});
