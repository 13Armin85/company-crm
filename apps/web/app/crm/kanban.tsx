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
}: {
  issue: Issue;
  transferMembers?: Member[];
  transferDisabled?: boolean;
  onAssigneeChange?: (issue: Issue, assigneeId: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: issue.id,
    data: { issue },
  });
  return (
    <article
      ref={setNodeRef}
      className={`kanban-card ${isDragging ? "dragging" : ""}`}
      style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined }}
      {...listeners}
      {...attributes}
    >
      <div className="kanban-card-top">
        <span dir="ltr">
          {issue.projectIdentifier}-{toFa(issue.sequenceId)}
        </span>
        <GripVertical size={16} />
      </div>
      <h3>{issue.name}</h3>
      <div className="label-row">
        {issue.labels?.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      {onAssigneeChange && transferMembers && transferMembers.length > 1 && (
        <label className="kanban-transfer-control" onPointerDown={(event) => event.stopPropagation()}>
          <span>واگذاری به</span>
          <select
            aria-label={`واگذاری ${issue.name} به عضو دیگر`}
            value={issue.assignee?.id ?? ""}
            disabled={transferDisabled}
            onChange={(event) => {
              if (event.target.value && event.target.value !== issue.assignee?.id) {
                onAssigneeChange(issue, event.target.value);
              }
            }}
          >
            {transferMembers.map((member) => (
              <option key={member.id} value={member.id}>
                {member.displayName}
              </option>
            ))}
          </select>
        </label>
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
}: {
  id: Status;
  color: string;
  issues: Issue[];
  onCreate?: () => void;
  transferMembers?: Member[];
  transferDisabled?: boolean;
  onAssigneeChange?: (issue: Issue, assigneeId: string) => void;
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
          />
        ))}
        {!issues.length && <p className="column-empty">کار را اینجا رها کنید</p>}
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
}: {
  issues: Issue[];
  onStatusChange: (issue: Issue, status: Status) => void;
  onCreate?: () => void;
  transferMembers?: Member[];
  transferDisabled?: boolean;
  onAssigneeChange?: (issue: Issue, assigneeId: string) => void;
}) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const dragEnd = ({ active, over }: DragEndEvent) => {
    const issue = active.data.current?.issue as Issue | undefined;
    const status = statusFromDropTarget(over?.id);
    if (issue && status && issue.status !== status) onStatusChange(issue, status);
  };

  return (
    <DndContext sensors={sensors} onDragEnd={dragEnd}>
      <div className="kanban-board">
        {ISSUE_STATUS_COLUMNS.map((column) => (
          <KanbanColumn
            key={column.id}
            {...column}
            issues={issues.filter((issue) => issue.status === column.id)}
            onCreate={onCreate}
            transferMembers={transferMembers}
            transferDisabled={transferDisabled}
            onAssigneeChange={onAssigneeChange}
          />
        ))}
      </div>
    </DndContext>
  );
}
