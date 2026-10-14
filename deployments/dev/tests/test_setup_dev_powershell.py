"""Test Windows startup with a fake Docker command, without touching containers."""

import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
POWERSHELL = shutil.which("powershell") or shutil.which("pwsh")


@unittest.skipUnless(POWERSHELL, "PowerShell is required")
class PowerShellDockerSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="crm setup ")
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        for name in ("start.ps1", "setup-dev.ps1", ".env.dev.example"):
            shutil.copyfile(ROOT / name, self.project / name)
        self.calls_file = self.project / "docker-calls.txt"
        self.harness = self.project / "harness.ps1"
        self.harness.write_text(
            """param([string]$EntryPoint, [string[]]$SetupArguments)
$ErrorActionPreference = 'Stop'
function global:docker {
    if ($env:NATIVE_DOCKER -eq '1') {
        & (Join-Path $PSScriptRoot 'docker.cmd') @args
        return
    }
    $call = $args -join ' '
    [IO.File]::AppendAllText($env:DOCKER_CALLS, $call + "`n")
    $global:LASTEXITCODE = 0
    if ($call -eq 'info' -and $env:INFO_EXIT -and -not $env:DESKTOP_STARTED) {
        $global:LASTEXITCODE = [int]$env:INFO_EXIT
    }
    if ($call -like '*config --quiet' -and $env:CONFIG_EXIT) {
        $global:LASTEXITCODE = [int]$env:CONFIG_EXIT
    }
    if ($call -like '*up -d*' -and $env:UP_EXIT) {
        $global:LASTEXITCODE = [int]$env:UP_EXIT
    }
}
function global:Start-Process {
    param([string]$FilePath, [string]$WindowStyle)
    [IO.File]::AppendAllText($env:DOCKER_CALLS, "desktop $FilePath $WindowStyle`n")
    $env:DESKTOP_STARTED = '1'
}
function global:Start-Sleep {}
function global:Invoke-RestMethod {
    return @{ instance = @{ is_setup_done = $true }; config = @{} }
}
$switches = @{}
foreach ($argument in $SetupArguments) { $switches[$argument.TrimStart('-')] = $true }
& (Join-Path $PSScriptRoot $EntryPoint) @switches
""",
            encoding="utf-8",
        )

    def run_setup(self, *args, entrypoint="setup-dev.ps1", **overrides):
        env = dict(os.environ)
        for key in ("INFO_EXIT", "CONFIG_EXIT", "UP_EXIT", "DESKTOP_STARTED", "COMPOSE_PROJECT_NAME", "NATIVE_DOCKER"):
            env.pop(key, None)
        env.update(
            DOCKER_CALLS=str(self.calls_file),
            ProgramFiles=str(self.project / "program files"),
            LOCALAPPDATA=str(self.project / "app data"),
        )
        env.update(overrides)
        # Invoke with splatting so switches are bound as switches, not strings.
        quoted_harness = str(self.harness).replace("'", "''")
        quoted_args = ",".join("'" + arg.replace("'", "''") + "'" for arg in args)
        command = f"& '{quoted_harness}' -EntryPoint '{entrypoint}' -SetupArguments @({quoted_args})"
        return subprocess.run(
            [POWERSHELL, "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", command],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )

    def calls(self):
        return self.calls_file.read_text() if self.calls_file.exists() else ""

    def test_workstation_is_used_for_configuration_startup_and_watch(self):
        (self.project / "docker-compose-workstation.yml").touch()
        result = self.run_setup()
        self.assertEqual(result.returncode, 0, result.stderr)
        compose_calls = [call for call in self.calls().splitlines() if "compose --env-file" in call]
        self.assertEqual(len(compose_calls), 3)
        for call in compose_calls:
            self.assertIn("-f docker-compose-workstation.yml", call)
            self.assertNotIn("--project-name", call)
        self.assertIn("Ready.", result.stdout)

    def test_base_compose_and_existing_credentials_are_preserved(self):
        settings = "DEV_SECRET_KEY=existing-secret\nDEV_ADMIN_EMAIL=custom@example.com\n"
        (self.project / ".env.dev").write_text(settings)
        result = self.run_setup("-NoWatch")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn("docker-compose-workstation.yml", self.calls())
        self.assertNotIn("watch --no-up", self.calls())
        self.assertEqual((self.project / ".env.dev").read_text(), settings)

    def test_failed_start_reports_the_workstation_logs_command(self):
        (self.project / "docker-compose-workstation.yml").touch()
        result = self.run_setup(UP_EXIT="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("-f docker-compose-workstation.yml logs --tail 100", result.stderr)
        self.assertNotIn("Ready.", result.stdout)
        self.assertNotIn("watch --no-up", self.calls())

    def test_user_install_of_docker_desktop_can_be_started(self):
        desktop = self.project / "app data" / "Programs" / "DockerDesktop" / "Docker Desktop.exe"
        desktop.parent.mkdir(parents=True)
        desktop.touch()
        result = self.run_setup(entrypoint="start.ps1", INFO_EXIT="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"desktop {desktop} Hidden", self.calls())
        self.assertIn("--build", self.calls())

    @unittest.skipUnless(os.name == "nt", "Windows native stderr behavior")
    def test_stopped_engine_stderr_does_not_abort_desktop_startup(self):
        desktop = self.project / "app data" / "Programs" / "DockerDesktop" / "Docker Desktop.exe"
        desktop.parent.mkdir(parents=True)
        desktop.touch()
        (self.project / "docker.cmd").write_text(
            "@echo off\n"
            'echo %*>>"%DOCKER_CALLS%"\n'
            'if "%1"=="info" if not defined DESKTOP_STARTED (\n'
            "  echo engine unavailable 1>&2\n"
            "  exit /b 1\n"
            ")\n"
            "exit /b 0\n",
            encoding="utf-8",
        )
        result = self.run_setup(entrypoint="start.ps1", NATIVE_DOCKER="1")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn(f"desktop {desktop} Hidden", self.calls())
        self.assertIn("Ready.", result.stdout)


if __name__ == "__main__":
    unittest.main()
