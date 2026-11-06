$ErrorActionPreference = 'Stop'
$workspaceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
. (Join-Path $PSScriptRoot 'activate.ps1')
Push-Location $workspaceRoot
try {
    npm run lint
    if ($LASTEXITCODE) { throw 'Frontend lint failed.' }
    npm run build
    if ($LASTEXITCODE) { throw 'Frontend build failed.' }
    npm run contracts:build
    if ($LASTEXITCODE) { throw 'Contract build failed.' }
    npm run contracts:test
    if ($LASTEXITCODE) { throw 'Contract tests failed.' }
    npm run typecheck --workspace contracts
    if ($LASTEXITCODE) { throw 'Contract TypeScript check failed.' }
    Push-Location contracts
    try {
        forge test
        if ($LASTEXITCODE) { throw 'Foundry tests failed.' }
    } finally { Pop-Location }
    Push-Location backend
    try {
        uv run --locked ruff check .
        if ($LASTEXITCODE) { throw 'Python lint failed.' }
        uv run --locked python -m pytest
        if ($LASTEXITCODE) { throw 'API tests failed.' }
    } finally { Pop-Location }
    Write-Host 'All base checks passed.'
} finally { Pop-Location }
