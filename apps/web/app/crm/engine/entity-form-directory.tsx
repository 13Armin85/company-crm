import { useState } from "react";
import { SearchableSelect } from "@plane/ui";
import { Button } from "../components";
import { errorMessage, useWorkspaceAccess } from "../api";
import { useEngineCatalog, useEngineDefinitions } from "./api";
import type { FieldDefinition } from "./api";
import { FormDesigner } from "./form-designer";
import { DefinitionEditor } from "./definition-editor";

export function EntityFormDirectory() {
  const catalog = useEngineCatalog();
  const fields = useEngineDefinitions<FieldDefinition>("fields");
  const { data: access } = useWorkspaceAccess();
  const [code, setCode] = useState("");
  const [creating, setCreating] = useState(false);
  const entity = catalog.data?.entities.find((candidate) => candidate.code === code);
  return (
    <section className="engine-view-settings">
      <h2>فرم‌های ایجاد و ویرایش موجودیت‌ها</h2>
      <p>هر موجودیت و زیرنوع یک فرم مشترک ایجاد و ویرایش دارد. فیلدهای هسته‌ای با قفل مشخص شده‌اند.</p>
      <SearchableSelect
        label="فرم موجودیت"
        value={code}
        options={(catalog.data?.entities || []).map((candidate) => ({
          id: candidate.code,
          title: candidate.title + (candidate.parent ? " · زیرنوع" : ""),
        }))}
        onChange={setCode}
      />
      {access?.can("EntityType.Create") && (
        <Button variant="secondary" onClick={() => setCreating(true)}>
          موجودیت جدید
        </Button>
      )}
      {creating && (
        <DefinitionEditor
          kind="entities"
          onClose={() => setCreating(false)}
          onSaved={(createdEntity) => {
            if (createdEntity?.code) setCode(createdEntity.code);
          }}
        />
      )}
      {(catalog.error || fields.error) && (
        <p role="alert">{errorMessage(catalog.error || fields.error, "فهرست فرم‌ها دریافت نشد.")}</p>
      )}
      {entity && fields.data && (
        <FormDesigner key={entity.id} entity={entity} fields={fields.data} entities={catalog.data?.entities || []} />
      )}
    </section>
  );
}
