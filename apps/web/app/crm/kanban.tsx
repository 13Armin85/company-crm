import { useCurrentUser, useWorkspaceAccess, useProjects, useMembers } from "./api";
import { canChangeIssueStatus, canTransferIssue } from "./task-access";
import { SearchableSelect } from "@plane/ui";
import { DndContext, PointerSensor, useDraggable, useDroppable, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent, UniqueIdentifier } from "@dnd-kit/core";
import { GripVertical, Plus } from "lucide-react";
import { Avatar, PriorityBadge } from "./components";
import type { Issue, Member, Status } from "./types";
import { statusFa, toFa } from "./utils";

export const ISSUE_STATUS_COLUMNS: { id: Status; color: string }[] = [
  { id: "Todo", color: "#9ca3af" },
  { id: "In Progress", color: "#3b82f6" },
  { id: "Review", color: "#8b5cf6" },
  { id: "Done", color: "#10b981" },
  { id: "Blocked", color: "#ef4444" },
];

export const statusFromDropTarget = (id: UniqueIdentifier | undefined): Status | undefined =>
  ISSUE_STATUS_COLUMNS.find((column) => column.id === id)?.id;

function KanbanCard({
  issue,
  transferMembers,
  transferDisabled,
  onAssigneeChange,
  readOnly = false,
  allowTransfer = false,
}: {
  issue: Issue;
  transferMembers?: Member[];
  transferDisabled?: boolean;
  onAssigneeChange?: (issue: Issue, assigneeId: string) => void;
  readOnly?: boolean;
  allowTransfer?: boolean;
}) {
  const { data: user } = useCurrentUser();
  const { data: access } = useWorkspaceAccess();
  const { data: projects = [] } = useProjects();
  const { data: projectMembers = [] } = useMembers(undefined, issue.scope === "project" ? issue.projectId : undefined);
  const eligibleMembers = issue.scope === "project" ? projectMembers : transferMembers;
  const canChangeStatus = !readOnly && canChangeIssueStatus(issue, user?.id, (code) => access?.can(code) === true);
  const canTransfer =
    (!readOnly || allowTransfer) && canTransferIssue(issue, user?.id, (code) => access?.can(code) === true, projects);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: issue.id,
    disabled: !canChangeStatus,
    data: { issue },
  });
  const cardAttributes = { ...attributes, "aria-disabled": !canChangeStatus && !canTransfer };
  return (
    <article
      ref={setNodeRef}
      className={`kanban-card ${isDragging ? "dragging" : ""}`}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
      {...listeners}
      {...cardAttributes}
    >
      <div className="kanban-card-top">
        <span dir="ltr">
          {issue.projectIdentifier}-{toFa(issue.sequenceId)}
        </span>
        <GripVertical size={16} />
      </div>
      <h3>{issue.name}</h3>
      <p className="issue-people">
        فرستنده: {issue.sender?.displayName || "نامشخص"}
        <br />
        مسئول: {issue.assignee?.displayName || "بدون مسئول"}
      </p>
      <div className="label-row">
        {issue.labels?.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      {canTransfer && onAssigneeChange && eligibleMembers && eligibleMembers.length > 1 && (
        <div className="kanban-transfer-control" onPointerDown={(event) => event.stopPropagation()}>
          <label htmlFor={`kanban-transfer-${issue.id}`}>انتقال به شخص دیگر</label>
          <SearchableSelect
            id={`kanban-transfer-${issue.id}`}
            label={`واگذاری ${issue.name} به عضو دیگر`}
            optionClassName="member-transfer-options"
            value={issue.assignee?.id ?? ""}
            selectedLabel={issue.assignee?.displayName ?? "بدون مسئول"}
            placeholder="نام شخص را جستجو کنید"
            disabled={transferDisabled}
            onChange={(id) => {
              if (id && id !== issue.assignee?.id) onAssigneeChange(issue, id);
            }}
            options={eligibleMembers
              .filter((member) => access?.is_admin || member.id !== user?.id)
              .map((member) => ({
                id: member.id,
                title: member.displayName,
                description: member.email,
                disabled: member.isActive === false || member.id === issue.assignee?.id,
              }))}
          />
        </div>
      )}
      <footer>
        <PriorityBadge priority={issue.priority} />
        <Avatar member={issue.assignee} size="sm" />
      </footer>
    </article>
  );
}

function KanbanColumn({
  id,
  color,
  issues,
  onCreate,
  transferMembers,
  transferDisabled,
  onAssigneeChange,
  readOnly = false,
  allowTransfer = false,
}: {
  id: Status;
  color: string;
  issues: Issue[];
  onCreate?: () => void;
  transferMembers?: Member[];
  transferDisabled?: boolean;
  onAssigneeChange?: (issue: Issue, assigneeId: string) => void;
  readOnly?: boolean;
  allowTransfer?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <section ref={setNodeRef} className={`kanban-column ${isOver ? "is-over" : ""}`}>
      <header>
        <span>
          <i style={{ background: color }} />
          {statusFa[id]} <b>{toFa(issues.length)}</b>
        </span>
        {onCreate && (
          <button type="button" onClick={onCreate} aria-label={`افزودن کار به ${statusFa[id]}`}>
            <Plus size={16} />
          </button>
        )}
      </header>
      <div>
        {issues.map((issue) => (
          <KanbanCard
            key={issue.id}
            issue={issue}
            transferMembers={transferMembers}
            transferDisabled={transferDisabled}
            onAssigneeChange={onAssigneeChange}
            readOnly={readOnly}
            allowTransfer={allowTransfer}
          />
        ))}
        {!issues.length && <p className="column-empty">{readOnly ? "کاری وجود ندارد" : "کار را اینجا رها کنید"}</p>}
      </div>
    </section>
  );
}

export function IssueKanbanBoard({
  issues,
  onStatusChange,
  onCreate,
  transferMembers,
  transferDisabled,
  onAssigneeChange,
  readOnly = false,
  allowTransfer = false,
}: {
  issues: Issue[];
  onStatusChange: (issue: Issue, status: Status) => void;
  onCreate?: () => void;
  transferMembers?: Member[];
  transferDisabled?: boolean;
  onAssigneeChange?: (issue: Issue, assigneeId: string) => void;
  readOnly?: boolean;
  allowTransfer?: boolean;
}) {
  const { data: user } = useCurrentUser();
  const { data: access } = useWorkspaceAccess();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const dragEnd = ({ active, over }: DragEndEvent) => {
    const issue = active.data.current?.issue as Issue | undefined;
    const status = statusFromDropTarget(over?.id);
    if (
      !readOnly &&
      issue &&
      status &&
      issue.status !== status &&
      canChangeIssueStatus(issue, user?.id, (code) => access?.can(code) === true)
    )
      onStatusChange(issue, status);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={dragEnd}>
      <div className="kanban-board">
        {ISSUE_STATUS_COLUMNS.map((column) => (
          <KanbanColumn
            key={column.id}
            {...column}
            issues={issues.filter((issue) => issue.status === column.id)}
            onCreate={readOnly ? undefined : onCreate}
            transferMembers={transferMembers}
            transferDisabled={transferDisabled}
            onAssigneeChange={onAssigneeChange}
            readOnly={readOnly}
            allowTransfer={allowTransfer}
          />
        ))}
      </div>
    </DndContext>
  );
}
