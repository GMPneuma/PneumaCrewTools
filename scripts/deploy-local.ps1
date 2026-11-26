param(
  [switch]$Deploy,
  [switch]$ServerStopped,
  [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$config = Get-Content -LiteralPath (Join-Path $repo 'crewtools-target.json') -Raw | ConvertFrom-Json
$manifest = Get-Content -LiteralPath (Join-Path $repo 'static/module.json') -Raw | ConvertFrom-Json
$branch = git -C $repo branch --show-current
if ($LASTEXITCODE -ne 0) { throw 'Cannot identify Git branch' }
$base = git -C $repo rev-parse $config.branch
if ($LASTEXITCODE -ne 0) { throw 'Configured base branch is missing' }
git -C $repo merge-base --is-ancestor $base HEAD
if ($LASTEXITCODE -ne 0) { throw "Current branch does not contain $($config.branch). Check the version worktree." }
$major = [string]$config.foundryMajor
if ($manifest.id -ne 'pneuma-crewtools' -or [string]$manifest.compatibility.minimum -ne $major -or [string]$manifest.compatibility.maximum -ne $major) { throw 'Manifest does not match this worktree target' }
$expectedRoot = "W:\data\foundry$major"
$dataRoot = [IO.Path]::GetFullPath($config.dataRoot)
if ($dataRoot -ne $expectedRoot) { throw 'Unexpected Foundry data root' }
$target = [IO.Path]::GetFullPath((Join-Path $dataRoot 'Data/modules/pneuma-crewtools'))
if ($target -ne "$expectedRoot\Data\modules\pneuma-crewtools") { throw 'Unexpected deployment target' }
Write-Output "Branch: $branch; Foundry: $major; Target: $target"
if ($CheckOnly) { return }
if ($Deploy -and !$ServerStopped) { throw 'Stop the matching Foundry server and supply -ServerStopped before deployment' }
Push-Location $repo
try {
  node node_modules/typescript/bin/tsc --noEmit
  if ($LASTEXITCODE -ne 0) { throw 'Typecheck failed; nothing deployed' }
  node node_modules/vite/bin/vite.js build
  if ($LASTEXITCODE -ne 0) { throw 'Build failed; nothing deployed' }
  $dist = Join-Path $repo 'dist'
  $built = Get-Content -LiteralPath (Join-Path $dist 'module.json') -Raw | ConvertFrom-Json
  if ($built.id -ne $manifest.id -or [string]$built.compatibility.minimum -ne $major -or [string]$built.compatibility.maximum -ne $major -or $built.manifest -ne $manifest.manifest) { throw 'Built manifest does not match target' }
  if (!$Deploy) { Write-Output 'Build verified. No deployment requested.'; return }
  if (!(Test-Path -LiteralPath (Join-Path $dataRoot 'Data/modules'))) { throw 'Foundry modules directory is unavailable' }
  $backup = $null
  if (Test-Path -LiteralPath $target) {
    $backupRoot = Join-Path $dataRoot 'development-backups'
    $backup = Join-Path $backupRoot ('pneuma-crewtools-' + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))
    if (Test-Path -LiteralPath $backup) { throw 'Backup already exists' }
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    Move-Item -LiteralPath $target -Destination $backup
  }
  try {
    Copy-Item -LiteralPath $dist -Destination $target -Recurse
    $files = @(Get-ChildItem -LiteralPath $dist -File -Recurse)
    if ($files.Count -ne @(Get-ChildItem -LiteralPath $target -File -Recurse).Count) { throw 'Deployed file count differs' }
    foreach ($file in $files) {
      $relative = [IO.Path]::GetRelativePath($dist, $file.FullName)
      if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath (Join-Path $target $relative)).Hash) { throw "Deployed hash differs: $relative" }
    }
  } catch {
    if (Test-Path -LiteralPath $target) {
      $failed = "$target.failed-$(Get-Date -Format 'yyyyMMdd-HHmmss-fff')"
      Move-Item -LiteralPath $target -Destination $failed
    }
    if ($backup) { Move-Item -LiteralPath $backup -Destination $target }
    throw
  }
  Write-Output "Deployed $($files.Count) verified files. Previous installation: $backup"
} finally { Pop-Location }
