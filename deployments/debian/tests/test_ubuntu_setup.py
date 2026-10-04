"""Test Ubuntu preparation using an isolated filesystem and mocked host commands."""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


class UbuntuSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="plane ubuntu setup ")
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        self.bash = os.environ.get("BASH_EXECUTABLE") or (
            r"C:\Program Files\Git\bin\bash.exe" if os.name == "nt" else shutil.which("bash")
        )
        if not self.bash or not Path(self.bash).exists():
            self.skipTest("Bash is required")
        self.etc = self.project / "etc"
        self.etc.mkdir()
        # These directories already exist on an Ubuntu host with apt installed.
        self.sources = self.etc / "apt" / "sources.list.d"
        self.sources.mkdir(parents=True)
        (self.etc / "apt" / "keyrings").mkdir()
        self.os_release = self.project / "os-release"
        self.os_release.write_text(
            "ID=ubuntu\nVERSION_ID=26.04\nVERSION_CODENAME=resolute\nUBUNTU_CODENAME=resolute\n",
            encoding="utf-8",
        )
        self.calls_path = self.project / "host-calls.txt"
        self.installed_marker = self.project / "docker-installed"
        self.bash_env = self.project / "mock-host.sh"
        self.bash_env.write_text(
            'uname() { printf "Linux\\n"; }\n'
            'sudo() { if [[ "$1" == -v ]]; then return 0; fi; "$@"; }\n'
            'openssl() { return 0; }\n'
            'nano() { return 0; }\n'
            'tmux() { return 0; }\n'
            'install() {\n'
            '  local destination="${@: -1}"\n'
            '  case "$destination" in "$PLANE_ETC_DIR"/*) ;; *) return 99 ;; esac\n'
            '  if [[ "$*" == *" -d "* ]]; then [[ -d "$destination" ]];\n'
            '  else cp "${@: -2:1}" "$destination"; fi\n'
            '}\n'
            'dpkg-query() {\n'
            '  if [[ "${@: -1}" == "${CONFLICT_PACKAGE:-}" ]]; then\n'
            '    printf "install ok installed"; return 0;\n'
            '  fi\n'
            '  return 1\n'
            '}\n'
            'dpkg() { printf "amd64\\n"; }\n'
            'apt-get() {\n'
            '  printf "apt-get %s\\n" "$*" >> "$HOST_CALLS"\n'
            '  if [[ "${APT_EXIT:-0}" != 0 ]]; then return "$APT_EXIT"; fi\n'
            '  case "$*" in *docker-ce*) touch "$INSTALLED_MARKER" ;; esac\n'
            '  return 0\n'
            '}\n'
            'curl() {\n'
            '  printf "curl %s\\n" "$*" >> "$HOST_CALLS"\n'
            '  if [[ "${CURL_EXIT:-0}" != 0 ]]; then return "$CURL_EXIT"; fi\n'
            '  while [[ $# -gt 0 ]]; do\n'
            '    if [[ "$1" == -o ]]; then printf "FIXTURE_KEY\\n" > "$2"; return 0; fi\n'
            '    shift\n'
            '  done\n'
            '  return 1\n'
            '}\n'
            'systemctl() {\n'
            '  printf "systemctl %s\\n" "$*" >> "$HOST_CALLS"\n'
            '  return "${SYSTEMCTL_EXIT:-0}"\n'
            '}\n'
            'docker() {\n'
            '  printf "docker %s\\n" "$*" >> "$HOST_CALLS"\n'
            '  case "$*" in\n'
            '    "compose version")\n'
            '      if [[ -f "$INSTALLED_MARKER" ]]; then return 0; else return 1; fi ;;\n'
            '    "info") return "${DOCKER_INFO_EXIT:-0}" ;;\n'
            '  esac\n'
            '  return 0\n'
            '}\n',
            encoding="utf-8",
        )

    def run_setup(self, *args, **overrides):
        env = dict(os.environ)
        env.pop("DOCKER_HOST", None)
        env.pop("DOCKER_CONTEXT", None)
        etc_path = self.etc.as_posix()
        if os.name == "nt":
            # GNU mkdir/install in Git Bash need /c/... paths for parent traversal.
            etc_path = "/" + self.etc.drive[0].lower() + etc_path[2:]
        env.update(
            BASH_ENV=self.bash_env.as_posix(),
            PLANE_OS_RELEASE_FILE=self.os_release.as_posix(),
            PLANE_ETC_DIR=etc_path,
            HOST_CALLS=self.calls_path.as_posix(),
            INSTALLED_MARKER=self.installed_marker.as_posix(),
        )
        env.update(overrides)
        result = subprocess.run(
            [self.bash, (ROOT / "deployments" / "ubuntu" / "setup-server.sh").as_posix(), *args],
            env=env,
            text=True,
            capture_output=True,
            timeout=30,
        )
        calls = self.calls_path.read_text(encoding="utf-8") if self.calls_path.exists() else ""
        return result, calls

    def test_ubuntu_2604_installs_from_ubuntu_repository_and_enables_docker(self):
        result, calls = self.run_setup()
        self.assertEqual(result.returncode, 0, result.stderr)
        source = (self.etc / "apt" / "sources.list.d" / "docker.sources").read_text(encoding="utf-8")
        self.assertIn("URIs: https://download.docker.com/linux/ubuntu", source)
        self.assertIn("Suites: resolute", source)
        self.assertIn("Architectures: amd64", source)
        self.assertIn("https://download.docker.com/linux/ubuntu/gpg", calls)
        self.assertNotIn("download.docker.com/linux/debian", calls)
        self.assertIn("apt-get install -y docker-ce docker-ce-cli containerd.io", calls)
        self.assertIn("systemctl enable --now docker", calls)
        self.assertLess(calls.index("systemctl enable"), calls.rindex("docker info"))
        self.assertIn("Ubuntu host is ready", result.stdout)

    def test_no_install_with_existing_docker_does_not_modify_package_sources(self):
        self.installed_marker.touch()
        result, calls = self.run_setup("--no-install")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("apt-get", calls)
        self.assertNotIn("curl", calls)
        self.assertEqual(list(self.sources.iterdir()), [])
        self.assertEqual(list((self.etc / "apt" / "keyrings").iterdir()), [])
        self.assertIn("systemctl enable --now docker", calls)

    def test_no_install_with_missing_docker_stops_before_installation(self):
        result, calls = self.run_setup("--no-install")
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("apt-get", calls)
        self.assertNotIn("systemctl", calls)

    def test_other_distribution_stops_without_host_changes(self):
        self.os_release.write_text("ID=debian\nVERSION_CODENAME=bookworm\n", encoding="utf-8")
        result, calls = self.run_setup()
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("requires Ubuntu", result.stderr)
        self.assertEqual(calls, "")

    def test_conflicting_runtime_stops_without_uninstalling_packages(self):
        result, calls = self.run_setup(CONFLICT_PACKAGE="containerd")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("containerd", result.stderr)
        self.assertNotIn("apt-get", calls)

    def test_failed_apt_stops_before_repository_download_and_service_start(self):
        result, calls = self.run_setup(APT_EXIT="42")
        self.assertEqual(result.returncode, 42)
        self.assertIn("installing host tools", result.stderr)
        self.assertNotIn("curl", calls)
        self.assertNotIn("systemctl", calls)

    def test_failed_key_download_stops_before_docker_installation(self):
        result, calls = self.run_setup(CURL_EXIT="22")
        self.assertEqual(result.returncode, 22)
        self.assertIn("configuring the official Ubuntu Docker repository", result.stderr)
        self.assertNotIn("apt-get install -y docker-ce", calls)
        self.assertNotIn("systemctl", calls)

    def test_failed_service_start_is_not_reported_as_success(self):
        self.installed_marker.touch()
        result, calls = self.run_setup("--no-install", SYSTEMCTL_EXIT="31")
        self.assertEqual(result.returncode, 31)
        self.assertIn("starting the Docker service", result.stderr)
        self.assertNotIn("Ubuntu host is ready", result.stdout)
        self.assertNotIn("docker info", calls)

    def test_remote_docker_environment_stops_before_host_changes(self):
        result, calls = self.run_setup(DOCKER_HOST="ssh://other-host")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("local Ubuntu", result.stderr)
        self.assertEqual(calls, "")

    def test_unavailable_docker_daemon_is_not_reported_as_ready(self):
        self.installed_marker.touch()
        result, _ = self.run_setup("--no-install", DOCKER_INFO_EXIT="29")
        self.assertEqual(result.returncode, 29)
        self.assertIn("verifying Docker", result.stderr)
        self.assertNotIn("Ubuntu host is ready", result.stdout)

    def test_debian_repository_from_old_instructions_is_backed_up_and_corrected(self):
        sources = self.etc / "apt" / "sources.list.d"
        sources.mkdir(parents=True, exist_ok=True)
        previous = "Types: deb\nURIs: https://download.docker.com/linux/debian\nSuites: resolute\n"
        (sources / "docker.sources").write_text(previous, encoding="utf-8")
        result, _ = self.run_setup()
        self.assertEqual(result.returncode, 0, result.stderr)
        backups = list(sources.glob("docker.sources.before-ubuntu-*"))
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(encoding="utf-8"), previous)
        corrected = (sources / "docker.sources").read_text(encoding="utf-8")
        self.assertIn("download.docker.com/linux/ubuntu", corrected)
        self.assertNotIn("download.docker.com/linux/debian", corrected)


if __name__ == "__main__":
    unittest.main()
