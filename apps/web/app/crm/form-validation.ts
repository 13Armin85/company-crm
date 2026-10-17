export function validationMessage(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
  const validity = field.validity;
  if (validity.valueMissing) return "تکمیل این فیلد الزامی است.";
  if (validity.typeMismatch && field instanceof HTMLInputElement && field.type === "email")
    return "ایمیل معتبر وارد کنید.";
  if (validity.tooShort && field instanceof HTMLInputElement) return `حداقل ${field.minLength} نویسه وارد کنید.`;
  if (validity.tooLong && field instanceof HTMLInputElement) return `حداکثر ${field.maxLength} نویسه وارد کنید.`;
  if (validity.patternMismatch) return "مقدار واردشده با قالب مجاز این فیلد مطابقت ندارد.";
  if (validity.rangeUnderflow || validity.rangeOverflow) return "مقداری در محدوده مجاز وارد کنید.";
  return "مقدار معتبر وارد کنید.";
}

export function localizeInvalidField(event: Event): void {
  const field = event.target;
  if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)
    field.setCustomValidity(validationMessage(field));
}

export function clearFieldValidation(event: Event): void {
  const field = event.target;
  if (field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)
    field.setCustomValidity("");
}
