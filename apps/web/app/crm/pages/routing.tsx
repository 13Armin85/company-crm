import { useEffect, useState } from "react";
import { Edit3, GitBranch, Inbox, Plus, UserCheck, XCircle } from "lucide-react";
import {
  useClaimTicketRoleQueue,
  useDeactivateTicketRoutingRule,
  useOrganizationRoles,
  useOrganizationUnits,
  useSaveTicketRoutingRule,
  useTicketRoleQueue,
  useTicketRoutingRules,
  useWorkspaceAccess,
} from "../api";
import { Button, EmptyState, PageHeader, Skeleton } from "../components";
import { useUIStore } from "../store";
import type { TicketRoutingRule } from "../types";
import { persianDate, toFa } from "../utils";

type RuleForm = Pick<TicketRoutingRule, "name" | "unitId" | "requiredRoleId" | "requiredLevel" | "isActive"> & {
  id?: string;
};

export default function RoutingPage() {
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const setFormDirty = useUIStore((state) => state.setFormDirty);
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  const isAdmin = access?.isAdmin === true;
  const { data: rules = [], isLoading: rulesLoading } = useTicketRoutingRules(undefined, isAdmin);
  const { data: queue = [], isLoading: queueLoading } = useTicketRoleQueue();
  const { data: units = [] } = useOrganizationUnits(undefined, isAdmin);
  const { data: roles = [] } = useOrganizationRoles(undefined, isAdmin);
  const saveRule = useSaveTicketRoutingRule(slug);
  const deactivateRule = useDeactivateTicketRoutingRule(slug);
  const claimQueue = useClaimTicketRoleQueue(slug);
  const [editing, setEditing] = useState<RuleForm>();

  useEffect(() => {
    setFormDirty("ticket-routing-rule", Boolean(editing));
    return () => setFormDirty("ticket-routing-rule", false);
  }, [editing, setFormDirty]);

  if (accessLoading) return <Skeleton rows={6} />;

  return (
    <div>
      <PageHeader
        eyebrow="گردش کار سازمانی"
        title="ارجاع هوشمند تیکت"
        description="ابتدا مدیر واحد بررسی می‌شود؛ در صورت نبود Role یا Level کافی، مسیر تا والد ادامه می‌یابد و در نهایت تیکت وارد Role Queue می‌شود."
        actions={
          isAdmin ? (
            <Button
              icon={Plus}
              onClick={() => setEditing({ name: "", unitId: "", requiredRoleId: "", requiredLevel: 0, isActive: true })}
            >
              قانون جدید
            </Button>
          ) : undefined
        }
      />

      {isAdmin && (
        <section className="management-section">
          <header className="section-heading">
            <div>
              <h2>Routing Rules</h2>
              <p>قانون‌های قابل انتخاب هنگام ساخت تیکت پروژه.</p>
            </div>
          </header>
          <div className="table-card organization-table">
            {rulesLoading ? (
              <Skeleton rows={4} />
            ) : !rules.length ? (
              <EmptyState title="قانونی تعریف نشده" description="برای اتصال Team، Role و Level یک قانون بسازید." />
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>نام</th>
                    <th>واحد شروع</th>
                    <th>Role مورد نیاز</th>
                    <th>Level</th>
                    <th>وضعیت</th>
                    <th>عملیات</th>
                  </tr>
                </thead>
                <tbody>
                  {rules.map((rule) => (
                    <tr key={rule.id}>
                      <td>
                        <span className="role-title">
                          <GitBranch size={17} />
                          {rule.name}
                        </span>
                      </td>
                      <td>{rule.unitTitle}</td>
                      <td>{rule.roleName}</td>
                      <td>{toFa(rule.requiredLevel)}</td>
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

      <section className="management-section">
        <header className="section-heading">
          <div>
            <h2>Role Queue</h2>
            <p>{isAdmin ? "تیکت‌های بدون مدیر واجد شرایط" : "تیکت‌هایی که با نقش و Level شما قابل دریافت‌اند"}</p>
          </div>
        </header>
        <div className="table-card organization-table">
          {queueLoading ? (
            <Skeleton rows={4} />
          ) : !queue.length ? (
            <EmptyState title="صف نقش خالی است" description="همه تیکت‌ها مدیر واجد شرایط دارند یا قبلاً دریافت شده‌اند." />
          ) : (
            <table>
              <thead>
                <tr>
                  <th>تیکت</th>
                  <th>پروژه</th>
                  <th>قانون</th>
                  <th>Role / Level</th>
                  <th>زمان ورود</th>
                  <th>عملیات</th>
                </tr>
              </thead>
              <tbody>
                {queue.map((entry) => (
                  <tr key={entry.id}>
                    <td>{entry.issueName}</td>
                    <td>{entry.projectName}</td>
                    <td>{entry.ruleName}</td>
                    <td>
                      {entry.roleName} / {toFa(entry.requiredLevel)}
                    </td>
                    <td>{entry.createdAt ? persianDate(entry.createdAt) : "—"}</td>
                    <td>
                      <Button
                        icon={UserCheck}
                        variant="secondary"
                        disabled={claimQueue.isPending}
                        onClick={() => claimQueue.mutate(entry.id)}
                      >
                        دریافت
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      {editing && (
        <div
          className="modal-layer"
          role="presentation"
          onMouseDown={(event) => event.target === event.currentTarget && setEditing(undefined)}
        >
          <form
            className="create-modal organization-modal"
            onSubmit={(event) => {
              event.preventDefault();
              saveRule.mutate(editing, { onSuccess: () => setEditing(undefined) });
            }}
          >
            <header>
              <div>
                <span className="modal-kicker">Ticket Routing</span>
                <h2>{editing.id ? "ویرایش قانون" : "قانون جدید"}</h2>
              </div>
              <Inbox size={22} />
            </header>
            <label>
              <span>نام قانون</span>
              <input
                value={editing.name}
                onChange={(event) => setEditing({ ...editing, name: event.target.value })}
                required
              />
            </label>
            <label>
              <span>واحد شروع</span>
              <select
                value={editing.unitId}
                onChange={(event) => setEditing({ ...editing, unitId: event.target.value })}
                required
              >
                <option value="">انتخاب واحد</option>
                {units
                  .filter((unit) => unit.isActive || unit.id === editing.unitId)
                  .map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span>Role مورد نیاز</span>
              <select
                value={editing.requiredRoleId}
                onChange={(event) => {
                  const role = roles.find((item) => item.id === event.target.value);
                  setEditing({
                    ...editing,
                    requiredRoleId: event.target.value,
                    requiredLevel: role?.level ?? editing.requiredLevel,
                  });
                }}
                required
              >
                <option value="">انتخاب Role</option>
                {roles
                  .filter((role) => role.isActive || role.id === editing.requiredRoleId)
                  .map((role) => (
                    <option key={role.id} value={role.id}>
                      {role.name} — Level {toFa(role.level)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span>حداقل Level</span>
              <input
                type="number"
                min={0}
                value={editing.requiredLevel}
                onChange={(event) => setEditing({ ...editing, requiredLevel: Number(event.target.value) })}
                required
              />
            </label>
            <label className="active-toggle">
              <input
                type="checkbox"
                checked={editing.isActive}
                onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })}
              />
              <span>قانون فعال باشد</span>
            </label>
            <footer>
              <Button variant="secondary" onClick={() => setEditing(undefined)}>
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
        </div>
      )}
    </div>
  );
}
