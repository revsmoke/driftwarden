/**
 * Git Utilities for Driftwarden
 * Provides git metadata for issue tracking and logging
 */

import { execSync } from 'child_process';
import { logger } from './logger.js';

/**
 * Execute a git command and return trimmed output
 * @param {string} command - Git command to execute
 * @returns {string|null} Command output or null on error
 */
function execGit(command) {
  try {
    return execSync(`git ${command}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Get current git commit hash
 * @param {boolean} short - Return short hash (7 chars) if true
 * @returns {string|null} Commit hash or null
 */
export function getCommitHash(short = true) {
  const flag = short ? '--short' : '';
  return execGit(`rev-parse ${flag} HEAD`.trim());
}

/**
 * Get current git branch name
 * @returns {string|null} Branch name or null
 */
export function getBranch() {
  return execGit('rev-parse --abbrev-ref HEAD');
}

/**
 * Check if there are uncommitted changes
 * @returns {boolean} True if working directory is dirty
 */
export function isDirty() {
  const status = execGit('status --porcelain');
  return status !== null && status.length > 0;
}

/**
 * Get the most recent commit message
 * @returns {string|null} Commit message or null
 */
export function getLastCommitMessage() {
  return execGit('log -1 --format=%s');
}

/**
 * Get the author of the last commit
 * @returns {string|null} Author name and email or null
 */
export function getLastCommitAuthor() {
  return execGit('log -1 --format=%an <%ae>');
}

/**
 * Get remote origin URL
 * @returns {string|null} Remote URL or null
 */
export function getRemoteUrl() {
  return execGit('remote get-url origin');
}

/**
 * Get all git metadata as an object
 * @returns {object} Git metadata
 */
export function getGitMetadata() {
  const metadata = {
    commitHash: getCommitHash(false),
    commitHashShort: getCommitHash(true),
    branch: getBranch(),
    isDirty: isDirty(),
    lastCommitMessage: getLastCommitMessage(),
    lastCommitAuthor: getLastCommitAuthor(),
    remoteUrl: getRemoteUrl(),
    timestamp: new Date().toISOString(),
  };

  logger.debug(`Git metadata: ${metadata.branch}@${metadata.commitHashShort}${metadata.isDirty ? ' (dirty)' : ''}`);

  return metadata;
}

/**
 * Get minimal git context for issue tracking
 * @returns {object} Minimal git context
 */
export function getGitContext() {
  return {
    commit: getCommitHash(true),
    branch: getBranch(),
    dirty: isDirty(),
  };
}

/**
 * Check if current directory is a git repository
 * @returns {boolean} True if in a git repo
 */
export function isGitRepo() {
  return execGit('rev-parse --is-inside-work-tree') === 'true';
}

export default {
  getCommitHash,
  getBranch,
  isDirty,
  getLastCommitMessage,
  getLastCommitAuthor,
  getRemoteUrl,
  getGitMetadata,
  getGitContext,
  isGitRepo,
};
