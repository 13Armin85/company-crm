/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import React, { useEffect } from "react";
import { I18nextProvider } from "react-i18next";
import { i18nInstance } from "../core";
import faLiteralTranslations from "../literal-translations/fa.json";
import faLiteralOverrides from "../literal-translations/fa-overrides";
import faPlanLiteralTranslations from "../literal-translations/fa-plans";

interface TranslationProviderProps {
  children: React.ReactNode;
}

const literalTranslations: Record<string, string> = {
  ...faLiteralTranslations,
  ...faLiteralOverrides,
  ...faPlanLiteralTranslations,
};
const normalizedLiteralTranslations = new Map<string, string>();
const ambiguousNormalizedLiterals = new Set<string>();
const originalText = new WeakMap<Text, string>();
const originalAttributes = new WeakMap<Element, Map<string, string>>();
const translatableAttributes = ["placeholder", "title", "aria-label", "alt"] as const;
const excludedContentSelector =
  'script, style, noscript, code, pre, textarea, [contenteditable="true"], [data-no-literal-translation]';

const normalizeWhitespace = (value: string) => value.trim().replace(/\s+/g, " ");

for (const [source, translation] of Object.entries(literalTranslations)) {
  const normalizedSource = normalizeWhitespace(source);
  const existingTranslation = normalizedLiteralTranslations.get(normalizedSource);
  if (existingTranslation && existingTranslation !== translation) {
    ambiguousNormalizedLiterals.add(normalizedSource);
    normalizedLiteralTranslations.delete(normalizedSource);
  } else if (!ambiguousNormalizedLiterals.has(normalizedSource)) {
    normalizedLiteralTranslations.set(normalizedSource, translation);
  }
}

const translateLiteral = (value: string): string | undefined => {
  const match = value.match(/^(\s*)([\s\S]*?)(\s*)$/);
  if (!match) return undefined;

  const [, leadingWhitespace = "", source = "", trailingWhitespace = ""] = match;
  if (!source) return undefined;
  if (/^(?:https?:\/\/|mailto:)|\S+@\S+\.\S+|\.(?:jpe?g|png|webp|svg|json|csv)$/i.test(source)) return undefined;

  const translation = literalTranslations[source] ?? normalizedLiteralTranslations.get(normalizeWhitespace(source));
  return translation ? `${leadingWhitespace}${translation}${trailingWhitespace}` : undefined;
};

const isExcludedContent = (element: Element | null): boolean => Boolean(element?.closest(excludedContentSelector));

const localizeTextNode = (node: Text, isPersian: boolean) => {
  if (isExcludedContent(node.parentElement)) return;

  const savedSource = originalText.get(node);
  if (!isPersian) {
    if (savedSource !== undefined) {
      const expectedTranslation = translateLiteral(savedSource);
      if (expectedTranslation === node.data) node.data = savedSource;
      originalText.delete(node);
    }
    return;
  }

  if (savedSource !== undefined && translateLiteral(savedSource) === node.data) return;

  const translation = translateLiteral(node.data);
  if (translation && translation !== node.data) {
    originalText.set(node, node.data);
    node.data = translation;
  } else if (savedSource !== undefined) {
    originalText.delete(node);
  }
};

const localizeAttribute = (element: Element, attribute: string, isPersian: boolean) => {
  if (!element.hasAttribute(attribute) || isExcludedContent(element)) return;

  const savedAttributes = originalAttributes.get(element);
  const savedSource = savedAttributes?.get(attribute);
  const value = element.getAttribute(attribute);
  if (value === null) return;

  if (!isPersian) {
    if (savedSource !== undefined) {
      const expectedTranslation = translateLiteral(savedSource);
      if (expectedTranslation === value) element.setAttribute(attribute, savedSource);
      savedAttributes?.delete(attribute);
      if (savedAttributes?.size === 0) originalAttributes.delete(element);
    }
    return;
  }

  if (savedSource !== undefined && translateLiteral(savedSource) === value) return;

  const translation = translateLiteral(value);
  if (translation && translation !== value) {
    const attributes = savedAttributes ?? new Map<string, string>();
    attributes.set(attribute, value);
    originalAttributes.set(element, attributes);
    element.setAttribute(attribute, translation);
  } else if (savedSource !== undefined) {
    savedAttributes?.delete(attribute);
  }
};

const localizeElement = (element: Element, isPersian: boolean) => {
  for (const attribute of translatableAttributes) localizeAttribute(element, attribute, isPersian);
  if (
    element.matches('meta[name="description"], meta[name="keywords"], meta[property^="og:"], meta[name^="twitter:"]')
  ) {
    localizeAttribute(element, "content", isPersian);
  }
};

const localizeTree = (root: Node, isPersian: boolean) => {
  if (root instanceof Text) {
    localizeTextNode(root, isPersian);
    return;
  }
  if (!(root instanceof Element) && !(root instanceof DocumentFragment) && !(root instanceof Document)) return;

  if (root instanceof Element) localizeElement(root, isPersian);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    if (node instanceof Text) localizeTextNode(node, isPersian);
    else if (node instanceof Element) localizeElement(node, isPersian);
    node = walker.nextNode();
  }
};

const usePersianLiteralTranslations = () => {
  useEffect(() => {
    let isPersian = (i18nInstance.resolvedLanguage ?? i18nInstance.language ?? "").toLowerCase().startsWith("fa");
    const applyToDocument = () => localizeTree(document.documentElement, isPersian);
    const handleLanguageChange = (language: string) => {
      isPersian = language.toLowerCase().startsWith("fa");
      applyToDocument();
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "characterData") {
          localizeTree(mutation.target, isPersian);
        } else if (mutation.type === "attributes") {
          localizeElement(mutation.target as Element, isPersian);
        } else {
          for (const node of mutation.addedNodes) localizeTree(node, isPersian);
        }
      }
    });

    applyToDocument();
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: [...translatableAttributes, "content"],
    });
    i18nInstance.on("languageChanged", handleLanguageChange);

    return () => {
      observer.disconnect();
      i18nInstance.off("languageChanged", handleLanguageChange);
    };
  }, []);
};

// Render the provider unconditionally: translation readiness is handled before
// hydration (entry.client awaits initPromise). Gating on init with `return null`
// makes the first client render diverge from the server HTML, and React 19
// leaves server DOM it could not adopt in place instead of clearing it.
export const TranslationProvider: React.FC<TranslationProviderProps> = ({ children }) => {
  usePersianLiteralTranslations();
  return <I18nextProvider i18n={i18nInstance}>{children}</I18nextProvider>;
};
