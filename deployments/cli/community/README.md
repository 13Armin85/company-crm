# میزبانی شخصی پلین

این راهنما نصب نسخهٔ self-hosted پلین را روی سرور ابری یا رایانهٔ شخصی توضیح می‌دهد. در این روش کنترل کامل برنامه و داده‌ها در اختیار شما است.

## آماده‌سازی Docker

<details>
  <summary>گزینهٔ ۱: سرور ابری</summary>

یک ماشین مانند AWS EC2 با حداقل ۲ vCPU و ۴ گیگابایت RAM بسازید و Docker Engine را نصب کنید:

```bash
curl -fsSL https://get.docker.com | sh -
```

</details>

<details>
  <summary>گزینهٔ ۲: رایانهٔ شخصی</summary>

در macOS، Docker Desktop را از [Docker Hub](https://hub.docker.com/editions/community/docker-ce-desktop-mac/) دریافت کنید، فایل DMG را اجرا و برنامه را به Applications منتقل کنید.

در Windows، Docker Desktop را از [Docker Hub](https://hub.docker.com/editions/community/docker-ce-desktop-windows/) دریافت و نصب کنید. در صورت درخواست، قابلیت‌های Hyper-V و Containers را فعال و سیستم را راه‌اندازی مجدد کنید.

پس از نصب، در Terminal یا Command Prompt درستی نصب را بررسی کنید:

```bash
docker --version
```

</details>

## نصب پلین

### پیش‌نیازها

- Docker نصب و در حال اجرا باشد.
- سیستم‌عامل امکان اجرای Bash داشته باشد؛ در Windows از [Git Bash](https://git-scm.com/download/win) استفاده کنید.
- کاربر جاری به سرویس Docker دسترسی داشته باشد. در صورت نیاز در Linux از `sudo su` استفاده کنید.
- ادامهٔ فرمان‌ها را در Terminal یا Git Bash اجرا کنید.

### دریافت آخرین نسخه

```bash
mkdir plane-selfhost
cd plane-selfhost
```

برای Docker Compose:

```bash
curl -fsSL -o setup.sh https://github.com/makeplane/plane/releases/latest/download/setup.sh
chmod +x setup.sh
```

برای Docker Swarm:

```bash
curl -fsSL -o setup.sh https://github.com/makeplane/plane/releases/latest/download/swarm.sh
chmod +x setup.sh
```

## راه‌اندازی اولیه

اسکریپت را اجرا کنید:

```bash
./setup.sh
```

در Docker Compose گزینهٔ `1) Install (x86_64)` و در Docker Swarm گزینهٔ `1) Deploy Stack` را انتخاب کنید. اسکریپت پوشهٔ `plane-app` و فایل‌های `docker-compose.yaml` و `plane.env` را می‌سازد. پس از پایان، با گزینهٔ ۸ در Compose یا ۷ در Swarm خارج شوید.

### تنظیم محیط

پیش از شروع سرویس‌ها، فایل `plane.env` را بازبینی کنید. مهم‌ترین متغیرها عبارت‌اند از:

- `LISTEN_HTTP_PORT`: پورت HTTP؛ مقدار پیش‌فرض `80`. پورت باید آزاد باشد.
- `WEB_URL`: دامنهٔ کامل و پورت برنامه، مانند `https://plane.example.com:8080` یا `http://[IP-ADDRESS]:8080`.
- `CORS_ALLOWED_ORIGINS`: origin مجاز frontend که معمولاً باید با `WEB_URL` هماهنگ باشد.

تنظیمات ایمیل را نیز برای دعوت اعضای تیم پیکربندی کنید.

### شروع سرویس‌ها

در Docker Compose دوباره `./setup.sh` را اجرا و گزینهٔ `2) Start` را انتخاب کنید. پس از دریافت ایمیج‌ها، برنامه از نشانی تنظیم‌شده در `WEB_URL` یا IP سرور در دسترس خواهد بود.

در Docker Swarm از گزینهٔ `1) Deploy Stack` استفاده کنید.

## عملیات مدیریتی

هر بار `./setup.sh` را اجرا و عملیات موردنظر را انتخاب کنید.

| عملیات | Docker Compose | Docker Swarm |
| --- | --- | --- |
| شروع یا deploy | `2) Start` | `1) Deploy Stack` |
| توقف یا حذف stack | `3) Stop` | `2) Remove Stack` |
| وضعیت stack | — | `3) View Stack Status` |
| راه‌اندازی مجدد | `4) Restart` | `4) Redeploy Stack` |
| ارتقا | `5) Upgrade` | `5) Upgrade` |
| مشاهدهٔ گزارش‌ها | `6) View Logs` | `6) View Logs` |
| پشتیبان‌گیری | `7) Backup Data` | — |

پیش از تغییر `plane.env` بهتر است سرویس‌ها را متوقف کنید. پس از تغییر تنظیمات، Restart یا Redeploy را اجرا کنید.

### ارتقا

انتخاب گزینهٔ Upgrade سرویس‌ها را متوقف و آخرین `docker-compose.yaml` و `plane.env` را دریافت می‌کند. پس از ارتقا، تغییرات `plane.env` را حتماً بازبینی کنید و سپس سرویس‌ها را با Start یا Redeploy بالا بیاورید.

### مشاهدهٔ گزارش‌ها

پس از انتخاب `View Logs`، یکی از سرویس‌های Web، Space، API، Worker، Beat-Worker، Migrator، Proxy، Redis، Postgres، MinIO یا RabbitMQ را انتخاب کنید. برای نمونه، عدد ۳ گزارش API را نمایش می‌دهد. برای خروج از گزارش زنده `Ctrl+C` را بزنید تا به منوی اصلی برگردید.

## پشتیبان‌گیری در Docker Compose

در `./setup.sh` گزینهٔ `7) Backup Data` را انتخاب کنید. volumeهای PostgreSQL، Redis و uploads در پوشه‌ای زمان‌دار زیر `plane-app/backup/` ذخیره می‌شوند.

## بازیابی در Docker Compose

1. نسخهٔ Community پلین را نصب و یک بار start و سپس stop کنید تا volumeها ساخته شوند.
2. اسکریپت بازیابی را کنار `setup.sh` دریافت کنید:

   ```bash
   curl -fsSL -o restore.sh https://github.com/makeplane/plane/releases/latest/download/restore.sh
   chmod +x restore.sh
   ```

3. مسیر پوشه‌ای را که فایل‌های `*.tar.gz` در آن قرار دارند به اسکریپت بدهید:

   ```bash
   ./restore.sh <path-to-backup-folder>
   ```

4. پس از بازیابی، پلین را با `./setup.sh start` اجرا کنید.

## بازیابی نسخهٔ Commercial آفلاین

1. اسکریپت مخصوص را دریافت کنید:

   ```bash
   curl -fsSL -o restore-airgapped.sh https://github.com/makeplane/plane/releases/latest/download/restore-airgapped.sh
   chmod +x restore-airgapped.sh
   ```

2. پوشهٔ پشتیبان و اسکریپت را به سرور Commercial Air-Gapped منتقل کنید.
3. نسخهٔ Commercial باید استخراج و متوقف شده باشد.
4. بازیابی را اجرا کنید:

   ```bash
   ./restore-airgapped.sh <path-to-backup-folder>
   ```

5. پس از پایان، نسخهٔ Commercial را با داده‌های بازیابی‌شده اجرا کنید.

<details>
  <summary>ارتقا از نسخهٔ ۰.۱۳.۲ به ۰.۱۴.x</summary>

این مهاجرت فقط یک بار لازم است. ابتدا نسخهٔ ۰.۱۴ را یک بار start و سپس stop کنید تا volumeهای مقصد ساخته شوند. بعد اسکریپت مهاجرت را دریافت کنید:

```bash
curl -fsSL -o migrate.sh https://raw.githubusercontent.com/makeplane/plane/master/deploy/selfhost/migration-0.13-0.14.sh
chmod +x migrate.sh
```

پیش از اجرا، نام volumeهای قدیمی و جدید را پیدا کنید:

```bash
docker volume ls -q | grep -i "_pgdata"
docker volume ls -q | grep -i "_uploads"
docker volume ls -q | grep -i "_redisdata"
```

سپس `./migrate.sh` را اجرا کنید. اسکریپت prefix مبدأ و مقصد را می‌خواهد؛ برای مثال اگر volumeها `v0132_redisdata` و `plane-app_redisdata` باشند، مبدأ `v0132` و مقصد `plane-app` است. خطای پیدانشدن volume معمولاً به prefix یا suffix نادرست مربوط می‌شود. خروج موفق بدون خطا پایان می‌یابد؛ پس از آن نسخهٔ ۰.۱۴ را دوباره اجرا کنید.

</details>
