# THROWAWAY: local-only layout prototype; no report files are modified.
$ErrorActionPreference = 'Stop'
$prototypePython = (Get-Command python.exe -ErrorAction SilentlyContinue).Source
if (-not $prototypePython) {
    $prototypePython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
}
if (-not (Test-Path -LiteralPath $prototypePython)) {
    throw 'Python executable not found. Install Python or run collaborative_report_prototype.py with your Python executable.'
}
& $prototypePython (Join-Path $PSScriptRoot 'collaborative_report_prototype.py') @args
