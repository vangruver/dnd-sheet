---
name: map-factory
description: Generate geographically accurate AI-styled maps. Use when asked to create, generate, or make artistic/styled/AI maps of locations.
allowed-tools: Bash, Read, Write, Glob
---

# Map Factory

Generate geographically accurate, AI-styled map images from any location. The process has two stages: (1) generate a base GIS map with Cartopy, (2) stylize it with Stability AI to preserve geographic accuracy while applying artistic styles.

## Setup

Before generating maps, check if the virtual environment exists:

```bash
ls .map-factory-venv/bin/python 2>/dev/null || python3 scripts/setup.py
```

If setup is needed, run `python3 scripts/setup.py` and follow its instructions.

The `STABILITY_API_KEY` environment variable must be set for stylization. If missing, inform the user:
> You need a Stability AI API key for map stylization. Get one at https://platform.stability.ai/ and set it: `export STABILITY_API_KEY=your_key_here`

## Step 1: Resolve Location to Bounding Box

Convert the user's location into a bounding box `[west, south, east, north]` in longitude/latitude.

**Common bounding boxes for reference:**

| Location | Bounds (west,south,east,north) |
|---|---|
| San Francisco | -122.52,37.70,-122.35,37.82 |
| Manhattan, NYC | -74.02,40.70,-73.97,40.80 |
| London | -0.20,51.45,0.05,51.55 |
| Tokyo | 139.60,35.60,139.85,35.75 |
| Paris | 2.25,48.82,2.42,48.90 |
| Sydney | 151.10,-33.95,151.30,-33.80 |
| Los Angeles | -118.40,33.90,-118.15,34.10 |
| Chicago | -87.75,41.80,-87.60,41.95 |

For other locations, use your geographic knowledge to determine an appropriate bounding box. Ensure:
- West longitude < East longitude
- South latitude < North latitude
- The box is tight enough to show detail but covers the full area of interest

If the user provides explicit coordinates, use those directly.

## Step 2: Generate Base Map

Run the base map generator using the virtual environment Python:

```bash
.map-factory-venv/bin/python scripts/generate_base_map.py \
  --bounds WEST,SOUTH,EAST,NORTH \
  --output output/base_map.png \
  --features land,coastline,rivers,borders
```

**Options:**
- `--bounds` (required): Bounding box as `west,south,east,north`
- `--output` (default: `output/base_map.png`): Output file path
- `--dpi` (default: 300): Image resolution
- `--size` (default: 8): Figure size in inches
- `--features` (default: `land,coastline,rivers,borders`): Comma-separated list from: `land`, `coastline`, `rivers`, `borders`, `lakes`, `ocean`, `states`
- `--tiles` (optional): Background imagery source: `satellite`, `street`, or `terrain`

**Tips:**
- For coastal areas, include `ocean` in features for better contrast
- For US states, add `states` to show state boundaries
- Use `--tiles satellite` for satellite imagery as the base (useful for detailed areas)

## Step 3: Craft the Style Prompt

Transform the user's style request into an effective prompt for Stability AI. Good map-style prompts:

**Structure:** `"[adjective] [style] map of [region], [visual details], [medium/technique]"`

**Examples:**
- "beautiful illustrated map in Studio Ghibli anime style, soft watercolor textures, rolling green hills, whimsical details, vibrant colors"
- "vintage hand-drawn nautical chart, aged parchment texture, compass rose, sepia tones, detailed coastline illustration"
- "cyberpunk neon city map, dark background with glowing grid lines, futuristic labels, holographic effect"
- "fantasy RPG world map, aged paper texture, mountain illustrations, forest regions, medieval cartography style"
- "minimalist modern map, clean lines, muted pastel colors, Scandinavian design aesthetic"
- "watercolor painting of a topographic map, soft color washes, artistic contour lines, fine art style"

**Tips for good prompts:**
- Always include the medium/technique (watercolor, illustration, digital art, etc.)
- Mention texture (parchment, paper, glossy, matte)
- Include color palette descriptions
- Reference specific art styles or artists for stronger results
- Add "map" or "cartographic" to keep outputs map-like
- Avoid prompts that are purely about non-map subjects

## Step 4: Stylize the Map

Run the stylization script:

```bash
.map-factory-venv/bin/python scripts/stylize_map.py \
  --image output/base_map.png \
  --prompt "your style prompt here" \
  --output output/styled_map.png \
  --control-strength 0.7
```

**Options:**
- `--image` (required): Path to base map PNG
- `--prompt` (required): Style description
- `--output` (default: `output/styled_map.png`): Output path
- `--control-strength` (default: 0.7): How closely to follow base map structure (0-1). Higher = more geographically accurate, lower = more artistic freedom
- `--negative-prompt` (optional): What to avoid (e.g., "blurry, low quality, distorted text")
- `--seed` (optional): For reproducible results

**Control strength guide:**
- 0.5-0.6: More artistic freedom, looser geographic accuracy
- 0.7: Good balance (recommended default)
- 0.8-0.9: Very accurate to base map, less stylistic variation

## Step 5: Present Results

After stylization completes, tell the user:
1. Where the styled map was saved (e.g., `output/styled_map.png`)
2. The base map is also available at `output/base_map.png`
3. Offer to adjust: different style, control strength, or area

If the user wants to iterate, you can re-run just the stylization step with a different prompt or control strength without regenerating the base map.
