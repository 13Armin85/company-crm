# ماژول ابزارهای OpenAPI

این ماژول ساختاری ماژولار و منظم برای ابزارهای OpenAPI و `drf-spectacular` فراهم می‌کند و جایگزین فایل یکپارچهٔ `openapi_spec_helpers.py` شده است.

## ساختار

```text
plane/utils/openapi/
├── __init__.py          # بازصادرکردن اجزای عمومی
├── auth.py              # افزونه‌های احراز هویت
├── parameters.py        # پارامترهای مشترک OpenAPI
├── responses.py         # پاسخ‌های مشترک OpenAPI
├── examples.py          # نمونه‌های مشترک OpenAPI
├── decorators.py        # دکوراتورهای کمکی endpointها
└── hooks.py             # hookهای پیش‌پردازش و پس‌پردازش schema
```

## استفاده

برای سازگاری با کدهای قبلی می‌توان همه‌چیز را از ماژول اصلی وارد کرد:

```python
from plane.utils.openapi import (
    asset_docs,
    ASSET_ID_PARAMETER,
    UNAUTHORIZED_RESPONSE,
)
```

در کدهای جدید، import مستقیم از ماژول مربوط توصیه می‌شود:

```python
from plane.utils.openapi.decorators import asset_docs
from plane.utils.openapi.parameters import ASSET_ID_PARAMETER
from plane.utils.openapi.responses import UNAUTHORIZED_RESPONSE
```

## محتوای ماژول‌ها

### `auth.py`

- `APIKeyAuthenticationExtension`: احراز هویت با `X-API-Key`
- `APITokenAuthenticationExtension`: احراز هویت با توکن Bearer

### `parameters.py`

- پارامترهای مسیر: `WORKSPACE_SLUG_PARAMETER`، `PROJECT_ID_PARAMETER`، `ISSUE_ID_PARAMETER` و `ASSET_ID_PARAMETER`
- پارامترهای query: `CURSOR_PARAMETER` و `PER_PAGE_PARAMETER`

### `responses.py`

- پاسخ‌های احراز هویت: `UNAUTHORIZED_RESPONSE` و `FORBIDDEN_RESPONSE`
- پاسخ‌های منبع: `NOT_FOUND_RESPONSE` و `VALIDATION_ERROR_RESPONSE`
- پاسخ‌های asset مانند `PRESIGNED_URL_SUCCESS_RESPONSE` و `ASSET_UPDATED_RESPONSE`
- پاسخ‌های عمومی asset مانند `GENERIC_ASSET_UPLOAD_SUCCESS_RESPONSE` و `ASSET_DOWNLOAD_SUCCESS_RESPONSE`

### `examples.py`

شامل `FILE_UPLOAD_EXAMPLE`، `WORKSPACE_EXAMPLE`، `PROJECT_EXAMPLE` و `ISSUE_EXAMPLE` است.

### `decorators.py`

- `workspace_docs()`: endpointهای workspace
- `project_docs()`: endpointهای project
- `issue_docs()`: endpointهای issue یا work item
- `asset_docs()`: endpointهای asset

### `hooks.py`

- `preprocess_filter_api_v1_paths()`: فیلتر مسیرهای API نسخهٔ ۱
- `postprocess_assign_tags()`: تخصیص tag براساس الگوی URL
- `generate_operation_summary()`: تولید خلاصهٔ عملیات

## وضعیت مهاجرت

مهاجرت کامل شده است. همهٔ اجزای `openapi_spec_helpers.py` به این ساختار منتقل شده‌اند، importها به‌روز شده‌اند و فایل قدیمی حذف شده است. این مهاجرت افزونه‌های احراز هویت، پارامترها، پاسخ‌ها، دکوراتورها، hookها، نمونه‌ها و viewهای asset را پوشش می‌دهد.

فایل‌های view مربوط به asset، project، user، state، intake، member، module، cycle و issue و همچنین `plane/settings/common.py` و `plane/api/apps.py` به مسیرهای جدید به‌روزرسانی شده‌اند.

## مزایا

1. گروه‌بندی بهتر قابلیت‌های مرتبط
2. نگهداری و یافتن ساده‌تر کد
3. حفظ سازگاری با importهای قبلی
4. وابستگی کمتر میان بخش‌ها
5. مستندسازی یکسان endpointها
6. کاهش حدود ۸۰ درصدی کد تکراری دکوراتورها
