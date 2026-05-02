$ErrorActionPreference = 'Stop'

$dirs = @(
  'C:\development\CsPortfolioTracking\src',
  'C:\development\CsPortfolioTracking\apps\web\src',
  'C:\development\CsPortfolioTracking\packages\shared\src'
)

$files = foreach ($dir in $dirs) {
  if (Test-Path $dir) {
    Get-ChildItem -Path $dir -Recurse -File | Where-Object { $_.Extension -in '.js', '.jsx' }
  }
}

$fixed = 0

foreach ($file in $files) {
  $content = Get-Content $file.FullName -Raw
  $original = $content

  $content = $content.Replace('from "@/', 'from "@shared/')
  $content = $content.Replace("from '@/", "from '@shared/")
  $content = $content.Replace('@shared/ModalContext', '@shared/contexts/ModalContext')
  $content = $content.Replace('@shared/ThemeContext', '@shared/contexts/ThemeContext')
  $content = $content.Replace('@shared/CurrencyContext', '@shared/contexts/CurrencyContext')
  $content = $content.Replace('from "@shared/components"', 'from "@shared/components"')

  if ($content -ne $original) {
    Set-Content -Path $file.FullName -Value $content -Encoding UTF8
    Write-Host "Fixed $($file.FullName)"
    $fixed++
  }
}

Write-Host "Done. Fixed $fixed files."

