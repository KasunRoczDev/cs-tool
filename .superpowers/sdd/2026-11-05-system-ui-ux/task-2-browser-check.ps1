$ErrorActionPreference = 'Stop'
node .superpowers/sdd/2026-11-05-system-ui-ux/task-2-browser.cjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
$reviewDir = Join-Path (Get-Location) '.superpowers/sdd/2026-11-05-system-ui-ux'
$reviewUrl = ([System.Uri](Join-Path $reviewDir 'task-2-browser.html')).AbsoluteUri
$edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
foreach ($variant in @(@('mobile-dark','390,844','dark'), @('mobile-light','390,844','light'), @('desktop-dark','1440,1000','dark'), @('desktop-light','1440,1000','light'))) {
  & $edge --headless --disable-gpu --no-first-run --allow-file-access-from-files "--window-size=$($variant[1])" --virtual-time-budget=6000 --dump-dom "--user-data-dir=$reviewDir/task-2-edge-profile" "--screenshot=$reviewDir/task-2-$($variant[0]).png" "$($reviewUrl)?theme=$($variant[2])" 2> "$reviewDir/task-2-edge-errors.txt" | Set-Content -LiteralPath "$reviewDir/task-2-$($variant[0])-dom.html"
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  $result = Select-String -LiteralPath "$reviewDir/task-2-$($variant[0])-dom.html" -Pattern '<pre id="result"' | ForEach-Object { [regex]::Match($_.Line, '<pre id="result"[^>]*>([^<]*)').Groups[1].Value }
  Write-Output "$($variant[0]): $result"
  if ($result -notlike 'PASS*') { exit 1 }
}
