# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

import pytest

from plane.app.serializers.user import ProfileSerializer
from plane.db.models import Profile


@pytest.mark.unit
def test_new_profile_uses_persian():
    assert Profile().language == "fa"


@pytest.mark.unit
@pytest.mark.parametrize("language", ["en", "fr", "fa", "", None])
def test_profile_language_cannot_be_changed_through_api(language):
    profile = Profile()
    serializer = ProfileSerializer(profile, data={"language": language}, partial=True)
    assert serializer.is_valid(), serializer.errors
    assert "language" not in serializer.validated_data
    assert serializer.data["language"] == "fa"
