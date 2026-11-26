import { AUTO_MODEL_ID, SHOOTER_LEVELS, SelectionPreferenceSchema, type ProviderSelection } from '@game-creator/contracts';

/** Where the choice of provider and model is kept in the browser: those two ids and nothing else. */
export const STORAGE_KEY = 'game-creator.provider.v1';

/** The choice that calls no AI: the hand-made arena. The server answers it with the same two ids. */
export const DEMO: ProviderSelection = { providerId: 'demo', modelId: 'shooter-arena' };
/** What the interface calls the demo: the title of the arena. */
export const DEMO_TITLE = SHOOTER_LEVELS.arena.title;

/** The demo was once saved under the id of the platformer game (long gone). */
const RETIRED_DEMO_MODEL_ID = 'platformer-v1';

export const isDemoSelection = (selection: ProviderSelection) => selection.providerId === DEMO.providerId && selection.modelId === DEMO.modelId;

/** What a saved value means today: a bad value is the demo, the retired demo id is the demo, and an empty model id (older
 * versions stored it before a model was chosen) is "automatic". */
export function selectionFrom(saved: unknown): ProviderSelection {
  const parsed = SelectionPreferenceSchema.safeParse(saved);
  if (!parsed.success) return DEMO;
  const { providerId, modelId } = parsed.data;
  if (providerId === DEMO.providerId && modelId === RETIRED_DEMO_MODEL_ID) return DEMO;
  return modelId === '' ? { ...parsed.data, modelId: AUTO_MODEL_ID } : parsed.data;
}

/** The saved choice, or the demo when there is none or it cannot be read (storage may be disabled). */
export function loadSelection(read: () => string | null = () => localStorage.getItem(STORAGE_KEY)): ProviderSelection {
  try { return selectionFrom(JSON.parse(read() ?? 'null')); } catch { return DEMO; }
}
