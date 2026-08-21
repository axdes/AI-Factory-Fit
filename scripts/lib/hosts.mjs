/**
 * Which coding agents this repository already carries, and what each of them reads.
 *
 * The install wrote `.claude/settings.json`, a skill and a subagent into every
 * project unconditionally — including ones where nobody has ever run Claude Code.
 * That is the same failure as writing a `.stories.tsx` into a repository with no
 * Storybook: a file nothing reads, which is worse than its absence because it counts
 * as coverage in the summary and somebody has to keep it in step.
 *
 * The evidence is what the repository already has. A team using Cursor has a
 * `.cursor/`; a team using Copilot has `.github/copilot-instructions.md`. Nobody has
 * to be asked and nothing has to be guessed.
 *
 * `AGENTS.md` is the exception and is always written, because it is the one file the
 * skill-based hosts agree on — Codex reads it, Cursor reads it beside its own rules,
 * OpenCode creates one if it is missing. A portable contract in a repository with no
 * agent yet is a contract waiting for the first one, not a file for a tool nobody has.
 */

/** What each host reads, and how to tell it is here. */
export const HOSTS = {
  'Claude Code': {
    evidence: ['.claude', 'CLAUDE.md'],
    writes: ['.claude/settings.json', '.claude/skills/<name>-gate/SKILL.md', '.claude/agents/<name>-conformance.md'],
    why: 'settings carry the edit hook and the allowed commands; the skill and subagent are how the gate is reached',
  },
  Cursor: {
    evidence: ['.cursor', '.cursorrules'],
    writes: ['.cursor/rules/*.mdc'],
    why: 'a scoped rule loads only while a file it matches is being edited',
  },
  'GitHub Copilot': {
    evidence: ['.github/copilot-instructions.md', '.github/prompts'],
    writes: ['.github/copilot-instructions.md'],
    why: 'the one file it reads at session start',
  },
  'Gemini CLI': {
    evidence: ['GEMINI.md', '.gemini'],
    writes: ['GEMINI.md'],
    why: 'its own name for the always-read contract',
  },
  OpenCode: {
    evidence: ['.opencode', 'opencode.json'],
    writes: ['.opencode/agents/*.md'],
    why: 'agents are markdown files it discovers',
  },
  'Codex and anything else reading AGENTS.md': {
    evidence: ['AGENTS.md'],
    writes: ['AGENTS.md'],
    portable: true,
    why: 'the cross-tool contract, and the only one written whether or not a host is here',
  },
}

/**
 * @param exists a predicate over paths relative to the repository
 */
export function detectHosts(exists) {
  const present = []
  const absent = []
  for (const [name, host] of Object.entries(HOSTS)) {
    const found = host.evidence.filter(e => exists(e))
    // The portable contract is never "absent": it is written whether or not a host
    // is here, so listing it as not written contradicts the line above that says it
    // was. A report that disagrees with itself is one nobody finishes reading.
    if (found.length || host.portable) present.push({ name, ...host, found, assumed: !found.length && host.portable })
    else absent.push({ name, ...host })
  }
  return {
    present,
    absent,
    /** Whether to write this host's artefacts: it is here, or it is the portable one. */
    wants: (name) => present.some(h => h.name === name) || HOSTS[name]?.portable === true,
  }
}
