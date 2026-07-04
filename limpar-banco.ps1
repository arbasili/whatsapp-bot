<#
.SYNOPSIS
  Limpa os dados de teste do CRM (leads, conversas, bot_state, ai_activity e
  análises de reunião). Wrapper local do limpar-leads-teste.js — evita abrir o
  console do Railway a cada limpeza.

.DESCRIPTION
  Precisa da connection string PÚBLICA do Postgres do Railway e do CLIENT_ID.
  A URL interna (railway.internal) só funciona de dentro do Railway; da sua
  máquina use a pública (Railway -> Postgres -> Connect -> Public Network,
  algo como postgresql://postgres:SENHA@HOST.proxy.rlwy.net:PORTA/railway).

  Coloque as duas num arquivo .env NESTA pasta (já está no .gitignore, não vai
  pro git):
      DATABASE_URL=postgresql://postgres:SENHA@HOST.proxy.rlwy.net:PORTA/railway
      CLIENT_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx

  Alternativamente, defina DATABASE_URL e CLIENT_ID como variáveis de ambiente
  antes de rodar — o script usa as do ambiente se existirem.

.PARAMETER Confirmo
  Sem este switch, roda em DRY-RUN (só mostra as contagens, não apaga nada).

.PARAMETER Tudo
  Apaga TAMBÉM clients e user_clients (reset 100%). Ambos se auto-recriam: o bot
  re-registra o CLIENT_ID no boot e o painel re-vincula o usuário no 1o login.

.EXAMPLE
  .\limpar-banco.ps1                 # dry-run: mostra o que seria apagado
  .\limpar-banco.ps1 -Confirmo       # apaga de verdade (mantém clients/user_clients)
  .\limpar-banco.ps1 -Confirmo -Tudo # reset 100%
#>
param(
  [switch]$Confirmo,
  [switch]$Tudo
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path

# 1. Localiza o node
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  $cand = 'C:\Program Files\nodejs\node.exe'
  if (Test-Path $cand) { $node = $cand } else { Write-Error 'Node.js nao encontrado.'; exit 1 }
}

# 2. Credenciais: variaveis de ambiente atuais ou o .env desta pasta
$dbUrl    = $env:DATABASE_URL
$clientId = $env:CLIENT_ID
$envFile  = Join-Path $raiz '.env'
if ((-not $dbUrl -or -not $clientId) -and (Test-Path $envFile)) {
  foreach ($linha in Get-Content $envFile) {
    $l = $linha.Trim()
    if (-not $l -or $l.StartsWith('#') -or -not $l.Contains('=')) { continue }
    $i = $l.IndexOf('=')
    $k = $l.Substring(0, $i).Trim()
    $v = $l.Substring($i + 1).Trim().Trim('"')
    if ($k -eq 'DATABASE_URL' -and -not $dbUrl)    { $dbUrl = $v }
    if ($k -eq 'CLIENT_ID'    -and -not $clientId) { $clientId = $v }
  }
}
if (-not $dbUrl -or -not $clientId) {
  Write-Error "DATABASE_URL e/ou CLIENT_ID nao encontrados. Crie um .env nesta pasta (veja o cabecalho do script com: Get-Help .\limpar-banco.ps1 -Full)."
  exit 1
}
if ($dbUrl -match 'railway\.internal') {
  Write-Warning 'Sua DATABASE_URL e a INTERNA (railway.internal) — ela nao e acessivel da sua maquina. Use a connection string PUBLICA (...proxy.rlwy.net).'
}

# 3. Confirmacao antes de apagar de verdade
if ($Confirmo) {
  $escopo = if ($Tudo) { 'TUDO (inclui clients e user_clients)' } else { 'leads, conversas, bot_state, ai_activity e meeting_analyses' }
  Write-Host ''
  Write-Host "Vai APAGAR: $escopo" -ForegroundColor Yellow
  $resp = Read-Host "Tem certeza? digite 'sim' para confirmar"
  if ($resp -ne 'sim') { Write-Host 'Cancelado.'; exit 0 }
} else {
  Write-Host ''
  Write-Host '=== DRY-RUN (nada sera apagado) ===' -ForegroundColor Cyan
}

# 4. Roda o limpar-leads-teste.js com as credenciais no ambiente do processo filho
$argsNode = @('limpar-leads-teste.js')
if ($Confirmo) { $argsNode += '--confirmo' }
if ($Tudo)     { $argsNode += '--tudo' }

$env:DATABASE_URL = $dbUrl
$env:CLIENT_ID    = $clientId

Push-Location $raiz
try {
  & $node @argsNode
  $code = $LASTEXITCODE
} finally {
  Pop-Location
}

if ($Confirmo -and $code -eq 0) {
  Write-Host ''
  Write-Host 'IMPORTANTE: reinicie o servico do bot no Railway (Restart) para zerar o' -ForegroundColor Yellow
  Write-Host 'estado em memoria (conversas, agendamentos e lembretes pendentes).'     -ForegroundColor Yellow
}
exit $code
