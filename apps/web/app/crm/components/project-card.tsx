/** Project summary card with archive and delete actions. */
import { useDismissMenu } from "../use-dismiss-menu";
import { IdentifierBadge } from "@plane/ui";
import { useState } from "react";
import { Link } from "react-router";
import { Clock3, Trash2 } from "lucide-react";
import { useArchiveProject, useDeleteProject, useWorkspaceAccess } from "../api";
import { useUIStore } from "../store";
import type { Project } from "../types";
import { persianDate, toFa } from "../utils";
import { AvatarStack } from "./primitives";

export function ProjectCard({ project }: { project: Project }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useDismissMenu(menuOpen, () => setMenuOpen(false));
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const { data: access } = useWorkspaceAccess();
  const canEdit = access?.can("Project.Edit") === true;
  const canDelete = access?.can("Project.Delete") === true;
  const archiveProject = useArchiveProject(slug, project.id, Boolean(project.archivedAt));
  const deleteProject = useDeleteProject(slug, project.id);
  return (
    <article className="project-card">
      <div className="project-card-head">
        <span className="project-symbol" style={{ background: `${project.color}18`, color: project.color }}>
          {project.identifier.slice(0, 1)}
        </span>
        <div className="menu-anchor" ref={menuRef}>
          {(canEdit || canDelete) && (
            <button
              className="plain-icon"
              aria-label="منوی پروژه"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((value) => !value)}
            >
              •••
            </button>
          )}
          {(canEdit || canDelete) && menuOpen && (
            <div className="action-menu">
              {canEdit && !project.archivedAt && <Link to={`/projects/${project.id}?tab=settings`}>ویرایش پروژه</Link>}
              {canEdit && (
                <button
                  onClick={() => {
                    archiveProject.mutate();
                    setMenuOpen(false);
                  }}
                >
                  {project.archivedAt ? "خروج از بایگانی" : "بایگانی پروژه"}
                </button>
              )}
              {canDelete && (
                <button
                  className="danger-action"
                  disabled={deleteProject.isPending}
                  onClick={() => {
                    if (window.confirm(`پروژه «${project.name}» و همه اطلاعات وابسته به آن حذف شود؟`)) {
                      deleteProject.mutate();
                    }
                    setMenuOpen(false);
                  }}
                >
                  <Trash2 size={15} /> حذف پروژه
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <Link to={project.archivedAt ? "/projects" : `/projects/${project.id}`} className="project-card-link">
        <h3>{project.name}</h3>
        <p>{project.description || "توضیحی برای این پروژه ثبت نشده است."}</p>
        <div className="project-progress-label">
          <span>{toFa(project.progress ?? 0)}٪ پیشرفت</span>
          <span>
            {toFa(project.completedIssues ?? 0)} از {toFa(project.totalIssues ?? 0)} کار
          </span>
        </div>
        <div className="progress">
          <i style={{ width: `${project.progress ?? 0}%`, background: project.color }} />
        </div>
        <footer>
          <AvatarStack members={project.members} />
          <span>
            <Clock3 size={14} /> {persianDate(project.targetDate)}
          </span>
        </footer>
      </Link>
      <IdentifierBadge value={project.identifier} label="شناسه پروژه" />
    </article>
  );
}
