import type { EntityFormSchema } from "@plane/ui";

/** Hide the generated suffix on historical browser fixtures without changing stored names or codes. */
export function entityDisplayTitle(title: string): string {
  return title.replace(/^((?:آزمایش|نماهای|مبلغ|مرحله|موعد|گزینه|ارتباط|نمای شخصی) مرورگر) [a-z0-9]{7,12}$/i, "$1");
}

export function entityDisplaySchema(schema: EntityFormSchema): EntityFormSchema {
  return {
    ...schema,
    title: entityDisplayTitle(schema.title),
    fields: schema.fields.map((field) => ({ ...field, title: entityDisplayTitle(field.title) })),
    layout: {
      tabs: schema.layout.tabs.map((tab) => ({ ...tab, title: entityDisplayTitle(tab.title) })),
      sections: schema.layout.sections.map((section) => ({
        ...section,
        title: section.title && entityDisplayTitle(section.title),
        bindings: section.bindings.map((binding) => ({
          ...binding,
          title: binding.title && entityDisplayTitle(binding.title),
        })),
      })),
    },
  };
}
