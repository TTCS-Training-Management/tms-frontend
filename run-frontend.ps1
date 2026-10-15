$frontend = $PSScriptRoot

Set-Location -LiteralPath $frontend
npm run dev -- --host 0.0.0.0
