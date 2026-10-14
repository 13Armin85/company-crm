import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { copyIdentifier, IdentifierBadge } from "@plane/ui";
import { issueReference, matchesRecordSearch, organizationSearchIds } from "./identifiers";
import { emptyIssueFilters, emptyProjectFilters, filterIssues, filterProjects } from "./filter-rules";
import { filterRoleQueue } from "./role-queue-model";
import type { Issue, OrganizationUnit, Project, TicketRoleQueueEntry } from "./types";

const recordId = "0231611b-04f3-4d58-beb6-ffb09951d9af";
const issue: Issue = {
  id: recordId,
  name: "کار",
  scope: "workspace",
  projectIdentifier: "TEAM",
  sequenceId: 12,
  status: "Todo",
  priority: "None",
};
const project: Project = { id: recordId, name: "پروژه", identifier: "PRJ000001" };
const unit = (id: string, parentId?: string): OrganizationUnit => ({
  id,
  title: id,
  parentId,
  isActive: true,
  memberIds: [],
});

afterEach(() => vi.unstubAllGlobals());

describe("record identifiers", () => {
  it("uses the same workspace reference for display and search", () => {
    expect(issueReference(issue)).toBe("TEAM-12");
    expect(filterIssues([issue], emptyIssueFilters(), "team - ۱۲", "2026-10-15")).toEqual([issue]);
    expect(issueReference({ ...issue, scope: "project", projectIdentifier: "PRJ000001" })).toBe("PRJ000001-12");
  });
  it("finds records by their full UUID in project and task lists", () => {
    expect(filterIssues([issue], emptyIssueFilters(), recordId.toUpperCase(), "2026-10-15")).toEqual([issue]);
    expect(filterProjects([project], emptyProjectFilters(), recordId, "all", "2026-10-15")).toEqual([project]);
    expect(filterProjects([project], emptyProjectFilters(), "prj۰۰۰۰۰۱", "all", "2026-10-15")).toEqual([project]);
  });
  it("normalizes Persian digits and Arabic letters without matching unrelated identifiers", () => {
    expect(matchesRecordSearch("TEAM-١٢", ["TEAM-12"])).toBe(true);
    expect(matchesRecordSearch("پیگیری", ["پيگيري"])).toBe(true);
    expect(matchesRecordSearch(recordId, ["other-id", undefined])).toBe(false);
  });
  it("reveals the parents of a matching nested organization unit", () => {
    const units = [unit("root"), unit("parent", "root"), unit(recordId, "parent"), unit("sibling", "root")];
    expect([...organizationSearchIds(units, recordId)]).toEqual([recordId, "parent", "root"]);
    expect(organizationSearchIds(units, "unknown").size).toBe(0);
    expect(organizationSearchIds(units, "").size).toBe(4);
  });
  it("terminates when imported organizational data has a parent cycle", () => {
    expect([...organizationSearchIds([unit("a", "b"), unit("b", "a")], "a")]).toEqual(["a", "b"]);
  });
  it("finds queued work by UUID or the actual ticket reference", () => {
    const entry: TicketRoleQueueEntry = {
      id: "queue-id",
      issueId: recordId,
      issueIdentifier: "PRJ000001-12",
      issueName: "کار",
      projectId: "project-id",
      projectName: "پروژه",
      ruleId: "rule-id",
      ruleName: "قانون",
      requiredRoleId: "role-id",
      roleName: "نقش",
      status: "open",
    };
    for (const search of [recordId, "prj۰۰۰۰۰۱-۱۲", "queue-id"]) {
      expect(filterRoleQueue([entry], { search, roleId: "", projectId: "", sort: "oldest" })).toEqual([entry]);
    }
  });
  it("shows a selectable full identifier with an accessible copy action", () => {
    const html = renderToStaticMarkup(<IdentifierBadge value={recordId} label="شناسه کاربر" />);
    expect(html).toContain(`aria-label="کپی شناسه کاربر: ${recordId}"`);
    expect(html).toContain(`<span dir="ltr">${recordId}</span>`);
    expect(html).toContain('type="button"');
  });
  it("copies the complete stored identifier without changing its digits or case", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await copyIdentifier(recordId);
    expect(writeText).toHaveBeenCalledWith(recordId);
  });
  it("reports clipboard denial instead of claiming the identifier was copied", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    await expect(copyIdentifier(recordId)).rejects.toThrow("denied");
  });
  it("supports clipboard fallback on HTTP and restores focus even on failure", async () => {
    const input = { value: "", style: {}, select: vi.fn(), remove: vi.fn() };
    const focus = vi.fn();
    const execCommand = vi.fn().mockReturnValue(false);
    vi.stubGlobal("navigator", {});
    vi.stubGlobal("document", {
      activeElement: { focus },
      createElement: () => input,
      body: { append: vi.fn() },
      execCommand,
    });
    await expect(copyIdentifier(recordId)).rejects.toThrow("Clipboard unavailable");
    expect(input.value).toBe(recordId);
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(input.remove).toHaveBeenCalledOnce();
    expect(focus).toHaveBeenCalledOnce();
  });
});
