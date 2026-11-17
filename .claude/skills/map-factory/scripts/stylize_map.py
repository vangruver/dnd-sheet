#!/usr/bin/env python3
"""Stylize a base map using the Stability AI control/structure API endpoint."""

import argparse
import os
import sys

import requests


STABILITY_API_URL = "https://api.stability.ai/v2beta/stable-image/control/structure"


def stylize_map(image_path, prompt, output, control_strength=0.7,
                negative_prompt=None, seed=None):
    """Send a base map to Stability AI for stylization.

    Args:
        image_path: Path to the base map PNG
        prompt: Style description
        output: Output file path
        control_strength: How closely to follow the base map structure (0-1)
        negative_prompt: What to avoid in the output
        seed: Random seed for reproducibility

    Returns:
        Output file path on success

    Raises:
        SystemExit: On API errors or missing API key
    """
    api_key = os.environ.get("STABILITY_API_KEY")
    if not api_key:
        print("Error: STABILITY_API_KEY environment variable is not set.", file=sys.stderr)
        print("Get your API key from https://platform.stability.ai/", file=sys.stderr)
        sys.exit(1)

    if not os.path.exists(image_path):
        print(f"Error: Image file not found: {image_path}", file=sys.stderr)
        sys.exit(1)

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Accept": "image/*",
    }

    data = {
        "prompt": prompt,
        "control_strength": str(control_strength),
        "output_format": "png",
    }

    if negative_prompt:
        data["negative_prompt"] = negative_prompt
    if seed is not None:
        data["seed"] = str(seed)

    with open(image_path, "rb") as img_file:
        files = {"image": (os.path.basename(image_path), img_file, "image/png")}

        print(f"Sending base map to Stability AI for stylization...")
        response = requests.post(
            STABILITY_API_URL,
            headers=headers,
            data=data,
            files=files,
        )

    if response.status_code == 200:
        os.makedirs(os.path.dirname(os.path.abspath(output)), exist_ok=True)
        with open(output, "wb") as f:
            f.write(response.content)
        print(f"Styled map saved to {output}")
        return output
    else:
        error_msg = response.text
        try:
            error_data = response.json()
            error_msg = error_data.get("message", error_data.get("name", response.text))
        except (ValueError, KeyError):
            pass
        print(
            f"Error from Stability AI (HTTP {response.status_code}): {error_msg}",
            file=sys.stderr,
        )
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="Stylize a base map using Stability AI's control/structure endpoint."
    )
    parser.add_argument(
        "--image", required=True,
        help="Path to the base map PNG"
    )
    parser.add_argument(
        "--prompt", required=True,
        help="Style description (e.g., 'illustrated map in anime style with vibrant colors')"
    )
    parser.add_argument(
        "--output", default="output/styled_map.png",
        help="Output file path (default: output/styled_map.png)"
    )
    parser.add_argument(
        "--control-strength", type=float, default=0.7,
        help="How closely to follow the base map structure, 0-1 (default: 0.7)"
    )
    parser.add_argument(
        "--negative-prompt",
        help="What to avoid in the output (e.g., 'blurry, low quality')"
    )
    parser.add_argument(
        "--seed", type=int,
        help="Random seed for reproducibility"
    )

    args = parser.parse_args()

    if not 0 <= args.control_strength <= 1:
        parser.error("Control strength must be between 0 and 1")

    stylize_map(
        image_path=args.image,
        prompt=args.prompt,
        output=args.output,
        control_strength=args.control_strength,
        negative_prompt=args.negative_prompt,
        seed=args.seed,
    )


if __name__ == "__main__":
    main()
