# انتشار همین پروژه روی Debian یا Ubuntu از طریق SSH

مقصد اصلی `192.168.10.20` و مقصد تست `192.168.10.24` است. هر دو با کاربر SSH برابر `plane` استفاده می‌شوند؛ برای تست، IP را در فرمان‌های اتصال و initializer عوض کنید. انتشار مستقیماً با Docker Engine روی Linux انجام می‌شود؛ Windows Server یا IIS برای این مسیر لازم نیست.

این راهنما برای کاربر `plane` روی سرور `192.168.10.20` است. کد روی ویندوز آماده و منتقل می‌شود؛ build و اجرای production روی Debian یا Ubuntu انجام می‌شود. نسخه دقیق Ubuntu و منابع این سرور هنوز بررسی نشده‌اند؛ دستورات نصب Docker پایین، توزیع را از `/etc/os-release` می‌خوانند. فرض اولیه نصب تازه است. انتقال اطلاعات محیط توسعه، کاری جدا از انتقال سورس است؛ بخش پشتیبان‌گیری و بازیابی را ببینید.

دو محل اجرای دستور داریم: **PowerShell کامپیوتر ویندوزی** و **Bash سرور بعد از SSH**. بلوک‌های `powershell` را روی ویندوز و بلوک‌های `bash` را روی سرور اجرا کنید.

برای مسیر Ubuntu، [راهنمای آماده‌سازی و اجرای Ubuntu](../ubuntu/README.fa.md) شامل اسکریپت نصب میزبان است. پس از انتقال سورس می‌توانید `bash deployments/ubuntu/setup-server.sh` را اجرا کنید؛ سپس initializer و deploy هم از مسیر `deployments/ubuntu/` قابل اجرا هستند.

## ۱. معماری و نیازهای سرور

مسیر درخواست‌ها چنین است:

```text
Browser -> Linux :80/:443 -> Caddy proxy
                               |-> web
                               |-> admin (/god-mode/)
                               |-> space (/spaces/)
                               |-> live (/live/, WebSocket)
                               |-> api (/api/, /auth/)
                               |-> MinIO (/uploads/)

api + worker + beat-worker -> PostgreSQL + Valkey + RabbitMQ + MinIO
```

`docker-compose-production.yml` تمام سرویس‌های برنامه را از سورس همین پوشه می‌سازد. `migrator` هنگام نصب و به‌روزرسانی اجرا می‌شود و سپس خارج می‌شود؛ سرویس دائمی نیست. pgAdmin پنل کمکی دیتابیس است و با profile اختیاری `tools` اجرا می‌شود.

برای برنامه‌ریزی یک نصب کوچک، ۴ هسته، ۸ گیگابایت RAM و حدود ۶۰ گیگابایت فضای دیسک نقطه شروع مناسبی است؛ این اعداد تضمین مصرف یا حداقل قطعی نیستند. مصرف واقعی به کاربران و فایل‌ها بستگی دارد. ساخت چند فرانت‌اند و MinIO حافظه و فضای بیشتری از اجرای عادی مصرف می‌کند. اسکریپت build را به‌صورت ترتیبی اجرا می‌کند. لازم نیست Node، pnpm، Python یا PostgreSQL را روی میزبان نصب کنید؛ ابزارها داخل Docker هستند.

فضای آزاد این سرور را پیش از build بررسی کنید. برای ساخت همه imageها و نگهداری cache، بهتر است حدود ۳۰ تا ۴۰ گیگابایت فضای آزاد فراهم شود. این برآورد برای برنامه‌ریزی است و مصرف دقیق با build مشخص می‌شود. ممکن است دیسک VM بزرگ‌تر باشد و فقط بخشی از آن به LVM ریشه اختصاص یافته باشد. برای تشخیص، این دستورهای فقط‌خواندنی را اجرا کنید:

```bash
nproc
lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINTS
sudo vgs
sudo lvs
```

اگر در ستون `VFree` فضای آزاد وجود داشته باشد، می‌توان با بررسی filesystem و مسیر logical volume، ظرفیت ریشه را از همان فضای آزاد بیشتر کرد. در غیر این صورت باید ظرفیت دیسک VM یا دیسک محل داده‌های Docker افزایش یابد. دستور تغییر partition یا LVM را پس از بررسی این خروجی‌ها انتخاب کنید.

سرور به اینترنت برای apt، imageها، npm، pip و Go نیاز دارد. اجرای دستورها باید با Bash و کاربر دارای `sudo` انجام شود. مسیر نصب در این راهنما `/home/plane/company-crm` است؛ اگر home کاربر متفاوت است، خروجی `echo "$HOME"` را مبنا قرار دهید.

## ۲. اتصال از ویندوز

در PowerShell:

```powershell
Test-NetConnection 192.168.10.20 -Port 22
ssh plane@192.168.10.20
```

در اولین اتصال، fingerprint کلید میزبان را با مدیر سرور تطبیق دهید، سپس `yes` وارد کنید. رمز Linux کاربر `plane` را وارد کنید؛ هنگام تایپ رمز چیزی نمایش داده نمی‌شود. اگر از کلید SSH موجود استفاده می‌کنید:

```powershell
ssh -i "$env:USERPROFILE\.ssh\id_ed25519" plane@192.168.10.20
```

اگر `ssh` روی ویندوز وجود ندارد، در PowerShell با دسترسی Administrator کلاینت OpenSSH را نصب و یک ترمینال تازه باز کنید:

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0
```

اگر پورت SSH سرور به‌جای ۲۲ مقدار دیگری است، از `ssh -p PORT` و `scp -P PORT` استفاده کنید. برای timeout، ارتباط شبکه/VPN، IP و سرویس SSH سرور را بررسی کنید. در کنسول خود سرور، مدیر سیستم می‌تواند اجرا کند:

```bash
sudo apt-get update
sudo apt-get install -y openssh-server
sudo systemctl enable --now ssh
```

روی سرور، مشخصات و دسترسی را ببینید:

```bash
whoami
cat /etc/os-release
uname -m
free -h
df -h / /var/lib
ip -br addr
sudo -v
sudo ss -lntp
```

اگر `plane` عضو sudo نیست، مدیر سرور از کنسول یا حساب root اجرا کند:

```bash
apt-get update
apt-get install -y sudo
usermod -aG sudo plane
```

سپس کاربر `plane` از SSH خارج و دوباره وارد شود. برای اشغال بودن پورت ۸۰ یا ۴۴۳، برنامه صاحب پورت را با `ss` شناسایی کنید. قبل از ادامه، پورت آزاد یا reverse proxy موجود باید طبق معماری شما تنظیم شود؛ اسکریپت سرویس‌های دیگر سرور را متوقف نمی‌کند.

## ۳. نصب Docker Engine و Compose روی Debian یا Ubuntu

اگر `sudo docker version` و `sudo docker compose version` موفق‌اند، نیاز به نصب دوباره نیست. برای نصب تازه، مطابق مستندات رسمی [Docker برای Ubuntu](https://docs.docker.com/engine/install/ubuntu/) یا [Docker برای Debian](https://docs.docker.com/engine/install/debian/) عمل کنید. Ubuntu 26.04 در فهرست نسخه‌های پشتیبانی‌شده Docker است. بلوک زیر، مخزن همان توزیع را انتخاب می‌کند:

روی Ubuntu، پس از انتقال پروژه، اسکریپت `bash deployments/ubuntu/setup-server.sh` همین آماده‌سازی را انجام می‌دهد و با خطا متوقف می‌شود. دستورات دستی پایین نیز قابل استفاده‌اند.

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl openssl nano tmux
docker_distro=$(. /etc/os-release && printf '%s' "$ID")
docker_codename=$(. /etc/os-release && printf '%s' "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL "https://download.docker.com/linux/$docker_distro/gpg" -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/$docker_distro
Suites: $docker_codename
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
sudo docker run --rm hello-world
```

این بلوک برای `ID=ubuntu` یا `ID=debian` است. اگر قبلاً دستور قدیمی Debian را روی Ubuntu اجرا کرده‌اید، همین بلوک، کلید و فایل `/etc/apt/sources.list.d/docker.sources` را با مقادیر درست Ubuntu جایگزین می‌کند. اگر قبلاً بسته‌های `docker.io`، `docker-compose`، `podman-docker`، `containerd` یا `runc` نصب شده‌اند و نصب conflict می‌دهد، طبق مستندات Docker و با بررسی workloadهای موجود، تعارض بسته‌ها را رفع کنید.

در این راهنما فرمان‌های Docker با `sudo` اجرا می‌شوند. اگر Docker از قبل نصب است، ابزارهای میزبان را جداگانه نصب کنید:

```bash
sudo apt-get update
sudo apt-get install -y openssl nano tmux
```

## ۴. انتقال سورس فعلی ویندوز، همراه تغییرات commit نشده

برای انتقال کد موجود در IDE، در **PowerShell ویندوز** یک آرشیو بسازید. این فرمان، dependencyها، خروجی build، تنظیمات محرمانه و داده‌های runtime را منتقل نمی‌کند. قالب مخصوص سرور، `production.env.example`، داخل آرشیو می‌ماند.

```powershell
Set-Location 'C:\Users\11\Desktop\company-crm'
powershell -NoProfile -ExecutionPolicy Bypass -File .\deployments\debian\export-source.ps1
if ($LASTEXITCODE -ne 0) { throw 'ساخت آرشیو ناموفق بود؛ انتقال را ادامه ندهید.' }
scp .\tmp\company-crm-source.tar.gz plane@192.168.10.20:company-crm-source.tar.gz
if ($LASTEXITCODE -ne 0) { throw 'انتقال آرشیو ناموفق بود.' }
```

روی **سرور**:

```bash
mkdir -p "$HOME/company-crm"
tar -xzf "$HOME/company-crm-source.tar.gz" -C "$HOME/company-crm"
cd "$HOME/company-crm"
ls docker-compose-production.yml deployments/debian
```

برای رفع احتمالی CRLF فایل‌های shell منتقل‌شده از ویندوز:

```bash
find deployments/ubuntu deployments/debian apps/api/bin -type f -name '*.sh' -exec sed -i 's/\r$//' {} +
```

در صورت داشتن remote حاوی همین تغییرات، می‌توانید به‌جای آرشیو، با `git clone YOUR_REPOSITORY_URL "$HOME/company-crm"` کد را دریافت کنید. نصب‌کننده عمومی Plane یا imageهای آماده upstream، سفارشی‌سازی‌های این مخزن را شامل نمی‌شوند.

## ۵. تنظیم آدرس و secrets نصب تازه

برای انتشار اولیه داخل شبکه:

```bash
cd "$HOME/company-crm"
bash deployments/debian/init-env.sh http://192.168.10.20
nano .env.production
```

اسکریپت برای PostgreSQL، RabbitMQ، MinIO، Django، Live و pgAdmin مقدار تصادفی مستقل تولید می‌کند و فایل را با permission `600` می‌سازد. رمزها را چاپ نمی‌کند. اجرای دوباره، فایل موجود را حفظ می‌کند. در nano، `Ctrl+O` و Enter برای ذخیره، `Ctrl+X` برای خروج است.

مقادیر مهم برای حالت LAN:

```dotenv
PUBLIC_URL=http://192.168.10.20
SITE_ADDRESS=http://192.168.10.20
BIND_ADDRESS=192.168.10.20
ALLOWED_HOSTS=192.168.10.20,localhost,127.0.0.1,api
MINIO_ENDPOINT_SSL=0
PGADMIN_EMAIL=your-admin@example.com
```

`BIND_ADDRESS` را از مقدار اولیه `0.0.0.0` به IP همین سرور تغییر دهید. IP باید در خروجی `ip -br addr` وجود داشته باشد. سایر مقادیر تصادفی را نگه دارید. همه تنظیمات backend از این یک فایل گرفته می‌شوند؛ نیازی به ساخت یا ویرایش `apps/api/.env` برای این Compose نیست. `PUBLIC_URL` یک origin بدون مسیر، بدون `/` انتهایی و بدون پورت سفارشی است. این پیکربندی از پورت‌های استاندارد ۸۰/۴۴۳ استفاده می‌کند.

پس از ساخت volumeهای دیتابیس/صف، تغییر رمز فقط در env رمز موجود داخل داده‌های آن سرویس را تغییر نمی‌دهد. `SECRET_KEY` برای decrypt کردن تنظیمات ذخیره‌شده هم استفاده می‌شود؛ آن را در استقرارهای بعدی و بازیابی حفظ کنید.

## ۶. build، migration و اجرای همه سرویس‌ها

برای اینکه قطع شدن SSH، build را متوقف نکند، یک جلسه tmux ایجاد کنید:

```bash
tmux new -s plane-deploy
cd "$HOME/company-crm"
bash deployments/debian/deploy.sh
```

این اسکریپت تنظیمات را بررسی می‌کند، imageها را از کد فعلی می‌سازد، برای آماده شدن زیرساخت منتظر می‌ماند، migration را اجرا می‌کند و بعد تمام سرویس‌های برنامه را در پس‌زمینه بالا می‌آورد. اگر migration خطا دهد ادامه نمی‌دهد. اجرای اول، بسته به اینترنت و منابع، ممکن است طولانی شود. در صورت قطع ارتباط، دوباره SSH بزنید و با `tmux attach -t plane-deploy` برگردید. برای جدا شدن از tmux، `Ctrl+B` و سپس `D` را بزنید.

پیش از build، فضای filesystem محل داده‌های Docker بررسی می‌شود؛ با کمتر از ۲۰ GiB آزاد، build شروع نمی‌شود. این بررسی اولیه تضمین کافی بودن فضای build نیست؛ ۳۰ تا ۴۰ گیگابایت آزاد برای برنامه‌ریزی پیشنهاد می‌شود. حد بررسی با متغیر عدد صحیح مثبت `PLANE_BUILD_MIN_FREE_GB` قابل تنظیم است. حالت `--no-build` این بررسی مربوط به ساخت image را اجرا نمی‌کند.

معادل دستی همان مراحل، برای بررسی یا کنترل جداگانه:

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

هر فرمان باید موفق شود، سپس فرمان بعدی را اجرا کنید. `dc` فقط یک تابع کوتاه‌شده برای همان Compose است؛ با هر اتصال SSH تازه باید تعریفش کنید. برای استفاده از imageهای موجود، بدون build:

```bash
bash deployments/debian/deploy.sh --no-build
```

نیازی به `pnpm dev`، `start.sh` یا `setup-dev.sh` روی سرور production نیست. restart policy سرویس‌ها و فعال بودن Docker، اجرای آن‌ها پس از boot را حفظ می‌کند. خروج از SSH سرویس‌های اجراشده با `-d` را متوقف نمی‌کند.

## ۷. بررسی، ساخت حساب مدیر و آدرس‌ها

روی سرور:

```bash
cd "$HOME/company-crm"
dc() { sudo docker compose --env-file .env.production -f docker-compose-production.yml "$@"; }
dc ps -a
dc logs --tail 100 api worker beat-worker live proxy
curl -fsS http://192.168.10.20/api/instances/
curl -fsS http://192.168.10.20/live/health/
curl -I http://192.168.10.20/
```

در مرورگر **کامپیوتر خودتان**:

| بخش                          | آدرس LAN                            |
| ---------------------------- | ----------------------------------- |
| برنامه اصلی                  | http://192.168.10.20/               |
| راه‌اندازی و مدیریت instance | http://192.168.10.20/god-mode/      |
| صفحات منتشرشده               | http://192.168.10.20/spaces/        |
| API                          | http://192.168.10.20/api/instances/ |
| سلامت Live                   | http://192.168.10.20/live/health/   |

در نصب تازه، `/god-mode/` را باز کنید و فرم راه‌اندازی instance را با ایمیل و رمز دلخواه مدیر تکمیل کنید. سپس وارد برنامه اصلی شوید و workspace بسازید. این نصب، حساب‌های نمونه README محیط توسعه را ایجاد نمی‌کند.

از داخل برنامه، ورود، ساخت یک کار، upload/download یک فایل و ویرایش هم‌زمان یک صفحه در دو مرورگر را بررسی کنید. وضعیت `running` worker به‌تنهایی عملکرد صف را اثبات نمی‌کند؛ هنگام این آزمایش لاگ worker را هم ببینید.

ایمیل دعوت، بازیابی رمز و ورود با کد ایمیلی به SMTP واقعی نیاز دارد. تنظیمات Email/Authentication را در God mode تکمیل کنید؛ نصب Docker به‌تنهایی ایمیل ارسال نمی‌کند. ابتدا حساب مدیر و روش ورود با رمز را راه‌اندازی کنید.

## ۸. پنل دیتابیس و کنسول فایل‌ها از طریق تونل SSH

pgAdmin را روی **سرور** اجرا کنید:

```bash
dc --profile tools up -d pgadmin
grep '^PGADMIN_' .env.production
```

در یک **PowerShell ویندوزی جداگانه**، تونل را باز نگه دارید:

```powershell
ssh -N -L 5050:127.0.0.1:5050 -L 9090:127.0.0.1:9090 plane@192.168.10.20
```

اکنون pgAdmin در http://localhost:5050 و کنسول MinIO در http://localhost:9090 قابل استفاده‌اند. رمز pgAdmin همان `PGADMIN_PASSWORD` است؛ برای MinIO از `AWS_ACCESS_KEY_ID` و `AWS_SECRET_ACCESS_KEY` در `.env.production` استفاده کنید.

در pgAdmin، یک Server ثبت کنید: Host برابر `plane-db`، Port برابر `5432`، Maintenance database برابر `plane`، Username برابر `POSTGRES_USER` و Password برابر `POSTGRES_PASSWORD` فایل env. ترافیک اتصال از container pgAdmin به container دیتابیس می‌رود.

## ۹. انتشار اینترنتی با دامنه و HTTPS

`192.168.10.20` یک IP خصوصی است. افراد خارج از شرکت برای دسترسی به آن، به VPN یا دامنه/IP عمومی و مسیر شبکه نیاز دارند. برای دامنه فرضی `crm.example.com`:

1. رکورد DNS نوع A را به **IP عمومی روتر/سرور شرکت** وصل کنید؛ رکورد A اینترنتی را به `192.168.10.20` ندهید. AAAA را فقط با مسیر IPv6 درست اضافه کنید.
2. روی روتر، TCP پورت‌های ۸۰ و ۴۴۳ را به `192.168.10.20` با همان پورت‌ها forward کنید. SSH، دیتابیس، صف، pgAdmin و MinIO console را forward نکنید.
3. اگر اتصال شرکت پشت CGNAT است، برای این روش به IP عمومی قابل ورود، VPN یا یک راهکار تونل نیاز دارید.
4. در شبکه شرکت، دامنه باید قابل دسترسی باشد؛ معمولاً split DNS به IP داخلی یا NAT loopback روتر لازم است. containerهای سرور هم باید دامنه را resolve و باز کنند؛ Spaces برای metadata از آدرس عمومی API استفاده می‌کند.

برای **نصب تازه اینترنتی**، به‌جای origin حالت LAN اجرا کنید:

```bash
bash deployments/debian/init-env.sh https://crm.example.com
nano .env.production
```

برای **تغییر نصب LAN موجود**، env را دستی ویرایش کنید تا secrets حفظ شوند:

```dotenv
PUBLIC_URL=https://crm.example.com
SITE_ADDRESS=https://crm.example.com
BIND_ADDRESS=192.168.10.20
ALLOWED_HOSTS=crm.example.com,localhost,127.0.0.1,api
MINIO_ENDPOINT_SSL=1
```

پس از آماده شدن DNS و port forwarding:

```bash
bash deployments/debian/deploy.sh
dc logs --tail 100 proxy
curl -I https://crm.example.com/
curl -fsS https://crm.example.com/api/instances/
```

آدرس‌ها در build فرانت‌اند قرار می‌گیرند؛ پس تغییر دامنه نیاز به build دوباره دارد. در این مرحله از `--no-build` استفاده نکنید. پس از تغییر origin، مرورگر را refresh کنید و دوباره وارد شوید. برای اینترنت از origin نهایی HTTPS استفاده کنید تا cookieهای برنامه هم secure باشند.

با دامنه عمومی، دسترسی ورودی پورت‌ها و volume پایدار `/data`، Caddy [گواهی HTTPS را خودکار دریافت و تمدید می‌کند](https://caddyserver.com/docs/automatic-https). نیازی به نصب Certbot یا nginx روی میزبان برای این مسیر نیست. برای LAN با HTTP، HTTPS خودکار عمداً با پیشوند `http://` غیرفعال است. TLS داخلی با CA شرکت مسیر جداگانه‌ای دارد.

این راهنما TLS را روی Caddy همین سرور خاتمه می‌دهد. اگر reverse proxy دیگری در جلو دارید، دامنه، header پروتکل و trusted proxy باید برای همان معماری تنظیم شوند.

## ۱۰. پورت‌ها و فایروال

Compose تنها TCP ۸۰/۴۴۳ proxy را روی `BIND_ADDRESS` منتشر می‌کند. PostgreSQL، Valkey، RabbitMQ و API پورت میزبان ندارند؛ pgAdmin و کنسول MinIO فقط روی loopback هستند و با تونل SSH باز می‌شوند.

برای بررسی:

```bash
sudo ss -lntp
dc ps
```

در firewall روتر/شبکه، دسترسی وب و SSH را طبق مخاطب برنامه باز کنید؛ برای نصب LAN، ۸۰/۴۴۳ فقط از شبکه شرکت و ۲۲ فقط از شبکه مدیریت لازم است. اگر UFW از قبل فعال است، اجازه پورت SSH واقعی را حفظ کنید. [Docker ممکن است ترافیک پورت‌های منتشرشده را قبل از قوانین UFW مسیریابی کند](https://docs.docker.com/engine/network/packet-filtering-firewalls/#docker-and-ufw)؛ محدودیت مبدأ را در firewall شبکه یا قواعد مناسب Docker اعمال کنید. پورت‌های دیتابیس را برای رفع خطای اتصال عمومی نکنید.

## ۱۱. توقف، لاگ و به‌روزرسانی

در هر اتصال SSH تازه:

```bash
cd "$HOME/company-crm"
dc() { sudo docker compose --env-file .env.production -f docker-compose-production.yml "$@"; }
```

فرمان‌های روزمره:

```bash
dc ps -a
dc logs -f --tail 100 api worker live proxy
dc restart api
dc stop
bash deployments/debian/deploy.sh --no-build
```

در حالت Git، پس از backup از `git pull --ff-only` استفاده کنید. در حالت آرشیو، دوباره مراحل انتقال را اجرا و آرشیو جدید را در همان مسیر استخراج کنید؛ env و volumeها در آرشیو نیستند. استخراج آرشیو فایل‌های حذف‌شده از نسخه جدید را پاک نمی‌کند؛ اگر نسخه جدید فایل‌هایی را حذف کرده، از checkout تازه یا Git برای انتقال دقیق استفاده کنید. سپس:

```bash
bash deployments/debian/deploy.sh
```

برای maintenance همراه تغییر schema، پس از ساخت imageها و قبل از migration، نویسنده‌ها را متوقف کنید:

```bash
dc build --pull
dc stop api worker beat-worker live
bash deployments/debian/deploy.sh --no-build
```

اگر استقرار خطا دهد، لاگ را بررسی کنید؛ سرویس‌های توقف‌یافته ممکن است تا رفع مشکل خاموش بمانند. بازگشت کد بعد از migration همیشه کافی نیست؛ ممکن است بازیابی دیتابیس نسخه قبلی لازم باشد.

`dc down` containerها و شبکه همین نصب را حذف و volumeهای داده را حفظ می‌کند. `down -v` و `docker volume prune` می‌توانند داده‌ها را از بین ببرند؛ برای توقف و به‌روزرسانی عادی از آن‌ها استفاده نکنید.

## ۱۲. پشتیبان‌گیری و بازیابی

پشتیبان لازم شامل دیتابیس PostgreSQL، فایل‌های MinIO و `.env.production` است. اطلاعات محلی Docker توسعه با انتقال کد منتقل نمی‌شوند. نمونه زیر برای volumeهای همین نصب production است؛ برای انتقال از `plane-dev` باید نام volumeها، اطلاعات اتصال و فایل env همان نصب را مبنا قرار دهید و secrets قبلی را حفظ کنید.

پیش از backup، image کمکی را دریافت کنید. برای هماهنگی DB و فایل‌ها، نویسنده‌ها و MinIO را در یک بازه maintenance متوقف می‌کنیم:

```bash
cd "$HOME/company-crm"
dc() { sudo docker compose --env-file .env.production -f docker-compose-production.yml "$@"; }
sudo docker pull alpine:3.22
umask 077
backup_dir="$HOME/plane-backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
cp .env.production "$backup_dir/env.production"
dc stop api worker beat-worker live plane-minio
dc exec -T plane-db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_dir/database.dump"
sudo docker run --rm --mount type=volume,src=plane-production_uploads,dst=/data,readonly --mount "type=bind,src=$backup_dir,dst=/backup" alpine:3.22 tar -czf /backup/uploads.tar.gz -C /data .
sudo chown "$(id -un):$(id -gn)" "$backup_dir/uploads.tar.gz"
bash deployments/debian/deploy.sh --no-build
ls -lh "$backup_dir"
```

موفقیت هر فرمان را بررسی کنید؛ فایل dump خالی backup معتبر نیست. اگر backup خطا داد، برای بازگرداندن سرویس‌ها اسکریپت deploy با `--no-build` را اجرا کنید. یک کپی خارج از همین سرور نگه دارید؛ مثلاً در PowerShell:

```powershell
New-Item -ItemType Directory -Force -Path .\tmp\server-backups | Out-Null
scp -r plane@192.168.10.20:plane-backups/20261004-120000 .\tmp\server-backups\
```

نام پوشه نمونه را با نام واقعی backup خود عوض کنید. این backup داده‌های برنامه را پوشش می‌دهد؛ RabbitMQ/Valkey و گواهی Caddy در آن نیستند. هنگام restore روی نصب تازه، taskهای در صف بازنمی‌گردند و Caddy برای دامنه دوباره گواهی می‌گیرد. برای بازیابی کامل عملیاتی، volumeهای صف/کش و Caddy را هم با روش backup هماهنگ و در حالت توقف snapshot کنید.

برای بازیابی فقط در **نصب تازه با DB و uploads خالی**، سورس همان نسخه و پوشه backup را منتقل کنید، سپس روی سرور جدید:

```bash
cd "$HOME/company-crm"
backup_dir="$HOME/plane-backups/REPLACE_WITH_BACKUP_DIRECTORY"
cp "$backup_dir/env.production" .env.production
chmod 600 .env.production
dc() { sudo docker compose --env-file .env.production -f docker-compose-production.yml "$@"; }
dc config --quiet
export COMPOSE_PARALLEL_LIMIT=1
dc build --pull
sudo docker pull alpine:3.22
dc up -d --wait --wait-timeout 600 plane-db plane-redis plane-mq
dc create plane-minio
dc exec -T plane-db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --no-owner --exit-on-error' < "$backup_dir/database.dump"
sudo docker run --rm --mount type=volume,src=plane-production_uploads,dst=/data --mount "type=bind,src=$backup_dir,dst=/backup,readonly" alpine:3.22 tar -xzf /backup/uploads.tar.gz -C /data
bash deployments/debian/deploy.sh --no-build
```

در restore، پیش از deploy آدرس و `BIND_ADDRESS` را برای سرور جدید بررسی کنید. دستور restore بالا برای بازنویسی نصب دارای داده نیست. روی یک محیط جداگانه، بازیابی backup را آزمایش کنید.

## ۱۳. عیب‌یابی

```bash
dc ps -a
dc logs --tail 200 api worker beat-worker live proxy plane-db plane-mq plane-minio
sudo docker system df
free -h
df -h
```

- **permission denied برای Docker:** از `sudo docker` استفاده کنید؛ اسکریپت deploy در صورت نیاز همین کار را می‌کند.
- **Cannot assign requested address:** مقدار `BIND_ADDRESS` روی این سرور وجود ندارد؛ آن را با `ip -br addr` تطبیق دهید.
- **پورت اشغال:** خروجی `sudo ss -lntp` را ببینید؛ سرویس صاحب پورت را شناسایی کنید.
- **صفحه باز می‌شود ولی login خطای CSRF یا redirect به localhost دارد:** `PUBLIC_URL`، `ALLOWED_HOSTS`، پروتکل، envهای build و header reverse proxy را بررسی کنید و deploy را با build اجرا کنید.
- **خطای upload یا لینک فایل:** origin، `MINIO_ENDPOINT_SSL`، مسیر `/uploads/` و لاگ API/MinIO را بررسی کنید.
- **migration ناموفق:** خطای `dc run --rm --no-deps migrator` را رفع کنید؛ راه‌اندازی را ادامه ندهید.
- **build با code 137 یا Killed:** حافظه را بررسی کنید؛ build ترتیبی است، ولی یک build هم ممکن است از RAM موجود بیشتر بخواهد.
- **خطای دانلود یا timeout:** اتصال سرور به registryهای Docker/npm/pip/Go را بررسی کنید و بعد همان دستور را تکرار کنید. `.npmrc` مخزن از `registry.npmmirror.com` و بعضی Dockerfileها از mirrorهای Go استفاده می‌کنند؛ اگر در شبکه شما در دسترس نیستند، registry/proxy را در همان فایل به مقصد قابل دسترسی و مورد اعتماد تغییر دهید و دوباره build کنید.
- **HTTPS صادر نمی‌شود:** A/AAAA، IP عمومی، port forwarding، firewall و `dc logs proxy` را بررسی کنید. آزمایش از اینترنت موبایل کمک می‌کند خطای NAT loopback را از مشکل انتشار عمومی جدا کنید.

برای بررسی فایل‌ها و اسکریپت‌های همین مسیر بدون ساخت image:

```bash
python -m unittest discover -s deployments/debian/tests -v
```

این آزمون‌ها به Bash، OpenSSL و Docker Compose CLI نیاز دارند؛ daemon یا دانلود image لازم نیست.
