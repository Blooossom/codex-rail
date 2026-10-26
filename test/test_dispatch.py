import importlib.util
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location('dispatch',Path(__file__).parents[1]/'scripts/dispatch.py')
dispatch=importlib.util.module_from_spec(spec)
spec.loader.exec_module(dispatch)

class RoutingTests(unittest.TestCase):
    def test_interactive_args_are_preserved(self):
        for args in [[],['-m','gpt-6-astra'],['resume','--last'],['--profile','work','fork','--last'],
                     ['-c','model="gpt-6.1-sol"','resume','--last'],['--','--help'],['Explain --remote usage']]:
            with self.subTest(args=args):self.assertTrue(dispatch.should_wrap(args))

    def test_maintenance_and_remote_commands_stay_native(self):
        for args in [['--version'],['exec','say hello'],['--profile','work','exec','say hello'],
                     ['-c','foo=true','plugin','list'],['login','status'],['update'],['--remote','unix://'],
                     ['resume','--help'],['-m','gpt-6-astra','--help'],['--no-daemon'],['completion','zsh']]:
            with self.subTest(args=args):self.assertFalse(dispatch.should_wrap(args))

    def test_disabled_plugin_uses_native_command(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);home=root/'codex';home.mkdir();work=root/'work';work.mkdir()
            config=home/'config.toml'
            config.write_text('[plugins."codex-rail@blossom-local"]\nenabled = false\n')
            self.assertFalse(dispatch.plugin_enabled('codex-rail@blossom-local',home,work))
            config.write_text('[plugins."codex-rail@blossom-local"]\nenabled = true\n')
            self.assertTrue(dispatch.plugin_enabled('codex-rail@blossom-local',home,work))
            (work/'.codex').mkdir();(work/'.codex/config.toml').write_text('[plugins."codex-rail@blossom-local"]\nenabled = false\n')
            self.assertFalse(dispatch.plugin_enabled('codex-rail@blossom-local',home,work))

if __name__=='__main__':unittest.main()
