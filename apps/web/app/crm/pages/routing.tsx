import { DialogTitle } from "@headlessui/react";
import { IdentifierBadge, ModalCore, SearchableSelect } from "@plane/ui";
import { useEffect, useState } from "react";
import { Edit3, GitBranch, Inbox, Plus, XCircle } from "lucide-react";
import {
  useDeactivateTicketRoutingRule,
  useOrganizationRoles,
  useOrganizationUnits,
  useSaveTicketRoutingRule,
  useTicketRoutingRules,
  useWorkspaceAccess,
} from "../api";
import { Button, EmptyState, PageHeader, SearchBox, Skeleton } from "../components";
import { useUIStore } from "../store";
import type { TicketRoutingRule } from "../types";
import { RoleQueue } from "../role-queue";
import { Navigate, useSearchParams } from "react-router";
import { matchesRecordSearch } from "../identifiers";

type RuleForm = Pick<TicketRoutingRule, "name" | "unitId" | "requiredRoleId" | "isActive"> & {
  id?: string;
};

export default function RoutingPage() {
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const setFormDirty = useUIStore((state) => state.setFormDirty);
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  const canManage = access?.can("Routing.Manage") === true;
  const { data: rules = [], isLoading: rulesLoading } = useTicketRoutingRules(
    undefined,
    access?.can("Routing.View") ?? false
  );
  const { data: units = [] } = useOrganizationUnits(undefined, canManage);
  const { data: roles = [] } = useOrganizationRoles(undefined, canManage);
  const saveRule = useSaveTicketRoutingRule(slug);
  const deactivateRule = useDeactivateTicketRoutingRule(slug);
  const [editing, setEditing] = useState<RuleForm>();
  const [query, setQuery] = useState("");
  const [params] = useSearchParams();
  const searchParam = params.get("search") ?? "";
  useEffect(() => setQuery(searchParam), [searchParam]);
  const visibleRules = rules.filter((rule) =>
    matchesRecordSearch(query, [rule.id, rule.unitId, rule.requiredRoleId, rule.name, rule.unitTitle, rule.roleName])
  );

  useEffect(() => {
    setFormDirty("ticket-routing-rule", Boolean(editing));
    return () => setFormDirty("ticket-routing-rule", false);
  }, [editing, setFormDirty]);

  if (accessLoading) return <Skeleton rows={6} />;
  if (!access?.can("Routing.Queue.View")) return <Navigate to="/my-work" replace />;

  return (
    <div>
      <PageHeader
        eyebrow="گردش کار سازمانی"
        title="صف کارها و ارجاع"
        description="کارهای منتظر پذیرش را پیدا کنید و مسئولیت کار مرتبط با نقش خود را بپذیرید."
        actions={
          canManage ? (
            <Button
              icon={Plus}
              onClick={() => setEditing({ name: "", unitId: "", requiredRoleId: "", isActive: true })}
            >
              قانون جدید
            </Button>
          ) : undefined
        }
      />

      <RoleQueue
        canClaim={access.can("Routing.Queue.Claim")}
        canViewAll={access.can("Routing.Queue.ViewAll")}
        canViewProject={access.can("Project.View")}
      />

      {canManage && (
        <section className="management-section">
          <header className="section-heading">
            <div>
              <h2>قانون‌های ارجاع</h2>
              <p>قانون‌های قابل انتخاب هنگام ساخت تیکت پروژه.</p>
            </div>
          </header>
          <SearchBox value={query} onChange={setQuery} placeholder="جستجوی شناسه یا نام قانون ارجاع…" />
          <div className="table-card organization-table">
            {rulesLoading ? (
              <Skeleton rows={4} />
            ) : !visibleRules.length ? (
              <EmptyState
                title={rules.length ? "قانونی پیدا نشد" : "قانونی تعریف نشده"}
                description={rules.length ? "عبارت جست‌وجو را بررسی کنید." : "برای اتصال واحد و نقش یک قانون بسازید."}
              />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>نام</th>
                    <th>واحد شروع</th>
                    <th>نقش مورد نیاز</th>
                    <th>وضعیت</th>
                    <th>عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRules.map((rule) => (
                    <tr key={rule.id}>
                      <td>
                        <span className="role-title">
                          <GitBranch size={17} />
                          {rule.name}
                        </span>
                        <IdentifierBadge value={rule.id} label="شناسه قانون ارجاع" />
                      </td>
                      <td>{rule.unitTitle}</td>
                      <td>{rule.roleName}</td>
                      <td>
                        <span className={`state-pill ${rule.isActive ? "is-on" : "is-off"}`}>
                          {rule.isActive ? "فعال" : "غیرفعال"}
                        </span>
                      </td>
                      <td className="row-actions">
                        <button onClick={() => setEditing(rule)} title="ویرایش">
                          <Edit3 size={16} />
                        </button>
                        {rule.isActive && (
                          <button onClick={() => deactivateRule.mutate(rule.id)} title="غیرفعال‌کردن">
                            <XCircle size={16} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      )}

      {editing && (
        <ModalCore
          isOpen
          className="create-modal organization-modal"
          handleClose={() => {
            if (!saveRule.isPending) setEditing(undefined);
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (saveRule.isPending) return;
              saveRule.mutate(editing, { onSuccess: () => setEditing(undefined) });
            }}
          >
            <header>
              <div>
                <span className="modal-kicker">ارجاع کارها</span>
                <DialogTitle as="h2">{editing.id ? "ویرایش قانون" : "قانون جدید"}</DialogTitle>
              </div>
              <Inbox size={22} />
            </header>
            <label>
              <span>نام قانون</span>
              <input
                value={editing.name}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                required
                disabled={saveRule.isPending}
              />
            </label>
            <label htmlFor="crm-routing-select-1">
              <span>واحد شروع</span>
              <SearchableSelect
                id="crm-routing-select-1"
                label="واحد شروع"
                value={editing.unitId}
                onChange={(unitId) => setEditing({ ...editing, unitId })}
                disabled={saveRule.isPending}
                options={units.map((unit) => ({ id: unit.id, title: unit.title, disabled: !unit.isActive }))}
              />
            </label>
            <label htmlFor="crm-routing-select-2">
              <span>نقش مورد نیاز</span>
              <SearchableSelect
                id="crm-routing-select-2"
                label="نقش مورد نیاز"
                value={editing.requiredRoleId}
                onChange={(requiredRoleId) => setEditing({ ...editing, requiredRoleId })}
                disabled={saveRule.isPending}
                options={roles.map((role) => ({
                  id: role.id,
                  title: role.name,
                  description: role.description,
                  disabled: !role.isActive,
                }))}
              />
            </label>
            <label className="active-toggle">
              <input
                type="checkbox"
                disabled={saveRule.isPending}
                checked={editing.isActive}
                onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })}
              />
              <span>قانون فعال باشد</span>
            </label>
            {saveRule.isError && <p role="alert">عملیات انجام نشد؛ اطلاعات واردشده را بررسی و دوباره تلاش کنید.</p>}
            <footer>
              <Button variant="secondary" disabled={saveRule.isPending} onClick={() => setEditing(undefined)}>
                انصراف
              </Button>
              <Button
                type="submit"
                disabled={saveRule.isPending || !editing.name.trim() || !editing.unitId || !editing.requiredRoleId}
              >
                ذخیره قانون
              </Button>
            </footer>
          </form>
        </ModalCore>
      )}
    </div>
  );
}
