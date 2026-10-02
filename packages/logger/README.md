# بستهٔ ثبت رویداد

این بسته یک logger عمومی و middleware ثبت درخواست مبتنی بر [Winston](https://github.com/winstonjs/winston) فراهم می‌کند. سطح گزارش‌گیری از طریق متغیر محیطی قابل تنظیم است و رویدادهای برنامه و درخواست‌های HTTP به‌شکل ساخت‌یافته ثبت می‌شوند.

## قابلیت‌ها

- تنظیم پویای سطح گزارش‌گیری از طریق متغیر محیطی
- نمونهٔ ازپیش‌پیکربندی‌شدهٔ `logger` برای استفادهٔ عمومی
- middleware با نام `requestLogger` برای ثبت درخواست‌های ورودی

## استفاده

بسته را به `package.json` اضافه کنید:

```json
{
  "dependencies": {
    "@plane/logger": "workspace:*"
  }
}
```

سپس loggerها را وارد کنید:

```typescript
import { logger, requestLogger } from "@plane/logger";
```

### logger عمومی

```typescript
logger.info("This is an info log");
logger.warn("This is a warning");
logger.error("This is an error");
```

### middleware ثبت درخواست

```typescript
const app = express();
app.use(requestLogger);
```

## سطح‌های موجود

- `error`
- `warn`
- `info` (پیش‌فرض)
- `http`
- `verbose`
- `debug`
- `silly`

## فایل‌های گزارش

فایل‌ها در پوشهٔ `logs` واقع در مسیر کاری جاری ذخیره می‌شوند. گزارش خطا با الگوی `error-%DATE%.log` و گزارش ترکیبی با الگوی `combined-%DATE%.log` ساخته می‌شود. دورهٔ نگهداری فایل‌ها ۷ روز است.

## پیکربندی

سطح پیش‌فرض `info` است. برای تغییر آن، متغیر `LOG_LEVEL` را در فایل `.env` تنظیم کنید.
