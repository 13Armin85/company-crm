/** Global quick-create modal backed by the entity engine. */
import { lazy, Suspense } from "react";
import { useLocation } from "react-router";
import { useWorkspaceAccess } from "../api";
import { useUIStore } from "../store";
import { Skeleton } from "./primitives";

const EngineQuickCreate = lazy(() => import("../engine/quick-create"));

export function CreateModal() {
  const open = useUIStore((state) => state.createOpen);
  const createKind = useUIStore((state) => state.createKind);
  const location = useLocation();
  const { data: access } = useWorkspaceAccess();
  if (
    !open ||
    !access?.can(createKind === "project" ? "Project.Create" : "Issue.Create") ||
    (createKind !== "project" && location.pathname.replace(/\/+$/, "") === "/my-work")
  )
    return null;
  return (
    <Suspense fallback={<Skeleton rows={3} />}>
      <EngineQuickCreate />
    </Suspense>
  );
}
