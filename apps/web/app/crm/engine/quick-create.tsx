import { useLocation } from "react-router";
import { AccessModal } from "../access/components";
import { useUIStore } from "../store";
import { EngineRecordForm } from "./record-form";

export default function QuickCreate() {
  const location = useLocation(),
    kind = useUIStore((state) => state.createKind),
    close = useUIStore((state) => state.setCreateOpen);
  const projectId = location.pathname.match(/^\/projects\/([^/]+)/)?.[1];
  const code = kind === "project" ? "project" : "ticket";
  return (
    <AccessModal title={kind === "project" ? "پروژه جدید" : "کار جدید"} onClose={() => close(false)}>
      <EngineRecordForm
        code={code}
        initialValues={code === "ticket" && projectId ? { project: projectId } : undefined}
        onSaved={() => close(false)}
        onCancel={() => close(false)}
      />
    </AccessModal>
  );
}
