$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Get-Archive([string]$Url, [string]$Destination) {
    & curl.exe --fail --location --retry 3 --retry-all-errors --connect-timeout 15 --max-time 240 --silent --show-error $Url --output $Destination
    if ($LASTEXITCODE -ne 0) { throw "Download failed: $Url" }
}
$toolRoot = Join-Path $env:LOCALAPPDATA 'Web3Hackathon'
$downloadRoot = Join-Path $toolRoot 'downloads'
New-Item -ItemType Directory -Force -Path $toolRoot, $downloadRoot | Out-Null

# Pin Node 24 LTS without replacing the system Node installation.
$nodeRelease = @{ version = 'v24.22.2' }
$nodeArchive = "node-$($nodeRelease.version)-win-x64.zip"
$nodeDirectory = Join-Path $toolRoot "node-$($nodeRelease.version)-win-x64"
if (-not (Test-Path (Join-Path $nodeDirectory 'node.exe')) -or -not (Test-Path (Join-Path $nodeDirectory 'npm.cmd'))) {
    Get-Archive "https://nodejs.org/dist/$($nodeRelease.version)/$nodeArchive" (Join-Path $downloadRoot $nodeArchive)
    $checksums = (Invoke-WebRequest "https://nodejs.org/dist/$($nodeRelease.version)/SHASUMS256.txt" -UseBasicParsing).Content
    $checksumLine = ($checksums -split "`n") | Where-Object { $_.Trim().EndsWith(" $nodeArchive") } | Select-Object -First 1
    if (-not $checksumLine) { throw 'Node archive checksum missing.' }
    $expected = ($checksumLine.Trim() -split '\s+')[0]
    if ((Get-FileHash (Join-Path $downloadRoot $nodeArchive) -Algorithm SHA256).Hash -ne $expected) { throw 'Node checksum mismatch.' }
    Expand-Archive -LiteralPath (Join-Path $downloadRoot $nodeArchive) -DestinationPath $toolRoot -Force
}

$env:Path = "$nodeDirectory;$env:Path"
# Official npm packages include native Windows binaries and npm integrity checks.
$foundryVersion = '1.7.1'
$foundryRoot = Join-Path $toolRoot "foundry-npm-$foundryVersion"
$foundryDirectory = Join-Path $foundryRoot 'node_modules/.bin'
if (-not (Test-Path (Join-Path $foundryDirectory 'forge.cmd'))) {
    & (Join-Path $nodeDirectory 'npm.cmd') install --prefix $foundryRoot --ignore-scripts --no-fund --no-audit --save-exact "@foundry-rs/forge@$foundryVersion" "@foundry-rs/cast@$foundryVersion" "@foundry-rs/anvil@$foundryVersion" "@foundry-rs/chisel@$foundryVersion"
    if ($LASTEXITCODE -ne 0) { throw 'Foundry npm installation failed.' }
}

$config = @{ node = $nodeDirectory; foundry = $foundryDirectory; nodeVersion = $nodeRelease.version; foundryVersion = $foundryVersion }
$config | ConvertTo-Json | Set-Content (Join-Path $PSScriptRoot '../.toolchain.local.json') -Encoding UTF8
$env:Path = "$nodeDirectory;$foundryDirectory;$env:Path"
& (Join-Path $nodeDirectory 'node.exe') --version
& (Join-Path $foundryDirectory 'forge.cmd') --version
if ($LASTEXITCODE -ne 0) { throw 'Foundry executable verification failed.' }
Write-Host 'Toolchain installed. Dot-source scripts/activate.ps1 in each new PowerShell session.'
