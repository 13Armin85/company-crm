import { useEffect, useMemo, useState } from "react";
import { Building2, ChevronDown, ChevronLeft, Edit3, Plus, UsersRound, XCircle } from "lucide-react";
import { Navigate } from "react-router";
import {
  useDeactivateOrganizationUnit,
  useMembers,
  useOrganizationUnits,
  useSaveOrganizationUnit,
  useWorkspaceAccess,
} from "../api";
import { Button, EmptyState, PageHeader, Skeleton } from "../components";
import { useUIStore } from "../store";
import type { OrganizationUnit } from "../types";
import { AccessModal, MultiSelector } from "../access/components";
import { DelegateManager } from "../access/delegate-manager";

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
  const deactivateUnit = useDeactivateOrganizationUnit(slug);
  const [form, setForm] = useState<UnitForm>();
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [draggedId, setDraggedId] = useState<string>();
  const [delegateUnit, setDelegateUnit] = useState<OrganizationUnit>();
  const roots = useMemo(() => units.filter((unit) => !unit.parentId), [units]);
  useEffect(() => {
    setFormDirty("organization-unit", Boolean(form));
    return () => setFormDirty("organization-unit", false);
  }, [form, setFormDirty]);
  if (accessLoading) return <Skeleton rows={6} />;
  if (!access?.can("OrganizationUnit.View")) return <Navigate to="/my-work" replace />;

  const submit = () => {
    if (!form?.title.trim()) return;
    saveUnit.mutate(
      {
        ...form,
        managerId: access.can("OrganizationUnit.Manager.Assign") ? (form.managerId ?? "") : undefined,
        memberIds: access.can("OrganizationUnit.Member.Manage") ? form.memberIds : undefined,
      },
      { onSuccess: () => setForm(undefined) }
    );
  };
  const moveUnit = (unit: OrganizationUnit, parentId?: string) => {
    if (!access.can("OrganizationUnit.Edit") || unit.id === parentId || unit.parentId === parentId) return;
    saveUnit.mutate({
      id: unit.id,
      title: unit.title,
      parentId,
    });
  };
  const renderUnit = (unit: OrganizationUnit, depth = 0) => {
    const children = units.filter((item) => item.parentId === unit.id);
    const isCollapsed = collapsed.has(unit.id);
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
            {access.can("OrganizationUnit.Edit") && (
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
            {unit.isActive && access.can("OrganizationUnit.Disable") && (
              <button onClick={() => deactivateUnit.mutate(unit.id)} title="غیرفعال‌کردن">
                <XCircle size={15} />
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
          <EmptyState title="ساختار سازمانی خالی است" description="اولین واحد سازمانی را ایجاد کنید." />
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
      {form && (
        <AccessModal
          title={form.id ? "ویرایش واحد" : "افزودن واحد"}
          busy={saveUnit.isPending}
          onClose={() => setForm(undefined)}
        >
          <section className="organization-modal">
            <label>
              <span>عنوان واحد</span>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </label>
            <label>
              <span>واحد بالادستی</span>
              <select
                value={form.parentId ?? ""}
                onChange={(e) => setForm({ ...form, parentId: e.target.value || undefined })}
              >
                <option value="">ریشه سازمان</option>
                {units
                  .filter((unit) => unit.id !== form.id && unit.isActive)
                  .map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.title}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              <span>مدیر فعلی</span>
              <select
                disabled={!access.can("OrganizationUnit.Manager.Assign")}
                value={form.managerId ?? ""}
                onChange={(e) => setForm({ ...form, managerId: e.target.value || undefined })}
              >
                <option value="">بدون مدیر</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
              </select>
            </label>
            <MultiSelector
              label="اعضای واحد"
              selected={form.memberIds}
              onChange={(memberIds) => setForm({ ...form, memberIds })}
              disabled={!access.can("OrganizationUnit.Member.Manage")}
              options={members
                .filter((member) => member.isActive !== false)
                .map((member) => ({
                  id: member.id,
                  title: member.displayName,
                  description: member.email,
                  initials: member.initials,
                  avatarUrl: member.avatarUrl,
                }))}
            />
            <footer>
              <Button variant="secondary" onClick={() => setForm(undefined)}>
                انصراف
              </Button>
              <Button onClick={submit} disabled={!form.title.trim() || saveUnit.isPending}>
                ذخیره واحد
              </Button>
            </footer>
          </section>
        </AccessModal>
      )}
    </div>
  );
}
