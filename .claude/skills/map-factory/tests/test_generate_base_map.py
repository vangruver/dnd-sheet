"""Tests for scripts/generate_base_map.py."""

import argparse
import os
import tempfile

import pytest

# Add scripts directory to path so we can import the module
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

from generate_base_map import parse_bounds, parse_features, generate_base_map


class TestParseBounds:
    def test_valid_bounds(self):
        result = parse_bounds("-122.52,37.70,-122.35,37.82")
        assert result == [-122.52, 37.70, -122.35, 37.82]

    def test_bounds_with_spaces(self):
        result = parse_bounds("-122.52, 37.70, -122.35, 37.82")
        assert result == [-122.52, 37.70, -122.35, 37.82]

    def test_too_few_values(self):
        with pytest.raises(argparse.ArgumentTypeError, match="4 comma-separated"):
            parse_bounds("-122.52,37.70,-122.35")

    def test_too_many_values(self):
        with pytest.raises(argparse.ArgumentTypeError, match="4 comma-separated"):
            parse_bounds("-122.52,37.70,-122.35,37.82,0")

    def test_non_numeric_values(self):
        with pytest.raises(argparse.ArgumentTypeError, match="numeric"):
            parse_bounds("abc,37.70,-122.35,37.82")

    def test_longitude_out_of_range(self):
        with pytest.raises(argparse.ArgumentTypeError, match="Longitude"):
            parse_bounds("-200,37.70,-122.35,37.82")

    def test_latitude_out_of_range(self):
        with pytest.raises(argparse.ArgumentTypeError, match="Latitude"):
            parse_bounds("-122.52,100,-122.35,37.82")

    def test_south_greater_than_north(self):
        with pytest.raises(argparse.ArgumentTypeError, match="South bound must be less"):
            parse_bounds("-122.52,37.82,-122.35,37.70")

    def test_south_equal_to_north(self):
        with pytest.raises(argparse.ArgumentTypeError, match="South bound must be less"):
            parse_bounds("-122.52,37.70,-122.35,37.70")

    def test_integer_bounds(self):
        result = parse_bounds("-122,37,-120,38")
        assert result == [-122.0, 37.0, -120.0, 38.0]

    def test_boundary_longitude_values(self):
        result = parse_bounds("-180,0,180,10")
        assert result == [-180.0, 0.0, 180.0, 10.0]

    def test_boundary_latitude_values(self):
        result = parse_bounds("0,-90,10,90")
        assert result == [0.0, -90.0, 10.0, 90.0]


class TestParseFeatures:
    def test_valid_features(self):
        result = parse_features("land,coastline,rivers,borders")
        assert result == ["land", "coastline", "rivers", "borders"]

    def test_single_feature(self):
        result = parse_features("land")
        assert result == ["land"]

    def test_all_features(self):
        result = parse_features("land,coastline,rivers,borders,lakes,ocean,states")
        assert len(result) == 7

    def test_features_with_spaces(self):
        result = parse_features("land, coastline, rivers")
        assert result == ["land", "coastline", "rivers"]

    def test_unknown_feature(self):
        with pytest.raises(argparse.ArgumentTypeError, match="Unknown features"):
            parse_features("land,mountains")

    def test_multiple_unknown_features(self):
        with pytest.raises(argparse.ArgumentTypeError, match="Unknown features"):
            parse_features("mountains,glaciers")


class TestGenerateBaseMap:
    def test_generates_png(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output = os.path.join(tmpdir, "test_map.png")
            result = generate_base_map(
                bounds=[-122.52, 37.70, -122.35, 37.82],
                output=output,
                dpi=72,
                size=4,
                features=["land", "coastline"],
            )
            assert result == output
            assert os.path.exists(output)
            assert os.path.getsize(output) > 0

    def test_creates_output_directory(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output = os.path.join(tmpdir, "subdir", "nested", "map.png")
            generate_base_map(
                bounds=[-122.52, 37.70, -122.35, 37.82],
                output=output,
                dpi=72,
                size=4,
            )
            assert os.path.exists(output)

    def test_default_features(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output = os.path.join(tmpdir, "map.png")
            generate_base_map(
                bounds=[0, 0, 10, 10],
                output=output,
                dpi=72,
                size=4,
            )
            assert os.path.exists(output)

    def test_ocean_feature(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output = os.path.join(tmpdir, "map.png")
            generate_base_map(
                bounds=[-122.52, 37.70, -122.35, 37.82],
                output=output,
                dpi=72,
                size=4,
                features=["ocean", "coastline"],
            )
            assert os.path.exists(output)

    def test_different_dpi(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            output_low = os.path.join(tmpdir, "low.png")
            output_high = os.path.join(tmpdir, "high.png")
            generate_base_map(
                bounds=[0, 0, 10, 10],
                output=output_low,
                dpi=50,
                size=4,
                features=["land"],
            )
            generate_base_map(
                bounds=[0, 0, 10, 10],
                output=output_high,
                dpi=150,
                size=4,
                features=["land"],
            )
            assert os.path.getsize(output_high) > os.path.getsize(output_low)
