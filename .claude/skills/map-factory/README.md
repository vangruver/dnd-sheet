# Map Factory

A Claude Code skill that generates geographically accurate, AI-styled map images. Say "Create an AI map of San Francisco in watercolor style" and get a beautiful, geographically accurate map.

## How It Works

1. **Base map generation** — Cartopy renders an accurate GIS map from coordinates (runs locally, CPU only)
2. **AI stylization** — Stability AI's structure control API applies artistic styles while preserving geographic accuracy (~$0.02/image)

## Installation

```bash
npx skills add <owner>/map-factory
```

## Prerequisites

- **Python 3.8+** with pip
- **Stability AI API key** — Get one at [platform.stability.ai](https://platform.stability.ai/)
- **System libraries** (for Cartopy):
  - macOS: `brew install geos proj`
  - Ubuntu: `sudo apt-get install libgeos-dev libproj-dev`

## Configuration

Set your Stability AI API key as an environment variable:

```bash
export STABILITY_API_KEY=your_key_here
```

Add it to your shell profile (`~/.zshrc`, `~/.bashrc`, etc.) to persist across sessions.

## Usage

After installing the skill, just ask Claude naturally:

- "Create an AI map of San Francisco in Studio Ghibli style"
- "Generate a vintage nautical chart of the Mediterranean"
- "Make a cyberpunk-style map of Tokyo"
- "Create a watercolor map of the California coast"
- "Generate a fantasy RPG map of Iceland"

You can also provide specific coordinates:

- "Create a map with bounds -122.52,37.70,-122.35,37.82 in watercolor style"

### Options You Can Request

- **Style**: Any artistic style (anime, watercolor, vintage, cyberpunk, fantasy, etc.)
- **Features**: Land, coastlines, rivers, borders, lakes, ocean, state lines
- **Tiles**: Satellite, street, or terrain imagery as the base
- **Control strength**: How closely the output follows the geographic structure (0-1)

## Manual Usage

You can also run the scripts directly:

```bash
# Setup (first time)
python3 scripts/setup.py

# Generate base map
.map-factory-venv/bin/python scripts/generate_base_map.py \
  --bounds -122.52,37.70,-122.35,37.82 \
  --output output/base_map.png

# Stylize
.map-factory-venv/bin/python scripts/stylize_map.py \
  --image output/base_map.png \
  --prompt "beautiful watercolor map, soft colors, artistic coastlines" \
  --output output/styled_map.png
```

## License

MIT
