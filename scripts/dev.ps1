# EchoTracker dev: api 8100 + web 5173 в отдельных окнах
$root = Split-Path -Parent $PSScriptRoot
Start-Process node -ArgumentList "src/server.ts" -WorkingDirectory "$root\api"
Start-Process pnpm -ArgumentList "--filter @echotracker/web dev" -WorkingDirectory $root
