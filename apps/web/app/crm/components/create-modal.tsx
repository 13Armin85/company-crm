/** Global quick-create modal backed by the entity engine. */
import { lazy, Suspense } from "react";
import { useWorkspaceAccess } from "../api";
import { useUIStore } from "../store";
import { Skeleton } from "./primitives";

const EngineQuickCreate = lazy(() => import("../engine/quick-create"));

export function CreateModal() {
  const open = useUIStore((state) => state.createOpen);
  const createKind = useUIStore((state) => state.createKind);
  const { data: access } = useWorkspaceAccess();
  if (!open || !access?.can(createKind === "project" ? "Project.Create" : "Issue.Create")) return null;
  return (
    <Suspense fallback={<Skeleton rows={3} />}>
      <EngineQuickCreate />
    </Suspense>
  );
}
