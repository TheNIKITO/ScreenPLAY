# Compila native\ScreenPLAYAudio.cs -> native\ScreenPLAYAudio.exe com o csc.exe do .NET Framework
# (vem com o Windows, não precisa instalar nada).
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { throw "csc.exe não encontrado em $csc" }
$src = Join-Path $root 'native\ScreenPLAYAudio.cs'
$out = Join-Path $root 'native\ScreenPLAYAudio.exe'
& $csc /nologo /optimize+ /platform:x64 /target:exe "/out:$out" $src
if ($LASTEXITCODE -ne 0) { throw 'falha ao compilar ScreenPLAYAudio' }
"ok: $out"
