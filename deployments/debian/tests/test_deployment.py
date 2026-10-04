"""Run with python -m unittest discover -s deployments/debian/tests -v.

Tests use temporary settings and mock Docker commands; no daemon or image pulls.
"""

import json
import os
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
SECRET_KEYS = (
    "SECRET_KEY",
    "LIVE_SERVER_SECRET_KEY",
    "POSTGRES_PASSWORD",
    "RABBITMQ_PASSWORD",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "PGADMIN_PASSWORD",
)


class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="plane production ")
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        self.deployment = self.project / "deployments" / "debian"
        self.deployment.mkdir(parents=True)
        for filename in ("production.env.example", "init-env.sh", "deploy.sh"):
            shutil.copyfile(ROOT / "deployments" / "debian" / filename, self.deployment / filename)
        self.bash = os.environ.get("BASH_EXECUTABLE") or (
            r"C:\Program Files\Git\bin\bash.exe" if os.name == "nt" else shutil.which("bash")
        )
        if not self.bash or not Path(self.bash).exists():
            self.skipTest("Bash is required")

    def run_script(self, name, *args, **extra_env):
        env = dict(os.environ)
        env.pop("BASH_ENV", None)
        env.update(extra_env)
        return subprocess.run(
            [self.bash, (self.deployment / name).as_posix(), *args],
            cwd=self.project,
            env=env,
            text=True,
            capture_output=True,
            timeout=30,
        )

    def initialize(self, origin="http://192.168.10.20"):
        result = self.run_script("init-env.sh", origin)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.initialization_output = result.stdout + result.stderr
        content = (self.project / ".env.production").read_text(encoding="utf-8")
        values = dict(line.split("=", 1) for line in content.splitlines() if line and not line.startswith("#"))
        return content, values

    def mock_deploy(self, *args, migration_exit=0):
        calls_path = self.project / "docker-calls.txt"
        bash_env = self.project / "mock-docker.sh"
        bash_env.write_text(
            'docker() {\n'
            '    printf "%s\\n" "$*" >> "$DOCKER_CALLS"\n'
            '    case "$*" in\n'
            '        *"run --rm --no-deps migrator") return "$MIGRATION_EXIT" ;;\n'
            '    esac\n'
            '    return 0\n'
            '}\n',
            encoding="utf-8",
        )
        result = self.run_script(
            "deploy.sh",
            *args,
            BASH_ENV=bash_env.as_posix(),
            DOCKER_CALLS=calls_path.as_posix(),
            MIGRATION_EXIT=str(migration_exit),
        )
        calls = calls_path.read_text(encoding="utf-8") if calls_path.exists() else ""
        return result, calls

    def test_initialization_creates_distinct_secrets_without_printing_them(self):
        content, values = self.initialize()
        self.assertNotIn("CHANGE_ME_", content)
        self.assertEqual(values["PUBLIC_URL"], "http://192.168.10.20")
        self.assertEqual(values["SITE_ADDRESS"], "http://192.168.10.20")
        self.assertEqual(values["MINIO_ENDPOINT_SSL"], "0")
        self.assertEqual(len({values[key] for key in SECRET_KEYS}), len(SECRET_KEYS))
        for key in SECRET_KEYS:
            self.assertRegex(values[key], r"^[a-f0-9]{32,64}$")
            self.assertNotIn(values[key], self.initialization_output)
        if os.name != "nt":
            self.assertEqual((self.project / ".env.production").stat().st_mode & 0o777, 0o600)
        self.assertEqual(list(self.project.glob(".env.production.*")), [])

    def test_https_origin_enables_https_for_storage(self):
        _, values = self.initialize("https://crm.example.com/")
        self.assertEqual(values["PUBLIC_URL"], "https://crm.example.com")
        self.assertEqual(values["MINIO_ENDPOINT_SSL"], "1")
        self.assertIn("crm.example.com", values["ALLOWED_HOSTS"])

    def test_existing_settings_and_secrets_are_preserved(self):
        before, _ = self.initialize()
        result = self.run_script("init-env.sh", "https://new.example.com")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.project / ".env.production").read_text(encoding="utf-8"), before)

    def test_invalid_origins_do_not_create_settings(self):
        for origin in ("192.168.10.20", "http://server/path", "http://server:8080", "https://user:pass@server"):
            with self.subTest(origin=origin):
                result = self.run_script("init-env.sh", origin)
                self.assertNotEqual(result.returncode, 0)
                self.assertFalse((self.project / ".env.production").exists())

    def test_deploy_waits_for_infrastructure_and_migrates_before_starting_apps(self):
        self.initialize()
        result, calls = self.mock_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("--env-file .env.production -f docker-compose-production.yml config --quiet", calls)
        build = calls.index("build --pull")
        infrastructure = calls.index("up -d --wait --wait-timeout 600")
        migration = calls.index("run --rm --no-deps migrator")
        application = calls.index("up -d --wait --wait-timeout 900")
        self.assertLess(build, infrastructure)
        self.assertLess(infrastructure, migration)
        self.assertLess(migration, application)

    def test_failed_migration_stops_deployment(self):
        self.initialize()
        result, calls = self.mock_deploy(migration_exit=23)
        self.assertEqual(result.returncode, 23)
        self.assertNotIn("up -d --wait --wait-timeout 900", calls)

    def test_no_build_reuses_images_but_still_runs_migrations(self):
        self.initialize()
        result, calls = self.mock_deploy("--no-build")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("build --pull", calls)
        self.assertIn("run --rm --no-deps migrator", calls)

    def test_placeholder_settings_fail_before_docker_is_called(self):
        shutil.copyfile(self.deployment / "production.env.example", self.project / ".env.production")
        result, calls = self.mock_deploy()
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, "")

    def test_compose_uses_consistent_credentials_and_keeps_database_ports_private(self):
        _, values = self.initialize()
        docker = shutil.which("docker")
        if not docker:
            self.skipTest("Docker Compose CLI is required")
        docker_config = self.project / "docker-config"
        docker_config.mkdir()
        # Shell/CI values must not override this test's temporary fixture.
        env = {key: value for key, value in os.environ.items() if key not in values}
        env["DOCKER_CONFIG"] = str(docker_config)
        result = subprocess.run(
            [
                docker,
                "compose",
                "--env-file",
                str(self.project / ".env.production"),
                "-f",
                str(ROOT / "docker-compose-production.yml"),
                "--profile",
                "maintenance",
                "--profile",
                "tools",
                "config",
                "--format",
                "json",
            ],
            env=env,
            text=True,
            capture_output=True,
            timeout=30,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        config = json.loads(result.stdout)
        services = config["services"]
        self.assertEqual(len(services), 14)
        for name in ("api", "migrator", "worker", "beat-worker"):
            backend = services[name]["environment"]
            self.assertEqual(backend["SECRET_KEY"], values["SECRET_KEY"])
            self.assertEqual(
                backend["RABBITMQ_PASSWORD"], services["plane-mq"]["environment"]["RABBITMQ_DEFAULT_PASS"]
            )
            self.assertEqual(
                backend["AWS_SECRET_ACCESS_KEY"], services["plane-minio"]["environment"]["MINIO_ROOT_PASSWORD"]
            )
            self.assertIn(services["plane-db"]["environment"]["POSTGRES_PASSWORD"], backend["DATABASE_URL"])
            self.assertEqual(backend["DEBUG"], "0")
            self.assertEqual(backend["CORS_ALLOWED_ORIGINS"], values["PUBLIC_URL"])
        self.assertEqual(
            services["api"]["environment"]["LIVE_SERVER_SECRET_KEY"],
            services["live"]["environment"]["LIVE_SERVER_SECRET_KEY"],
        )
        for name in ("web", "admin", "space"):
            self.assertEqual(services[name]["build"]["args"]["VITE_API_BASE_URL"], values["PUBLIC_URL"])
        private_services = (
            "plane-db", "plane-redis", "plane-mq", "api", "worker", "beat-worker", "web", "admin", "space", "live"
        )
        for name in private_services:
            self.assertNotIn("ports", services[name])
        for name in ("plane-minio", "pgadmin"):
            self.assertTrue(all(port["host_ip"] == "127.0.0.1" for port in services[name]["ports"]))
        self.assertEqual(services["migrator"]["profiles"], ["maintenance"])
        self.assertEqual(services["pgadmin"]["profiles"], ["tools"])
        self.assertTrue(any(volume["target"] == "/data" for volume in services["proxy"]["volumes"]))


class SourceExportTests(unittest.TestCase):
    @unittest.skipUnless(os.name == "nt", "Windows PowerShell exporter")
    def test_export_includes_current_source_but_excludes_settings_dependencies_and_runtime_data(self):
        with tempfile.TemporaryDirectory(prefix="plane source export ") as temporary:
            project = Path(temporary)
            deployment = project / "deployments" / "debian"
            deployment.mkdir(parents=True)
            for name in ("export-source.ps1", "production.env.example"):
                shutil.copyfile(ROOT / "deployments" / "debian" / name, deployment / name)
            included = {
                "package.json": '{"name":"current-source"}',
                "apps/web/uncommitted.ts": "export const current = true;",
                ".gitignore": "node_modules/",
            }
            excluded = (
                ".env.production", ".env.dev", "apps/api/.env", "node_modules/dependency/index.js",
                "apps/web/build/index.html", "backups/database.dump", "uploads/file.txt", ".git/config",
            )
            for name, content in included.items():
                path = project / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
            for name in excluded:
                path = project / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("EXCLUDED_FIXTURE", encoding="utf-8")
            result = subprocess.run(
                [
                    "powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File",
                    str(deployment / "export-source.ps1"),
                ],
                text=True,
                capture_output=True,
                timeout=30,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            with tarfile.open(project / "tmp" / "company-crm-source.tar.gz") as archive:
                members = {member.name.removeprefix("./"): member for member in archive if member.isfile()}
                for name, content in included.items():
                    self.assertIn(name, members)
                    self.assertEqual(archive.extractfile(members[name]).read().decode("utf-8"), content)
                self.assertIn("deployments/debian/production.env.example", members)
                for name in excluded:
                    self.assertNotIn(name, members)
                self.assertFalse(any(name.startswith("tmp/") for name in members))


if __name__ == "__main__":
    unittest.main()
