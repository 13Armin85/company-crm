import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

test("work update and delete view messages use clear Persian", async () => {
  const [literal, workspace, project] = await Promise.all([
    json("../src/literal-translations/fa.json"),
    json("../src/locales/fa/workspace.json"),
    json("../src/locales/fa/project.json"),
  ]);
  assert.equal(literal["Error while updating work item"], "به‌روزرسانی کار انجام نشد؛ دوباره تلاش کنید.");
  for (const entry of [workspace.workspace_views.delete_view, project.project_views.delete_view]) {
    assert.equal(entry.title, "این نما حذف شود؟");
    assert.match(entry.content, /قابل بازیابی نیست/);
    assert.doesNotMatch(entry.content, /هرگونی/);
  }
});
