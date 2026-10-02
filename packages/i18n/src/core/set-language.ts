/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { initPromise, i18nInstance } from "./instance";
import { FALLBACK_LANGUAGE, getLanguageDirection, LANGUAGE_STORAGE_KEY } from "../constants/language";

export async function setLanguage(): Promise<void> {
  await initPromise;
  await i18nInstance.changeLanguage(FALLBACK_LANGUAGE);
  if (typeof window !== "undefined") {
    document.documentElement.lang = FALLBACK_LANGUAGE;
    document.documentElement.dir = getLanguageDirection(FALLBACK_LANGUAGE);
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, FALLBACK_LANGUAGE);
    } catch {
      // A blocked storage write must not prevent rendering Persian.
    }
  }
}
