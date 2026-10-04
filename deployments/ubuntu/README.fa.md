# استقرار کامل پروژه روی Ubuntu از طریق SSH

این راهنما برای دریافت پروژه از [مخزن company-crm](https://github.com/13Armin85/company-crm.git)، شاخه `main`، سرور Ubuntu با IP برابر `192.168.10.24` و کاربر `plane` است. فرمان‌های `powershell` روی ویندوز و فرمان‌های `bash` داخل SSH سرور اجرا می‌شوند. هر مرحله باید موفق شود، سپس مرحله بعد را اجرا کنید.

طبق انتخاب فعلی، برنامه روی `http://192.168.10.24` در شبکه شرکت منتشر می‌شود؛ دامنه و port forwarding روتر برای این حالت لازم نیست. برای دسترسی اینترنتی در آینده، بخش دامنه و HTTPS هم لازم است. فرض این راهنما نصب تازه است؛ دریافت سورس، دیتابیس و فایل‌های محیط توسعه را منتقل نمی‌کند. نسخه Ubuntu و منابع این سرور هنوز از طریق SSH بررسی نشده‌اند.

## ۱. اتصال به سرور

در PowerShell ویندوز:

```powershell
Set-Location 'C:\Users\11\Desktop\company-crm'
Test-NetConnection 192.168.10.24 -Port 22
ssh plane@192.168.10.24
```

تست باید `TcpTestSucceeded: True` بدهد. در اولین SSH، fingerprint را با مدیر سرور تطبیق دهید و سپس `yes` وارد کنید. رمز Linux کاربر `plane` را وارد کنید؛ نمایش ندادن کاراکترهای رمز طبیعی است. اگر کلید SSH دارید:

```powershell
ssh -i "$env:USERPROFILE\.ssh\id_ed25519" plane@192.168.10.24
```

اگر ویندوز فرمان `ssh` ندارد، در PowerShell با دسترسی Administrator اجرا و سپس ترمینال جدید باز کنید:

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
```

اگر پورت ۲۲ قابل دسترسی نیست، اتصال LAN/VPN و IP را بررسی کنید. در صورت نصب نبودن SSH، مدیر سرور از کنسول Ubuntu اجرا کند:

```bash
sudo apt-get update
sudo apt-get install -y openssh-server
sudo systemctl enable --now ssh
```

برای SSH با پورت متفاوت، `ssh -p PORT` و `scp -P PORT` را استفاده کنید؛ `PORT` را با پورت واقعی عوض کنید.

## ۲. بررسی Ubuntu، دسترسی و منابع

پس از SSH، روی سرور:

```bash
whoami
cat /etc/os-release
uname -m
nproc
free -h
df -h / /var/lib
ip -br addr
sudo -v
sudo ss -lntp
```

کاربر باید `plane` و توزیع باید Ubuntu باشد. IP `192.168.10.24` باید روی یکی از interfaceها وجود داشته باشد. برای ثابت ماندن IP، در DHCP روتر برای سرور reservation تنظیم کنید یا IP ثابت موجود را با مدیر شبکه هماهنگ کنید.

اگر `sudo -v` اجازه نداد، مدیر سیستم از حساب دارای sudo اجرا کند:

```bash
sudo usermod -aG sudo plane
```

سپس کاربر `plane` با `exit` خارج و دوباره SSH بزند. اگر پورت‌های ۸۰/۴۴۳ اشغال‌اند، با خروجی `ss` صاحب پورت را شناسایی کنید و پیش از deploy، پورت را آزاد یا reverse proxy موجود را تنظیم کنید.

برای برنامه‌ریزی یک نصب کوچک، ۴ هسته، ۸ گیگابایت RAM و حدود ۳۰ تا ۴۰ گیگابایت فضای آزاد برای build نقطه شروع مناسبی است؛ مصرف واقعی به بار برنامه و فایل‌ها بستگی دارد. اسکریپت با کمتر از ۲۰ GiB فضای آزاد در filesystem داده‌های Docker، build را شروع نمی‌کند. بزرگ بودن دیسک VM به‌تنهایی کافی نیست؛ فضای آزاد باید داخل filesystem Linux تخصیص یافته باشد.

سرور هنگام نصب و build به اینترنت برای apt، Docker images، npm، pip و Go نیاز دارد. ابزارهای برنامه داخل imageها نصب می‌شوند؛ آماده‌سازی میزبان با اسکریپت بخش ۴ انجام می‌شود.

## ۳. دریافت پروژه از GitHub روی سرور

داخل SSH سرور، با کاربر `plane`:

```bash
sudo apt-get update
sudo apt-get install -y git ca-certificates curl
cd "$HOME"
git clone --branch main --single-branch https://github.com/13Armin85/company-crm.git company-crm
cd "$HOME/company-crm"
git log -1 --oneline
ls docker-compose-production.yml deployments/ubuntu deployments/debian
```

مخزن در زمان بررسی عمومی است، پس clone با HTTPS به رمز GitHub نیاز ندارد. اگر خانه کاربر `/home/plane` است، مسیر نصب `/home/plane/company-crm` خواهد بود. clone را با `sudo` اجرا نکنید تا مالک فایل‌ها خود کاربر `plane` باشد. اگر پوشه `company-crm` از قبل وجود دارد، ابتدا محتوای آن را بررسی کنید؛ پوشه نصب یا داده‌های موجود را حذف یا با نسخه تازه جایگزین نکنید. برای checkout قبلی همین مخزن، از روند به‌روزرسانی بخش ۱۱ استفاده کنید.

اسکریپت‌های لازم و Compose مخصوص production در شاخه `main` موجودند؛ برای نصب اولیه، تغییر کد روی ویندوز لازم نیست. پیام راهنمای بعضی اسکریپت‌های نسخه GitHub ممکن است IP نمونه `192.168.10.20` را نشان دهد؛ مقدار عملیاتی در این راهنما `192.168.10.24` است و آن را به initializer می‌دهیم.

### تغییرات محلی و دریافت آن‌ها روی سرور

clone فقط commitهای ارسال‌شده به GitHub را دریافت می‌کند. اگر بعداً روی ویندوز کد یا اسکریپتی تغییر کرد، فایل‌های مربوط را بررسی، commit و push کنید. مثال برای فایل‌های استقرار فعلی، در PowerShell ویندوز:

```powershell
Set-Location 'C:\Users\11\Desktop\company-crm'
git status --short
git branch --show-current
git diff -- deployments/ubuntu deployments/debian
git add -- deployments/ubuntu/README.fa.md deployments/ubuntu/setup-server.sh deployments/debian/README.fa.md deployments/debian/init-env.sh deployments/debian/deploy.sh
git diff --cached
git commit -m "Document Ubuntu LAN deployment from GitHub"
git push origin HEAD
```

فهرست `git add` را متناسب با فایل‌هایی که قصد انتشارشان را دارید تنظیم کنید. اگر قبل از این مرحله فایل دیگری staged بوده، در `git diff --cached` آن را هم خواهید دید؛ تنها تغییرات موردنظر را commit کنید. اگر شاخه فعلی `main` نیست، push همان شاخه را ارسال می‌کند؛ برای دریافت با مسیر پیش‌فرض این راهنما باید ابتدا تغییرات را به `main` برسانید یا در clone نام همان شاخه را انتخاب کنید. `.env.production` حاوی رمزهای سرور است و باید خارج از Git بماند.

پس از push به `main`، روی سرور با `git pull --ff-only origin main` و deploy بخش ۱۱ تغییرات را دریافت کنید. برای نصب اولیه، همین clone کافی است.

### روش جایگزین: انتقال سورس محلی بدون GitHub

اگر لازم است تغییرات commit نشده محلی را منتقل کنید، این روش جایگزین clone است؛ برای نصب تازه فقط یکی از دو روش را اجرا کنید.

یک PowerShell دیگر روی ویندوز باز کنید:

```powershell
Set-Location 'C:\Users\11\Desktop\company-crm'
powershell -NoProfile -ExecutionPolicy Bypass -File .\deployments\debian\export-source.ps1
if ($LASTEXITCODE -ne 0) { throw 'ساخت آرشیو ناموفق بود؛ ادامه ندهید.' }
scp .\tmp\company-crm-source.tar.gz plane@192.168.10.24:company-crm-source.tar.gz
if ($LASTEXITCODE -ne 0) { throw 'انتقال فایل ناموفق بود؛ ادامه ندهید.' }
```

آرشیو شامل سورس فعلی با تغییرات commit نشده است. تنظیمات محلی، رمزها، dependencyها، خروجی build و داده‌های runtime از آرشیو خارج می‌شوند؛ قالب `production.env.example` داخل آن می‌ماند.

در ترمینال SSH سرور:

```bash
mkdir -p "$HOME/company-crm"
tar -xzf "$HOME/company-crm-source.tar.gz" -C "$HOME/company-crm"
cd "$HOME/company-crm"
find deployments/ubuntu deployments/debian apps/api/bin -type f -name '*.sh' -exec sed -i 's/\r$//' {} +
ls docker-compose-production.yml deployments/ubuntu deployments/debian
```

فرمان `find` پایان خط CRLF ویندوز را برای اسکریپت‌های Linux اصلاح می‌کند. در clone روی Ubuntu فایل‌های shell با پایان خط LF دریافت می‌شوند و این اصلاح لازم نیست. روش آرشیو تاریخچه `.git` را منتقل نمی‌کند؛ نصب آرشیوی را با آرشیو تازه به‌روزرسانی کنید.

## ۴. نصب Docker و ابزارهای میزبان

روی Ubuntu و از ریشه پروژه:

```bash
bash deployments/ubuntu/setup-server.sh
sudo docker version
sudo docker compose version
sudo docker run --rm hello-world
```

اسکریپت نسخه Ubuntu را تشخیص می‌دهد؛ Docker Engine، Buildx و Compose plugin را در صورت نیاز از [مخزن رسمی Docker برای Ubuntu](https://docs.docker.com/engine/install/ubuntu/) نصب می‌کند؛ OpenSSL، nano و tmux را آماده و Docker را برای اجرا پس از boot فعال می‌کند. ممکن است رمز sudo درخواست شود.

اگر همه ابزارها از قبل نصب‌اند، `bash deployments/ubuntu/setup-server.sh --no-install` آماده بودن آن‌ها را بررسی و Docker را فعال می‌کند. جزئیات دستورات دستی نصب در بخش ۳ [راهنمای مشترک](../debian/README.fa.md) آمده است.

اگر اسکریپت تعارض بسته‌ها را گزارش داد، با بررسی برنامه‌های موجود و طبق مستندات Docker تعارض را رفع کنید؛ اسکریپت runtime برنامه‌های دیگر را حذف نمی‌کند. در صورت خطای دانلود، DNS، اینترنت و دسترسی به registry اعلام‌شده در خطا را بررسی و پس از رفع خطا فرمان را دوباره اجرا کنید.

## ۵. ساخت تنظیمات و رمزهای production

روی سرور:

```bash
cd "$HOME/company-crm"
bash deployments/ubuntu/init-env.sh http://192.168.10.24
nano .env.production
```

اسکریپت Ubuntu همان initializer مشترک `deployments/debian/init-env.sh` را اجرا می‌کند. برای نصب تازه، رمزهای مستقل تصادفی تولید و فایل `.env.production` را با permission برابر `600` می‌سازد. اگر فایل موجود باشد آن را حفظ می‌کند؛ برای تغییر آدرس نصب قبلی، فایل موجود را دستی ویرایش کنید.

مقادیر زیر را بررسی کنید؛ `BIND_ADDRESS` را از مقدار اولیه `0.0.0.0` به IP سرور تغییر دهید:

```dotenv
PUBLIC_URL=http://192.168.10.24
SITE_ADDRESS=http://192.168.10.24
BIND_ADDRESS=192.168.10.24
ALLOWED_HOSTS=192.168.10.24,localhost,127.0.0.1,api
MINIO_ENDPOINT_SSL=0
PGADMIN_EMAIL=your-admin@example.com
```

`PGADMIN_EMAIL` را با ایمیل معتبر مدیر عوض کنید. سایر کلیدها و رمزهای تولیدشده را حفظ کنید. ذخیره در nano با `Ctrl+O` و Enter و خروج با `Ctrl+X` است. `PUBLIC_URL` باید بدون مسیر، بدون پورت سفارشی و بدون `/` انتهایی باشد؛ این Compose روی پورت استاندارد ۸۰/۴۴۳ کار می‌کند.

تنظیمات سرور در `.env.production` است؛ `docker-compose-production.yml` مقادیر را به سرویس‌ها می‌دهد. پس از ایجاد داده‌های PostgreSQL/صف، تغییر رمز تنها در env، رمز موجود داخل آن سرویس‌ها را تغییر نمی‌دهد. به‌ویژه `SECRET_KEY` را در به‌روزرسانی و restore نگه دارید؛ تنظیمات ذخیره‌شده برنامه به آن وابسته‌اند.

## ۶. build، migration و اجرای همه سرویس‌ها

روی سرور:

```bash
tmux new -s plane-deploy
cd "$HOME/company-crm"
bash deployments/ubuntu/deploy.sh
```

اسکریپت تنظیمات و فضای دیسک را بررسی می‌کند، imageها را از همین سورس با build ترتیبی می‌سازد، زیرساخت را بالا می‌آورد، برای سلامت آن منتظر می‌ماند، migration دیتابیس را اجرا می‌کند و سپس سرویس‌های برنامه را در پس‌زمینه اجرا می‌کند. هر خطا، ادامه استقرار را متوقف و مرحله خطادار را اعلام می‌کند.

سرویس‌های دائمی عبارت‌اند از `web`، `admin`، `space`، `live`، `api`، `worker`، `beat-worker`، `proxy`، `plane-db`، `plane-redis`، `plane-mq` و `plane-minio`. `migrator` هنگام استقرار اجرا و خارج می‌شود. pgAdmin اختیاری است و در بخش ۸ فعال می‌شود.

برای جدا شدن از tmux، `Ctrl+B` و سپس `D` را بزنید. اگر SSH قطع شد، دوباره وصل شوید و ادامه خروجی را ببینید:

```bash
tmux attach -t plane-deploy
```

پس از deploy موفق، بستن SSH سرویس‌ها را متوقف نمی‌کند. فعال بودن Docker و سیاست `restart: unless-stopped` اجرای سرویس‌های فعال را پس از reboot حفظ می‌کنند. اگر عمداً `stop` کرده باشید، برای شروع مجدد deploy را با `--no-build` اجرا کنید.

معادل دستی مراحل، هر فرمان پس از موفقیت فرمان قبلی:

```bash
cd "$HOME/company-crm"
dc() { sudo docker compose --env-file .env.production -f docker-compose-production.yml "$@"; }
export COMPOSE_PARALLEL_LIMIT=1
dc config --quiet
dc build --pull
dc up -d --wait --wait-timeout 600 plane-db plane-redis plane-mq plane-minio
dc run --rm --no-deps migrator
dc up -d --wait --wait-timeout 900 api worker beat-worker web admin space live proxy
dc ps -a
```

## ۷. بررسی و ساخت حساب مدیر

در هر SSH تازه، از ریشه پروژه تابع کوتاه‌شده Compose را تعریف کنید:

```bash
cd "$HOME/company-crm"
dc() { sudo docker compose --env-file .env.production -f docker-compose-production.yml "$@"; }
dc ps -a
dc logs --tail 100 api worker beat-worker live proxy
curl -fsS http://192.168.10.24/api/instances/
curl -fsS http://192.168.10.24/live/health/
curl -I http://192.168.10.24/
```

در PowerShell ویندوز هم دسترسی وب را بررسی کنید:

```powershell
Test-NetConnection 192.168.10.24 -Port 80
```

در مرورگر کامپیوترتان:

| بخش | آدرس |
| --- | --- |
| ساخت حساب مدیر و تنظیم instance | http://192.168.10.24/god-mode/ |
| برنامه اصلی | http://192.168.10.24/ |
| صفحات منتشرشده | http://192.168.10.24/spaces/ |

ابتدا فرم God mode را با ایمیل و رمز مدیر تکمیل کنید، سپس وارد برنامه شوید و workspace بسازید. ورود، ساخت کار، upload/download فایل و ویرایش هم‌زمان در دو مرورگر را آزمایش کنید؛ هنگام انجام کارها لاگ worker را هم ببینید.

برای ایمیل دعوت، بازیابی رمز و ورود با کد ایمیلی، SMTP واقعی را در تنظیمات Email/Authentication در God mode وارد کنید: میزبان، پورت، نام کاربری، رمز و حالت TLS/SSL مطابق سرویس ایمیل شما. ابتدا روش ورود با رمز را آماده و سپس ارسال ایمیل را آزمایش کنید.

## ۸. pgAdmin و کنسول MinIO با تونل SSH

برای فعال کردن پنل اختیاری دیتابیس، روی سرور با تابع `dc` بخش ۷:

```bash
dc --profile tools up -d --wait --wait-timeout 180 pgadmin
nano .env.production
```

نام کاربری و رمز موردنیاز را از فایل بخوانید. در یک PowerShell ویندوزی دیگر، تونل را باز و ترمینالش را باز نگه دارید:

```powershell
ssh -N -L 5050:127.0.0.1:5050 -L 9090:127.0.0.1:9090 plane@192.168.10.24
```

pgAdmin در `http://localhost:5050` با `PGADMIN_EMAIL` و `PGADMIN_PASSWORD` و کنسول MinIO در `http://localhost:9090` با `AWS_ACCESS_KEY_ID` و `AWS_SECRET_ACCESS_KEY` باز می‌شود. در pgAdmin یک Server ثبت کنید: Host برابر `plane-db`، Port برابر `5432`، Maintenance database برابر `POSTGRES_DB`، Username برابر `POSTGRES_USER` و Password برابر `POSTGRES_PASSWORD` فایل env.

## ۹. انتشار روی اینترنت با دامنه و HTTPS

اگر استفاده فقط در شبکه شرکت است، مراحل قبلی انتشار LAN را کامل کرده‌اند. برای اینترنت، `crm.example.com` نمونه است؛ همه‌جا آن را با دامنه واقعی خود عوض کنید.

1. در DNS دامنه، رکورد A برای `crm` را به IP عمومی شرکت وصل کنید. AAAA فقط در صورت داشتن مسیر IPv6 صحیح لازم است.
2. روی روتر، TCP پورت ۸۰ عمومی را به `192.168.10.24:80` و TCP پورت ۴۴۳ عمومی را به `192.168.10.24:443` forward کنید. IP داخلی سرور باید ثابت بماند.
3. دسترسی ورودی این دو پورت را در firewall شبکه باز کنید. اگر شرکت پشت CGNAT است، ابتدا IP عمومی قابل ورود یا راهکار VPN/تونل مناسب تهیه کنید.
4. برای دسترسی از داخل شرکت هم دامنه باید کار کند: NAT loopback روتر یا DNS داخلی که دامنه را به `192.168.10.24` resolve کند. دسترسی به همین دامنه از containerها را هم بررسی کنید، چون Spaces برای metadata از آدرس عمومی API استفاده می‌کند.

برای تغییر نصب LAN موجود، روی سرور فایل env را ویرایش و رمزها را حفظ کنید:

```bash
cd "$HOME/company-crm"
nano .env.production
```

مقادیر مربوط به آدرس:

```dotenv
PUBLIC_URL=https://crm.example.com
SITE_ADDRESS=https://crm.example.com
BIND_ADDRESS=192.168.10.24
ALLOWED_HOSTS=crm.example.com,localhost,127.0.0.1,api
MINIO_ENDPOINT_SSL=1
```

سپس فرانت‌اندها را با آدرس جدید دوباره build کنید:

```bash
bash deployments/ubuntu/deploy.sh
dc logs --tail 100 proxy
curl -I https://crm.example.com/
curl -fsS https://crm.example.com/api/instances/
curl -fsS https://crm.example.com/live/health/
```

در تغییر IP یا دامنه، `--no-build` کافی نیست، چون آدرس‌ها داخل build فرانت‌اند قرار می‌گیرند. بعد از تغییر origin، با HTTPS جدید وارد شوید. با DNS و دسترسی پورت‌های صحیح، Caddy [گواهی را خودکار دریافت و تمدید می‌کند](https://caddyserver.com/docs/automatic-https). اگر مستقیماً نصب اینترنتی تازه می‌کنید، در بخش ۵ از `bash deployments/ubuntu/init-env.sh https://YOUR_REAL_DOMAIN` استفاده کنید.

## ۱۰. فایروال و پورت‌ها

روی سرور برای مشاهده وضعیت:

```bash
sudo ss -lntp
sudo ufw status verbose
```

اگر UFW نصب و فعال است، با فرض پورت SSH برابر ۲۲، قواعد لازم را اضافه کنید:

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

پورت SSH واقعی را اجازه دهید تا اتصال مدیریت برقرار بماند. محدودیت دسترسی به وب را متناسب با LAN یا اینترنت در firewall شبکه اعمال کنید. [ترافیک پورت‌های منتشرشده Docker می‌تواند قواعد UFW را دور بزند](https://docs.docker.com/engine/network/packet-filtering-firewalls/#docker-and-ufw)، بنابراین UFW به‌تنهایی محدودیت مبدأ برای containerها ایجاد نمی‌کند.

Compose فقط وب را روی IP سرور منتشر می‌کند. PostgreSQL، Valkey، RabbitMQ و API پورت میزبان ندارند؛ pgAdmin و کنسول MinIO فقط روی loopback هستند. مدیریت این پنل‌ها با تونل بخش ۸ انجام می‌شود.

## ۱۱. توقف، شروع مجدد و به‌روزرسانی

در هر SSH تازه:

```bash
cd "$HOME/company-crm"
dc() { sudo docker compose --env-file .env.production -f docker-compose-production.yml "$@"; }
```

فرمان‌های مستقل روزمره؛ فقط فرمان موردنیازتان را اجرا کنید:

```bash
dc ps -a
dc logs -f --tail 100 api worker live proxy
dc restart api
dc stop
bash deployments/ubuntu/deploy.sh --no-build
```

در لاگ زنده، `Ctrl+C` فقط مشاهده لاگ را متوقف می‌کند. `dc stop` همه سرویس‌های در حال اجرای همین پروژه را متوقف می‌کند. `--no-build` برای شروع دوباره با imageهای موجود است.

برای انتشار تغییرات کد در نصب Git، ابتدا backup بخش ۱۲ را بگیرید و تغییرات ویندوز را به `main` در GitHub ارسال کنید. سپس روی سرور:

```bash
cd "$HOME/company-crm"
git status --short
git pull --ff-only origin main
git log -1 --oneline
bash deployments/ubuntu/deploy.sh
```

اگر `git status` تغییرات فایل‌های tracked را نشان می‌دهد، پیش از pull آن‌ها را بررسی و حفظ کنید؛ از reset برای پاک کردن تغییرات استفاده نکنید. اگر pull خطا داد، deploy را اجرا نکنید. `.env.production` نادیده گرفته می‌شود و volumeهای Docker مستقل از checkout هستند؛ تنظیمات و داده‌های production باقی می‌مانند. با تغییر IP یا URL باید مقادیر بخش ۵ هم ویرایش و فرانت‌اندها دوباره build شوند.

در نصب آرشیوی، روی ویندوز دوباره آرشیو بسازید و با `scp` منتقل کنید؛ روی سرور همان فرمان‌های استخراج بخش ۳ و `bash deployments/ubuntu/deploy.sh` را اجرا کنید. استخراج آرشیو، فایل‌هایی را که از سورس جدید حذف شده‌اند پاک نمی‌کند؛ برای نسخه‌های دارای حذف فایل از checkout تازه با انتقال env یا Git حاوی همان تغییرات استفاده کنید.

از دستور `down -v` برای به‌روزرسانی استفاده نکنید؛ volumeها و داده‌های نصب را حذف می‌کند. حفظ همان نام پروژه Compose یعنی `plane-production` برای اتصال به volumeهای فعلی لازم است.

## ۱۲. پشتیبان‌گیری

این backup شامل env، دیتابیس و فایل‌های آپلودشده است. برای هماهنگی DB و فایل‌ها، نویسنده‌های برنامه موقتاً متوقف می‌شوند؛ در این بازه برنامه از دسترس خارج می‌شود. هر فرمان باید موفق شود، سپس ادامه دهید:

```bash
cd "$HOME/company-crm"
dc() { sudo docker compose --env-file .env.production -f docker-compose-production.yml "$@"; }
sudo docker pull alpine:3.22
umask 077
backup_dir="$HOME/plane-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
cp .env.production "$backup_dir/env.production"
if [[ -d .git ]]; then git rev-parse HEAD > "$backup_dir/source-commit.txt"; fi
dc stop proxy web admin space live api worker beat-worker plane-minio
dc exec -T plane-db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_dir/database.dump"
test -s "$backup_dir/database.dump"
sudo docker run --rm --network none --mount type=volume,src=plane-production_uploads,dst=/data,readonly --mount "type=bind,src=$backup_dir,dst=/backup" alpine:3.22 tar -czf /backup/uploads.tar.gz -C /data .
sudo chown "$(id -un):$(id -gn)" "$backup_dir/uploads.tar.gz"
bash deployments/ubuntu/deploy.sh --no-build
ls -lh "$backup_dir"
```

اگر backup خطا داد، قبل از بررسی بیشتر برای بازگرداندن سرویس‌ها deploy را با `--no-build` اجرا کنید. یک کپی خارج از این سرور نگه دارید. در PowerShell، نام پوشه نمونه را با نام واقعی خروجی بالا عوض کنید:

```powershell
New-Item -ItemType Directory -Force -Path .\tmp\server-backups | Out-Null
scp -r plane@192.168.10.24:plane-backups/REPLACE_WITH_BACKUP_DIRECTORY .\tmp\server-backups\
```

داده‌های صف/کش و گواهی‌های Caddy در این backup نیستند. روش restore در نصب تازه و محدودیت‌های آن در بخش ۱۲ [راهنمای مشترک](../debian/README.fa.md) آمده است. restore را در محیط جداگانه آزمایش کنید.

## ۱۳. عیب‌یابی و آزمون‌ها

با تابع `dc` بخش ۷:

```bash
dc ps -a
dc logs --tail 200 plane-db plane-mq plane-minio api worker live proxy
sudo docker system df
df -h / /var/lib
free -h
```

- `Permission denied` در SSH: رمز/کلید و حساب `plane` را بررسی کنید.
- `port is already allocated`: صاحب پورت را با `sudo ss -lntp` پیدا کنید.
- `cannot assign requested address`: IP مقدار `BIND_ADDRESS` باید روی سرور وجود داشته باشد.
- `no space left on device` یا `Build stopped`: فضای آزاد filesystem داده‌های Docker را افزایش دهید.
- `Killed` یا `exit 137`: حافظه و لاگ OOM سیستم را بررسی کنید؛ build ممکن است RAM بیشتری نیاز داشته باشد.
- خطای registry، npm، pip یا Go: DNS، اینترنت و میزبان دانلود گزارش‌شده را بررسی کنید.
- `502` یا `unhealthy`: لاگ همان سرویس را بررسی کنید؛ قبل از ادامه خطا را رفع کنید.
- پس از تغییر دامنه هنوز درخواست‌ها به IP قبلی می‌روند: env و build دوباره فرانت‌اندها را بررسی کنید.
- upload موفق نیست: لاگ API/MinIO، آدرس عمومی، `MINIO_ENDPOINT_SSL` و `FILE_SIZE_LIMIT` را بررسی کنید؛ مقدار پیش‌فرض حدود ۵ MiB است.

آزمون‌های محلی اسکریپت‌ها، روی ویندوز از ریشه مخزن:

```powershell
python -m unittest discover -s deployments/debian/tests -v
```

این آزمون‌ها Docker و apt را شبیه‌سازی می‌کنند و بسته‌ای روی میزبان نصب نمی‌کنند؛ آزمون Compose فقط به CLI نیاز دارد. build واقعی imageها و اجرای روی Ubuntu باید با فرمان‌های این راهنما روی سرور تأیید شوند.
