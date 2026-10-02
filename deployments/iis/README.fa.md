# استقرار Plane CRM پشت IIS

این پروژه مستقیماً داخل Application Pool اجرا نمی‌شود. معماری production پیشنهادی چنین است:

`Internet -> IIS :443 -> Ubuntu VM :8080 -> Caddy -> web/admin/space/live/api`

PostgreSQL، Valkey، RabbitMQ، MinIO و workerهای Celery نیز داخل همان Ubuntu VM و با Docker Compose اجرا می‌شوند.

## 1. پیش‌نیازها

- Windows Server 2022 یا 2025 با IIS و Hyper-V
- یک Ubuntu Server 24.04 LTS VM با IP ثابت
- حداقل 4 vCPU، 8 GB RAM و 60 GB دیسک برای نصب کوچک
- دامنه‌ای مانند `crm.example.com` که به IP عمومی IIS اشاره کند
- گواهی TLS برای همان دامنه در IIS

Docker Desktop روی Windows Server پشتیبانی نمی‌شود. Docker Engine را داخل Ubuntu VM نصب کنید.

## 2. نصب Docker Engine در Ubuntu

روی Ubuntu این دستورها را اجرا کنید:

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

cat <<EOF | sudo tee /etc/apt/sources.list.d/docker.sources
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

پس از نصب، این دو دستور باید موفق باشند:

```bash
sudo docker version
sudo docker compose version
```

سرویس Docker را برای boot فعال کنید:

```bash
sudo systemctl enable --now docker
```

## 3. انتقال سورس

مخزن را در `/opt/plane` clone کنید یا آرشیو سورس را به آن مسیر انتقال دهید. پوشه‌های `.git`، `node_modules`، `.turbo` و `build` برای انتقال لازم نیستند؛ Docker خروجی production را دوباره می‌سازد.

## 4. تنظیم secrets و دامنه

از فایل‌های زیر کپی بگیرید:

```bash
cd /opt/plane
cp deployments/iis/plane.env.example .env
cp deployments/iis/api.env.example apps/api/.env
chmod 600 .env apps/api/.env
```

برای هر secret یک مقدار جدا تولید کنید:

```bash
openssl rand -hex 32
```

در هر دو فایل:

- تمام `CHANGE_TO_...` و `SAME_AS_ROOT_...`ها را جایگزین کنید.
- `crm.example.com` را با دامنه واقعی عوض کنید.
- مقدار `LISTEN_HTTP_PORT` را به شکل `IP_PRIVATE_UBUNTU:8080` وارد کنید.
- رمز PostgreSQL، RabbitMQ، MinIO و `LIVE_SERVER_SECRET_KEY` در دو فایل باید دقیقاً یکسان باشد.
- در `.env`، مقدار `TRUSTED_PROXIES` را IP داخلی Windows Server قرار دهید.
- از رمزهای محیط توسعه یا مقادیر نمونه استفاده نکنید.

## 5. build و اجرای production

```bash
cd /opt/plane
sudo docker compose config --quiet
sudo docker compose build --pull
sudo docker compose up -d plane-db plane-redis plane-mq plane-minio
sudo docker compose run --rm migrator
sudo docker compose up -d web admin space api worker beat-worker live proxy
sudo docker compose ps -a
```

`migrator` باید با exit code صفر تمام شود و باقی سرویس‌ها باید `Up` باشند. سپس از Windows Server آزمایش کنید:

```powershell
curl.exe http://PLANE_VM_IP:8080/api/instances/
```

## 6. تنظیم IIS

در PowerShell با دسترسی Administrator:

```powershell
Install-WindowsFeature Web-Server,Web-WebSockets,Web-Mgmt-Console -IncludeManagementTools
```

URL Rewrite 2.1 x64 و سپس Application Request Routing 3.0 x64 را نصب کنید. بعد reverse proxy و حفظ Host header را فعال کنید:

```powershell
$appcmd = "$env:windir\System32\inetsrv\appcmd.exe"
& $appcmd set config -section:system.webServer/proxy /enabled:"True" /preserveHostHeader:"True" /reverseRewriteHostInResponseHeaders:"False" /commit:apphost
& $appcmd set config -section:system.webServer/rewrite/allowedServerVariables /+"[name='HTTP_X_FORWARDED_PROTO']" /commit:apphost
```

در IIS Manager:

1. یک Application Pool با نام `PlaneProxyPool` و گزینه **No Managed Code** بسازید.
2. یک سایت با نام `Plane` و مسیر `C:\inetpub\plane-proxy` بسازید.
3. binding پورت 80 برای دامنه واقعی اضافه کنید.
4. binding پورت 443 با SNI و گواهی TLS دامنه اضافه کنید.
5. در Server Proxy Settings مربوط به ARR، timeout را روی 3600 ثانیه قرار دهید.

فایل `web.config.example` را در `C:\inetpub\plane-proxy\web.config` کپی کنید و `PLANE_VM_IP` را با IP ثابت Ubuntu VM جایگزین کنید. سپس اجرا کنید:

```powershell
iisreset
curl.exe -I https://crm.example.com/
curl.exe https://crm.example.com/api/instances/
```

## 7. فایروال

- از اینترنت فقط TCP 80 و 443 به Windows Server باز باشد.
- پورت 8080 Ubuntu فقط از IP داخلی Windows Server قابل دسترسی باشد.
- پورت‌های 5432، 6379، 5672، 9000 و 9090 را عمومی نکنید.

## 8. عیب‌یابی

```bash
cd /opt/plane
sudo docker compose ps -a
sudo docker compose logs --tail 200 migrator api live proxy
sudo docker compose logs -f api worker live proxy
```

- خطای IIS `502.3`: اتصال Windows Server به `VM_IP:8080` را بررسی کنید.
- خطای IIS `500.50`: مجازشدن `HTTP_X_FORWARDED_PROTO` در سطح server را بررسی کنید.
- خطای upload با `413` یا `404.13`: دو مقدار `FILE_SIZE_LIMIT` و `maxAllowedContentLength` باید برابر باشند.
- قطع ویرایش هم‌زمان: قابلیت WebSocket IIS، سرویس `live` و route `/live/` را بررسی کنید.

## 9. پشتیبان‌گیری قبل از به‌روزرسانی

حداقل از دیتابیس PostgreSQL و volume آپلودهای MinIO نسخه پشتیبان بگیرید. سپس برای انتشار نسخه جدید:

```bash
cd /opt/plane
sudo docker compose build --pull
sudo docker compose up -d plane-db plane-redis plane-mq plane-minio
sudo docker compose run --rm migrator
sudo docker compose up -d --remove-orphans
```
