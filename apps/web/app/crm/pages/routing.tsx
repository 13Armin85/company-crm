import { Navigate } from "react-router";
import { useWorkspaceAccess } from "../api";
import { PageHeader, Skeleton } from "../components";
import { RoleQueue } from "../role-queue";
import { RoutingRulesManager, TypeTargets } from "../ticket/routing-rules";

export default function RoutingPage() {
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  if (accessLoading) return <Skeleton rows={6} />;
  if (!access?.can("Routing.Queue.View")) return <Navigate to="/my-work" replace />;
  const canManage = access.can("Routing.Manage");
  return (
    <div>
      <PageHeader
        eyebrow="گردش کار سازمانی"
        title="صف کارها و ارجاع"
        description="کارهای منتظر پذیرش و تیکت‌های بدون مسئول را ببینید؛ مدیران قواعد ارجاع خودکار را به ترتیب اجرا تنظیم می‌کنند."
      />
      <RoleQueue
        canClaim={access.can("Routing.Queue.Claim")}
        canViewAll={access.can("Routing.Queue.ViewAll")}
        canViewProject={access.can("Project.View")}
      />
      <RoutingRulesManager canManage={canManage} />
      {access.can("Ticket.TargetSet") && <TypeTargets />}
    </div>
  );
}
