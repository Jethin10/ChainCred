param([ValidateSet('up', 'down', 'status')][string]$Action = 'up')
$ErrorActionPreference = 'Stop'
$stateDirectory = Join-Path $PSScriptRoot '../.local'
New-Item -ItemType Directory -Force $stateDirectory | Out-Null
$keepaliveFile = Join-Path $stateDirectory 'wsl-keepalive.pid'
if ($Action -eq 'up') {
    $existing = $null
    if (Test-Path $keepaliveFile) {
        $existing = Get-Process -Id ([int](Get-Content $keepaliveFile -Raw)) -ErrorAction SilentlyContinue
    }
    if (-not $existing -or $existing.ProcessName -ne 'wsl') {
        # WSL does not count systemd services as activity. Keep this distro alive.
        $keeper = Start-Process wsl.exe -ArgumentList '-d', 'kali-linux', '--', 'sleep', 'infinity' -WindowStyle Hidden -PassThru
        $keeper.Id | Set-Content $keepaliveFile
    }
}
$composePath = (Resolve-Path (Join-Path $PSScriptRoot '../compose.yaml')).Path
$linuxPath = (& wsl -d kali-linux -- wslpath -a $composePath.Replace('\', '/')).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not translate the Compose path.' }
& wsl -d kali-linux -- systemctl start docker
if ($LASTEXITCODE -ne 0) { throw 'Docker Engine could not start in WSL.' }
switch ($Action) {
    up { & wsl -d kali-linux -- docker-compose -f $linuxPath up -d --wait }
    down { & wsl -d kali-linux -- docker-compose -f $linuxPath down }
    status { & wsl -d kali-linux -- docker-compose -f $linuxPath ps }
}
if ($LASTEXITCODE -ne 0) { throw "Docker Compose $Action failed." }
if ($Action -eq 'down' -and (Test-Path $keepaliveFile)) {
    $keeperId = [int](Get-Content $keepaliveFile -Raw)
    $keeper = Get-CimInstance Win32_Process -Filter "ProcessId = $keeperId" -ErrorAction SilentlyContinue
    if ($keeper -and $keeper.Name -eq 'wsl.exe' -and $keeper.CommandLine -match 'kali-linux.*sleep.*infinity') {
        Stop-Process -Id $keeperId
    }
    Remove-Item -LiteralPath $keepaliveFile
}
