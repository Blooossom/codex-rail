---
name: setup
description: Set up, repair, disable, or remove Codex Rail terminal integration for macOS zsh or Windows PowerShell so ordinary interactive codex commands show the train. Run after plugin installation to activate the train.
---

Codex Rail is a local plugin with a terminal companion. Its setup integrates the existing `codex` command; it does not modify Codex's built-in TUI renderer.

Resolve the plugin root two directories above this SKILL.md. Read the plugin's `README.md` when troubleshooting the runtime. Do not copy implementation files into an unrelated repository.

Installing with `codex plugin add` does not install shell integration or change an existing shell. Always finish setup and report how to activate it.

On macOS or Linux with zsh, run `python3 <plugin-root>/scripts/setup.py --install --plugin-id codex-rail@blossom-local`, then run the same script with `--status`. The installer finds Node 22+, preserves the native Codex binary, backs up the zsh startup file, and adds one owned source block. tmux is required; if missing, explain the dependency and install it within the user's authorized setup scope. Linux remains unverified outside automated tests.

On native Windows, use PowerShell 5.1 or 7 and Windows Terminal (`wt.exe`), Node 22+, Python 3.11+, and a logged-in native Codex CLI. No tmux or WSL is required. In the target PowerShell run `& '<plugin-root>\scripts\setup.ps1' -Install -ProfilePath $PROFILE.CurrentUserCurrentHost`, then the same script with `-Status`. Use the actual profile of the user's selected PowerShell edition and host. It backs up that profile and adds one owned source block. Activate using the reported dot-source command or a new PowerShell tab. An ordinary interactive `codex` opens a separate Windows Terminal window with Codex above and the train below; the originating shell waits until it exits. Windows Terminal GUI operation is experimental until tested on a real desktop. Do not change execution policy or bypass it; report the actual policy error if scripts are blocked.

If installed under a different marketplace, use its actual qualified plugin id (`--plugin-id` on zsh, `-PluginId` on PowerShell). The runtime and WebSocket dependency are bundled. Do not disable hook trust, modify authentication, or bypass permissions. No lifecycle hook is needed.

Verify `codex --version`, `codex exec --help`, and `codex plugin list --marketplace <marketplace> --json` still reach native Codex. Use bundled routing tests without running model turns. Confirm that the target shell loads the function and `--status` reports configured true. Windows uses `test/windows.ps1` to test PowerShell routing and profile installation/removal in isolation; macOS uses the tmux pseudo-terminal regression test.

For requested disable/removal on zsh, run `python3 <plugin-root>/scripts/setup.py --remove`. On Windows use `& '<plugin-root>\scripts\setup.ps1' -Remove -ProfilePath $PROFILE.CurrentUserCurrentHost`. It removes only the owned source block and integration files. Disabling the plugin in Codex makes the dispatcher fall back to native Codex on subsequent starts. A running session keeps its display until it exits.

On zsh, temporarily bypass with `CODEX_RAIL_DISABLE=1 codex` or `command codex`. On PowerShell set `$env:CODEX_RAIL_DISABLE = '1'` for subsequent invocations and remove the variable to re-enable. Maintenance commands, help, version, explicit remote connections, piped input/output, and unsupported terminal sizes pass through automatically. Preserve exact user arguments and never route approval decisions through this skill.
