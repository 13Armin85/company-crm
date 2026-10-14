import { SearchableSelect } from "@plane/ui";
import { useState } from "react";
import { Plus } from "lucide-react";
import { useCurrentUser, useIssues, useProjects, useWorkspaceAccess } from "../api";
import { Button, PageHeader } from "../components";
import { IssueCalendar } from "../issue-calendar";
import { useUIStore } from "../store";

export default function CalendarPage() {
  const { data: currentUser } = useCurrentUser();
  const [projectFilter, setProjectFilter] = useState("all");
  const setCreate = useUIStore((state) => state.setCreateOpen);
  const { data: issues = [], isLoading } = useIssues();
  const { data: projects = [] } = useProjects();
  const { data: access } = useWorkspaceAccess();
  return (
    <div>
      <PageHeader
        eyebrow="برنامه تیم"
        title="تقویم"
        description="موعدهای واقعی کارها در همه پروژه‌ها"
        actions={
          access?.can("Issue.Create") ? (
            <Button icon={Plus} onClick={() => setCreate(true, "issue")}>
              کار جدید
            </Button>
          ) : undefined
        }
      />
      <IssueCalendar
        issues={issues.filter((issue) => projectFilter === "all" || issue.projectId === projectFilter)}
        projects={projects}
        timeZone={currentUser?.timeZone}
        isLoading={isLoading}
        toolbarEnd={
          <div className="calendar-project-filter">
            <label htmlFor="calendar-project-filter">نمایش کارهای پروژه</label>
            <SearchableSelect
              id="calendar-project-filter"
              label="فیلتر پروژه"
              value={projectFilter}
              onChange={setProjectFilter}
              options={[
                { id: "all", title: "همه پروژه‌ها" },
                ...projects.map((project) => ({ id: project.id, title: project.name })),
              ]}
            />
          </div>
        }
      />
    </div>
  );
}
