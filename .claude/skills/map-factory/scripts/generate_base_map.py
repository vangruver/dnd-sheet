#!/usr/bin/env python3
"""Generate a base GIS map using Cartopy from bounding box coordinates."""

import argparse
import os
import sys

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import cartopy.crs as ccrs
import cartopy.io.img_tiles as cimgt
from cartopy.feature import NaturalEarthFeature


FEATURE_DEFINITIONS = {
    "land": lambda: NaturalEarthFeature(
        "physical", "land", "10m", edgecolor="face", facecolor="lightgray"
    ),
    "coastline": lambda: NaturalEarthFeature("physical", "coastline", "10m"),
    "rivers": lambda: NaturalEarthFeature(
        "physical", "rivers_lake_centerlines", "10m",
        edgecolor="blue", facecolor="none"
    ),
    "borders": lambda: NaturalEarthFeature(
        "cultural", "admin_0_countries", "10m",
        edgecolor="black", facecolor="none", linestyle=":"
    ),
    "lakes": lambda: NaturalEarthFeature(
        "physical", "lakes", "10m", edgecolor="blue", facecolor="lightblue"
    ),
    "ocean": lambda: NaturalEarthFeature(
        "physical", "ocean", "10m", edgecolor="face", facecolor="#cce6f4"
    ),
    "states": lambda: NaturalEarthFeature(
        "cultural", "admin_1_states_provinces_lines", "10m",
        edgecolor="gray", facecolor="none", linestyle="--"
    ),
}

TILE_SOURCES = {
    "satellite": lambda: cimgt.GoogleTiles(style="satellite"),
    "street": lambda: cimgt.GoogleTiles(style="street"),
    "terrain": lambda: cimgt.GoogleTiles(style="terrain"),
}


def parse_bounds(bounds_str):
    """Parse a comma-separated bounding box string into [west, south, east, north]."""
    parts = bounds_str.split(",")
    if len(parts) != 4:
        raise argparse.ArgumentTypeError(
            f"Bounds must be 4 comma-separated values (west,south,east,north), got {len(parts)}"
        )
    try:
        west, south, east, north = [float(p.strip()) for p in parts]
    except ValueError as e:
        raise argparse.ArgumentTypeError(f"Bounds must be numeric values: {e}")

    if not (-180 <= west <= 180 and -180 <= east <= 180):
        raise argparse.ArgumentTypeError("Longitude values must be between -180 and 180")
    if not (-90 <= south <= 90 and -90 <= north <= 90):
        raise argparse.ArgumentTypeError("Latitude values must be between -90 and 90")
    if south >= north:
        raise argparse.ArgumentTypeError("South bound must be less than north bound")

    return [west, south, east, north]


def parse_features(features_str):
    """Parse a comma-separated feature list and validate against known features."""
    features = [f.strip() for f in features_str.split(",")]
    unknown = [f for f in features if f not in FEATURE_DEFINITIONS]
    if unknown:
        raise argparse.ArgumentTypeError(
            f"Unknown features: {', '.join(unknown)}. "
            f"Available: {', '.join(FEATURE_DEFINITIONS.keys())}"
        )
    return features


def generate_base_map(bounds, output, dpi=300, size=8, features=None, tiles=None):
    """Generate a base map and save it to the output path.

    Args:
        bounds: [west, south, east, north] bounding box
        output: Output file path
        dpi: Image resolution
        size: Figure size in inches
        features: List of Natural Earth feature names to include
        tiles: Tile source name (satellite, street, terrain) or None
    """
    if features is None:
        features = ["land", "coastline", "rivers", "borders"]

    west, south, east, north = bounds

    if tiles and tiles in TILE_SOURCES:
        tile_source = TILE_SOURCES[tiles]()
        fig, ax = plt.subplots(
            figsize=(size, size),
            subplot_kw={"projection": tile_source.crs},
        )
        # Calculate zoom level based on extent size
        extent_size = max(abs(east - west), abs(north - south))
        if extent_size > 10:
            zoom = 6
        elif extent_size > 1:
            zoom = 10
        else:
            zoom = 12
        ax.add_image(tile_source, zoom)
    else:
        fig, ax = plt.subplots(
            figsize=(size, size),
            subplot_kw={"projection": ccrs.Mercator()},
        )

    for feature_name in features:
        if feature_name in FEATURE_DEFINITIONS:
            ax.add_feature(FEATURE_DEFINITIONS[feature_name]())

    ax.set_extent([west, east, south, north], crs=ccrs.PlateCarree())
    ax.coastlines(resolution="10m", linewidth=0.8)

    os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
    plt.savefig(output, dpi=dpi, bbox_inches="tight", pad_inches=0)
    plt.close(fig)

    print(f"Base map saved to {output}")
    return output


def main():
    parser = argparse.ArgumentParser(
        description="Generate a base GIS map using Cartopy."
    )
    parser.add_argument(
        "--bounds", required=True, type=parse_bounds,
        help="Bounding box as west,south,east,north (lon/lat)"
    )
    parser.add_argument(
        "--output", default="output/base_map.png",
        help="Output file path (default: output/base_map.png)"
    )
    parser.add_argument(
        "--dpi", type=int, default=300,
        help="Image resolution (default: 300)"
    )
    parser.add_argument(
        "--size", type=int, default=8,
        help="Figure size in inches (default: 8)"
    )
    parser.add_argument(
        "--features", type=parse_features, default="land,coastline,rivers,borders",
        help="Comma-separated Natural Earth features (default: land,coastline,rivers,borders)"
    )
    parser.add_argument(
        "--tiles", choices=list(TILE_SOURCES.keys()),
        help="Tile source for background imagery (satellite, street, terrain)"
    )

    args = parser.parse_args()
    generate_base_map(
        bounds=args.bounds,
        output=args.output,
        dpi=args.dpi,
        size=args.size,
        features=args.features,
        tiles=args.tiles,
    )


if __name__ == "__main__":
    main()
