# 从声明式用例生成确定性的无敏感信息手机界面 PNG；Windows System.Drawing，无需网络。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$root = Split-Path -Parent $PSScriptRoot
$casePath = Join-Path $root 'tests/vision/cases.json'
$out = Join-Path $root 'tests/vision/fixtures'
New-Item -ItemType Directory -Path $out -Force | Out-Null
$cases = Get-Content -Raw -Encoding UTF8 -LiteralPath $casePath | ConvertFrom-Json
$records = @()
$width = 390
$height = 780
$fontName = 'Microsoft YaHei'
$brushInk = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(20, 36, 63))
$brushBlue = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(29, 78, 216))
$brushWhite = [Drawing.SolidBrush]::new([Drawing.Color]::White)
$brushMuted = [Drawing.SolidBrush]::new([Drawing.Color]::FromArgb(68, 82, 107))
$pen = [Drawing.Pen]::new([Drawing.Color]::FromArgb(203, 213, 225), 1)
$titleFont = [Drawing.Font]::new($fontName, 23, [Drawing.FontStyle]::Bold, [Drawing.GraphicsUnit]::Pixel)
$smallFont = [Drawing.Font]::new($fontName, 13, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$normalFont = [Drawing.Font]::new($fontName, 19, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)
$compactFont = [Drawing.Font]::new($fontName, 12, [Drawing.FontStyle]::Regular, [Drawing.GraphicsUnit]::Pixel)

try {
  foreach ($case in $cases) {
    if ($case.id -notmatch '^\d{2}$') { throw 'Invalid case ID' }
    $bitmap = [Drawing.Bitmap]::new($width, $height)
    $graphics = [Drawing.Graphics]::FromImage($bitmap)
    try {
      $graphics.SmoothingMode = [Drawing.Drawing2D.SmoothingMode]::AntiAlias
      $graphics.TextRenderingHint = [Drawing.Text.TextRenderingHint]::AntiAliasGridFit
      $graphics.Clear([Drawing.Color]::FromArgb(245,247,251))
      $graphics.FillRectangle($brushBlue, 0, 0, $width, 110)
      $graphics.DrawString('9:41   演示手机', $smallFont, $brushWhite, 20, 13)
      $graphics.DrawString([string]$case.title, $titleFont, $brushWhite, 18, 47)
      $graphics.DrawString('以下均为虚构内容，不产生真实业务', $smallFont, $brushMuted, 18, 125)
      $compact = $case.layout -eq 'compact'
      $font = if ($compact) { $compactFont } else { $normalFont }
      $rowHeight = if ($compact) { 43 } else { 66 }
      $gap = if ($compact) { 5 } else { 10 }
      $left = 18; $top = 164; $rowWidth = $width - 36
      $expectedBox = $null
      for ($i = 0; $i -lt $case.rows.Count; $i++) {
        $y = $top + $i * ($rowHeight + $gap)
        $graphics.FillRectangle($brushWhite, $left, $y, $rowWidth, $rowHeight)
        $graphics.DrawRectangle($pen, $left, $y, $rowWidth, $rowHeight)
        $graphics.DrawString([string]$case.rows[$i], $font, $brushInk, $left + 16, $y + ($rowHeight - $font.Height) / 2)
        $graphics.DrawString('›', $normalFont, $brushMuted, $width - 43, $y + ($rowHeight - $normalFont.Height) / 2)
        if ($case.expected -eq 'target' -and $i -eq $case.targetIndex) {
          $expectedBox = @(($left / $width), ($y / $height), (($left + $rowWidth) / $width), (($y + $rowHeight) / $height))
        }
      }
      $graphics.FillRectangle($brushWhite, 0, 714, $width, 66)
      $graphics.DrawString('首页           服务           我的', $normalFont, $brushMuted, 38, 735)
    } finally { $graphics.Dispose() }
    $fileName = "sg-$($case.id).png"
    $destination = Join-Path $out $fileName
    try {
      if ($case.mode -eq 'blur') {
        $small = [Drawing.Bitmap]::new(18,36)
        $down = [Drawing.Graphics]::FromImage($small)
        try { $down.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBilinear; $down.DrawImage($bitmap, 0, 0, 18, 36) } finally { $down.Dispose() }
        $blur = [Drawing.Bitmap]::new($width,$height)
        $up = [Drawing.Graphics]::FromImage($blur)
        try { $up.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::Bilinear; $up.DrawImage($small, 0, 0, $width, $height) } finally { $up.Dispose(); $small.Dispose() }
        try { $blur.Save($destination, [Drawing.Imaging.ImageFormat]::Png) } finally { $blur.Dispose() }
      } elseif ($case.mode -eq 'crop') {
        $crop = $bitmap.Clone([Drawing.Rectangle]::new(0,0,$width,260), $bitmap.PixelFormat)
        try { $crop.Save($destination, [Drawing.Imaging.ImageFormat]::Png) } finally { $crop.Dispose() }
      } else { $bitmap.Save($destination, [Drawing.Imaging.ImageFormat]::Png) }
    } finally { $bitmap.Dispose() }
    $targetLabel = if ($case.expected -eq 'target') { [string]$case.rows[$case.targetIndex] } else { $null }
    $records += [ordered]@{ id = $case.id; category = $case.category; file = $fileName; question = $case.question; expected = $case.expected; targetLabel = $targetLabel; boundingBox = $expectedBox }
  }
  ConvertTo-Json -InputObject @($records) -Depth 8 | Set-Content -LiteralPath (Join-Path $out 'manifest.json') -Encoding utf8
  Write-Output "Generated $($records.Count) synthetic vision fixtures."
} finally {
  foreach ($item in @($brushInk,$brushBlue,$brushWhite,$brushMuted,$pen,$titleFont,$smallFont,$normalFont,$compactFont)) { $item.Dispose() }
}
