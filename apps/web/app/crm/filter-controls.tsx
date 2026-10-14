import { useId, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { CompactMultiSelector, FilterDialog, PersianDatePicker, SearchableSelect } from "@plane/ui";
import {
  deadlineFilterError,
  emptyIssueFilters,
  emptyProjectFilters,
  filterIssues,
  filterProjects,
  projectFilterError,
  UNASSIGNED,
  WORKSPACE_TASKS,
} from "./filter-rules";
import type { DeadlineFilters, DeadlineMode, IssueFilters, ProjectFilters, ProjectTab } from "./filter-rules";
import type { Issue, Member, Priority, Project, Status } from "./types";
import { priorityFa, statusFa, toFa } from "./utils";

export function DataFilterButton({ count, open, onClick }: { count: number; open: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`filter-button ${count ? "has-filters" : ""}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onClick}
    >
      <SlidersHorizontal size={16} aria-hidden="true" /> فیلتر
      {count > 0 && <span aria-label={`${toFa(count)} فیلتر فعال`}>{toFa(count)}</span>}
    </button>
  );
}

function DeadlineFields({
  value,
  onChange,
  timeZone,
}: {
  value: DeadlineFilters;
  onChange: (value: Partial<DeadlineFilters>) => void;
  timeZone?: string;
}) {
  const id = useId();
  const noDate = value.deadline === "no-date";
  return (
    <fieldset className="data-filter-deadline">
      <legend>موعد</legend>
      <SearchableSelect
        label="وضعیت موعد"
        value={value.deadline}
        onChange={(deadline) =>
          onChange({
            deadline: deadline as DeadlineMode,
            ...(deadline === "no-date" ? { dueFrom: "", dueTo: "" } : {}),
          })
        }
        options={[
          { id: "all", title: "همه موعدها" },
          { id: "with-date", title: "دارای موعد" },
          { id: "overdue", title: "موعد گذشته و انجام‌نشده" },
          { id: "today", title: "موعد امروز" },
          { id: "upcoming", title: "موعد پس از امروز" },
          { id: "no-date", title: "بدون موعد" },
        ]}
      />
      <div className="data-filter-grid">
        <div className="data-filter-field">
          <label htmlFor={`${id}-from`}>از تاریخ (شمسی)</label>
          <PersianDatePicker
            id={`${id}-from`}
            label="موعد از تاریخ"
            value={value.dueFrom}
            onChange={(dueFrom) => onChange({ dueFrom })}
            max={value.dueTo || undefined}
            disabled={noDate}
            timeZone={timeZone}
          />
        </div>
        <div className="data-filter-field">
          <label htmlFor={`${id}-to`}>تا تاریخ (شمسی)</label>
          <PersianDatePicker
            id={`${id}-to`}
            label="موعد تا تاریخ"
            value={value.dueTo}
            onChange={(dueTo) => onChange({ dueTo })}
            min={value.dueFrom || undefined}
            disabled={noDate}
            timeZone={timeZone}
          />
        </div>
      </div>
    </fieldset>
  );
}

const memberOptions = (members: Member[]) =>
  [...new Map(members.map((member) => [member.id, member])).values()].map((member) => ({
    id: member.id,
    title: member.displayName,
    description: member.email,
    initials: member.initials,
    avatarUrl: member.avatarUrl,
  }));

export function IssueFilterDialog({
  filters,
  issues,
  projects,
  members,
  query,
  today,
  timeZone,
  loading,
  onClose,
  onApply,
}: {
  filters: IssueFilters;
  issues: Issue[];
  projects: Project[];
  members: Member[];
  query: string;
  today: string;
  timeZone?: string;
  loading: boolean;
  onClose: () => void;
  onApply: (filters: IssueFilters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  const statuses = Object.keys(statusFa) as Status[];
  const priorities = Object.keys(priorityFa) as Priority[];
  return (
    <FilterDialog
      isOpen
      title="فیلتر کارها"
      description="فیلترهای بخش‌های مختلف هم‌زمان اعمال می‌شوند. جستجوی صفحه نیز در نتایج لحاظ می‌شود."
      resultCount={filterIssues(issues, draft, query, today, timeZone).length}
      resultLabel="کار مطابق انتخاب‌ها"
      validationMessage={deadlineFilterError(draft)}
      loading={loading}
      onClose={onClose}
      onApply={() => onApply(draft)}
      onReset={() => setDraft(emptyIssueFilters())}
    >
      <p className="data-filter-help">
        با انتخاب چند گزینه در یک بخش، نتایج مربوط به هرکدام نمایش داده می‌شوند. بخش بدون انتخاب، محدودیتی ندارد.
      </p>
      <div className="data-filter-grid">
        <CompactMultiSelector
          label="وضعیت"
          selected={draft.statuses}
          onChange={(ids) => setDraft({ ...draft, statuses: statuses.filter((id) => ids.includes(id)) })}
          options={statuses.map((id) => ({ id, title: statusFa[id] }))}
        />
        <CompactMultiSelector
          label="اولویت"
          selected={draft.priorities}
          onChange={(ids) => setDraft({ ...draft, priorities: priorities.filter((id) => ids.includes(id)) })}
          options={priorities.map((id) => ({ id, title: priorityFa[id] }))}
        />
        <CompactMultiSelector
          label="پروژه"
          selected={draft.projectIds}
          onChange={(projectIds) => setDraft({ ...draft, projectIds })}
          options={[
            { id: WORKSPACE_TASKS, title: "خارج از پروژه" },
            ...projects.map((project) => ({ id: project.id, title: project.name, description: project.identifier })),
          ]}
        />
        <CompactMultiSelector
          label="مسئول"
          selected={draft.assigneeIds}
          onChange={(assigneeIds) => setDraft({ ...draft, assigneeIds })}
          options={[
            { id: UNASSIGNED, title: "بدون مسئول" },
            ...memberOptions([...members, ...issues.flatMap((issue) => (issue.assignee ? [issue.assignee] : []))]),
          ]}
        />
      </div>
      <DeadlineFields value={draft} onChange={(values) => setDraft({ ...draft, ...values })} timeZone={timeZone} />
    </FilterDialog>
  );
}

export function ProjectFilterDialog({
  filters,
  projects,
  members,
  query,
  tab,
  tabLabel,
  today,
  timeZone,
  loading,
  onClose,
  onApply,
}: {
  filters: ProjectFilters;
  projects: Project[];
  members: Member[];
  query: string;
  tab: ProjectTab;
  tabLabel: string;
  today: string;
  timeZone?: string;
  loading: boolean;
  onClose: () => void;
  onApply: (filters: ProjectFilters) => void;
}) {
  const [draft, setDraft] = useState(filters);
  const id = useId();
  return (
    <FilterDialog
      isOpen
      title="فیلتر پروژه‌ها"
      description={`نتایج در تب «${tabLabel}» و با توجه به جستجوی صفحه نمایش داده می‌شوند.`}
      resultCount={filterProjects(projects, draft, query, tab, today, timeZone).length}
      resultLabel="پروژه مطابق انتخاب‌ها"
      validationMessage={projectFilterError(draft)}
      loading={loading}
      onClose={onClose}
      onApply={() => onApply(draft)}
      onReset={() => setDraft(emptyProjectFilters())}
    >
      <p className="data-filter-help">
        با انتخاب چند گزینه در یک بخش، نتایج مربوط به هرکدام نمایش داده می‌شوند. بخش‌های مختلف هم‌زمان اعمال می‌شوند و بخش
        بدون انتخاب، محدودیتی ندارد.
      </p>
      <div className="data-filter-grid">
        <CompactMultiSelector
          label="اعضای پروژه"
          selected={draft.memberIds}
          onChange={(memberIds) => setDraft({ ...draft, memberIds })}
          options={memberOptions(members)}
        />
        <CompactMultiSelector
          label="مدیر پروژه"
          selected={draft.leadIds}
          onChange={(leadIds) => setDraft({ ...draft, leadIds })}
          options={[
            { id: UNASSIGNED, title: "بدون مدیر" },
            ...memberOptions([
              ...members,
              ...projects.flatMap((project) => (project.projectLead ? [project.projectLead] : [])),
            ]),
          ]}
        />
      </div>
      <fieldset className="data-filter-progress">
        <legend>درصد پیشرفت</legend>
        <div className="data-filter-grid">
          <div className="data-filter-field">
            <label htmlFor={`${id}-min`}>حداقل پیشرفت (درصد)</label>
            <input
              id={`${id}-min`}
              type="number"
              min={0}
              max={100}
              step={1}
              placeholder="۰"
              value={draft.progressMin}
              onChange={(event) => setDraft({ ...draft, progressMin: event.target.value })}
            />
          </div>
          <div className="data-filter-field">
            <label htmlFor={`${id}-max`}>حداکثر پیشرفت (درصد)</label>
            <input
              id={`${id}-max`}
              type="number"
              min={0}
              max={100}
              step={1}
              placeholder="۱۰۰"
              value={draft.progressMax}
              onChange={(event) => setDraft({ ...draft, progressMax: event.target.value })}
            />
          </div>
        </div>
      </fieldset>
      <DeadlineFields value={draft} onChange={(values) => setDraft({ ...draft, ...values })} timeZone={timeZone} />
    </FilterDialog>
  );
}
