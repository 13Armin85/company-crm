# صادرکننده‌های داده

ابزاری منعطف و قابل توسعه برای خروجی‌گرفتن از مدل‌های Django در قالب‌های CSV، JSON و XLSX.

## معرفی

ماژول exporters با تعریف schema امکانات زیر را فراهم می‌کند:

- پشتیبانی از CSV، JSON و XLSX
- فیلدهای نوع‌دار `StringField`، `NumberField`، `DateField`، `DateTimeField`، `BooleanField`، `ListField` و `JSONField`
- تبدیل‌های سفارشی در سطح فیلد و متدهای preparer
- دسترسی به ویژگی‌های تودرتو و مدل‌های مرتبط با نگارش نقطه‌ای
- قالب‌بندی متناسب با نوع خروجی؛ برای مثال آرایهٔ JSON یا رشتهٔ جداشده در CSV

## شروع سریع

```python
from plane.utils.exporters import Exporter, ExportSchema, StringField, NumberField

class UserExportSchema(ExportSchema):
    name = StringField(source="username", label="User Name")
    email = StringField(source="email", label="Email Address")
    posts_count = NumberField(label="Total Posts")

    def prepare_posts_count(self, obj):
        return obj.posts.count()

users = User.objects.all()
exporter = Exporter(format_type="csv", schema_class=UserExportSchema)
filename, content = exporter.export("users_export", users)
```

QuerySet را مستقیماً به `export` بدهید؛ تبدیل داده‌ها را خود Exporter انجام می‌دهد.

### خروجی issueها

```python
from plane.utils.exporters import Exporter, IssueExportSchema

issues = Issue.objects.filter(project_id=project_id).prefetch_related(
    "assignee_details",
    "label_details",
    "issue_module",
)

exporter = Exporter(format_type="xlsx", schema_class=IssueExportSchema)
filename, content = exporter.export("issues", issues)

exporter = Exporter(format_type="json", schema_class=IssueExportSchema)
filename, content = exporter.export(
    "issues_filtered",
    issues,
    fields=["id", "name", "state_name", "assignees"],
)
```

برای چند پروژه، QuerySet هر پروژه را جداگانه فیلتر کنید:

```python
for project_id in project_ids:
    project_issues = issues.filter(project_id=project_id)
    exporter = Exporter(format_type="csv", schema_class=IssueExportSchema)
    filename, content = exporter.export(f"issues-{project_id}", project_issues)
```

## تعریف schema

### انواع فیلد

`StringField` مقدار را به رشته تبدیل می‌کند:

```python
name = StringField(source="name", label="Name", default="N/A")
```

`NumberField` اعداد صحیح و اعشاری را مدیریت می‌کند:

```python
count = NumberField(source="items_count", label="Count", default=0)
```

`DateField` تاریخ را با الگوی `%a, %d %b %Y` قالب‌بندی می‌کند:

```python
start_date = DateField(source="start_date", label="Start Date")
```

`DateTimeField` از الگوی `%a, %d %b %Y %I:%M:%S %Z%z` استفاده می‌کند:

```python
created_at = DateTimeField(source="created_at", label="Created At")
```

`BooleanField` مقدار را به boolean تبدیل می‌کند:

```python
is_active = BooleanField(source="is_active", label="Active", default=False)
```

`ListField` فهرست‌ها را در CSV و XLSX با جداکنندهٔ پیش‌فرض `", "` به هم متصل می‌کند؛ در JSON آرایه حفظ می‌شود:

```python
tags = ListField(source="tags", label="Tags")
assignees = ListField(label="Assignees")
```

`JSONField` اشیای قابل‌سریال‌سازی را در CSV و XLSX به رشتهٔ JSON تبدیل می‌کند و در JSON به‌شکل شیء نگه می‌دارد:

```python
metadata = JSONField(source="metadata", label="Metadata")
comments = JSONField(label="Comments")
```

### پارامترهای فیلد

همهٔ فیلدها این پارامترها را می‌پذیرند:

- `source`: مسیر نقطه‌ای ویژگی، مانند `project.name`
- `default`: مقدار پیش‌فرض هنگامی که فیلد `None` است
- `label`: عنوان ستون در خروجی

نمونهٔ مسیر نقطه‌ای:

```python
project_name = StringField(source="project.name", label="Project")
owner_email = StringField(source="created_by.email", label="Owner Email")
```

### متدهای preparer

برای منطق پیچیده، متدی با نام `prepare_<field_name>` بسازید. این متد بر تعریف عادی فیلد اولویت دارد:

```python
class MySchema(ExportSchema):
    assignees = ListField(label="Assignees")
    status = StringField(label="Status")

    def prepare_assignees(self, obj):
        return [f"{u.first_name} {u.last_name}" for u in obj.assignee_details]

    def prepare_status(self, obj):
        return "Active" if obj.is_active else "Inactive"
```

## قالب‌های خروجی

### CSV

- همهٔ فیلدها با `QUOTE_ALL` نقل‌قول می‌شوند.
- فهرست‌ها با `", "` یا مقدار `list_joiner` به هم متصل می‌شوند.
- اشیای JSON به رشتهٔ JSON تبدیل می‌شوند.
- پسوند فایل `.csv` است.

```python
exporter = Exporter(
    format_type="csv",
    schema_class=MySchema,
    options={"list_joiner": "; "},
)
```

### JSON

نوع داده، آرایه‌ها و ساختار تودرتو حفظ می‌شوند و پسوند فایل `.json` است. محتوای بازگشتی رشته است.

```python
exporter = Exporter(format_type="json", schema_class=MySchema)
filename, content = exporter.export("data", records)
```

### XLSX

فایل سازگار با Excel با openpyxl ساخته می‌شود. فهرست‌ها با جداکننده به هم متصل و اشیای JSON سریال می‌شوند. پسوند `.xlsx` و محتوای بازگشتی از نوع bytes است.

```python
exporter = Exporter(format_type="xlsx", schema_class=MySchema)
filename, content = exporter.export("data", records)
```

## استفادهٔ پیشرفته

### context و داده‌های ازپیش‌واکشی‌شده

برای جلوگیری از queryهای N+1، متد `get_context_data()` را بازنویسی کنید:

```python
class MySchema(ExportSchema):
    attachment_count = NumberField(label="Attachments")

    def prepare_attachment_count(self, obj):
        attachments = self.context.get("attachments_dict", {})
        return len(attachments.get(obj.id, []))

    @classmethod
    def get_context_data(cls, queryset):
        return {"attachments_dict": get_attachments_dict(queryset)}

queryset = MyModel.objects.all()
exporter = Exporter(format_type="csv", schema_class=MySchema)
filename, content = exporter.export("data", queryset)
```

Exporter هنگام سریال‌سازی به‌طور خودکار از `get_context_data()` استفاده می‌کند.

### افزودن formatter سفارشی

```python
from plane.utils.exporters import Exporter, BaseFormatter

class XMLFormatter(BaseFormatter):
    def format(self, filename, records, schema_class, options=None):
        return (f"{filename}.xml", xml_content)

Exporter.register_formatter("xml", XMLFormatter)
exporter = Exporter(format_type="xml", schema_class=MySchema)
```

قالب‌های ثبت‌شده را می‌توان دریافت کرد:

```python
formats = Exporter.get_available_formats()
# ['csv', 'json', 'xlsx']
```

### فیلتر فیلدها

```python
filename, content = exporter.export(
    "filtered_data",
    queryset,
    fields=["id", "name", "email"],
)
```

### گسترش schema

```python
class ExtendedIssueExportSchema(IssueExportSchema):
    custom_field = JSONField(label="Custom Data")

    def prepare_custom_field(self, obj):
        return self.context.get("custom_data", {}).get(obj.id, {})

    @classmethod
    def get_context_data(cls, queryset):
        context = super().get_context_data(queryset)
        context["custom_data"] = fetch_custom_data(queryset)
        return context
```

### سریال‌سازی دستی

```python
data = MySchema.serialize_queryset(queryset, fields=["id", "name"])

schema = MySchema()
obj_data = schema.serialize(obj)
```

## روش‌های پیشنهادی

1. با `get_context_data()` داده‌های مرتبط را یک‌جا واکشی و از N+1 جلوگیری کنید.
2. برای عنوان خوانای ستون‌ها همیشه `label` مناسب بنویسید.
3. برای فیلدهای nullable مقدار `default` مناسب تعیین کنید.
4. منطق پیچیده را در متدهای preparer نگه دارید.
5. QuerySet را مستقیماً به Exporter بدهید و فقط در صورت نیاز سریال‌سازی دستی انجام دهید.
6. برای چند خروجی، QuerySet را پیش از سریال‌سازی فیلتر کنید.

## مرجع API

### `Exporter`

- `__init__(format_type, schema_class, options=None)`: تعیین قالب، کلاس schema و گزینه‌های قالب
- `export(filename, data, fields=None)`: دریافت نام فایل بدون پسوند و QuerySet یا فهرست dict؛ خروجی `(filename_with_extension, content)` است
- `get_available_formats()`: دریافت قالب‌های موجود
- `register_formatter(format_type, formatter_class)`: ثبت formatter سفارشی

محتوای CSV و JSON رشته و محتوای XLSX از نوع bytes است.

### `ExportSchema`

- `__init__(context=None)`: context در preparerها با `self.context` در دسترس است
- `serialize(obj, fields=None)`: سریال‌سازی یک شیء به dict
- `serialize_queryset(queryset, fields=None)`: سریال‌سازی QuerySet به فهرست dict
- `get_context_data(queryset)`: قابل بازنویسی برای واکشی داده‌های مرتبط

### `ExportField`

کلاس پایهٔ انواع فیلد است. برای ساخت نوع جدید آن را گسترش دهید. `get_value(obj, context)` مقدار قالب‌بندی‌شده را برمی‌گرداند و `_format_value(raw)` برای قالب‌بندی ویژهٔ نوع قابل بازنویسی است.

## تست

```python
queryset = MyModel.objects.all()
exporter = Exporter(format_type="json", schema_class=MySchema)
filename, content = exporter.export("test", queryset)
assert filename == "test.json"
assert isinstance(content, str)

filename, content = exporter.export("test", queryset, fields=["id", "name"])
data = json.loads(content)
assert all(set(item.keys()) == {"id", "name"} for item in data)

data = MySchema.serialize_queryset(queryset)
assert len(data) == queryset.count()
```
