<# : batch
@echo off
rem ============================================================
rem  Pleaseme - Impresion directa de facturas (sin cuadro de imprimir)
rem  Doble clic en este archivo. Hace todo solo:
rem   1. Te deja elegir la impresora predeterminada.
rem   2. Evita que Windows cambie la impresora predeterminada.
rem   3. Evita que Edge se quede abierto en segundo plano.
rem   4. Crea en el escritorio el acceso directo "Pleaseme Facturacion"
rem      que abre el sistema con impresion directa (--kiosk-printing).
rem   5. Cierra Edge y abre el sistema con ese acceso directo.
rem ============================================================
powershell -NoProfile -ExecutionPolicy Bypass -Command "iex ([IO.File]::ReadAllText('%~f0'))"
echo.
pause
exit /b
#>

$ErrorActionPreference = 'Stop'
$url = 'https://lloammes81.github.io/pleaseme-accesories/index.html'

Write-Host ''
Write-Host '=== Pleaseme - Configurar impresion directa de facturas ===' -ForegroundColor Yellow
Write-Host ''

# 1. Buscar Microsoft Edge
$edge = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $edge) { Write-Host 'No se encontro Microsoft Edge en este equipo.' -ForegroundColor Red; return }
Write-Host "Edge: $edge"

# 2. Impresora predeterminada
$impresoras = @(Get-CimInstance Win32_Printer | Sort-Object Name)
if ($impresoras.Count -eq 0) { Write-Host 'No hay impresoras instaladas.' -ForegroundColor Red; return }
Write-Host ''
Write-Host 'Impresoras instaladas:'
for ($i = 0; $i -lt $impresoras.Count; $i++) {
  $marca = if ($impresoras[$i].Default) { '  <- predeterminada ahora' } else { '' }
  Write-Host ("  {0}. {1}{2}" -f ($i + 1), $impresoras[$i].Name, $marca)
}
Write-Host ''
$r = Read-Host 'Escribe el numero de la impresora para las facturas (Enter = dejar la actual)'
if ($r -match '^\d+$' -and [int]$r -ge 1 -and [int]$r -le $impresoras.Count) {
  $elegida = $impresoras[[int]$r - 1].Name
  # Que Windows no cambie la predeterminada por su cuenta
  Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Windows' -Name 'LegacyDefaultPrinterMode' -Value 1 -Type DWord
  (New-Object -ComObject WScript.Network).SetDefaultPrinter($elegida)
  Write-Host "OK  Impresora predeterminada: $elegida" -ForegroundColor Green
} else {
  Write-Host 'OK  Se deja la impresora predeterminada actual.' -ForegroundColor Green
}

# 3. Edge no se queda abierto en segundo plano (si no, la impresion directa no se activa)
$pol = 'HKCU:\Software\Policies\Microsoft\Edge'
if (-not (Test-Path $pol)) { New-Item -Path $pol -Force | Out-Null }
Set-ItemProperty -Path $pol -Name 'StartupBoostEnabled' -Value 0 -Type DWord
Set-ItemProperty -Path $pol -Name 'BackgroundModeEnabled' -Value 0 -Type DWord
Write-Host 'OK  Edge ya no se queda abierto en segundo plano' -ForegroundColor Green

# 4. Acceso directo en el escritorio
$escritorio = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $escritorio 'Pleaseme Facturacion.lnk'
$ws = New-Object -ComObject WScript.Shell
$sc = $ws.CreateShortcut($lnk)
$sc.TargetPath = $edge
$sc.Arguments = "--kiosk-printing $url"
$sc.WorkingDirectory = Split-Path $edge
$sc.IconLocation = "$edge,0"
$sc.Description = 'Pleaseme Facturacion - imprime directo en la impresora predeterminada'
$sc.Save()
Write-Host "OK  Acceso directo creado: $lnk" -ForegroundColor Green

# 5. Cerrar Edge y abrir el sistema con impresion directa
Write-Host ''
Read-Host 'Se va a CERRAR Microsoft Edge (guarda lo que tengas abierto). Pulsa Enter para continuar'
Get-Process msedge -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 2
Start-Process -FilePath $lnk
Write-Host ''
Write-Host 'LISTO. Usa siempre el acceso directo "Pleaseme Facturacion" del escritorio.' -ForegroundColor Yellow
Write-Host 'Al pulsar Imprimir en la factura, se imprime directo en la impresora predeterminada.' -ForegroundColor Yellow
