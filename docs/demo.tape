# Records the README demo GIF with VHS (https://github.com/charmbracelet/vhs):
#   vhs docs/demo.tape
# Run from the repository root.

Output docs/demo.gif

Set FontSize 15
Set Width 1280
Set Height 820
Set Padding 20
Set TypingSpeed 40ms
Set Theme "Catppuccin Mocha"

Type "# An AI agent built this app and said it was done. Is it?"
Enter
Sleep 1.5s
Type "node bin/realitygate.mjs audit examples/vibe-coded-app"
Enter
Sleep 6s

Type "clear"
Enter
Type "# Every check must prove it can FAIL - planted canaries:"
Enter
Sleep 1s
Type "node bin/realitygate.mjs selftest"
Enter
Sleep 4s

Type "clear"
Enter
Type "# The repo built with these gates:"
Enter
Type "node bin/realitygate.mjs audit . | head -14"
Enter
Sleep 5s
