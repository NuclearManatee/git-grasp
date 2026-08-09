// @ts-nocheck
/**
 * Collapse description KNN + FTS hits to one row per recipe id.
 * Skill axes are parked — pick highest cosine when multiple vec hits share an id.
 */

export type RecipeHitLike = {
  command_id?: string | number;
  recipe_id?: string | number;
  id?: string | number;
  intent_text?: string;
  description?: string;
  title?: string;
  intent_category?: string;
  skill_level_text?: string;
  _forcedScore?: number;
  score?: number;
  commands?: { command?: string; comment?: string }[];
  risk?: number;
  example?: string;
  snippet?: string;
  command_recipe?: string;
  [key: string]: unknown;
};

export type FtsHitLike = {
  command_id?: string | number;
  recipe_id?: string | number;
  bm25: number;
};

export type CollapsedCommand = {
  command_id: string;
  rawCosine: number | null;
  rawBm25: number | null;
  intent_text: string;
  intent_category: string;
  skill_level_text: string;
  title: string;
  description: string;
  commands: { command?: string; comment?: string }[];
  risk: number;
  example: string;
  snippet: string;
  command_recipe_json: string;
  stepCount: number;
};

function recipeIdOf(hit: { command_id?: unknown; recipe_id?: unknown; id?: unknown }): string {
  return String(hit.recipe_id ?? hit.command_id ?? hit.id ?? '');
}

function cosineOf(hit: RecipeHitLike): number {
  if (typeof hit._forcedScore === 'number') return hit._forcedScore;
  if (typeof hit.score === 'number') return hit.score;
  return 0;
}

/** @deprecated skill parked — returns highest-cosine hit */
export function pickIntentForCommand(
  intents: RecipeHitLike[],
  _preferredSkill?: string,
): RecipeHitLike {
  const pool = [...intents];
  pool.sort((a, b) => cosineOf(b) - cosineOf(a));
  return pool[0]!;
}

/**
 * Collapse KNN hits + FTS hits to one row per recipe id.
 */
export function collapseToCommands(
  knnHits: RecipeHitLike[],
  ftsHits: FtsHitLike[],
  _preferredSkill?: string,
): CollapsedCommand[] {
  const byRecipe = new Map<string, RecipeHitLike[]>();
  for (const h of knnHits) {
    const id = recipeIdOf(h);
    if (!id) continue;
    if (!byRecipe.has(id)) byRecipe.set(id, []);
    byRecipe.get(id)!.push(h);
  }

  const bm25ByRecipe = new Map<string, number>();
  for (const f of ftsHits) {
    const id = recipeIdOf(f);
    if (!id) continue;
    const prev = bm25ByRecipe.get(id);
    if (prev == null || f.bm25 < prev) bm25ByRecipe.set(id, f.bm25);
  }

  const recipeIds = new Set<string>([
    ...byRecipe.keys(),
    ...bm25ByRecipe.keys(),
  ]);

  const out: CollapsedCommand[] = [];
  for (const command_id of recipeIds) {
    const hits = byRecipe.get(command_id) ?? [];
    const picked = hits.length ? pickIntentForCommand(hits) : null;
    const commands = picked?.commands ?? [];
    const recipeJson =
      typeof picked?.command_recipe === 'string'
        ? picked.command_recipe
        : JSON.stringify({ commands });
    const description = String(
      picked?.description ?? picked?.intent_text ?? '',
    );
    const title = String(picked?.title ?? '');
    out.push({
      command_id,
      rawCosine: picked ? cosineOf(picked) : null,
      rawBm25: bm25ByRecipe.has(command_id)
        ? bm25ByRecipe.get(command_id)!
        : null,
      intent_text: description,
      intent_category: String(picked?.intent_category ?? ''),
      skill_level_text: '',
      title,
      description,
      commands,
      risk: Number(picked?.risk ?? 0),
      example: String(picked?.example ?? commands[0]?.command ?? ''),
      snippet: String(picked?.snippet ?? ''),
      command_recipe_json: recipeJson,
      stepCount: commands.length || 1,
    });
  }
  return out;
}
