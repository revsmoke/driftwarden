/**
 * Issue Tracker for Driftwarden
 * Persistent issue records in issues/ directory for git-based tracking
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { logger } from '../utils/logger.js';
import { getGitContext, isGitRepo } from '../utils/git.js';

const ISSUES_DIR = 'issues';
const ISSUE_PREFIX = 'ISSUE-';

/**
 * Ensure issues directory exists
 */
function ensureIssuesDir() {
  if (!existsSync(ISSUES_DIR)) {
    mkdirSync(ISSUES_DIR, { recursive: true });
  }
}

/**
 * Generate next issue ID
 * @returns {string} Issue ID (e.g., "ISSUE-0001")
 */
function generateIssueId() {
  ensureIssuesDir();

  const files = readdirSync(ISSUES_DIR).filter(
    (f) => f.startsWith(ISSUE_PREFIX) && f.endsWith('.md')
  );

  let maxNum = 0;
  for (const file of files) {
    const match = file.match(/ISSUE-(\d+)\.md/);
    if (match) {
      const num = parseInt(match[1], 10);
      if (num > maxNum) maxNum = num;
    }
  }

  const nextNum = maxNum + 1;
  return `${ISSUE_PREFIX}${String(nextNum).padStart(4, '0')}`;
}

/**
 * Get current timestamp in ISO format
 * @returns {string}
 */
function timestamp() {
  return new Date().toISOString();
}

/**
 * Create a new issue
 * @param {object} options - Issue options
 * @returns {object} Created issue
 */
export function createIssue(options) {
  const {
    title,
    description,
    severity = 'medium', // low, medium, high, critical
    category = 'error', // error, warning, config, sync, connection
    context = {},
    suggestedFix = null,
  } = options;

  ensureIssuesDir();

  const issueId = generateIssueId();
  const createdAt = timestamp();

  // Add git metadata to context if available
  let enrichedContext = { ...context };
  if (isGitRepo()) {
    const gitContext = getGitContext();
    enrichedContext = {
      ...enrichedContext,
      git: gitContext,
    };
  }

  const issue = {
    id: issueId,
    title,
    description,
    severity,
    category,
    status: 'open',
    createdAt,
    updatedAt: createdAt,
    context: enrichedContext,
    suggestedFix,
    resolution: null,
    resolvedAt: null,
  };

  // Generate markdown content
  const markdown = formatIssueMarkdown(issue);

  // Write to file
  const filePath = join(ISSUES_DIR, `${issueId}.md`);
  writeFileSync(filePath, markdown, 'utf-8');

  logger.activity('issue_created', {
    issueId,
    title,
    severity,
    category,
  });

  return issue;
}

/**
 * Format issue as markdown
 * @param {object} issue - Issue object
 * @returns {string} Markdown content
 */
function formatIssueMarkdown(issue) {
  const lines = [
    `# ${issue.id}: ${issue.title}`,
    '',
    `**Status:** ${issue.status}`,
    `**Severity:** ${issue.severity}`,
    `**Category:** ${issue.category}`,
    `**Created:** ${issue.createdAt}`,
    `**Updated:** ${issue.updatedAt}`,
  ];

  // Add git metadata if available
  if (issue.context?.git) {
    const git = issue.context.git;
    lines.push(`**Git Branch:** ${git.branch || 'unknown'}`);
    lines.push(`**Git Commit:** ${git.commit || 'unknown'}${git.dirty ? ' (uncommitted changes)' : ''}`);
  }

  lines.push('');
  lines.push('## Description');
  lines.push('');
  lines.push(issue.description);
  lines.push('');

  if (issue.context && Object.keys(issue.context).length > 0) {
    // Filter out git from context display (already shown above)
    const contextWithoutGit = { ...issue.context };
    delete contextWithoutGit.git;

    if (Object.keys(contextWithoutGit).length > 0) {
      lines.push('## Context');
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(contextWithoutGit, null, 2));
      lines.push('```');
      lines.push('');
    }
  }

  if (issue.suggestedFix) {
    lines.push('## Suggested Fix');
    lines.push('');
    lines.push(issue.suggestedFix);
    lines.push('');
  }

  if (issue.resolution) {
    lines.push('## Resolution');
    lines.push('');
    lines.push(issue.resolution);
    lines.push('');
    if (issue.resolvedAt) {
      lines.push(`**Resolved:** ${issue.resolvedAt}`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Parse issue from markdown file
 * @param {string} filePath - Path to issue file
 * @returns {object|null} Parsed issue or null
 */
function parseIssueFromMarkdown(filePath) {
  if (!existsSync(filePath)) return null;

  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const issue = {
    id: null,
    title: null,
    status: 'open',
    severity: 'medium',
    category: 'error',
    createdAt: null,
    updatedAt: null,
    description: '',
    context: {},
    suggestedFix: null,
    resolution: null,
    resolvedAt: null,
  };

  let currentSection = null;
  let sectionContent = [];

  for (const line of lines) {
    // Parse header
    const headerMatch = line.match(/^# (ISSUE-\d+): (.+)$/);
    if (headerMatch) {
      issue.id = headerMatch[1];
      issue.title = headerMatch[2];
      continue;
    }

    // Parse metadata
    const statusMatch = line.match(/^\*\*Status:\*\* (.+)$/);
    if (statusMatch) {
      issue.status = statusMatch[1];
      continue;
    }

    const severityMatch = line.match(/^\*\*Severity:\*\* (.+)$/);
    if (severityMatch) {
      issue.severity = severityMatch[1];
      continue;
    }

    const categoryMatch = line.match(/^\*\*Category:\*\* (.+)$/);
    if (categoryMatch) {
      issue.category = categoryMatch[1];
      continue;
    }

    const createdMatch = line.match(/^\*\*Created:\*\* (.+)$/);
    if (createdMatch) {
      issue.createdAt = createdMatch[1];
      continue;
    }

    const updatedMatch = line.match(/^\*\*Updated:\*\* (.+)$/);
    if (updatedMatch) {
      issue.updatedAt = updatedMatch[1];
      continue;
    }

    const resolvedMatch = line.match(/^\*\*Resolved:\*\* (.+)$/);
    if (resolvedMatch) {
      issue.resolvedAt = resolvedMatch[1];
      continue;
    }

    // Parse git metadata
    const gitBranchMatch = line.match(/^\*\*Git Branch:\*\* (.+)$/);
    if (gitBranchMatch) {
      if (!issue.context.git) issue.context.git = {};
      issue.context.git.branch = gitBranchMatch[1];
      continue;
    }

    const gitCommitMatch = line.match(/^\*\*Git Commit:\*\* ([a-f0-9]+)(\s*\(uncommitted changes\))?$/);
    if (gitCommitMatch) {
      if (!issue.context.git) issue.context.git = {};
      issue.context.git.commit = gitCommitMatch[1];
      issue.context.git.dirty = !!gitCommitMatch[2];
      continue;
    }

    // Parse section headers
    if (line.startsWith('## ')) {
      // Save previous section
      if (currentSection) {
        saveSectionContent(issue, currentSection, sectionContent);
      }
      currentSection = line.substring(3).trim();
      sectionContent = [];
      continue;
    }

    // Collect section content
    if (currentSection) {
      sectionContent.push(line);
    }
  }

  // Save last section
  if (currentSection) {
    saveSectionContent(issue, currentSection, sectionContent);
  }

  return issue;
}

/**
 * Save section content to issue
 * @param {object} issue - Issue object
 * @param {string} section - Section name
 * @param {Array<string>} content - Section content lines
 */
function saveSectionContent(issue, section, content) {
  const text = content
    .join('\n')
    .trim()
    .replace(/^```json\n/, '')
    .replace(/\n```$/, '');

  switch (section) {
    case 'Description':
      issue.description = text;
      break;
    case 'Context':
      try {
        issue.context = JSON.parse(text);
      } catch {
        issue.context = { raw: text };
      }
      break;
    case 'Suggested Fix':
      issue.suggestedFix = text;
      break;
    case 'Resolution':
      issue.resolution = text;
      break;
  }
}

/**
 * Get an issue by ID
 * @param {string} issueId - Issue ID
 * @returns {object|null} Issue or null
 */
export function getIssue(issueId) {
  const filePath = join(ISSUES_DIR, `${issueId}.md`);
  return parseIssueFromMarkdown(filePath);
}

/**
 * List all issues
 * @param {object} filters - Optional filters
 * @returns {Array<object>} Array of issues
 */
export function listIssues(filters = {}) {
  ensureIssuesDir();

  const { status, severity, category } = filters;

  const files = readdirSync(ISSUES_DIR).filter(
    (f) => f.startsWith(ISSUE_PREFIX) && f.endsWith('.md')
  );

  const issues = [];
  for (const file of files) {
    const issue = parseIssueFromMarkdown(join(ISSUES_DIR, file));
    if (!issue) continue;

    // Apply filters
    if (status && issue.status !== status) continue;
    if (severity && issue.severity !== severity) continue;
    if (category && issue.category !== category) continue;

    issues.push(issue);
  }

  // Sort by created date (newest first)
  issues.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  return issues;
}

/**
 * Update an issue
 * @param {string} issueId - Issue ID
 * @param {object} updates - Fields to update
 * @returns {object|null} Updated issue or null
 */
export function updateIssue(issueId, updates) {
  const issue = getIssue(issueId);
  if (!issue) return null;

  // Apply updates
  const allowedFields = [
    'title',
    'description',
    'severity',
    'category',
    'status',
    'suggestedFix',
    'resolution',
  ];

  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      issue[field] = updates[field];
    }
  }

  issue.updatedAt = timestamp();

  // If resolving, set resolved timestamp
  if (updates.status === 'resolved' && !issue.resolvedAt) {
    issue.resolvedAt = timestamp();
  }

  // Write updated issue
  const filePath = join(ISSUES_DIR, `${issueId}.md`);
  const markdown = formatIssueMarkdown(issue);
  writeFileSync(filePath, markdown, 'utf-8');

  logger.activity('issue_updated', {
    issueId,
    updates: Object.keys(updates),
  });

  return issue;
}

/**
 * Resolve an issue
 * @param {string} issueId - Issue ID
 * @param {string} resolution - Resolution description
 * @returns {object|null} Resolved issue or null
 */
export function resolveIssue(issueId, resolution) {
  return updateIssue(issueId, {
    status: 'resolved',
    resolution,
  });
}

/**
 * Create issue from error
 * @param {Error} error - Error object
 * @param {object} context - Additional context
 * @returns {object} Created issue
 */
export function createIssueFromError(error, context = {}) {
  const title = error.message.substring(0, 100);
  const description = `An error occurred during sync operation.\n\n**Error Message:**\n${error.message}`;

  const issueContext = {
    ...context,
    errorName: error.name,
    errorStack: error.stack?.split('\n').slice(0, 10).join('\n'),
  };

  // Determine category from error
  let category = 'error';
  const msg = error.message.toLowerCase();
  if (msg.includes('ssh') || msg.includes('tunnel')) {
    category = 'connection';
  } else if (msg.includes('config') || msg.includes('missing')) {
    category = 'config';
  } else if (msg.includes('sync') || msg.includes('diff')) {
    category = 'sync';
  }

  // Determine severity
  let severity = 'medium';
  if (msg.includes('fatal') || msg.includes('critical')) {
    severity = 'critical';
  } else if (msg.includes('warn')) {
    severity = 'low';
  }

  // Generate suggested fix
  let suggestedFix = null;
  if (category === 'connection') {
    suggestedFix =
      '1. Verify SSH credentials in config.json\n' +
      '2. Check that the SSH key file exists and has correct permissions\n' +
      '3. Ensure the remote host is reachable\n' +
      '4. Try running with increased timeout settings';
  } else if (category === 'config') {
    suggestedFix =
      '1. Verify all required fields are present in config.json\n' +
      '2. Check for typos in field names\n' +
      '3. Ensure file paths are absolute or relative to project root';
  }

  return createIssue({
    title,
    description,
    severity,
    category,
    context: issueContext,
    suggestedFix,
  });
}

/**
 * Get issue summary
 * @returns {object} Summary statistics
 */
export function getIssueSummary() {
  const issues = listIssues();

  const summary = {
    total: issues.length,
    byStatus: {
      open: 0,
      resolved: 0,
      'in-progress': 0,
    },
    bySeverity: {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    },
    byCategory: {
      error: 0,
      warning: 0,
      config: 0,
      sync: 0,
      connection: 0,
    },
  };

  for (const issue of issues) {
    if (summary.byStatus[issue.status] !== undefined) {
      summary.byStatus[issue.status]++;
    }
    if (summary.bySeverity[issue.severity] !== undefined) {
      summary.bySeverity[issue.severity]++;
    }
    if (summary.byCategory[issue.category] !== undefined) {
      summary.byCategory[issue.category]++;
    }
  }

  return summary;
}

export default {
  createIssue,
  getIssue,
  listIssues,
  updateIssue,
  resolveIssue,
  createIssueFromError,
  getIssueSummary,
};
