$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$temporary = Join-Path ([IO.Path]::GetTempPath()) ("rail-ps-test-" + [guid]::NewGuid().ToString('N'))
$bin = Join-Path $temporary "bin space ' & ;"
$profilePath = Join-Path $temporary 'profile test.ps1'
$originalPath = $env:PATH
$originalAppData = $env:APPDATA
$originalCodexHome = $env:CODEX_HOME
$originalEncoding = [Console]::OutputEncoding
try {
    New-Item -ItemType Directory -Path $bin -Force | Out-Null
    $env:PATH = "$bin;$originalPath"
    $env:APPDATA = Join-Path $temporary 'appdata'
    $env:CODEX_HOME = Join-Path $temporary 'codex-home'
    [Console]::OutputEncoding = New-Object Text.UTF8Encoding $false
    $script = Join-Path $bin 'node_modules\@openai\codex\bin\codex.js'
    New-Item -ItemType Directory -Path (Split-Path $script -Parent) -Force | Out-Null
    [IO.File]::WriteAllText($script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));')
    [IO.File]::WriteAllText((Join-Path $bin 'codex.cmd'), '@echo off')
    [IO.File]::WriteAllText((Join-Path $bin 'wt.exe'), '')
    [IO.File]::WriteAllText($profilePath, '# Existing profile content' + [Environment]::NewLine)
    & (Join-Path $root 'scripts\setup.ps1') -Install -ProfilePath $profilePath | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Install failed' }
    $status = & (Join-Path $root 'scripts\setup.ps1') -Status -ProfilePath $profilePath | ConvertFrom-Json
    if (-not $status.configured) { throw 'Integration was not configured' }
    $first = [IO.File]::ReadAllText($profilePath)
    & (Join-Path $root 'scripts\setup.ps1') -Install -ProfilePath $profilePath | Out-Null
    if ([IO.File]::ReadAllText($profilePath) -ne $first) { throw 'Install was not idempotent' }
    if (-not (Get-ChildItem $temporary -Filter '*.codex-rail-backup-*')) { throw 'Profile backup missing' }
    . $profilePath
    if ((Get-Command codex).CommandType -ne 'Function') { throw 'PowerShell function did not load' }
    $version = codex --version | ConvertFrom-Json
    if ($version[0] -ne '--version') { throw 'Version did not reach native Codex' }
    $unicode = ([string][char]0xD55C) + ([string][char]0xAE00)
    $expected = @('exec', '', 'space value', 'a"b', "it's", '`literal', 'x; y & z', '$(Get-Process)', $unicode)
    $actual = codex @expected | ConvertFrom-Json
    if (($actual | ConvertTo-Json -Compress) -ne ($expected | ConvertTo-Json -Compress)) {
        throw "Native arguments changed: $($actual | ConvertTo-Json -Compress)"
    }
    $pipeline = 'hello' | codex exec - | ConvertFrom-Json
    if (($pipeline | ConvertTo-Json -Compress) -ne (@('exec', '-') | ConvertTo-Json -Compress)) {
        throw 'Pipeline arguments changed'
    }
    & (Join-Path $root 'scripts\setup.ps1') -Remove -ProfilePath $profilePath | Out-Null
    $removed = [IO.File]::ReadAllText($profilePath)
    if (-not $removed.Contains('# Existing profile content') -or $removed.Contains('>>> Codex Rail')) {
        throw 'Removal did not preserve the existing profile'
    }
    $status = & (Join-Path $root 'scripts\setup.ps1') -Status -ProfilePath $profilePath | ConvertFrom-Json
    if ($status.configured) { throw 'Removal left integration configured' }
    Write-Output "PowerShell $($PSVersionTable.PSVersion): setup, profile backup, exact argv, native commands, pipeline and removal OK"
} finally {
    Remove-Item Function:\codex -ErrorAction SilentlyContinue
    $env:PATH = $originalPath
    $env:APPDATA = $originalAppData
    $env:CODEX_HOME = $originalCodexHome
    [Console]::OutputEncoding = $originalEncoding
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Recurse -Force }
}
