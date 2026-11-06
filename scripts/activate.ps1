$configPath = Join-Path $PSScriptRoot '../.toolchain.local.json'
if (-not (Test-Path $configPath)) { throw 'Run ./scripts/install-toolchain.ps1 first.' }
$toolchain = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
foreach ($toolPath in @($toolchain.node, $toolchain.foundry)) {
    if (-not (Test-Path $toolPath)) { throw "Missing tool directory: $toolPath" }
}
$env:Path = "$($toolchain.node);$($toolchain.foundry);$env:Path"
Write-Host "Web3 toolchain active: Node $($toolchain.nodeVersion), Foundry $($toolchain.foundryVersion)"
