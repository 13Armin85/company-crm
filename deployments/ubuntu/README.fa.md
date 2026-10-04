# اجرای production روی Ubuntu

این مسیر برای Ubuntu Server، از جمله Ubuntu 26.04 LTS با codename برابر `resolute`، آماده شده است. سرویس‌های برنامه از سورس همین مخزن با `docker-compose-production.yml` ساخته می‌شوند. اسکریپت‌های Ubuntu برای تنظیمات و اجرای برنامه از پیاده‌سازی مشترک استقرار استفاده می‌کنند.

## انتقال از ویندوز

در PowerShell، از ریشه پروژه:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\deployments\debian\export-source.ps1
if ($LASTEXITCODE -ne 0) { throw 'ساخت آرشیو ناموفق بود.' }
scp .\tmp\company-crm-source.tar.gz plane@192.168.10.20:company-crm-source.tar.gz
```

پس از اتصال با `ssh plane@192.168.10.20`، روی سرور:

```bash
mkdir -p "$HOME/company-crm"
tar -xzf "$HOME/company-crm-source.tar.gz" -C "$HOME/company-crm"
cd "$HOME/company-crm"
find deployments/ubuntu deployments/debian apps/api/bin -type f -name '*.sh' -exec sed -i 's/\r$//' {} +
```

## آماده‌سازی Ubuntu

```bash
bash deployments/ubuntu/setup-server.sh
```

این فرمان Ubuntu را تشخیص می‌دهد، در صورت نیاز Docker Engine و Compose را از [مخزن رسمی Ubuntu](https://docs.docker.com/engine/install/ubuntu/) نصب می‌کند، OpenSSL، nano و tmux را آماده می‌کند و Docker را برای اجرای پس از boot فعال می‌کند. ممکن است رمز `sudo` درخواست شود. بسته‌های متعارض متعلق به برنامه‌های دیگر را حذف نمی‌کند؛ در صورت تعارض متوقف می‌شود. اگر فایل `docker.sources` قبلی شامل مخزن Debian باشد، پیش از اصلاح از آن کپی نگه می‌دارد.

اگر تمام ابزارها قبلاً نصب شده‌اند:

```bash
bash deployments/ubuntu/setup-server.sh --no-install
```

## تنظیم آدرس و رمزها

```bash
bash deployments/ubuntu/init-env.sh http://192.168.10.20
nano .env.production
```

مقادیر اصلی برای شبکه شرکت:

```dotenv
PUBLIC_URL=http://192.168.10.20
SITE_ADDRESS=http://192.168.10.20
BIND_ADDRESS=192.168.10.20
ALLOWED_HOSTS=192.168.10.20,localhost,127.0.0.1,api
MINIO_ENDPOINT_SSL=0
```

رمزهای تصادفی باقی فایل را حفظ کنید. اجرای دوباره initializer فایل موجود را حفظ می‌کند. برای ذخیره در nano، `Ctrl+O` و Enter و برای خروج `Ctrl+X` را بزنید.

## build و اجرای سرویس‌ها

```bash
tmux new -s plane-deploy
cd "$HOME/company-crm"
bash deployments/ubuntu/deploy.sh
```

پیش از build، فضای آزاد filesystem محل داده‌های Docker بررسی می‌شود. با کمتر از ۲۰ GiB آزاد، build شروع نمی‌شود. این حد یک کنترل اولیه است؛ مصرف واقعی با build مشخص می‌شود. برای این مخزن حدود ۳۰ تا ۴۰ گیگابایت فضای آزاد پیشنهاد می‌شود. ظرفیت دیسک VM باید داخل filesystem لینوکس هم تخصیص یافته باشد. کاربران آگاه می‌توانند حد بررسی را با متغیر `PLANE_BUILD_MIN_FREE_GB` به یک عدد صحیح مثبت تغییر دهند.

با هر خطای build، زیرساخت، migration یا شروع برنامه، اسکریپت همان‌جا متوقف و مرحله خطادار را اعلام می‌کند. build سرویس‌ها به‌ترتیب اجرا می‌شود. برای استفاده از imageهای موجود:

```bash
bash deployments/ubuntu/deploy.sh --no-build
```

سپس در مرورگر:

- برنامه: http://192.168.10.20/
- راه‌اندازی مدیر: http://192.168.10.20/god-mode/
- صفحات منتشرشده: http://192.168.10.20/spaces/

ابتدا فرم God mode را تکمیل کنید. اطلاعات نصب، دامنه و HTTPS، SMTP، تونل پنل دیتابیس، backup و restore در [راهنمای کامل استقرار](../debian/README.fa.md) آمده است. خطاها را پیش از ادامه مراحل رفع کنید؛ اجرای واقعی روی سرور با آزمون‌های محلی اسکریپت‌ها متفاوت است.

## آزمون‌های محلی اسکریپت‌ها

```bash
python -m unittest discover -s deployments/debian/tests -v
```

این آزمون‌ها از Docker و apt شبیه‌سازی‌شده استفاده می‌کنند و بسته‌ای روی میزبان نصب نمی‌کنند. برای بررسی فایل Compose فقط Docker Compose CLI لازم است.
