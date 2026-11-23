import type { WorkoutItem } from './workout'

export type Draft = { title: string; prescription: string; published: boolean; items: WorkoutItem[] }
export type SavedDraft = Draft & { id: string }

export const draftKey = (scope: readonly (string | number)[]) => 'workout-draft:v1:' + JSON.stringify(scope)

export function readDraft(storage: Storage, key: string): SavedDraft | null {
  try {
    const draft = JSON.parse(storage.getItem(key) ?? 'null') as SavedDraft | null
    if (draft && typeof draft.id === 'string' && typeof draft.title === 'string'
      && typeof draft.prescription === 'string' && typeof draft.published === 'boolean' && Array.isArray(draft.items)) return draft
  } catch { /* Повреждённая запись или недоступное хранилище. */ }
  return null
}
