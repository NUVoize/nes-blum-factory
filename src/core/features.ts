// Stretch features (PLAN §12.2). A flag that is off hides the UI control and makes the validator
// reject the matching fields. Flags turn on only when the feature is built and its tests are in the gate.
export const FEATURE_IDS = [
  'wallGrab',
  'swim',
  'melee',
  'doors',
  'extraEnemies',
  'conveyors',
  'extraSongs',
  'errorDiffusion',
  'romEnglish',
  'battery',
] as const;

export type FeatureId = (typeof FEATURE_IDS)[number];
export type FeatureFlags = Record<FeatureId, boolean>;

export const DEFAULT_FEATURES: FeatureFlags = Object.fromEntries(FEATURE_IDS.map((id) => [id, false])) as FeatureFlags;

export function isEnabled(flags: FeatureFlags, id: FeatureId): boolean {
  return flags[id] === true;
}
