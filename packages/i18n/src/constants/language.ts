/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { TLanguage, ILanguageOption } from "../types";

export const FALLBACK_LANGUAGE: TLanguage = "fa";

export const RTL_LANGUAGES: readonly TLanguage[] = ["fa"];

export const getLanguageDirection = (language: TLanguage): "ltr" | "rtl" =>
  RTL_LANGUAGES.includes(language) ? "rtl" : "ltr";

export const SUPPORTED_LANGUAGES: ILanguageOption[] = [{ label: "فارسی", value: "fa" }];

export const LANGUAGE_STORAGE_KEY = "userLanguage";
