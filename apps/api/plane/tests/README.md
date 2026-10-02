# تست‌های پلین

این پوشه شامل تست‌های برنامهٔ پلین است که با pytest سازمان‌دهی و اجرا می‌شوند.

## ساختار تست‌ها

- **تست واحد:** بررسی تابع یا کلاس به‌صورت مستقل
- **تست قرارداد:** بررسی تعامل مؤلفه‌ها و رعایت قرارداد API
  - **API:** endpointهای خارجی زیر مسیر `/api/v1/`
  - **App:** endpointهای برنامهٔ وب زیر مسیر `/api/`
- **تست دود:** بررسی‌های پایه برای اطمینان از اجرای صحیح برنامه

## تفاوت endpointهای API و App

1. **API خارجی** (`plane.api`)
   - مسیر `/api/v1/`
   - احراز هویت با API key در header با نام `X-Api-Key`
   - مناسب قراردادهای بیرونی و دسترسی سرویس‌های ثالث
   - fixture احراز هویت: `api_key_client`
   - محل تست‌ها: `contract/api/`

2. **API برنامهٔ وب** (`plane.app`)
   - مسیر `/api/`
   - احراز هویت مبتنی بر session با CSRF غیرفعال
   - مناسب frontend برنامهٔ وب
   - fixture احراز هویت: `session_client`
   - محل تست‌ها: `contract/app/`

## اجرای تست‌ها

اجرای همهٔ تست‌ها:

```bash
python -m pytest
```

اجرای هر دسته:

```bash
# تست‌های واحد
python -m pytest plane/tests/unit/

# تست قرارداد API خارجی
python -m pytest plane/tests/contract/api/

# تست قرارداد برنامهٔ وب
python -m pytest plane/tests/contract/app/

# تست‌های دود
python -m pytest plane/tests/smoke/
```

اسکریپت کمکی نیز در دسترس است:

```bash
# همهٔ تست‌ها
./run_tests.py

# فقط تست‌های واحد
./run_tests.py -u

# تست‌های قرارداد همراه با گزارش پوشش
./run_tests.py -c -o

# اجرای موازی
./run_tests.py -p
```

## Fixtureها

- `api_client`: کلاینت API بدون احراز هویت
- `create_user`: ساخت کاربر آزمایشی
- `api_token`: توکن API کاربر آزمایشی
- `api_key_client`: کلاینت دارای API key برای تست API خارجی
- `session_client`: کلاینت دارای session برای تست API برنامه
- `plane_server`: سرور زندهٔ تست Django برای تست‌های دود مبتنی بر HTTP

fixtureهای عمومی در `conftest.py`، وابستگی‌های بیرونی در `conftest_external.py` و factoryهای مدل در `factories.py` قرار دارند.

## نوشتن تست

1. تست را متناسب با نوع آن در پوشهٔ درست قرار دهید.
2. برای `/api/v1/` از `api_key_client`، برای `/api/` از `session_client` و برای HTTP واقعی از `plane_server` استفاده کنید.
3. برای API خارجی از `reverse("api:endpoint_name")` و برای API برنامه از `reverse("endpoint_name")` استفاده کنید.
4. تست‌های متصل به دیتابیس باید دکوراتور `@pytest.mark.django_db` داشته باشند.
5. marker مناسب مانند `@pytest.mark.unit`، `@pytest.mark.contract` یا `@pytest.mark.smoke` را اضافه کنید.

## روش‌های پیشنهادی

- از نگارش `assert` در pytest به‌جای متدهای `self.assert*` جنگو استفاده کنید.
- برای آماده‌سازی و پاک‌سازی داده‌ها fixture را به `setUp` و `tearDown` ترجیح دهید.
- وابستگی‌های بیرونی را با `mock_redis`، `mock_elasticsearch` و `mock_celery` شبیه‌سازی کنید.
- هر تست را بر یک رفتار یا حالت مرزی مشخص متمرکز نگه دارید.
- فایل‌های تست را کوچک و براساس مؤلفه یا endpoint مرتب کنید.
- برای مدل‌ها، serializerها و منطق کسب‌وکار پوشش ۹۰ درصدی را هدف بگیرید.

برای قراردادهای جامع‌تر می‌توان به‌صورت اختیاری از containerهای تست Docker استفاده کرد.

## گزارش پوشش

```bash
python -m pytest --cov=plane --cov-report=term --cov-report=html
```

گزارش HTML در پوشهٔ `htmlcov/` ساخته می‌شود.

## مهاجرت تست‌های قدیمی

بعضی تست‌ها هنوز با ساختار قدیمی در پوشهٔ `api/` قرار دارند و باید به شاخهٔ مناسب در ساختار جدید تست‌های قرارداد منتقل شوند.
