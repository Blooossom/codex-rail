import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareLaunch } from '../src/launch-options.mjs';

test('explicit resume/fork YOLO is translated while other arguments survive', () => {
  for (const command of ['resume', 'fork']) {
    for (const flag of ['--yolo', '--dangerously-bypass-approvals-and-sandbox']) {
      const args = ['-C', '/work space', command, '--last', flag, '-m', 'gpt-6-astra'];
      const result = prepareLaunch(args);
      assert.deepEqual(result.args, args.filter(arg => arg !== flag));
      assert.deepEqual(result.resumePermissions, { method: `thread/${command}`,
        approvalPolicy: 'never', sandbox: 'danger-full-access' });
    }
  }
});

test('ordinary starts, prompts, option values, and conflicting flags are not reinterpreted', () => {
  for (const args of [[], ['--yolo'], ['resume', '--last'], ['resume', '--', '--yolo'],
    ['-m', '--yolo', 'resume', '--last'], ['explain resume', '--yolo'],
    ['resume', '--yolo', '--sandbox', 'read-only'], ['resume', '--yolo', '-a', 'on-request'],
    ['resume', '--yolo', '--sandbox=read-only'], ['resume', '--yolo', '--approve-for-me']]) {
    assert.deepEqual(prepareLaunch(args), { args, resumePermissions: null });
  }
});
