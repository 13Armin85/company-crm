# Copyright (c) 2023-present Plane Software, Inc. and contributors
# SPDX-License-Identifier: AGPL-3.0-only
# See the LICENSE file for details.

"""
Common OpenAPI responses for drf-spectacular.

This module provides reusable response definitions for common HTTP status codes
and scenarios that occur across multiple API endpoints.
"""

from drf_spectacular.utils import OpenApiResponse, OpenApiExample, inline_serializer
from rest_framework import serializers
from .examples import get_sample_for_schema


# Authentication & Authorization Responses
UNAUTHORIZED_RESPONSE = OpenApiResponse(
    description="Authentication credentials were not provided or are invalid.",
    examples=[
        OpenApiExample(
            name="Unauthorized",
            value={
                "error": "اعتبارسنجی هویتی پارامترهای ارائه نشده",
                "error_code": "AUTHENTICATION_REQUIRED",
            },
        )
    ],
)

FORBIDDEN_RESPONSE = OpenApiResponse(
    description="Permission denied. User lacks required permissions.",
    examples=[
        OpenApiExample(
            name="Forbidden",
            value={
                "error": "شما به انجام این عملیات مجوز ندارید",
                "error_code": "PERMISSION_DENIED",
            },
        )
    ],
)


# Resource Responses
NOT_FOUND_RESPONSE = OpenApiResponse(
    description="The requested resource was not found.",
    examples=[
        OpenApiExample(
            name="Not Found",
            value={"error": "یافت نشد", "error_code": "RESOURCE_NOT_FOUND"},
        )
    ],
)

VALIDATION_ERROR_RESPONSE = OpenApiResponse(
    description="Validation error occurred with the provided data.",
    examples=[
        OpenApiExample(
            name="Validation Error",
            value={
                "error": "اعتبارسنجی ناموفق بود",
                "details": {"field_name": ["This field is required."]},
            },
        )
    ],
)

# Generic Success Responses
DELETED_RESPONSE = OpenApiResponse(
    description="Resource deleted successfully",
    examples=[
        OpenApiExample(
            name="Deleted Successfully",
            value={"message": "منبع با موفقیت حذف شد"},
        )
    ],
)

ARCHIVED_RESPONSE = OpenApiResponse(
    description="Resource archived successfully",
    examples=[
        OpenApiExample(
            name="Archived Successfully",
            value={"message": "منبع با موفقیت قدم به عقب گرفته شد"},
        )
    ],
)

UNARCHIVED_RESPONSE = OpenApiResponse(
    description="Resource unarchived successfully",
    examples=[
        OpenApiExample(
            name="Unarchived Successfully",
            value={"message": "منبع با موفقیت از حذف بازگردانده شد"},
        )
    ],
)

# Specific Error Responses
INVALID_REQUEST_RESPONSE = OpenApiResponse(
    description="Invalid request data provided",
    examples=[
        OpenApiExample(
            name="Invalid Request",
            value={
                "error": "داده‌های درخواستی نامعتبر هستند",
                "details": "Specific validation errors",
            },
        )
    ],
)

CONFLICT_RESPONSE = OpenApiResponse(
    description="Resource conflict - duplicate or constraint violation",
    examples=[
        OpenApiExample(
            name="Resource Conflict",
            value={
                "error": "منبع با شناسه مشابه قبلاً وجود دارد",
                "id": "550e8400-e29b-41d4-a716-446655440000",
            },
        )
    ],
)

ADMIN_ONLY_RESPONSE = OpenApiResponse(
    description="Only admin or creator can perform this action",
    examples=[
        OpenApiExample(
            name="Admin Only",
            value={"error": "فقط مدیر یا ایجادکننده می‌توانند این عملیات را انجام دهند"},
        )
    ],
)

CANNOT_DELETE_RESPONSE = OpenApiResponse(
    description="Resource cannot be deleted due to constraints",
    examples=[
        OpenApiExample(
            name="Cannot Delete",
            value={"error": "منبع نمی‌تواند حذف شود", "reason": "Has dependencies"},
        )
    ],
)

CANNOT_ARCHIVE_RESPONSE = OpenApiResponse(
    description="Resource cannot be archived in current state",
    examples=[
        OpenApiExample(
            name="Cannot Archive",
            value={
                "error": "منبع نمی‌تواند قدم به عقب گرفته شود",
                "reason": "Not in valid state",
            },
        )
    ],
)

REQUIRED_FIELDS_RESPONSE = OpenApiResponse(
    description="Required fields are missing",
    examples=[
        OpenApiExample(
            name="Required Fields Missing",
            value={"error": "فیلدهای الزامی ناقص هستند", "fields": ["name", "type"]},
        )
    ],
)

# Project-specific Responses
PROJECT_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Project not found",
    examples=[
        OpenApiExample(
            name="Project Not Found",
            value={"error": "پروژه یافت نشد"},
        )
    ],
)

WORKSPACE_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Workspace not found",
    examples=[
        OpenApiExample(
            name="Workspace Not Found",
            value={"error": "فضای کاری یافت نشد"},
        )
    ],
)

PROJECT_NAME_TAKEN_RESPONSE = OpenApiResponse(
    description="Project name already taken",
    examples=[
        OpenApiExample(
            name="Project Name Taken",
            value={"error": "نام پروژه قبلاً توسط کاربر دیگری استفاده شده است"},
        )
    ],
)

# Issue-specific Responses
ISSUE_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Issue not found",
    examples=[
        OpenApiExample(
            name="Issue Not Found",
            value={"error": "کار یافت نشد."},
        )
    ],
)

WORK_ITEM_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Work item not found",
    examples=[
        OpenApiExample(
            name="Work Item Not Found",
            value={"error": "کار پیدا نشد"},
        )
    ],
)

EXTERNAL_ID_EXISTS_RESPONSE = OpenApiResponse(
    description="Resource with same external ID already exists",
    examples=[
        OpenApiExample(
            name="External ID Exists",
            value={
                "error": "منبع با شناسه خارجی و منبع خارجی مشابه قبلاً وجود دارد",  # noqa: E501
                "id": "550e8400-e29b-41d4-a716-446655440000",
            },
        )
    ],
)

# Label-specific Responses
LABEL_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Label not found",
    examples=[
        OpenApiExample(
            name="Label Not Found",
            value={"error": "برچسب پیدا نشد"},
        )
    ],
)

LABEL_NAME_EXISTS_RESPONSE = OpenApiResponse(
    description="Label with the same name already exists",
    examples=[
        OpenApiExample(
            name="Label Name Exists",
            value={"error": "برچسب با همان نام در پروژه وجود دارد."},
        )
    ],
)

# Module-specific Responses
MODULE_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Module not found",
    examples=[
        OpenApiExample(
            name="Module Not Found",
            value={"error": "ماژول یافت نشد"},
        )
    ],
)

MODULE_ISSUE_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Module issue not found",
    examples=[
        OpenApiExample(
            name="Module Issue Not Found",
            value={"error": "مشکل ماژول پیدا نشد"},
        )
    ],
)

# Cycle-specific Responses
CYCLE_CANNOT_ARCHIVE_RESPONSE = OpenApiResponse(
    description="Cycle cannot be archived",
    examples=[
        OpenApiExample(
            name="Cycle Cannot Archive",
            value={"error": "فقط چرخه‌های تمام‌شده قابل آرشیو است"},
        )
    ],
)

# State-specific Responses
STATE_NAME_EXISTS_RESPONSE = OpenApiResponse(
    description="State with the same name already exists",
    examples=[
        OpenApiExample(
            name="State Name Exists",
            value={"error": "وضعیت با نام مشابه قبلاً وجود دارد"},
        )
    ],
)

STATE_CANNOT_DELETE_RESPONSE = OpenApiResponse(
    description="State cannot be deleted",
    examples=[
        OpenApiExample(
            name="State Cannot Delete",
            value={
                "error": "وضعیت نمی‌تواند حذف شود",
                "reason": "Default state or has issues",
            },
        )
    ],
)

# Comment-specific Responses
COMMENT_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Comment not found",
    examples=[
        OpenApiExample(
            name="Comment Not Found",
            value={"error": "نظر پیدا نشد"},
        )
    ],
)

# Link-specific Responses
LINK_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Link not found",
    examples=[
        OpenApiExample(
            name="Link Not Found",
            value={"error": "پیوند پیدا نشد"},
        )
    ],
)

# Attachment-specific Responses
ATTACHMENT_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Attachment not found",
    examples=[
        OpenApiExample(
            name="Attachment Not Found",
            value={"error": "ضمیمه پیدا نشد"},
        )
    ],
)

# Search-specific Responses
BAD_SEARCH_REQUEST_RESPONSE = OpenApiResponse(
    description="Bad request - invalid search parameters",
    examples=[
        OpenApiExample(
            name="Bad Search Request",
            value={"error": "پارامترهای جستجو نامعتبر هستند"},
        )
    ],
)


# Pagination Response Templates
def create_paginated_response(
    item_schema,
    schema_name,
    description="Paginated results",
    example_name="Paginated Response",
):
    """Create a paginated response with the specified item schema"""

    return OpenApiResponse(
        description=description,
        response=inline_serializer(
            name=schema_name,
            fields={
                "grouped_by": serializers.CharField(allow_null=True),
                "sub_grouped_by": serializers.CharField(allow_null=True),
                "total_count": serializers.IntegerField(),
                "next_cursor": serializers.CharField(),
                "prev_cursor": serializers.CharField(),
                "next_page_results": serializers.BooleanField(),
                "prev_page_results": serializers.BooleanField(),
                "count": serializers.IntegerField(),
                "total_pages": serializers.IntegerField(),
                "total_results": serializers.IntegerField(),
                "extra_stats": serializers.CharField(allow_null=True),
                "results": serializers.ListField(child=item_schema()),
            },
        ),
        examples=[
            OpenApiExample(
                name=example_name,
                value={
                    "grouped_by": "state",
                    "sub_grouped_by": "priority",
                    "total_count": 150,
                    "next_cursor": "20:1:0",
                    "prev_cursor": "20:0:0",
                    "next_page_results": True,
                    "prev_page_results": False,
                    "count": 20,
                    "total_pages": 8,
                    "total_results": 150,
                    "extra_stats": None,
                    "results": [get_sample_for_schema(schema_name)],
                },
                summary=example_name,
            )
        ],
    )


# Asset-specific Responses
PRESIGNED_URL_SUCCESS_RESPONSE = OpenApiResponse(description="Presigned URL generated successfully")

GENERIC_ASSET_UPLOAD_SUCCESS_RESPONSE = OpenApiResponse(
    description="Presigned URL generated successfully",
    examples=[
        OpenApiExample(
            name="Generic Asset Upload Response",
            value={
                "upload_data": {
                    "url": "https://s3.amazonaws.com/bucket-name",
                    "fields": {
                        "key": "workspace-id/uuid-filename.pdf",
                        "AWSAccessKeyId": "AKIA...",
                        "policy": "eyJ...",
                        "signature": "abc123...",
                    },
                },
                "asset_id": "550e8400-e29b-41d4-a716-446655440000",
                "asset_url": "https://cdn.example.com/workspace-id/uuid-filename.pdf",
            },
        )
    ],
)

GENERIC_ASSET_VALIDATION_ERROR_RESPONSE = OpenApiResponse(
    description="Validation error",
    examples=[
        OpenApiExample(
            name="Missing required fields",
            value={"error": "نام و اندازه موارد الزامی هستند.", "status": False},
        ),
        OpenApiExample(
            name="Invalid file type",
            value={"error": "نوع فایل نامعتبر است.", "status": False},
        ),
    ],
)

ASSET_CONFLICT_RESPONSE = OpenApiResponse(
    description="Asset with same external ID already exists",
    examples=[
        OpenApiExample(
            name="Duplicate external asset",
            value={
                "message": "میراث با شناسه خارجی و منبع مشابه قبلاً وجود دارد",
                "asset_id": "550e8400-e29b-41d4-a716-446655440000",
                "asset_url": "https://cdn.example.com/existing-file.pdf",
            },
        )
    ],
)

ASSET_DOWNLOAD_SUCCESS_RESPONSE = OpenApiResponse(
    description="Presigned download URL generated successfully",
    examples=[
        OpenApiExample(
            name="Asset Download Response",
            value={
                "asset_id": "550e8400-e29b-41d4-a716-446655440000",
                "asset_url": "https://s3.amazonaws.com/bucket/file.pdf?signed-url",
                "asset_name": "document.pdf",
                "asset_type": "application/pdf",
            },
        )
    ],
)

ASSET_DOWNLOAD_ERROR_RESPONSE = OpenApiResponse(
    description="Bad request",
    examples=[
        OpenApiExample(name="Asset not uploaded", value={"error": "دارایی هنوز بارگذاری نشده است"}),
    ],
)

ASSET_UPDATED_RESPONSE = OpenApiResponse(description="Asset updated successfully")

ASSET_DELETED_RESPONSE = OpenApiResponse(description="Asset deleted successfully")

ASSET_NOT_FOUND_RESPONSE = OpenApiResponse(
    description="Asset not found",
    examples=[OpenApiExample(name="Asset not found", value={"error": "دارایی یافت نشد"})],
)
