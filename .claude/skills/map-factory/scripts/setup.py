#!/usr/bin/env python3
"""Setup script for map-factory: checks Python version, creates venv, installs dependencies."""

import os
import subprocess
import sys


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
VENV_DIR = os.path.join(PROJECT_DIR, ".map-factory-venv")
REQUIREMENTS_FILE = os.path.join(PROJECT_DIR, "requirements.txt")


def check_python_version():
    """Check that Python 3.8+ is available."""
    major, minor = sys.version_info[:2]
    if major < 3 or (major == 3 and minor < 8):
        print(f"Error: Python 3.8+ is required, but found {major}.{minor}", file=sys.stderr)
        sys.exit(1)
    print(f"Python {major}.{minor} detected (OK)")


def create_venv():
    """Create a virtual environment if it doesn't exist."""
    if os.path.exists(VENV_DIR):
        print(f"Virtual environment already exists at {VENV_DIR}")
        return

    print(f"Creating virtual environment at {VENV_DIR}...")
    subprocess.run([sys.executable, "-m", "venv", VENV_DIR], check=True)
    print("Virtual environment created.")


def get_venv_python():
    """Get the path to the Python executable inside the venv."""
    if sys.platform == "win32":
        return os.path.join(VENV_DIR, "Scripts", "python.exe")
    return os.path.join(VENV_DIR, "bin", "python")


def install_dependencies():
    """Install dependencies from requirements.txt into the venv."""
    venv_python = get_venv_python()
    if not os.path.exists(REQUIREMENTS_FILE):
        print(f"Error: {REQUIREMENTS_FILE} not found", file=sys.stderr)
        sys.exit(1)

    print("Installing dependencies from requirements.txt...")
    subprocess.run(
        [venv_python, "-m", "pip", "install", "-r", REQUIREMENTS_FILE],
        check=True,
    )
    print("Dependencies installed.")


def verify_cartopy():
    """Verify that Cartopy can be imported."""
    venv_python = get_venv_python()
    result = subprocess.run(
        [venv_python, "-c", "import cartopy; print(f'Cartopy {cartopy.__version__} OK')"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print("Warning: Cartopy import failed. You may need to install system dependencies.", file=sys.stderr)
        print("  macOS: brew install geos proj", file=sys.stderr)
        print("  Ubuntu: sudo apt-get install libgeos-dev libproj-dev", file=sys.stderr)
        print(f"  Error: {result.stderr.strip()}", file=sys.stderr)
        return False
    print(result.stdout.strip())
    return True


def check_api_key():
    """Check for STABILITY_API_KEY environment variable."""
    api_key = os.environ.get("STABILITY_API_KEY")
    if api_key:
        print("STABILITY_API_KEY is set (OK)")
    else:
        print("Warning: STABILITY_API_KEY environment variable is not set.")
        print("  You'll need it for map stylization.")
        print("  Get your API key from https://platform.stability.ai/")


def main():
    print("=== Map Factory Setup ===\n")

    check_python_version()
    create_venv()
    install_dependencies()
    cartopy_ok = verify_cartopy()
    check_api_key()

    print("\n=== Setup Complete ===")
    venv_python = get_venv_python()
    print(f"\nTo use the virtual environment, run scripts with:")
    print(f"  {venv_python} scripts/generate_base_map.py --bounds ...")
    print(f"\nOr activate the venv:")
    if sys.platform == "win32":
        print(f"  {VENV_DIR}\\Scripts\\activate")
    else:
        print(f"  source {VENV_DIR}/bin/activate")

    if not cartopy_ok:
        sys.exit(1)


if __name__ == "__main__":
    main()
