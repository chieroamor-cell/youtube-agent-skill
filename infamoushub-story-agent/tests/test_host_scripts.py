"""Read-only local host scripts must stay safe and runnable without paid services."""
import platform
import subprocess
import unittest
from pathlib import Path

BASE = Path(__file__).resolve().parents[1]

class HostScriptsTests(unittest.TestCase):
    def test_scripts_exist_and_contain_no_installer_commands(self):
        for path in (BASE/'scripts'/'check-computer.sh', BASE/'scripts'/'check-computer.ps1'):
            self.assertTrue(path.is_file(), path)
            code = path.read_text(encoding='utf-8').lower()
            for dangerous in ('invoke-expression', 'invoke-webrequest', 'curl ', 'wget ', 'pip install', 'git clone', 'start-process powershell'):
                self.assertNotIn(dangerous, code)
    @unittest.skipIf(platform.system() == 'Windows', 'POSIX shell test')
    def test_shell_check_succeeds_without_models(self):
        result = subprocess.run(['sh',str(BASE/'scripts'/'check-computer.sh')],
                                cwd=BASE,capture_output=True,text=True,timeout=35)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('Read-only:',result.stdout)
        self.assertIn('Piper',result.stdout)
        self.assertIn('Publishing must stay OFF.',result.stdout)
