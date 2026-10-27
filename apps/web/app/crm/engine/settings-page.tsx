import { PageHeader, Skeleton } from "../components";
import { useWorkspaceAccess } from "../api";
import { DesignWorkspace } from "./design-workspace";

export default function EngineSettingsPage() {
  const { data: access, isLoading } = useWorkspaceAccess();
  return (
    <div className="engine-settings">
      <PageHeader
        eyebrow="تنظیمات برنامه"
        title="طراحی فرم‌ها و جدول‌ها"
        description="صفحه را انتخاب کنید و فیلدها، ستون‌ها و تب‌های جدول آن را تغییر دهید."
      />
      {isLoading ? (
        <Skeleton rows={6} />
      ) : access?.can("FormDesigner.View") ? (
        <DesignWorkspace />
      ) : (
        <p role="alert">مجوز مشاهده و تغییر طراحی فرم‌ها را ندارید؛ از مدیر سامانه دسترسی بگیرید.</p>
      )}
    </div>
  );
}
