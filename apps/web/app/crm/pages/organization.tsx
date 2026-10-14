import { IdentifierBadge, SearchableSelect } from "@plane/ui";
import { useEffect, useMemo, useState } from "react";
import { Building2, ChevronDown, ChevronLeft, Edit3, Plus, Power, Trash2, UsersRound } from "lucide-react";
import { Navigate, useSearchParams } from "react-router";
import {
  useDeleteOrganizationObject,
  errorMessage,
  useMembers,
  useOrganizationUnits,
  useSaveOrganizationUnit,
  useWorkspaceAccess,
} from "../api";
import { Button, EmptyState, PageHeader, SearchBox, Skeleton } from "../components";
import { useUIStore } from "../store";
import type { OrganizationUnit } from "../types";
import { AccessModal, MultiSelector } from "../access/components";
import { DelegateManager } from "../access/delegate-manager";
import { organizationSearchIds } from "../identifiers";

type UnitForm = { id?: string; title: string; parentId?: string; managerId?: string; memberIds: string[] };
const emptyForm: UnitForm = { title: "", memberIds: [] };

export default function OrganizationPage() {
  const slug = useUIStore((state) => state.workspaceSlug) ?? "";
  const setFormDirty = useUIStore((state) => state.setFormDirty);
  const { data: access, isLoading: accessLoading } = useWorkspaceAccess();
  const { data: units = [], isLoading } = useOrganizationUnits(
    undefined,
    access?.can("OrganizationUnit.View") === true
  );
  const { data: members = [] } = useMembers();
  const saveUnit = useSaveOrganizationUnit(slug);
  const remove = useDeleteOrganizationObject(slug, "units");
  const [deleting, setDeleting] = useState<OrganizationUnit>();
  const [form, setForm] = useState<UnitForm>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [draggedId, setDraggedId] = useState<string>();
  const [delegateUnit, setDelegateUnit] = useState<OrganizationUnit>();
  const [query, setQuery] = useState("");
  const [params] = useSearchParams();
  const searchParam = params.get("search") ?? "";
  useEffect(() => setQuery(searchParam), [searchParam]);
  const visibleIds = useMemo(() => organizationSearchIds(units, query), [units, query]);
  const roots = useMemo(() => units.filter((unit) => !unit.parentId && visibleIds.has(unit.id)), [units, visibleIds]);
  useEffect(() => {
    setFormDirty("organization-unit", Boolean(form));
    return () => setFormDirty("organization-unit", false);
  }, [form, setFormDirty]);
  if (accessLoading) return <Skeleton rows={6} />;
  if (!access?.can("OrganizationUnit.View")) return <Navigate to="/my-work" replace />;
  const canEditStructure = access.can("OrganizationUnit.Edit");
  const canManageUnit =
    canEditStructure || access.can("OrganizationUnit.Manager.Assign") || access.can("OrganizationUnit.Member.Manage");

  const submit = () => {
    if (saveUnit.isPending || !form?.title.trim()) return;
    saveUnit.mutate(
      {
        id: form.id,
        title: !form.id || canEditStructure ? form.title : undefined,
        parentId: !form.id || canEditStructure ? form.parentId : undefined,
        managerId: access.can("OrganizationUnit.Manager.Assign") ? (form.managerId ?? "") : undefined,
        memberIds: access.can("OrganizationUnit.Member.Manage") ? form.memberIds : undefined,
      },
      { onSuccess: () => setForm(undefined) }
    );
  };
  const moveUnit = (unit: OrganizationUnit, parentId?: string) => {
    if (saveUnit.isPending || !canEditStructure || unit.id === parentId || unit.parentId === parentId) return;
    saveUnit.mutate({
      id: unit.id,
      title: unit.title,
      parentId: parentId ?? "",
    });
  };
  const renderUnit = (unit: OrganizationUnit, depth = 0) => {
    const children = units.filter((item) => item.parentId === unit.id && visibleIds.has(item.id));
    const isCollapsed = collapsed.has(unit.id) && !query.trim();
    return (
      <div key={unit.id} className="org-branch">
        <div
          className={`org-node ${unit.isActive ? "" : "is-inactive"}`}
          style={{ marginInlineStart: `${depth * 24}px` }}
          draggable={access.can("OrganizationUnit.Edit")}
          onDragStart={() => setDraggedId(unit.id)}
          onDragOver={(event) => event.preventDefault()}
          onDrop={() => {
            const dragged = units.find((item) => item.id === draggedId);
            if (dragged) moveUnit(dragged, unit.id);
            setDraggedId(undefined);
          }}
        >
          <button
            type="button"
            className="plain-icon"
            disabled={!children.length}
            onClick={() =>
              setCollapsed((current) => {
                const next = new Set(current);
                if (next.has(unit.id)) next.delete(unit.id);
                else next.add(unit.id);
                return next;
              })
            }
          >
            {isCollapsed ? <ChevronLeft size={16} /> : <ChevronDown size={16} />}
          </button>
          <span className="org-node-icon">
            <Building2 size={17} />
          </span>
          <div>
            <b>{unit.title}</b>
            <IdentifierBadge value={unit.id} label="شناسه واحد" />
            <small>
              {unit.managerName ? `مدیر: ${unit.managerName}` : "بدون مدیر"} · {unit.memberIds.length} عضو
            </small>
          </div>
          {!unit.isActive && <span className="state-pill is-off">غیرفعال</span>}
          <div className="org-node-actions">
            <button
              type="button"
              onClick={() => setDelegateUnit(unit)}
              title="جانشینان"
              aria-label={"جانشینان " + unit.title}
              aria-expanded={delegateUnit?.id === unit.id}
            >
              <UsersRound size={16} aria-hidden="true" />
            </button>
            {access.can("OrganizationUnit.Create") && (
              <button onClick={() => setForm({ title: "", parentId: unit.id, memberIds: [] })} title="افزودن زیرمجموعه">
                <Plus size={15} />
              </button>
            )}
            {canManageUnit && (
              <button
                onClick={() =>
                  setForm({
                    id: unit.id,
                    title: unit.title,
                    parentId: unit.parentId,
                    managerId: unit.managerId,
                    memberIds: unit.memberIds,
                  })
                }
                title="ویرایش"
              >
                <Edit3 size={15} />
              </button>
            )}
            {access.can("OrganizationUnit.Disable") && (
              <button
                type="button"
                className={`unit-action ${unit.isActive ? "" : "is-enable"}`}
                title={unit.isActive ? "غیرفعال کردن" : "فعال کردن"}
                aria-label={unit.isActive ? "غیرفعال کردن" : "فعال کردن"}
                disabled={saveUnit.isPending}
                onClick={() => saveUnit.mutate({ id: unit.id, isActive: !unit.isActive })}
              >
                <Power size={16} aria-hidden="true" />
              </button>
            )}
            {access.can("OrganizationUnit.Delete") && (
              <button
                type="button"
                className="unit-action is-danger"
                title="حذف واحد"
                aria-label="حذف واحد"
                disabled={remove.isPending}
                onClick={() => {
                  remove.reset();
                  setDeleting(unit);
                }}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
        {!isCollapsed && children.map((child) => renderUnit(child, depth + 1))}
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        eyebrow="مدیریت سازمان"
        title="ساختار سازمانی"
        description="واحدها را به‌صورت درختی مدیریت کنید؛ برای جابه‌جایی یک واحد، آن را روی والد جدید رها کنید."
        actions={
          access.can("OrganizationUnit.Create") && (
            <Button icon={Plus} onClick={() => setForm(emptyForm)}>
              واحد جدید
            </Button>
          )
        }
      />
      <SearchBox value={query} onChange={setQuery} placeholder="جستجوی شناسه، عنوان یا مدیر واحد…" />
      <section
        className="organization-tree panel"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          if (event.target !== event.currentTarget) return;
          const dragged = units.find((item) => item.id === draggedId);
          if (dragged) moveUnit(dragged);
          setDraggedId(undefined);
        }}
      >
        {isLoading ? (
          <Skeleton rows={6} />
        ) : roots.length ? (
          roots.map((root) => renderUnit(root))
        ) : (
          <EmptyState
            title={query.trim() ? "واحدی پیدا نشد" : "ساختار سازمانی خالی است"}
            description={query.trim() ? "شناسه یا عبارت جست‌وجو را بررسی کنید." : "اولین واحد سازمانی را ایجاد کنید."}
          />
        )}
      </section>
      {delegateUnit && (
        <DelegateManager
          key={delegateUnit.id}
          unitId={delegateUnit.id}
          unitTitle={delegateUnit.title}
          managerId={delegateUnit.managerId}
          onClose={() => setDelegateUnit(undefined)}
        />
      )}
      {deleting && (
        <AccessModal title="حذف واحد سازمانی" busy={remove.isPending} onClose={() => setDeleting(undefined)}>
          <p>
            واحد «{deleting.title}» حذف می‌شود و اعضا و جانشینان از این واحد دسترسی نمی‌گیرند. واحد دارای زیرواحد یا قانون
            فعال ابتدا باید تعیین تکلیف شود.
          </p>
          {remove.error && <p role="alert">{errorMessage(remove.error, "حذف واحد انجام نشد.")}</p>}
          <footer>
            <Button variant="secondary" disabled={remove.isPending} onClick={() => setDeleting(undefined)}>
              انصراف
            </Button>
            <Button
              variant="danger"
              disabled={remove.isPending}
              onClick={() => remove.mutate(deleting.id, { onSuccess: () => setDeleting(undefined) })}
            >
              حذف واحد
            </Button>
          </footer>
        </AccessModal>
      )}
      {saveUnit.error && <p role="alert">{errorMessage(saveUnit.error, "ذخیره واحد انجام نشد.")}</p>}
      {form && (
        <AccessModal
          title={form.id ? "ویرایش واحد" : "افزودن واحد"}
          busy={saveUnit.isPending}
          onClose={() => setForm(undefined)}
        >
          <form
            className="organization-modal"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label htmlFor="crm-unit-title">
              <span>عنوان واحد</span>
              <input
                id="crm-unit-title"
                required
                disabled={saveUnit.isPending || Boolean(form.id && !canEditStructure)}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </label>
            <label htmlFor="crm-organization-select-1">
              <span>واحد بالادستی</span>
              <SearchableSelect
                id="crm-organization-select-1"
                label="واحد بالادستی"
                disabled={saveUnit.isPending || Boolean(form.id && !canEditStructure)}
                value={form.parentId ?? ""}
                onChange={(parentId) => setForm({ ...form, parentId })}
                options={[
                  { id: "", title: "ریشه سازمان" },
                  ...units
                    .filter((unit) => unit.id !== form.id)
                    .map((unit) => ({
                      id: unit.id,
                      title: unit.title,
                      description: unit.isActive ? undefined : "واحد غیرفعال؛ وضعیت فرزندان مستقل است.",
                    })),
                ]}
              />
            </label>
            <label htmlFor="crm-organization-select-2">
              <span>مدیر فعلی</span>
              <SearchableSelect
                id="crm-organization-select-2"
                label="مدیر فعلی"
                disabled={saveUnit.isPending || !access.can("OrganizationUnit.Manager.Assign")}
                value={form.managerId ?? ""}
                onChange={(managerId) => setForm({ ...form, managerId })}
                options={[
                  { id: "", title: "بدون مدیر" },
                  ...members.map((member) => ({
                    id: member.id,
                    title: member.displayName,
                    description: member.email,
                    disabled: member.isActive === false,
                  })),
                ]}
              />
            </label>
            <MultiSelector
              label="اعضای واحد"
              selected={form.memberIds}
              onChange={(memberIds) => setForm({ ...form, memberIds })}
              disabled={saveUnit.isPending || !access.can("OrganizationUnit.Member.Manage")}
              options={members.map((member) => ({
                id: member.id,
                title: member.displayName,
                description: member.email,
                initials: member.initials,
                avatarUrl: member.avatarUrl,
                disabled: member.isActive === false,
              }))}
            />
            {saveUnit.error && <p role="alert">{errorMessage(saveUnit.error, "ذخیره واحد انجام نشد.")}</p>}
            <footer>
              <Button variant="secondary" disabled={saveUnit.isPending} onClick={() => setForm(undefined)}>
                انصراف
              </Button>
              <Button type="submit" disabled={!form.title.trim() || saveUnit.isPending}>
                ذخیره واحد
              </Button>
            </footer>
          </form>
        </AccessModal>
      )}
    </div>
  );
}
