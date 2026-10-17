# Gera o logo do ScreenPLAY (assets/icon.png, 512x512) em preto, branco e cinza.
# Uso: powershell -ExecutionPolicy Bypass -File tools\make-icon.ps1
param([string]$Out = (Join-Path $PSScriptRoot '..\assets\icon.png'))
Add-Type -AssemblyName System.Drawing

$size = 512
$bmp = New-Object System.Drawing.Bitmap $size, $size
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::Transparent)

function RoundRect([float]$x, [float]$y, [float]$w, [float]$h, [float]$r) {
  $p = New-Object System.Drawing.Drawing2D.GraphicsPath
  $d = $r * 2
  $p.AddArc($x, $y, $d, $d, 180, 90)
  $p.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
  $p.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
  $p.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
  $p.CloseFigure()
  return $p
}
$white = [System.Drawing.Color]::FromArgb(245, 245, 245)

# Fundo: preto com leve degradê cinza e borda fina (aparece bem na barra de tarefas escura)
$bg = RoundRect 16 16 480 480 112
$rect = New-Object System.Drawing.RectangleF 0, 16, $size, 480
$grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(48, 48, 48)), ([System.Drawing.Color]::FromArgb(10, 10, 10)), 90
$g.FillPath($grad, $bg)
$border = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(70, 70, 70)), 6
$g.DrawPath($border, $bg)

# Monitor
$pen = New-Object System.Drawing.Pen $white, 34
$pen.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
$pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
$screen = RoundRect 96 112 320 216 30
$g.DrawPath($pen, $screen)
$g.DrawLine($pen, 256, 328, 256, 388)
$g.DrawLine($pen, 186, 396, 326, 396)

# Botão "play" no meio da tela (cantos arredondados)
$play = New-Object System.Drawing.Drawing2D.GraphicsPath
$play.AddPolygon([System.Drawing.PointF[]]@(
  (New-Object System.Drawing.PointF 228, 172),
  (New-Object System.Drawing.PointF 228, 268),
  (New-Object System.Drawing.PointF 306, 220)))
$round = New-Object System.Drawing.Pen $white, 18
$round.LineJoin = [System.Drawing.Drawing2D.LineJoin]::Round
$g.FillPath((New-Object System.Drawing.SolidBrush $white), $play)
$g.DrawPath($round, $play)

$g.Dispose()
$bmp.Save([System.IO.Path]::GetFullPath($Out), [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"ok: $Out"
