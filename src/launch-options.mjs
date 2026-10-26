// Remote TUI resume rejects CLI permission switches even though thread/resume
// supports them. Translate only an explicit YOLO switch, never a saved default.
const values = new Set(['-c', '--config', '-m', '--model', '-p', '--profile', '-s', '--sandbox',
  '-a', '--ask-for-approval', '-C', '--cd', '--enable', '--disable', '--add-dir', '--local-provider',
  '--remote-auth-token-env']);
const yolo = new Set(['--yolo', '--dangerously-bypass-approvals-and-sandbox']);

export function prepareLaunch(args) {
  let command = null, conflicting = false;
  const remove = new Set();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i], key = arg.split('=')[0];
    if (arg === '--') break;
    if (['-s', '--sandbox', '-a', '--ask-for-approval', '--approve-for-me', '--full-auto'].includes(key)) conflicting = true;
    if (values.has(key)) { if (!arg.includes('=')) i++; continue; }
    if (arg === '-i' || arg === '--image') {
      // clap accepts multiple image paths up to the next option.
      while (i + 1 < args.length && !args[i + 1].startsWith('-')) i++;
      continue;
    }
    if (yolo.has(arg)) remove.add(i);
    else if (!arg.startsWith('-') && command === null) command = arg;
  }
  if (!['resume', 'fork'].includes(command) || !remove.size || conflicting)
    return { args: [...args], resumePermissions: null };
  return { args: args.filter((_, i) => !remove.has(i)), resumePermissions: {
    method: `thread/${command}`, approvalPolicy: 'never', sandbox: 'danger-full-access',
  } };
}
