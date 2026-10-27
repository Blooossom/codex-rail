[CmdletBinding()]
param(
    [switch]$Install,
    [switch]$Status,
    [switch]$Remove,
    [string]$ProfilePath = $PROFILE.CurrentUserCurrentHost,
    [string]$PluginId = 'codex-rail@blossom-local'
)

$ErrorActionPreference = 'Stop'
if (([int]$Install.IsPresent + [int]$Status.IsPresent + [int]$Remove.IsPresent) -ne 1) {
    throw 'Choose exactly one of -Install, -Status or -Remove.'
}
if ($Install) {
    $existing = Get-Command codex -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existing -and $existing.CommandType -in @('Function', 'Alias')) {
        if ($existing.CommandType -ne 'Function' -or -not $existing.Definition.Contains('--encoded-args $railEncoded')) {
            throw 'An existing codex alias/function needs to be preserved and reconciled before setup.'
        }
    }
}
$python = $null
foreach ($candidate in @('python.exe', 'python3.exe', 'py.exe')) {
    foreach ($command in @(Get-Command $candidate -CommandType Application -ErrorAction SilentlyContinue)) {
        if (-not $command) { continue }
        try { $major = & $command.Source -c 'import sys; print(int(sys.version_info >= (3, 11)))' 2>$null }
        catch { continue }
        if ($LASTEXITCODE -eq 0 -and "$major".Trim() -eq '1') {
            $python = $command.Source
            break
        }
    }
    if ($python) { break }
}
if (-not $python) { throw 'Python 3.11 or newer is required. Install Python, then retry.' }
$mode = if ($Install) { '--install' } elseif ($Status) { '--status' } else { '--remove' }
& $python (Join-Path $PSScriptRoot 'setup.py') $mode --shell powershell --profile $ProfilePath --plugin-id $PluginId
if ($LASTEXITCODE -ne 0) { throw 'Codex Rail setup failed. See the message above.' }
