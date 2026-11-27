import { validateSchemaValues } from "@plane/ui";
import type { EntityFormSchema, FormValues } from "@plane/ui";

/** Existing records can have historical required fields that the current editor cannot change. */
export function validateRecordEdit(schema: EntityFormSchema, values: FormValues, original?: FormValues) {
  const errors = validateSchemaValues(schema, values);
  if (!original) return errors;
  for (const field of schema.fields) {
    if (field.config.readonly || JSON.stringify(values[field.code]) === JSON.stringify(original[field.code])) {
      delete errors[field.code];
    }
  }
  return errors;
}
