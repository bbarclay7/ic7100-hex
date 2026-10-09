"""Runs the Node-based CESSB DSP test (skipped if node is not installed)."""
import os
import shutil
import subprocess
import unittest


class CessbDspTests(unittest.TestCase):
    @unittest.skipUnless(shutil.which('node'), 'node not installed')
    def test_cessb_processor(self):
        js = os.path.join(os.path.dirname(__file__), 'cessb_test.js')
        r = subprocess.run(['node', js], capture_output=True, text=True, timeout=120)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


if __name__ == '__main__':
    unittest.main()
