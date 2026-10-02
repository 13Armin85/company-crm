import assert from "node:assert/strict";
import { test } from "node:test";

test("Persian overrides saved languages and remains usable when storage is blocked", async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  const storage = new Map([["userLanguage", "en"]]);
  globalThis.window = {
    localStorage: {
      getItem: (key) => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
    },
  };
  globalThis.document = { documentElement: { lang: "en", dir: "ltr" } };

  try {
    const { i18nInstance, initPromise } = await import("../src/core/instance.ts");
    const { setLanguage } = await import("../src/core/set-language.ts");
    await initPromise;

    assert.equal(i18nInstance.language, "fa");
    assert.equal(i18nInstance.t("language"), "زبان");
    assert.deepEqual(Object.keys(i18nInstance.store.data), ["fa"]);
    assert.equal(storage.get("userLanguage"), "fa");
    assert.deepEqual(globalThis.document.documentElement, { lang: "fa", dir: "rtl" });

    // Old JS clients may still pass a locale argument; it cannot change the UI.
    await setLanguage("fr");
    assert.equal(i18nInstance.language, "fa");
    assert.equal(i18nInstance.t("language"), "زبان");

    globalThis.window.localStorage.setItem = () => {
      throw new Error("Storage disabled");
    };
    await assert.doesNotReject(setLanguage());
    assert.equal(i18nInstance.language, "fa");
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
