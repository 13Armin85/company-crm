import { useEffect, useState } from "react";
import { MemberSelect } from "@plane/ui";
import { ArrowDown, ArrowUp, Trash2, UsersRound, X } from "lucide-react";
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
  const { data, error } = useDelegates(unitId);
  const { data: members = [] } = useMembers();
  const mutation = useAccessMutation();
  const [ids, setIds] = useState<string[]>([]);
  const [selected, setSelected] = useState("");
  useEffect(() => {
    setIds(data?.delegates.map((row) => row.user_id) ?? []);
  }, [data]);
  const reorder = (index: number, offset: number) => {
    const next = [...ids];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    setIds(next);
  };
  const canManage = access?.can("OrganizationUnit.Delegate.Manage") ?? false;
  const availableMembers = members.filter(
    (row) => row.isActive !== false && row.id !== managerId && !ids.includes(row.id)
  );
  return (
    <section className="panel delegate-manager">
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
      {error && <p role="alert">دریافت جانشینان انجام نشد.</p>}
      {data?.active_delegation && (
        <p role="status">
          جانشین فعال: {members.find((row) => row.id === data.active_delegation?.user_id)?.displayName ?? "کاربر"} ·{" "}
          {data.active_delegation.reason} · تا {persianDate(data.active_delegation.ends_at, { year: "numeric" })}
        </p>
      )}
      {ids.length === 0 && <p className="delegate-empty">هنوز جانشینی برای این واحد انتخاب نشده است.</p>}
      <ol className="delegate-list">
        {ids.map((id, index) => (
          <li key={id}>
            <span className="delegate-position">{toFa(index + 1)}</span>
            <span className="delegate-name">
              {members.find((row) => row.id === id)?.displayName ??
                data?.delegates.find((row) => row.user_id === id)?.name}
            </span>
            {canManage && (
              <div className="row-actions">
                <button
                  type="button"
                  title="اولویت بالاتر"
                  aria-label="اولویت بالاتر"
                  disabled={index === 0 || mutation.isPending}
                  onClick={() => reorder(index, -1)}
                >
                  <ArrowUp size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  title="اولویت پایین‌تر"
                  aria-label="اولویت پایین‌تر"
                  disabled={index === ids.length - 1 || mutation.isPending}
                  onClick={() => reorder(index, 1)}
                >
                  <ArrowDown size={16} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  title="حذف از فهرست جانشینان"
                  aria-label="حذف از فهرست جانشینان"
                  disabled={mutation.isPending}
                  onClick={() => setIds(ids.filter((row) => row !== id))}
                >
                  <Trash2 size={16} aria-hidden="true" />
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
      {canManage && (
        <>
          <div className="delegate-add">
            <MemberSelect
              label="افزودن جانشین"
              value={selected}
              onChange={setSelected}
              disabled={mutation.isPending || !data || Boolean(error)}
              options={availableMembers.map((row) => ({
                id: row.id,
                title: row.displayName,
                initials: row.initials,
                avatarUrl: row.avatarUrl,
              }))}
            />
            <Button
              variant="secondary"
              disabled={!availableMembers.some((row) => row.id === selected) || mutation.isPending || Boolean(error)}
              onClick={() => {
                setIds([...ids, selected]);
                setSelected("");
              }}
            >
              افزودن
            </Button>
          </div>
          <footer className="delegate-footer">
            <span>ترتیب بالاتر، اولویت بیشتری دارد. تغییرات را ذخیره کنید.</span>
            <Button
              disabled={mutation.isPending || !data || Boolean(error)}
              onClick={() =>
                mutation.mutate({ path: `units/${unitId}/delegates/`, method: "put", body: { user_ids: ids } })
              }
            >
              ذخیره ترتیب
            </Button>
          </footer>
        </>
      )}
    </section>
  );
}
