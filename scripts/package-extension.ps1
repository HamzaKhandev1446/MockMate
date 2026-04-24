param(
  [string]$ProjectRoot = (Resolve-Path "$PSScriptRoot\..").Path
)

$manifestPath = Join-Path $ProjectRoot "manifest.json"
if (-not (Test-Path $manifestPath)) {
  throw "manifest.json not found at $manifestPath"
}

$manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json
$version = $manifest.version
if (-not $version) {
  throw "manifest.json version is missing"
}

$distDir = Join-Path $ProjectRoot "dist"
if (-not (Test-Path $distDir)) {
  New-Item -ItemType Directory -Path $distDir | Out-Null
}

$zipPath = Join-Path $distDir "mockmate-v$version.zip"
if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}

$excludePatterns = @(
  ".git",
  ".cursor",
  "dist",
  "node_modules",
  "scripts",
  "*.plan.md",
  "*.log",
  "*.tmp"
)

$items = Get-ChildItem -Path $ProjectRoot -Force | Where-Object {
  $name = $_.Name
  foreach ($pattern in $excludePatterns) {
    if ($name -like $pattern) { return $false }
  }
  return $true
}

Compress-Archive -Path ($items | ForEach-Object { $_.FullName }) -DestinationPath $zipPath -CompressionLevel Optimal
Write-Output "Created package: $zipPath"
