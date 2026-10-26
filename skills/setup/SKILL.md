---
name: setup
description: Set up, repair, disable, or remove Codex Rail terminal integration so ordinary interactive codex commands show the train. Use for Codex Rail setup and its terminal display preferences.
---

Codex Rail is a local plugin with a terminal companion. Its setup integrates the existing `codex` command; it does not modify Codex's built-in TUI renderer.

Resolve the plugin root two directories above this SKILL.md. Read the plugin's `README.md` when troubleshooting the runtime. Do not copy implementation files into an unrelated repository.

For requested setup, run `python3 <plugin-root>/scripts/setup.py --install --plugin-id codex-rail@blossom-local`, then run the same script with `--status`. The installer finds Node 22+, preserves the native Codex binary, backs up the zsh startup file, and adds one owned source block. If the plugin is installed under a different marketplace, use its actual qualified plugin id. If Python is older than 3.11, use an available newer Python.

The runtime is bundled, including its WebSocket dependency. tmux is required. If it is missing, explain the dependency and install it within the user's authorized setup scope. Do not disable hook trust, modify authentication, or bypass permissions. No lifecycle hook is needed for this plugin.

Verify `codex --version`, `codex exec --help`, and `codex plugin list --marketplace <marketplace> --json` still reach native Codex. Use the bundled routing tests to check interactive argument forwarding without running model turns. Confirm that a fresh zsh loads the function. Existing shell processes need to source the reported integration file once or open a new terminal tab.

For requested disable/removal, run `python3 <plugin-root>/scripts/setup.py --remove`. It removes only this plugin's shell source block and integration files. Disabling the plugin in Codex also makes the dispatcher fall back to native Codex on subsequent starts. A running session keeps its current display until it exits.

The user can temporarily bypass the train with `CODEX_RAIL_DISABLE=1 codex` or `command codex`. Maintenance commands, help, version, explicit remote connections, piped input/output, and unsupported terminal sizes are passed through automatically. Preserve exact user arguments and never route approval decisions through this skill.
