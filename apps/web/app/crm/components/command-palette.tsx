/** Global command palette for quick navigation and search. */
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { CheckCircle2, CircleDot, FolderKanban, Inbox, Search, Sparkles } from "lucide-react";
import {
  useIssues,
  useMembers,
  useOrganizationRoles,
  useOrganizationUnits,
  useProjects,
  useTicketRoutingRules,
  useWorkspaceAccess,
} from "../api";
import { useUIStore } from "../store";
import { issueReference, matchesRecordSearch } from "../identifiers";

const commands = [
  { label: "رفتن به خانه", hint: "G H", path: "/", icon: Sparkles },
  { label: "مشاهده پروژه‌ها", hint: "G P", path: "/projects", icon: FolderKanban },
  { label: "کارهای من", hint: "G M", path: "/my-work", icon: CheckCircle2 },
  { label: "صندوق ورودی", hint: "", path: "/inbox", icon: Inbox },
];
export function CommandPalette() {
  const open = useUIStore((state) => state.commandOpen);
  const setOpen = useUIStore((state) => state.setCommandOpen);
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const { data: projects = [] } = useProjects();
  // Every project's issues are only needed while the palette is open.
  const { data: issues = [] } = useIssues(undefined, undefined, open);
  const { data: access } = useWorkspaceAccess();
  const { data: members = [] } = useMembers(undefined, undefined, open && access?.can("User.View") === true);
  const { data: roles = [] } = useOrganizationRoles(undefined, open && access?.can("Role.View") === true);
  const { data: units = [] } = useOrganizationUnits(undefined, open && access?.can("OrganizationUnit.View") === true);
  const { data: rules = [] } = useTicketRoutingRules(undefined, open && access?.can("Routing.View") === true);
  const filtered = commands.filter((item) => matchesRecordSearch(query, [item.label]));
  const projectResults = query.trim()
    ? projects
        .filter((project) => matchesRecordSearch(query, [project.id, project.name, project.identifier]))
        .slice(0, 5)
    : [];
  const issueResults = query.trim()
    ? issues.filter((issue) => matchesRecordSearch(query, [issue.id, issue.name, issueReference(issue)])).slice(0, 5)
    : [];
  const recordResults = query.trim()
    ? [
        ...(access?.can("User.View")
          ? members
              .filter((member) =>
                matchesRecordSearch(query, [member.id, member.membershipId, member.displayName, member.email])
              )
              .map((member) => ({ id: member.id, name: `کاربر: ${member.displayName}`, path: `/team/${member.id}` }))
          : []),
        ...(access?.can("Role.View")
          ? roles
              .filter((role) => matchesRecordSearch(query, [role.id, role.name, role.description]))
              .map((role) => ({
                id: role.id,
                name: `نقش: ${role.name}`,
                path: `/roles?search=${encodeURIComponent(role.id)}`,
              }))
          : []),
        ...(access?.can("OrganizationUnit.View")
          ? units
              .filter((unit) => matchesRecordSearch(query, [unit.id, unit.title]))
              .map((unit) => ({
                id: unit.id,
                name: `واحد: ${unit.title}`,
                path: `/organization?search=${encodeURIComponent(unit.id)}`,
              }))
          : []),
        ...(access?.can("Routing.Manage")
          ? rules
              .filter((rule) => matchesRecordSearch(query, [rule.id, rule.name]))
              .map((rule) => ({
                id: rule.id,
                name: `ارجاع: ${rule.name}`,
                path: `/routing?search=${encodeURIComponent(rule.id)}`,
              }))
          : []),
      ].slice(0, 10)
    : [];
  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="modal-layer"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}
    >
      <section className="command-modal">
        <div className="command-input">
          <Search size={20} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="جستجو یا اجرای یک دستور..."
          />
          <kbd>ESC</kbd>
        </div>
        <div className="command-results">
          <small>پیشنهادها</small>
          {filtered.map(({ label, hint, path, icon: Icon }) => (
            <button
              key={path}
              onClick={() => {
                navigate(path);
                setOpen(false);
              }}
            >
              <Icon size={18} />
              <span>{label}</span>
              {hint && <kbd>{hint}</kbd>}
            </button>
          ))}
          {projectResults.length > 0 && <small>پروژه‌ها</small>}
          {projectResults.map((project) => (
            <button
              key={`project-${project.id}`}
              onClick={() => {
                navigate(`/projects/${project.id}`);
                setOpen(false);
              }}
            >
              <FolderKanban size={18} />
              <span>{project.name}</span>
              <kbd>{project.identifier}</kbd>
            </button>
          ))}
          {issueResults.length > 0 && <small>کارها</small>}
          {issueResults.map((issue) => (
            <button
              key={`issue-${issue.id}`}
              onClick={() => {
                navigate(issue.projectId ? `/projects/${issue.projectId}?tab=issues` : "/my-work");
                setOpen(false);
              }}
            >
              <CircleDot size={18} />
              <span>{issue.name}</span>
              <kbd>{issueReference(issue)}</kbd>
            </button>
          ))}
          {recordResults.length > 0 && <small>سازمان</small>}
          {recordResults.map((record) => (
            <button
              key={record.path}
              onClick={() => {
                navigate(record.path);
                setOpen(false);
              }}
            >
              <Search size={18} />
              <span>{record.name}</span>
              <kbd dir="ltr" title={record.id}>
                {record.id}
              </kbd>
            </button>
          ))}
          {query.trim() &&
            !filtered.length &&
            !projectResults.length &&
            !issueResults.length &&
            !recordResults.length && <p className="command-empty">نتیجه‌ای در داده‌های فضای کاری پیدا نشد.</p>}
        </div>
        <footer>
          <span>
            <b>↑↓</b> پیمایش
          </span>
          <span>
            <b>Enter</b> انتخاب
          </span>
          <span>
            <b>Esc</b> بستن
          </span>
        </footer>
      </section>
    </div>
  );
}
