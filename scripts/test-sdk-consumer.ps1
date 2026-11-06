$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'activate.ps1')
$packDir = Join-Path $repoRoot '.local/sdk-tarballs'
New-Item -ItemType Directory -Force $packDir | Out-Null
$consumerDir = Join-Path ([System.IO.Path]::GetTempPath()) ('paykit-consumer-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force $consumerDir | Out-Null
$packages = @('core', 'js', 'node', 'next', 'react')
foreach ($name in $packages) {
    & npm pack --silent --pack-destination $packDir -w "@paykit/$name"
    if ($LASTEXITCODE -ne 0) { throw "Could not pack $name" }
}
$example = Join-Path $repoRoot 'examples/next-store'
foreach ($name in @('app', 'lib', 'tsconfig.json', 'next.config.mjs')) {
    Copy-Item -LiteralPath (Join-Path $example $name) -Destination $consumerDir -Recurse
}
Copy-Item -LiteralPath (Join-Path $repoRoot 'packages/react/registry') -Destination (Join-Path $consumerDir 'components') -Recurse
$manifest = Get-Content -LiteralPath (Join-Path $example 'package.json') -Raw | ConvertFrom-Json
foreach ($name in $packages) {
    $tarball = Join-Path $packDir "paykit-$name-0.1.0.tgz"
    $manifest.dependencies | Add-Member -NotePropertyName "@paykit/$name" -NotePropertyValue ('file:' + $tarball.Replace('\', '/')) -Force
}
$manifest | Add-Member -NotePropertyName name -NotePropertyValue 'paykit-independent-consumer' -Force
[System.IO.File]::WriteAllText((Join-Path $consumerDir 'package.json'), ($manifest | ConvertTo-Json -Depth 20), (New-Object System.Text.UTF8Encoding($false)))
& npm install --prefix $consumerDir --ignore-scripts --no-audit --no-fund
if ($LASTEXITCODE -ne 0) { throw 'Independent consumer installation failed' }
foreach ($name in @('server', 'testing')) {
    if (Test-Path -LiteralPath (Join-Path $consumerDir "node_modules/@paykit/$name")) { throw "Production consumer unexpectedly installed @paykit/$name" }
}
& npm run build --prefix $consumerDir
if ($LASTEXITCODE -ne 0) { throw 'Independent consumer Next.js build failed' }
Write-Output "Independent tarball consumer passed: $consumerDir"
