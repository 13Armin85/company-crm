import { useEffect, useState } from "react";
import { MemberDirectory, MemberIdentity } from "@plane/ui";
import { ArrowDown, ArrowUp, CheckCircle2, Save, Trash2, UsersRound, X } from "lucide-react";
import { useMembers, useWorkspaceAccess } from "../api";
import { Button } from "../components";
import { persianDate, toFa } from "../utils";
import { useAccessMutation, useDelegates } from "./api";

export function DelegateManager({
  unitId,
  unitTitle,
  managerId,
  onClose,
}: {
  unitId: string;
  unitTitle?: string;
  managerId?: string;
  onClose?: () => void;
}) {
  const { data: access } = useWorkspaceAccess();
  const { data, error, isLoading } = useDelegates(unitId);
  const { data: members = [], isLoading: membersLoading, error: membersError, refetch: refetchMembers } = useMembers();
  const mutation = useAccessMutation();
  const [ids, setIds] = useState<string[]>(() => data?.delegates.map((row) => row.user_id) ?? []);
  useEffect(() => {
    setIds(data?.delegates.map((row) => row.user_id) ?? []);
  }, [data]);
  const reorder = (index: number, offset: number) => {
    setIds((current) => {
      if (index + offset < 0 || index + offset >= current.length) return current;
      const next = [...current];
      [next[index], next[index + offset]] = [next[index + offset], next[index]];
      return next;
    });
  };
  const canManage = access?.can("OrganizationUnit.Delegate.Manage") ?? false;
  const availableMembers = members.filter(
    (row) => row.isActive !== false && row.id !== managerId && !ids.includes(row.id)
  );
  const hasChanges = JSON.stringify(ids) !== JSON.stringify(data?.delegates.map((row) => row.user_id) ?? []);
  const busy = mutation.isPending || isLoading || membersLoading || !data || Boolean(error) || Boolean(membersError);
  return (
    <section className="panel delegate-manager" aria-label={"جانشینان " + (unitTitle ?? "واحد سازمانی")}>
      <header className="delegate-heading">
        <span className="delegate-heading-icon" aria-hidden="true">
          <UsersRound size={22} />
        </span>
        <div>
          <h2>جانشینان{unitTitle ? " «" + unitTitle + "»" : ""}</h2>
          <p>در غیبت مدیر، اولین جانشین فعال و حاضر در این فهرست انتخاب می‌شود.</p>
        </div>
        {onClose && (
          <button type="button" className="plain-icon" aria-label="بستن فهرست جانشینان" onClick={onClose}>
            <X size={18} />
          </button>
        )}
      </header>
      {error && (
        <p className="delegate-notice" role="alert">
          دریافت جانشینان انجام نشد. لطفاً دوباره این بخش را باز کنید.
        </p>
      )}
      {data?.active_delegation && (
        <p className="delegate-active" role="status">
          <CheckCircle2 size={19} aria-hidden="true" />
          <span>
            جانشین فعال: {members.find((row) => row.id === data.active_delegation?.user_id)?.displayName ?? "کاربر"} ·{" "}
            {data.active_delegation.reason} · تا {persianDate(data.active_delegation.ends_at, { year: "numeric" })}
          </span>
        </p>
      )}
      <div className={"delegate-workspace" + (canManage ? "" : "is-readonly")}>
        <section className="delegate-selected" aria-label="ترتیب جانشینان">
          <header className="delegate-section-heading">
            <h3>ترتیب جانشینان</h3>
            <span className="delegate-count" aria-live="polite">
              {toFa(ids.length)} نفر
            </span>
          </header>
          <p className="delegate-section-help">افراد از بالا به پایین و به‌ترتیب اولویت بررسی می‌شوند.</p>
          {isLoading ? (
            <p className="delegate-empty" role="status">
              در حال دریافت جانشینان…
            </p>
          ) : !error && ids.length === 0 ? (
            <div className="delegate-empty">
              <UsersRound size={30} aria-hidden="true" />
              <b>هنوز جانشینی انتخاب نشده است</b>
              <span>
                {canManage ? "از فهرست اعضا، جانشینان این واحد را اضافه کنید." : "برای این واحد جانشینی ثبت نشده است."}
              </span>
            </div>
          ) : null}
          <ol className="delegate-list" aria-label="جانشینان به‌ترتیب اولویت">
            {ids.map((id, index) => {
              const member = members.find((row) => row.id === id);
              const name =
                member?.displayName || data?.delegates.find((row) => row.user_id === id)?.name || "عضو سازمان";
              return (
                <li className="delegate-card" key={id}>
                  <span className="delegate-position" aria-label={"اولویت " + toFa(index + 1)}>
                    {toFa(index + 1)}
                  </span>
                  <div className="delegate-person">
                    <MemberIdentity
                      member={{
                        id,
                        title: name,
                        email: member?.email,
                        role: member?.role,
                        initials: member?.initials,
                        avatarUrl: member?.avatarUrl,
                      }}
                    />
                    {member?.isActive === false ? (
                      <span className="delegate-status is-inactive">عضو غیرفعال؛ در انتخاب جانشین بررسی نمی‌شود</span>
                    ) : index === 0 ? (
                      <span className="delegate-status">اولویت اول</span>
                    ) : null}
                  </div>
                  {canManage && (
                    <div className="delegate-actions">
                      <button
                        type="button"
                        title="اولویت بالاتر"
                        aria-label={"اولویت بالاتر برای " + name}
                        disabled={index === 0 || busy}
                        onClick={() => reorder(index, -1)}
                      >
                        <ArrowUp size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        title="اولویت پایین‌تر"
                        aria-label={"اولویت پایین‌تر برای " + name}
                        disabled={index === ids.length - 1 || busy}
                        onClick={() => reorder(index, 1)}
                      >
                        <ArrowDown size={16} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        title="حذف از فهرست جانشینان"
                        className="delegate-remove"
                        aria-label={"حذف جانشین " + name}
                        disabled={busy}
                        onClick={() => setIds((current) => current.filter((row) => row !== id))}
                      >
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
        {canManage && (
          <MemberDirectory
            options={availableMembers.map((row) => ({
              id: row.id,
              title: row.displayName,
              email: row.email,
              role: row.role,
              initials: row.initials,
              avatarUrl: row.avatarUrl,
            }))}
            onAdd={(id) => {
              if (!busy && availableMembers.some((row) => row.id === id)) {
                setIds((current) => (current.includes(id) ? current : [...current, id]));
              }
            }}
            disabled={busy}
            isLoading={membersLoading}
            hasError={Boolean(membersError)}
            onRetry={() => {
              void refetchMembers();
            }}
          />
        )}
      </div>
      {canManage && (
        <footer className="delegate-footer">
          <div>
            <b className={hasChanges ? "delegate-unsaved" : ""} role="status">
              {hasChanges ? "تغییرات ذخیره نشده" : "ترتیب ذخیره‌شدهٔ جانشینان"}
            </b>
            <span>افزودن، حذف و جابه‌جایی افراد با «ذخیره ترتیب» ثبت می‌شود.</span>
          </div>
          <Button
            icon={Save}
            disabled={busy || !hasChanges}
            onClick={() =>
              mutation.mutate({ path: `units/${unitId}/delegates/`, method: "put", body: { user_ids: ids } })
            }
          >
            {mutation.isPending ? "در حال ذخیره…" : "ذخیره ترتیب"}
          </Button>
        </footer>
      )}
    </section>
  );
}
