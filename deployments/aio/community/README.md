# ایمیج یکپارچهٔ Docker نسخهٔ Community پلین

ایمیج All-In-One یا AIO همهٔ سرویس‌های پلین را برای استقرار و آزمایش ساده‌تر در یک container قرار می‌دهد. رابط وب، سرور API، workerهای پس‌زمینه، سرور live و سایر اجزا در این ایمیج آماده‌اند.

## سرویس‌های موجود

- **برنامهٔ وب** روی پورت ۳۰۰۱: رابط اصلی پلین
- **Space** روی پورت ۳۰۰۲: فضاهای عمومی پروژه
- **Admin** روی پورت ۳۰۰۳: رابط مدیریت
- **API** روی پورت ۳۰۰۴: backend
- **Live** روی پورت ۳۰۰۵: همکاری بلادرنگ
- **Proxy** روی پورت‌های ۸۰ و ۴۴۳: reverse proxy مبتنی بر Caddy
- **Worker و Beat**: پردازش کارهای پس‌زمینه و زمان‌بندی‌شده

## پیش‌نیازها

سرویس‌های بیرونی زیر باید در دسترس باشند:

- PostgreSQL برای ذخیرهٔ داده
- Redis برای cache و session
- RabbitMQ برای صف پیام
- فضای ذخیره‌سازی سازگار با S3، مانند AWS S3 یا MinIO

### متغیرهای محیطی اجباری

تنظیمات اصلی:

- `DOMAIN_NAME`: نام دامنه یا نشانی IP
- `DATABASE_URL`: رشتهٔ اتصال PostgreSQL
- `REDIS_URL`: رشتهٔ اتصال Redis
- `AMQP_URL`: رشتهٔ اتصال RabbitMQ

تنظیمات ذخیره‌سازی:

- `AWS_REGION`: منطقهٔ AWS، مانند `us-east-1`
- `AWS_ACCESS_KEY_ID`: کلید دسترسی S3
- `AWS_SECRET_ACCESS_KEY`: کلید محرمانهٔ S3
- `AWS_S3_BUCKET_NAME`: نام bucket
- `AWS_S3_ENDPOINT_URL`: endpoint اختیاری S3؛ مقدار پیش‌فرض AWS است

## شروع سریع

```bash
docker run --name plane-aio --rm -it \
    -p 80:80 \
    -e DOMAIN_NAME=your-domain.com \
    -e DATABASE_URL=postgresql://user:pass@host:port/database \
    -e REDIS_URL=redis://host:port \
    -e AMQP_URL=amqp://user:pass@host:port/vhost \
    -e AWS_REGION=us-east-1 \
    -e AWS_ACCESS_KEY_ID=your-access-key \
    -e AWS_SECRET_ACCESS_KEY=your-secret-key \
    -e AWS_S3_BUCKET_NAME=your-bucket \
    makeplane/plane-aio-community:latest
```

نمونهٔ اجرا با نشانی IP و MinIO:

```bash
MYIP=192.168.68.169
docker run --name myaio --rm -it \
    -p 80:80 \
    -e DOMAIN_NAME=${MYIP} \
    -e DATABASE_URL=postgresql://plane:plane@${MYIP}:15432/plane \
    -e REDIS_URL=redis://${MYIP}:16379 \
    -e AMQP_URL=amqp://plane:plane@${MYIP}:15673/plane \
    -e AWS_REGION=us-east-1 \
    -e AWS_ACCESS_KEY_ID=5MV45J9NF5TEFZWYCRAX \
    -e AWS_SECRET_ACCESS_KEY=7xMqAiAHsf2UUjMH+EwICXlyJL9TO30m8leEaDsL \
    -e AWS_S3_BUCKET_NAME=plane-app \
    -e AWS_S3_ENDPOINT_URL=http://${MYIP}:19000 \
    -e FILE_SIZE_LIMIT=10485760 \
    makeplane/plane-aio-community:latest
```

## تنظیمات اختیاری

- `SITE_ADDRESS`: نشانی bind سرور؛ پیش‌فرض `:80`
- `SECRET_KEY`: کلید محرمانهٔ Django
- `LIVE_SERVER_SECRET_KEY`: کلید محرمانهٔ سرور live
- `FILE_SIZE_LIMIT`: بیشترین اندازهٔ بارگذاری برحسب بایت؛ پیش‌فرض `5242880` یا ۵ مگابایت
- `API_KEY_RATE_LIMIT`: محدودیت درخواست API key؛ پیش‌فرض `60/minute`

## پورت‌ها و volumeها

پورت ۸۰ برای HTTP و پورت ۴۴۳، در صورت پیکربندی SSL، برای HTTPS منتشر می‌شود. برای ماندگاری گزارش‌ها و داده‌ها volumeهای زیر پیشنهاد می‌شوند:

```bash
-v /path/to/logs:/app/logs \
-v /path/to/data:/app/data
```

## ساخت ایمیج

```bash
cd deployments/aio/community
IMAGE_NAME=myplane-aio ./build.sh --release=v0.27.1 [--platform=linux/amd64]
```

- `--release`: نسخهٔ پلین؛ اجباری
- `--image-name`: نام سفارشی ایمیج؛ پیش‌فرض `plane-aio-community`

## عیب‌یابی

گزارش‌های دسترسی در `/app/logs/access/` و گزارش‌های خطا در `/app/logs/error/` قرار دارند. برای دیدن وضعیت سرویس‌های مدیریت‌شده با Supervisor اجرا کنید:

```bash
docker exec -it <container-name> supervisorctl status
```

- در خطای دیتابیس، دسترسی شبکه و اطلاعات اتصال PostgreSQL را بررسی کنید.
- در خطای Redis، فعال‌بودن سرویس و درستی URL را بررسی کنید.
- در خطای بارگذاری فایل، کلیدها و مجوزهای bucket را بررسی کنید.
- هنگام شروع، container متغیرهای اجباری را اعتبارسنجی و موارد ناقص را گزارش می‌کند.

## استفاده در محیط عملیاتی

- گواهی معتبر SSL تنظیم کنید.
- از داده‌ها پشتیبان منظم بگیرید.
- مصرف منابع را پایش و در صورت نیاز مقیاس‌دهی کنید.
- برای دسترس‌پذیری بالا از load balancer بیرونی استفاده کنید.
- نسخه‌ها را به‌روز و متغیرهای محرمانه را امن نگه دارید.

برای دریافت پشتیبانی به مستندات رسمی پلین مراجعه کنید.
