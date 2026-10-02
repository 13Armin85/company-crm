"""Exercise Docker startup without downloading images or changing local data.

Run: python -m unittest discover -s deployments/dev/tests -v
"""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


class DockerSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="plane setup ")
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        for name in ("setup.sh", "setup-dev.sh", "start.sh", ".env.dev.example"):
            shutil.copyfile(ROOT / name, self.project / name)
        self.bin = self.project / "bin"
        self.bin.mkdir()
        self.bash_env = self.project / "bash-test-env"
        self.bash_env.write_text(
            'test_bin=$(cd -- "$(dirname "$BASH_ENV")/bin" && pwd)\n'
            'export PATH="$test_bin:$PATH"\n',
            encoding="utf-8",
        )
        docker = self.bin / "docker"
        docker.write_text(
            "#!/usr/bin/env bash\n"
            'printf "%s\\n" "$*" >> "$DOCKER_CALLS"\n'
            'case "$*" in\n'
            '  "info") if [[ -f "$READY_STATE_FILE" ]]; then exit 0; fi; '
            'exit "${INFO_EXIT:-0}" ;;\n'
            '  "context show") printf "%s\\n" "${TEST_CONTEXT:-default}" ;;\n'
            '  "compose version") exit "${COMPOSE_EXIT:-0}" ;;\n'
            '  *"config --quiet"*) exit "${CONFIG_EXIT:-0}" ;;\n'
            '  *"up -d"*) exit "${UP_EXIT:-0}" ;;\n'
            "esac\n",
            encoding="utf-8",
        )
        docker.chmod(0o755)
        self.calls_file = self.project / "docker-calls.txt"
        for name, script in {
            "uname": 'printf "%s\\n" "${SYSTEM_NAME:-Linux}"\n',
            "sudo": 'printf "sudo %s\\n" "$*" >> "$DOCKER_CALLS"\nexec "$@"\n',
            "systemctl": 'printf "systemctl %s\\n" "$*" >> "$DOCKER_CALLS"\n'
            'touch "$READY_STATE_FILE"\n',
            "open": 'printf "open %s\\n" "$*" >> "$DOCKER_CALLS"\n'
            'touch "$READY_STATE_FILE"\n',
        }.items():
            command = self.bin / name
            command.write_text("#!/usr/bin/env bash\n" + script, encoding="utf-8")
            command.chmod(0o755)
        installer_dir = self.project / "deployments" / "dev"
        installer_dir.mkdir(parents=True)
        (installer_dir / "install-docker.sh").write_text(
            'printf "install docker\\n" >> "$DOCKER_CALLS"\n'
            'exit "${INSTALL_EXIT:-0}"\n',
            encoding="utf-8",
        )
        # Git Bash lets the same tests run from Windows without requiring WSL.
        self.bash = os.environ.get("BASH_EXECUTABLE") or (
            r"C:\Program Files\Git\bin\bash.exe"
            if os.name == "nt"
            else shutil.which("bash")
        )
        if not self.bash or not Path(self.bash).exists():
            self.skipTest("Bash is required for startup script tests")

    def run_setup(self, *args, entrypoint="setup.sh", **overrides):
        env = dict(os.environ)
        for key in ("DOCKER_HOST", "DOCKER_CONTEXT", "PLANE_DOCKER_USE_SUDO"):
            env.pop(key, None)
        env.update(
            PATH=str(self.bin) + os.pathsep + env.get("PATH", ""),
            DOCKER_CALLS=self.calls_file.as_posix(),
            READY_STATE_FILE=(self.project / "docker-ready").as_posix(),
            BASH_ENV=self.bash_env.as_posix(),
        )
        env.update(overrides)
        return subprocess.run(
            [
                self.bash,
                str(self.project / entrypoint),
                *(["--docker"] if entrypoint == "setup.sh" else []),
                *args,
            ],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )

    def calls(self):
        return self.calls_file.read_text() if self.calls_file.exists() else ""

    def test_first_start_generates_secret_and_starts_entire_stack(self):
        result = self.run_setup()
        self.assertEqual(result.returncode, 0, result.stderr)
        env = (self.project / ".env.dev").read_text()
        self.assertRegex(env, r"DEV_SECRET_KEY=[a-f0-9]{96}\n")
        self.assertIn("--project-name plane-dev --env-file .env.dev", self.calls())
        self.assertIn("config --quiet", self.calls())
        self.assertIn("up -d --wait --wait-timeout 900\n", self.calls())
        self.assertNotIn("watch --no-up", self.calls())
        self.assertIn("Ready.", result.stdout)
        if os.name != "nt":
            self.assertEqual((self.project / ".env.dev").stat().st_mode & 0o777, 0o600)

    def test_existing_settings_are_preserved(self):
        settings = "DEV_SECRET_KEY=existing-key\nDEV_ADMIN_EMAIL=custom@example.com\n"
        (self.project / ".env.dev").write_text(settings)
        result = self.run_setup()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.project / ".env.dev").read_text(), settings)

    def test_clone_entrypoint_builds_current_code_and_needs_no_host_env_files(self):
        result = self.run_setup(entrypoint="start.sh")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("up -d --wait --wait-timeout 900 --build", self.calls())
        self.assertFalse((self.project / "apps").exists())
        self.assertIn("Ready.", result.stdout)

    def test_clone_entrypoint_can_reuse_images_without_build(self):
        for args in [("--no-build", "--watch"), ("--watch", "--no-build")]:
            result = self.run_setup(*args, entrypoint="start.sh")
            self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("--build", self.calls())
        self.assertIn("watch --no-up --prune=false", self.calls())

    def test_stopped_local_linux_engine_is_started_before_compose(self):
        result = self.run_setup(
            entrypoint="start.sh", INFO_EXIT="1", SYSTEM_NAME="Linux"
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("systemctl enable --now docker", self.calls())
        self.assertIn("Ready.", result.stdout)

    def test_macos_desktop_is_started_when_engine_is_off(self):
        result = self.run_setup(
            entrypoint="start.sh", INFO_EXIT="1", SYSTEM_NAME="Darwin"
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("open -g -a Docker", self.calls())

    def test_remote_engine_failure_never_starts_local_engine(self):
        result = self.run_setup(
            entrypoint="start.sh", INFO_EXIT="1", DOCKER_HOST="tcp://remote:2376"
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("systemctl", self.calls())
        self.assertNotIn("sudo", self.calls())
        self.assertNotIn("up -d", self.calls())

    def test_installer_failure_stops_before_settings_or_containers(self):
        result = self.run_setup(
            entrypoint="start.sh", COMPOSE_EXIT="1", INSTALL_EXIT="7"
        )
        self.assertEqual(result.returncode, 7)
        self.assertIn("install docker", self.calls())
        self.assertFalse((self.project / ".env.dev").exists())
        self.assertNotIn("up -d", self.calls())

    def test_no_install_option_and_help_have_no_system_install_side_effects(self):
        result = self.run_setup("--no-install", entrypoint="start.sh", COMPOSE_EXIT="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("install docker", self.calls())
        result = self.run_setup("--help", entrypoint="start.sh")
        self.assertEqual(result.returncode, 0)
        self.assertIn("Usage:", result.stdout)

    @unittest.skipUnless(
        os.name == "posix" and shutil.which("flock"), "Linux flock required"
    )
    def test_concurrent_start_does_not_change_settings_or_start_containers(self):
        import fcntl

        with (self.project / ".docker-dev.lock").open("w") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.run_setup()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("already running", result.stderr)
        self.assertFalse((self.project / ".env.dev").exists())
        self.assertNotIn("up -d", self.calls())

    def test_windows_line_endings_in_template(self):
        (self.project / ".env.dev.example").write_bytes(
            b"DEV_SECRET_KEY=\r\nDEV_USER_EMAIL=custom@example.com\r\n"
        )
        result = self.run_setup()
        self.assertEqual(result.returncode, 0, result.stderr)
        settings = (self.project / ".env.dev").read_bytes()
        self.assertNotIn(b"\r", settings)
        self.assertRegex(settings, rb"DEV_SECRET_KEY=[a-f0-9]{96}\n")
        self.assertIn(b"DEV_USER_EMAIL=custom@example.com\n", settings)

    def test_build_and_watch_options_are_forwarded(self):
        result = self.run_setup("--build", "--watch")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("up -d --wait --wait-timeout 900 --build", self.calls())
        self.assertIn("watch --no-up --prune=false", self.calls())

    def test_unavailable_docker_does_not_create_settings(self):
        result = self.run_setup(INFO_EXIT="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Docker is not available", result.stderr)
        self.assertFalse((self.project / ".env.dev").exists())
        self.assertNotIn("up -d", self.calls())

    def test_bad_configuration_does_not_start_containers(self):
        result = self.run_setup(CONFIG_EXIT="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("up -d", self.calls())
        self.assertNotIn("Ready.", result.stdout)

    def test_failed_start_never_reports_ready_or_starts_watch(self):
        result = self.run_setup("--watch", UP_EXIT="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Docker startup failed", result.stderr)
        self.assertNotIn("Ready.", result.stdout)
        self.assertNotIn("watch --no-up", self.calls())

    def test_help_and_invalid_options_have_no_side_effects(self):
        result = self.run_setup("--help")
        self.assertEqual(result.returncode, 0)
        self.assertIn("Usage:", result.stdout)
        result = self.run_setup("--unknown")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unknown option", result.stderr)
        self.assertEqual(self.calls(), "")
        self.assertFalse((self.project / ".env.dev").exists())


if __name__ == "__main__":
    unittest.main()
