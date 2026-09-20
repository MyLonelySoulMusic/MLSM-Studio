param(
  [Parameter(Mandatory = $true)][string]$Directory,
  [switch]$DryRun
)

$normalized = [IO.Path]::GetFullPath($Directory).TrimEnd('\')
if (-not (Test-Path -LiteralPath $normalized -PathType Container)) {
  throw "Cartella da aggiungere al PATH non trovata: $normalized"
}

$current = [Environment]::GetEnvironmentVariable('Path', 'User')
$entries = @($current -split ';' | Where-Object { $_ -and $_.Trim() })
$present = $entries | Where-Object { $_.TrimEnd('\').Equals($normalized, [StringComparison]::OrdinalIgnoreCase) }
if ($present) {
  Write-Host "PATH utente già configurato: $normalized"
  exit 0
}

$updated = (@($entries) + $normalized) -join ';'
if ($DryRun) {
  Write-Host "[dry-run] aggiunta al PATH utente: $normalized"
} else {
  [Environment]::SetEnvironmentVariable('Path', $updated, 'User')
  Write-Host "PATH utente aggiornato: $normalized"
}
