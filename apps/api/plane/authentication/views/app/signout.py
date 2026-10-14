# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Django imports
import logging

from django.views import View
from django.contrib.auth import logout
from django.http import HttpResponseRedirect
from django.utils import timezone

# Module imports
from plane.authentication.utils.host import user_ip, base_host
from plane.db.models import User

logger = logging.getLogger(__name__)


class SignOutAuthEndpoint(View):
    def post(self, request):
        # End the session even when recording optional logout metadata fails.
        try:
            if request.user.is_authenticated:
                User.objects.filter(pk=request.user.id).update(
                    last_logout_ip=user_ip(request=request),
                    last_logout_time=timezone.now(),
                )
        except Exception:
            logger.exception("Unable to record logout metadata")
        finally:
            logout(request)
        return HttpResponseRedirect(base_host(request=request, is_app=True))
