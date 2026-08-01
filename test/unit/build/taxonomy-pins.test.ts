import { describe, it, expect } from 'vitest';
import {
  validateCanonicalPin,
  validateCommandRoles,
  validatePinList,
  collapseNearDupIntents,
  GUI_VERBS,
  passATagRoles,
  runTaxonomyPins,
} from '../../../common/src/build/taxonomyPins.ts';
import {
  GOAL_ROLES,
  CanonicalPinSchema,
  TagRolesLlmResponseSchema,
} from '../../../common/src/schemas/taxonomyPins.ts';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const taxonomyVerbs = new Set(['git config', 'git blame', 'git bisect', 'git status', 'git citool']);

function okPin(over: Record<string, unknown> = {}) {
  return {
    goal_id: 'config-user-name',
    verb: 'git config',
    goal_roles: ['identity'],
    recipe_sketch: {
      commands: [{ command: 'git config user.name "Ada"', comment: 'set name' }],
    },
    seed_intents: [
      'how do I change my git username',
      'set git user name',
      'wrong author name in commits',
    ],
    ...over,
  };
}

describe('taxonomy pin schemas', () => {
  it('GOAL_ROLES is a closed set', () => {
    expect(GOAL_ROLES).toContain('identity');
    expect(GOAL_ROLES).toContain('history_bisect');
    expect(GOAL_ROLES).toHaveLength(12);
  });

  it('CanonicalPinSchema round-trips', () => {
    const p = CanonicalPinSchema.parse(okPin());
    expect(p.verb).toBe('git config');
    expect(p.seed_intents.length).toBe(3);
  });
});

describe('validateCanonicalPin', () => {
  it('accepts a minimal valid pin', () => {
    const r = validateCanonicalPin(okPin(), { taxonomyVerbs });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.pin.goal_id).toBe('config-user-name');
  });

  it('rejects verb not in taxonomy', () => {
    const r = validateCanonicalPin(okPin({ verb: 'git svn' }), { taxonomyVerbs });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.some((x) => x.startsWith('verb_not_in_taxonomy'))).toBe(true);
  });

  it('rejects primary verb mismatch', () => {
    const r = validateCanonicalPin(
      okPin({
        recipe_sketch: { commands: [{ command: 'git status', comment: 'nope' }] },
      }),
      { taxonomyVerbs },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.some((x) => x.startsWith('primary_verb_mismatch'))).toBe(true);
  });

  it('rejects shell metacharacters', () => {
    const r = validateCanonicalPin(
      okPin({
        recipe_sketch: {
          commands: [{ command: 'git config user.name x && git config user.email y' }],
        },
      }),
      { taxonomyVerbs },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.some((x) => x.includes('shell_meta'))).toBe(true);
  });

  it('rejects more than 2 flags per step', () => {
    const r = validateCanonicalPin(
      okPin({
        recipe_sketch: {
          commands: [{ command: 'git config --global --replace-all --type bool a true' }],
        },
      }),
      { taxonomyVerbs },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.some((x) => x.startsWith('too_many_flags'))).toBe(true);
  });

  it('rejects GUI verbs', () => {
    const r = validateCanonicalPin(
      okPin({
        goal_id: 'citool-x',
        verb: 'git citool',
        recipe_sketch: { commands: [{ command: 'git citool' }] },
      }),
      { taxonomyVerbs },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.some((x) => x.startsWith('gui_verb'))).toBe(true);
    expect(GUI_VERBS.has('citool')).toBe(true);
  });

  it('rejects more than 2 steps', () => {
    const r = validateCanonicalPin(
      okPin({
        recipe_sketch: {
          commands: [
            { command: 'git config user.name a' },
            { command: 'git config user.email b' },
            { command: 'git config --list' },
          ],
        },
      }),
      { taxonomyVerbs },
    );
    expect(r.ok).toBe(false);
  });
});

describe('validatePinList + collapseNearDupIntents', () => {
  it('dedupes goal_id fail-closed', () => {
    const { valid, invalid } = validatePinList([okPin(), okPin()], { taxonomyVerbs });
    expect(valid).toHaveLength(1);
    expect(invalid).toHaveLength(1);
    expect(invalid[0]!.reasons[0]).toMatch(/duplicate_goal_id/);
  });

  it('collapses near-dup seed intents', () => {
    expect(collapseNearDupIntents(['Set Name', 'set name', 'other'])).toEqual(['Set Name', 'other']);
  });
});

describe('validateCommandRoles', () => {
  it('accepts enum roles', () => {
    const r = validateCommandRoles(
      { command: 'git blame', goal_roles: ['authorship', 'inspection'] },
      { taxonomyVerbs },
    );
    expect(r.ok).toBe(true);
  });

  it('rejects unknown role', () => {
    const r = validateCommandRoles(
      { command: 'git blame', goal_roles: ['magic'] },
      { taxonomyVerbs },
    );
    expect(r.ok).toBe(false);
  });
});

describe('runTaxonomyPins with mock LLM', () => {
  it('writes roles + pins without live API', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'taxonomy-pins-'));
    const taxonomyPath = path.join(dir, 'git_commands.json');
    const rolesOut = path.join(dir, 'git_commands.roles.json');
    const pinsOut = path.join(dir, 'canonical_pins.json');

    writeFileSync(
      taxonomyPath,
      JSON.stringify({
        version: 1,
        scraped_at: '2026-01-01',
        sections: [],
        commands: [
          {
            name: 'config',
            summary: 'Get and set repository or global options',
            command: 'git config',
            section: 'Main Porcelain Commands',
          },
          {
            name: 'blame',
            summary: 'Show what revision and author last modified each line',
            command: 'git blame',
            section: 'Main Porcelain Commands',
          },
          {
            name: 'status',
            summary: 'Show the working tree status',
            command: 'git status',
            section: 'Main Porcelain Commands',
          },
        ],
      }),
    );

    let call = 0;
    const llmJsonObject = async ({ schema }: { schema: { parse?: unknown; safeParse?: unknown } }) => {
      call += 1;
      // Pass A: TagRoles
      if (schema === TagRolesLlmResponseSchema || call <= 1) {
        const payload = {
          items: [
            { command: 'git config', goal_roles: ['identity'] },
            { command: 'git blame', goal_roles: ['authorship'] },
            { command: 'git status', goal_roles: ['inspection', 'workspace'] },
          ],
        };
        // @ts-expect-error dynamic schema
        return schema.parse ? schema.parse(payload) : payload;
      }
      // Pass B draft / C gap / D repair — return empty or one pin
      if (call === 2) {
        const payload = {
          pins: [
            okPin(),
            {
              goal_id: 'blame-who',
              verb: 'git blame',
              goal_roles: ['authorship'],
              recipe_sketch: { commands: [{ command: 'git blame path', comment: '' }] },
              seed_intents: ['who wrote this line', 'who changed this file', 'git blame someone'],
            },
          ],
        };
        // @ts-expect-error dynamic
        return schema.parse ? schema.parse(payload) : payload;
      }
      // C gap-fill empty
      if (call === 3) {
        const payload = { pins: [] };
        // @ts-expect-error dynamic
        return schema.parse ? schema.parse(payload) : payload;
      }
      // D repair empty
      const payload = { pins: [], dropped_goal_ids: [] };
      // @ts-expect-error dynamic
      return schema.parse ? schema.parse(payload) : payload;
    };

    const result = await runTaxonomyPins({
      taxonomyPath,
      rolesOutPath: rolesOut,
      pinsOutPath: pinsOut,
      // @ts-expect-error mock
      llmJsonObject,
      fetchHelp: () => ({ ok: true, text: 'usage: git config …', metadata_source: 'git/-h/config' }),
      log: () => {},
    });

    expect(result.stats.tagged).toBe(3);
    expect(result.stats.pins_valid).toBeGreaterThanOrEqual(1);

    const roles = JSON.parse(readFileSync(rolesOut, 'utf8'));
    expect(roles.version).toBe(1);
    expect(roles.commands.find((c: { command: string }) => c.command === 'git config').goal_roles).toContain(
      'identity',
    );

    const pins = JSON.parse(readFileSync(pinsOut, 'utf8'));
    expect(pins.pins.some((p: { goal_id: string }) => p.goal_id === 'config-user-name')).toBe(true);
  });
});

describe('passATagRoles batching', () => {
  it('uses injected llm and help', async () => {
    const taxonomy = {
      version: 1,
      commands: [
        { name: 'config', summary: 'cfg', command: 'git config', section: 'Main Porcelain Commands' },
      ],
    };
    const help = new Map([['git config', 'usage: git config']]);
    const data = await passATagRoles(taxonomy as any, help, {
      log: () => {},
      llmJsonObject: async () =>
        TagRolesLlmResponseSchema.parse({
          items: [{ command: 'git config', goal_roles: ['identity', 'niche'] }],
        }),
    });
    expect(data.get('git config')).toEqual(['identity', 'niche']);
  });
});
