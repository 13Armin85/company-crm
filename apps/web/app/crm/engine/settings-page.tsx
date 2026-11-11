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
        description="بخش را انتخاب کنید و فرم یا جدول آن را تنظیم کنید."
      />
      {isLoading ? (
        <Skeleton rows={6} />
      ) : access?.can("FormDesigner.View") ? (
        <DesignWorkspace />
      ) : (
        <p role="status">برای طراحی فرم‌ها و جدول‌ها از مدیر سامانه دسترسی بگیرید.</p>
      )}
    </div>
  );
}
