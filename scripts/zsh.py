"""Shell launchers which retain user aliases and functions unchanged."""
from pathlib import Path
from shlex import quote


def launcher(python, dispatcher, settings, native, directory):
    return f'''#!/bin/sh
# Managed by Codex Rail launcher. The native Codex binary is untouched.
if [ -x {quote(str(python))} ] && [ -f {quote(str(dispatcher))} ] && [ -f {quote(str(settings))} ]; then
    exec {quote(str(python))} {quote(str(dispatcher))} {quote(str(settings))} -- "$@"
fi
if [ -x {quote(str(native))} ]; then
    exec {quote(str(native))} "$@"
fi
# The old native location may have disappeared after a CLI update.
rail_old_ifs=$IFS
IFS=:
rail_path=
for rail_entry in $PATH; do
    if [ "$rail_entry" != {quote(str(directory))} ]; then
        rail_path="${{rail_path:+$rail_path:}}$rail_entry"
    fi
done
IFS=$rail_old_ifs
PATH=$rail_path
export PATH
exec codex "$@"
'''


def integration(directory, native):
    shim = Path(directory)/'codex'
    body = f'command {quote(str(shim))} "$@"'
    # Existing aliases/functions continue to run, retaining their options, cwd and env.
    # Also support ordinary absolute-path calls inside wrappers without editing them.
    paths = list(dict.fromkeys([str(native), str(Path(native).resolve())]))
    hooks = '\n'.join(f'''    rail_native={quote(path)}
    if (( ! ${{+functions[$rail_native]}} )); then
        functions[$rail_native]={quote(body)}
    fi''' for path in paths)
    return f'''# Managed by the Codex Rail plugin. User aliases and functions stay unchanged.
() {{
    emulate -L zsh
    local rail_bin={quote(str(directory))}
    [[ -x "$rail_bin/codex" ]] || return
    local rail_entry rail_native
    local -a rail_paths
    for rail_entry in "${{path[@]}}"; do
        [[ "$rail_entry" == "$rail_bin" ]] || rail_paths+=("$rail_entry")
    done
    path=("$rail_bin" "${{rail_paths[@]}}")
    export PATH
    rehash
{hooks}
}}
'''
