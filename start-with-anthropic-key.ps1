$ErrorActionPreference = "Stop"

$secretsPath = Join-Path $PSScriptRoot "data\local-secrets.json"

function Convert-SecureStringToPlainText($secureValue) {
  if (-not $secureValue) { return "" }
  $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr)
  } finally {
    if ($ptr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
  }
}

function Read-EncryptedSecret($encryptedValue) {
  if (-not $encryptedValue) { return "" }
  try {
    $secureValue = ConvertTo-SecureString -String $encryptedValue
    return Convert-SecureStringToPlainText $secureValue
  } catch {
    return ""
  }
}

function Read-PlainSecret($prompt) {
  $secureValue = Read-Host $prompt -AsSecureString
  return Convert-SecureStringToPlainText $secureValue
}

function Protect-PlainSecret($plainValue) {
  if (-not $plainValue) { return "" }
  return ConvertTo-SecureString -String $plainValue -AsPlainText -Force | ConvertFrom-SecureString
}

$saved = @{}
if (Test-Path $secretsPath) {
  try {
    $saved = Get-Content $secretsPath -Raw | ConvertFrom-Json -AsHashtable
  } catch {
    Write-Host "Saved local secrets could not be read. They will be recreated."
    $saved = @{}
  }
}

$anthropicKey = Read-EncryptedSecret $saved.anthropicApiKey
if (-not $anthropicKey) {
  $anthropicKey = Read-PlainSecret "Paste your Anthropic API key"
}

$googleClientId = $env:GOOGLE_CLIENT_ID
if (-not $googleClientId) { $googleClientId = [string]$saved.googleClientId }
if (-not $googleClientId) {
  $googleClientId = Read-Host "Paste your Google OAuth Client ID"
}

$googleClientSecret = $env:GOOGLE_CLIENT_SECRET
if (-not $googleClientSecret) { $googleClientSecret = Read-EncryptedSecret $saved.googleClientSecret }
if (-not $googleClientSecret) {
  $googleClientSecret = Read-PlainSecret "Paste your Google OAuth Client Secret"
}

$qboClientId = $env:QBO_CLIENT_ID
if (-not $qboClientId) { $qboClientId = [string]$saved.qboClientId }

$qboClientSecret = $env:QBO_CLIENT_SECRET
if (-not $qboClientSecret) { $qboClientSecret = Read-EncryptedSecret $saved.qboClientSecret }

$qboRedirectUri = $env:QBO_REDIRECT_URI
if (-not $qboRedirectUri) { $qboRedirectUri = [string]$saved.qboRedirectUri }
if (-not $qboRedirectUri) { $qboRedirectUri = "http://localhost:8080/auth/qbo/callback" }

$qboEnvironment = $env:QBO_ENVIRONMENT
if (-not $qboEnvironment) { $qboEnvironment = [string]$saved.qboEnvironment }
if (-not $qboEnvironment) { $qboEnvironment = "sandbox" }

New-Item -ItemType Directory -Force -Path (Split-Path $secretsPath) | Out-Null
@{
  anthropicApiKey = Protect-PlainSecret $anthropicKey
  googleClientId = $googleClientId
  googleClientSecret = Protect-PlainSecret $googleClientSecret
  qboClientId = $qboClientId
  qboClientSecret = Protect-PlainSecret $qboClientSecret
  qboRedirectUri = $qboRedirectUri
  qboEnvironment = $qboEnvironment
} | ConvertTo-Json | Set-Content -Path $secretsPath -Encoding UTF8

$listener = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
  Stop-Process -Id $listener.OwningProcess -Force
}

$env:PORT = "8080"
$env:HOST = "127.0.0.1"
$env:AUTH_REQUIRED = "true"
$env:AUTH_SECRET = "codex-local-auth-secret-please-change-2026"
$env:AUTH_USERS_JSON = '[{"username":"augusto","passwordHash":"pbkdf2$120000$codex-local-salt$nzYSc-lwbuGw7zPOzwosdfjkfab8wjNn1VTiTtLJbEo"}]'
$env:CLAUDE_MODEL = "claude-opus-4-7,claude-opus-4-6,claude-sonnet-4-6"
$env:ENABLE_CLAUDE_WEB_SEARCH = "true"
$env:ANTHROPIC_API_KEY = $anthropicKey
$env:GOOGLE_CLIENT_ID = $googleClientId
$env:GOOGLE_CLIENT_SECRET = $googleClientSecret
$env:QBO_CLIENT_ID = $qboClientId
$env:QBO_CLIENT_SECRET = $qboClientSecret
$env:QBO_REDIRECT_URI = $qboRedirectUri
$env:QBO_ENVIRONMENT = $qboEnvironment

Write-Host "Starting AI Tax Agent on http://127.0.0.1:8080"
Write-Host "Saved local credentials in data\local-secrets.json for next time."
$nodePath = "C:\Users\54115\AppData\Local\OpenAI\Codex\bin\node.exe"
if (-not (Test-Path $nodePath)) {
  $nodePath = "node"
}
& $nodePath server.js
