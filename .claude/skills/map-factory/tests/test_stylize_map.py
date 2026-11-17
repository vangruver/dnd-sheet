"""Tests for scripts/stylize_map.py."""

import os
import sys
import tempfile
from unittest.mock import MagicMock, patch, mock_open

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

from stylize_map import stylize_map, STABILITY_API_URL


@pytest.fixture
def fake_image(tmp_path):
    """Create a minimal PNG file for testing."""
    # Minimal valid PNG: 1x1 pixel
    import struct
    import zlib

    def create_png(path):
        signature = b'\x89PNG\r\n\x1a\n'
        # IHDR chunk
        ihdr_data = struct.pack('>IIBBBBB', 1, 1, 8, 2, 0, 0, 0)
        ihdr_crc = struct.pack('>I', zlib.crc32(b'IHDR' + ihdr_data) & 0xffffffff)
        ihdr = struct.pack('>I', 13) + b'IHDR' + ihdr_data + ihdr_crc
        # IDAT chunk
        raw_data = zlib.compress(b'\x00\xff\x00\x00')
        idat_crc = struct.pack('>I', zlib.crc32(b'IDAT' + raw_data) & 0xffffffff)
        idat = struct.pack('>I', len(raw_data)) + b'IDAT' + raw_data + idat_crc
        # IEND chunk
        iend_crc = struct.pack('>I', zlib.crc32(b'IEND') & 0xffffffff)
        iend = struct.pack('>I', 0) + b'IEND' + iend_crc

        with open(path, 'wb') as f:
            f.write(signature + ihdr + idat + iend)
        return path

    return create_png(str(tmp_path / "test_input.png"))


class TestStylizeMapAPIKey:
    def test_missing_api_key(self, fake_image, tmp_path):
        with patch.dict(os.environ, {}, clear=True):
            # Ensure STABILITY_API_KEY is not set
            os.environ.pop("STABILITY_API_KEY", None)
            with pytest.raises(SystemExit):
                stylize_map(
                    image_path=fake_image,
                    prompt="test prompt",
                    output=str(tmp_path / "out.png"),
                )

    @patch("stylize_map.requests.post")
    def test_api_key_used_in_header(self, mock_post, fake_image, tmp_path):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.content = b"fake image data"
        mock_post.return_value = mock_response

        with patch.dict(os.environ, {"STABILITY_API_KEY": "test-key-123"}):
            stylize_map(
                image_path=fake_image,
                prompt="test prompt",
                output=str(tmp_path / "out.png"),
            )

        call_kwargs = mock_post.call_args
        assert call_kwargs.kwargs["headers"]["Authorization"] == "Bearer test-key-123"


class TestStylizeMapInputValidation:
    def test_nonexistent_image(self, tmp_path):
        with patch.dict(os.environ, {"STABILITY_API_KEY": "test-key"}):
            with pytest.raises(SystemExit):
                stylize_map(
                    image_path="/nonexistent/path.png",
                    prompt="test",
                    output=str(tmp_path / "out.png"),
                )


class TestStylizeMapAPICall:
    @patch("stylize_map.requests.post")
    def test_successful_stylization(self, mock_post, fake_image, tmp_path):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.content = b"fake styled image data"
        mock_post.return_value = mock_response

        output = str(tmp_path / "styled.png")
        with patch.dict(os.environ, {"STABILITY_API_KEY": "test-key"}):
            result = stylize_map(
                image_path=fake_image,
                prompt="anime style map",
                output=output,
            )

        assert result == output
        assert os.path.exists(output)
        with open(output, "rb") as f:
            assert f.read() == b"fake styled image data"

    @patch("stylize_map.requests.post")
    def test_api_called_with_correct_url(self, mock_post, fake_image, tmp_path):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.content = b"data"
        mock_post.return_value = mock_response

        with patch.dict(os.environ, {"STABILITY_API_KEY": "test-key"}):
            stylize_map(
                image_path=fake_image,
                prompt="test",
                output=str(tmp_path / "out.png"),
            )

        mock_post.assert_called_once()
        assert mock_post.call_args.args[0] == STABILITY_API_URL

    @patch("stylize_map.requests.post")
    def test_prompt_sent_in_data(self, mock_post, fake_image, tmp_path):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.content = b"data"
        mock_post.return_value = mock_response

        with patch.dict(os.environ, {"STABILITY_API_KEY": "test-key"}):
            stylize_map(
                image_path=fake_image,
                prompt="vintage watercolor map",
                output=str(tmp_path / "out.png"),
            )

        call_kwargs = mock_post.call_args.kwargs
        assert call_kwargs["data"]["prompt"] == "vintage watercolor map"

    @patch("stylize_map.requests.post")
    def test_control_strength_parameter(self, mock_post, fake_image, tmp_path):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.content = b"data"
        mock_post.return_value = mock_response

        with patch.dict(os.environ, {"STABILITY_API_KEY": "test-key"}):
            stylize_map(
                image_path=fake_image,
                prompt="test",
                output=str(tmp_path / "out.png"),
                control_strength=0.85,
            )

        call_kwargs = mock_post.call_args.kwargs
        assert call_kwargs["data"]["control_strength"] == "0.85"

    @patch("stylize_map.requests.post")
    def test_negative_prompt_included(self, mock_post, fake_image, tmp_path):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.content = b"data"
        mock_post.return_value = mock_response

        with patch.dict(os.environ, {"STABILITY_API_KEY": "test-key"}):
            stylize_map(
                image_path=fake_image,
                prompt="test",
                output=str(tmp_path / "out.png"),
                negative_prompt="blurry, low quality",
            )

        call_kwargs = mock_post.call_args.kwargs
        assert call_kwargs["data"]["negative_prompt"] == "blurry, low quality"

    @patch("stylize_map.requests.post")
    def test_negative_prompt_excluded_when_none(self, mock_post, fake_image, tmp_path):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.content = b"data"
        mock_post.return_value = mock_response

        with patch.dict(os.environ, {"STABILITY_API_KEY": "test-key"}):
            stylize_map(
                image_path=fake_image,
                prompt="test",
                output=str(tmp_path / "out.png"),
            )

        call_kwargs = mock_post.call_args.kwargs
        assert "negative_prompt" not in call_kwargs["data"]

    @patch("stylize_map.requests.post")
    def test_seed_parameter(self, mock_post, fake_image, tmp_path):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.content = b"data"
        mock_post.return_value = mock_response

        with patch.dict(os.environ, {"STABILITY_API_KEY": "test-key"}):
            stylize_map(
                image_path=fake_image,
                prompt="test",
                output=str(tmp_path / "out.png"),
                seed=42,
            )

        call_kwargs = mock_post.call_args.kwargs
        assert call_kwargs["data"]["seed"] == "42"

    @patch("stylize_map.requests.post")
    def test_creates_output_directory(self, mock_post, fake_image, tmp_path):
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.content = b"data"
        mock_post.return_value = mock_response

        output = str(tmp_path / "nested" / "dir" / "out.png")
        with patch.dict(os.environ, {"STABILITY_API_KEY": "test-key"}):
            stylize_map(
                image_path=fake_image,
                prompt="test",
                output=output,
            )

        assert os.path.exists(output)


class TestStylizeMapErrors:
    @patch("stylize_map.requests.post")
    def test_api_error_json_response(self, mock_post, fake_image, tmp_path):
        mock_response = MagicMock()
        mock_response.status_code = 400
        mock_response.text = '{"message": "Invalid prompt"}'
        mock_response.json.return_value = {"message": "Invalid prompt"}
        mock_post.return_value = mock_response

        with patch.dict(os.environ, {"STABILITY_API_KEY": "test-key"}):
            with pytest.raises(SystemExit):
                stylize_map(
                    image_path=fake_image,
                    prompt="test",
                    output=str(tmp_path / "out.png"),
                )

    @patch("stylize_map.requests.post")
    def test_api_error_plain_text_response(self, mock_post, fake_image, tmp_path):
        mock_response = MagicMock()
        mock_response.status_code = 500
        mock_response.text = "Internal Server Error"
        mock_response.json.side_effect = ValueError("Not JSON")
        mock_post.return_value = mock_response

        with patch.dict(os.environ, {"STABILITY_API_KEY": "test-key"}):
            with pytest.raises(SystemExit):
                stylize_map(
                    image_path=fake_image,
                    prompt="test",
                    output=str(tmp_path / "out.png"),
                )

    @patch("stylize_map.requests.post")
    def test_api_unauthorized(self, mock_post, fake_image, tmp_path):
        mock_response = MagicMock()
        mock_response.status_code = 401
        mock_response.text = "Unauthorized"
        mock_response.json.side_effect = ValueError("Not JSON")
        mock_post.return_value = mock_response

        with patch.dict(os.environ, {"STABILITY_API_KEY": "bad-key"}):
            with pytest.raises(SystemExit):
                stylize_map(
                    image_path=fake_image,
                    prompt="test",
                    output=str(tmp_path / "out.png"),
                )
