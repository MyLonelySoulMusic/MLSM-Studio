param(
  [Parameter(Mandatory = $true)][string]$ProjectRoot,
  [Parameter(Mandatory = $true)][string]$OutputDirectory
)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath $ProjectRoot).Path
$launch = Join-Path $project 'scripts\windows\launch.bat'
$icon = Join-Path $project 'apps\desktop\src-tauri\icons\icon.ico'
if (!(Test-Path -LiteralPath $launch -PathType Leaf) -or !(Test-Path -LiteralPath $icon -PathType Leaf)) {
  throw 'MLSM launch.bat or icon.ico is missing.'
}
$cmd = $env:ComSpec
if (!$cmd -or !(Test-Path -LiteralPath $cmd -PathType Leaf)) { $cmd = Join-Path ([Environment]::GetFolderPath('System')) 'cmd.exe' }
$owner = 'MLSM Studio - local launcher (managed)'
$null = New-Item -ItemType Directory -Path $OutputDirectory -Force
$destination = Join-Path $OutputDirectory 'MLSM Studio.lnk'
if ((Test-Path -LiteralPath $destination) -and ((Get-Item -LiteralPath $destination).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
  throw 'Refusing to overwrite a launcher symlink.'
}
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($destination)
if ((Test-Path -LiteralPath $destination) -and $shortcut.Description -ne $owner) {
  throw 'An unmanaged MLSM Studio.lnk already exists. Move it before creating the branded launcher.'
}
# /k preserves diagnostics after an error. TargetPath is an EXE; the BAT is a quoted argument.
$arguments = '/d /s /k ""{0}""' -f $launch
$shortcut.TargetPath = $cmd
$shortcut.Arguments = $arguments
$shortcut.WorkingDirectory = $project
$shortcut.IconLocation = $icon + ',0'
$shortcut.Description = $owner
$shortcut.WindowStyle = 1
$shortcut.Save()
if (!(Test-Path -LiteralPath $destination -PathType Leaf) -or (Get-Item -LiteralPath $destination).Length -eq 0) {
  throw 'Windows did not create the branded launcher.'
}
$saved = $shell.CreateShortcut($destination)
if ($saved.TargetPath -ne $cmd -or $saved.Arguments -ne $arguments -or $saved.IconLocation -ne ($icon + ',0')) {
  throw 'Windows launcher verification failed.'
}
