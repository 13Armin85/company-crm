# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

# Python imports
from smtplib import (
    SMTPAuthenticationError,
    SMTPConnectError,
    SMTPRecipientsRefused,
    SMTPSenderRefused,
    SMTPServerDisconnected,
)

# Django imports
from django.core.mail import BadHeaderError, EmailMultiAlternatives, get_connection
from django.db.models import Q, Case, When, Value

# Third party imports
from rest_framework import status
from rest_framework.response import Response

# Module imports
from .base import BaseAPIView
from plane.license.api.permissions import InstanceAdminPermission
from plane.license.models import InstanceConfiguration
from plane.license.api.serializers import InstanceConfigurationSerializer
from plane.license.utils.encryption import encrypt_data
from plane.utils.cache import cache_response, invalidate_cache
from plane.license.utils.instance_value import get_email_configuration


class InstanceConfigurationEndpoint(BaseAPIView):
    permission_classes = [InstanceAdminPermission]

    @cache_response(60 * 60 * 2, user=False)
    def get(self, request):
        instance_configurations = InstanceConfiguration.objects.all()
        serializer = InstanceConfigurationSerializer(instance_configurations, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @invalidate_cache(path="/api/instances/configurations/", user=False)
    @invalidate_cache(path="/api/instances/", user=False)
    def patch(self, request):
        configurations = InstanceConfiguration.objects.filter(key__in=request.data.keys())

        bulk_configurations = []
        for configuration in configurations:
            raw_value = request.data.get(configuration.key, configuration.value)
            value = "" if raw_value is None else str(raw_value).strip()
            if configuration.is_encrypted:
                configuration.value = encrypt_data(value)
            else:
                configuration.value = value
            bulk_configurations.append(configuration)

        InstanceConfiguration.objects.bulk_update(bulk_configurations, ["value"], batch_size=100)

        serializer = InstanceConfigurationSerializer(configurations, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class DisableEmailFeatureEndpoint(BaseAPIView):
    permission_classes = [InstanceAdminPermission]

    @invalidate_cache(path="/api/instances/", user=False)
    def delete(self, request):
        try:
            InstanceConfiguration.objects.filter(
                Q(
                    key__in=[
                        "EMAIL_HOST",
                        "EMAIL_HOST_USER",
                        "EMAIL_HOST_PASSWORD",
                        "ENABLE_SMTP",
                        "EMAIL_PORT",
                        "EMAIL_FROM",
                    ]
                )
            ).update(value=Case(When(key="ENABLE_SMTP", then=Value("0")), default=Value("")))
            return Response(status=status.HTTP_200_OK)
        except Exception:
            return Response(
                {"error": "پیکربرداری تنظیمات ایمیل غیرفعال نشد"},
                status=status.HTTP_400_BAD_REQUEST,
            )


class EmailCredentialCheckEndpoint(BaseAPIView):
    def post(self, request):
        receiver_email = request.data.get("receiver_email", False)
        if not receiver_email:
            return Response(
                {"error": "ایمیل گیرنده الزامی است"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        (
            EMAIL_HOST,
            EMAIL_HOST_USER,
            EMAIL_HOST_PASSWORD,
            EMAIL_PORT,
            EMAIL_USE_TLS,
            EMAIL_USE_SSL,
            EMAIL_FROM,
        ) = get_email_configuration()

        # Configure all the connections
        connection = get_connection(
            host=EMAIL_HOST,
            port=int(EMAIL_PORT),
            username=EMAIL_HOST_USER,
            password=EMAIL_HOST_PASSWORD,
            use_tls=EMAIL_USE_TLS == "1",
            use_ssl=EMAIL_USE_SSL == "1",
        )
        # Prepare email details
        subject = "Email Notification from Plane"
        message = "این یک ایمیل آزمایشی ارسال‌شده از برنامهٔ Plane است."
        # Send the email
        try:
            msg = EmailMultiAlternatives(
                subject=subject,
                body=message,
                from_email=EMAIL_FROM,
                to=[receiver_email],
                connection=connection,
            )
            msg.send(fail_silently=False)
            return Response({"message": "ایمیل با موفقیت ارسال شد."}, status=status.HTTP_200_OK)
        except BadHeaderError:
            return Response({"error": "سراسری نامعتبر"}, status=status.HTTP_400_BAD_REQUEST)
        except SMTPAuthenticationError:
            return Response(
                {"error": "اعتبارسنجی ناموفق بود: اطلاعات ورودی معتبر نبود"},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except SMTPConnectError:
            return Response(
                {"error": "نمی‌توان با سرور SMTP ارتباط برقرار کرد."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except SMTPSenderRefused:
            return Response(
                {"error": "آدرس از درخواست نامعتبر است."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except SMTPServerDisconnected:
            return Response(
                {"error": "پیامد ارسال ایمیل ناگهان قطع شد."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except SMTPRecipientsRefused:
            return Response(
                {"error": "تمامی آدرس‌های مقصد رد شدند."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except TimeoutError:
            return Response(
                {"error": "خطاى زمانبندى در هنگام اتصال به سرور SMTP."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except ConnectionError:
            return Response(
                {"error": "خطا در اتصال شبکه. لطفاً اینترنت خود را بررسی کنید."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception:
            return Response(
                {"error": "ایمیل ارسال نشد. لطفاً تنظیمات خود را بررسی کنید"},
                status=status.HTTP_400_BAD_REQUEST,
            )
