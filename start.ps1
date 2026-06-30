$ErrorActionPreference = "Stop"

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  & $node.Source "$PSScriptRoot\server.js"
  exit $LASTEXITCODE
}

$bundledNode = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if (Test-Path $bundledNode) {
  & $bundledNode "$PSScriptRoot\server.js"
  exit $LASTEXITCODE
}

Write-Host "No encontre Node.js. Instala Node.js desde https://nodejs.org y vuelve a ejecutar este archivo."
exit 1
