import { Navigate, useNavigate, useParams } from "react-router";
import { Button, PageHeader } from "../components";
import { EngineRecordForm } from "./record-form";

const pages: Record<string, { title: string; path: string }> = {
  ticket: { title: "کار پروژه", path: "/issues" },
  task: { title: "وظیفه", path: "/my-work" },
  project: { title: "پروژه", path: "/projects" },
  leave: { title: "عدم حضور", path: "/absences" },
};
export default function NativeFormPage() {
  const { code = "", recordId = "" } = useParams(),
    navigate = useNavigate();
  const page = pages[code];
  if (!page) return <Navigate to="/" replace />;
  const back = () => navigate(page.path);
  return (
    <div className="panel native-form-page">
      <PageHeader
        title={`فرم ${page.title}`}
        actions={
          <Button variant="secondary" onClick={back}>
            بازگشت
          </Button>
        }
      />
      <EngineRecordForm code={code} id={recordId} onSaved={back} onCancel={back} />
    </div>
  );
}
