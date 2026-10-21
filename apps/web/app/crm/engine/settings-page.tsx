import { PageHeader } from "../components";
import { useWorkspaceAccess } from "../api";
import { PageStudio } from "./page-studio";

export default function EngineSettingsPage() {
  const { data: access } = useWorkspaceAccess();
  return (
    <div className="engine-settings">
      <PageHeader
        title="طراحی فرم‌ها و جدول‌ها"
        description="صفحه را انتخاب کنید و فیلدها، ستون‌ها و تب‌های جدول آن را تغییر دهید."
      />
      {access?.can("FormLayout.Edit") ? <PageStudio /> : <p role="alert">مجوز تغییر فرم‌ها را ندارید.</p>}
    </div>
  );
}
