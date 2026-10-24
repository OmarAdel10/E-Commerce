// src/modules/settings/staff-language.ts
// The dashboard language one staff member chose (English or Bangla).
//
// Stored like the staff shortcuts and the setup guide: one per-user settings
// document (category `staff-language:<userId>`, key "document"), so the choice
// follows the person to every browser and goes with them when they are removed
// (`deleteStaffPreferencesStatement`). Null until they choose: a browser then
// keeps its own language. The last choice wins; there is nothing to merge.

import { z } from "zod";
import { ValidationError } from "@scalius/core/errors";
import type { Database } from "@scalius/database/client";
import { defineSettingsDocument, type SettingsDocument } from "../../settings-store";

export const STAFF_LANGUAGES = ["en", "bn"] as const;
export type StaffLanguage = (typeof STAFF_LANGUAGES)[number];

interface StaffLanguageDocument {
  language: StaffLanguage | null;
}

export function staffLanguageDocumentKey(userId: string): string {
  return `staff-language:${userId}`;
}

export function staffLanguageDocument(userId: string): SettingsDocument<StaffLanguageDocument> {
  if (!userId) throw new ValidationError("A signed-in staff member is required");
  return defineSettingsDocument<StaffLanguageDocument>({
    key: staffLanguageDocumentKey(userId),
    schema: z.object({ language: z.enum(STAFF_LANGUAGES).nullable() }),
    defaults: { language: null },
  });
}

/** The language this staff member chose, or null when they never chose one. */
export async function readStaffLanguage(db: Database, userId: string): Promise<StaffLanguage | null> {
  return (await staffLanguageDocument(userId).read(db)).language;
}

/** Saves this staff member's dashboard language. Saying it twice changes nothing. */
export async function writeStaffLanguage(db: Database, userId: string, language: StaffLanguage): Promise<StaffLanguage> {
  if (!STAFF_LANGUAGES.includes(language)) throw new ValidationError("The dashboard speaks English or Bangla");
  await staffLanguageDocument(userId).write(db, { language });
  return language;
}
