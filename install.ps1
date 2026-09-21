# Instalador do client/ pro Windows — dependencias, .env, comando `helena`,
# e (rodando como Administrador) o servico real do Windows "HelenaClient"
# via node-windows. Idempotente / re-executavel.
#
# Uso: .\install.ps1
# Sem Administrador, tudo roda exceto a instalacao do servico do Windows
# (nesse caso, use "npm start" manualmente sempre que quiser usar o client/).

$ErrorActionPreference = "Stop"
$ClientDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Write-Info($msg) { Write-Host "  $msg" }
function Write-Warn($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Ok($msg)   { Write-Host "  v $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "  x $msg" -ForegroundColor Red }

function Read-EnvValue($file, $key) {
    if (-not (Test-Path $file)) { return "" }
    $line = Get-Content $file | Where-Object { $_ -match "^$key=" } | Select-Object -Last 1
    if (-not $line) { return "" }
    return ($line -split "=", 2)[1].Trim().Trim('"', "'")
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Err "node nao encontrado no PATH."
    exit 1
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Err "npm nao encontrado no PATH."
    exit 1
}

Push-Location $ClientDir
try {
    Write-Host "Instalando dependencias (npm install)..." -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) { Write-Err "npm install falhou."; exit 1 }

    Write-Host "Buildando o painel web (Angular)..." -ForegroundColor Cyan
    npm run build:panel
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Build do painel falhou — abortando instalacao."
        Write-Info "Nunca sobe servindo painel quebrado ou build antigo silenciosamente. Corrija o erro acima e rode .\install.ps1 de novo."
        exit 1
    }
    Write-Ok "Painel web buildado."

    $EnvFile = Join-Path $ClientDir ".env"
    $EnvExample = Join-Path $ClientDir ".env.example"
    if (-not (Test-Path $EnvFile)) {
        Copy-Item $EnvExample $EnvFile
        Write-Warn ".env criado a partir de .env.example."
    }

    $missing = @()
    if (-not (Read-EnvValue $EnvFile "BACKEND_V2_URL")) { $missing += "BACKEND_V2_URL" }
    if (-not (Read-EnvValue $EnvFile "BACKEND_V2_API_TOKEN")) { $missing += "BACKEND_V2_API_TOKEN (gere via POST /auth/api-tokens, autenticado com seu JWT)" }

    if ($missing.Count -gt 0) {
        Write-Warn "Preencha estes campos em $EnvFile e rode .\install.ps1 de novo:"
        foreach ($m in $missing) { Write-Info "- $m" }
        exit 0
    }

    Write-Host "Instalando o comando 'helena' (chat)..." -ForegroundColor Cyan
    npm link
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "npm link falhou — talvez precise rodar como Administrador. Sem isso, rode 'node bin/helena.js' diretamente."
    } else {
        Write-Ok "'helena' disponivel globalmente."
    }

    $isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    if (-not $isAdmin) {
        Write-Warn "Nao esta rodando como Administrador — pulando instalacao do servico do Windows."
        Write-Info "Rode este script como Administrador pra instalar 'HelenaClient' como servico (inicia sozinho, mesmo sem login)."
        Write-Info "Ou rode 'npm start' manualmente sempre que quiser usar o client/."
        Write-Info "Rode 'helena' e use /canais pra parear o WhatsApp (o QR aparece no terminal)."
        exit 0
    }

    Write-Host "Instalando dependencia do servico do Windows (node-windows)..." -ForegroundColor Cyan
    # Nao e dependencia normal do package.json — so existe no Windows, e so
    # baixada quando alguem de fato pede o servico (--no-save: nunca entra
    # no package-lock.json, que e compartilhado com Linux/Mac).
    npm install node-windows --no-save
    if ($LASTEXITCODE -ne 0) { Write-Err "Falha instalando node-windows."; exit 1 }

    Write-Host "Instalando o servico 'HelenaClient'..." -ForegroundColor Cyan
    node scripts/install-windows-service.js

    Write-Host "Instalacao concluida." -ForegroundColor Cyan
    Write-Info "Use o atalho 'Painel Helena' na area de trabalho pra abrir o painel e parear o WhatsApp escaneando o QR."
    Write-Info "'helena' ja esta disponivel — teste com: helena --help"
} finally {
    Pop-Location
}
