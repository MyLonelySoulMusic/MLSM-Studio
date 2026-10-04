-- Called by the generated, branded .app. Project paths are data, never AppleScript source.
on run arguments
  set projectRoot to item 1 of arguments
  set launchCommand to "/bin/bash " & quoted form of (projectRoot & "/scripts/macos/launch.sh")
  tell application "Terminal"
    activate
    do script launchCommand
  end tell
end run
