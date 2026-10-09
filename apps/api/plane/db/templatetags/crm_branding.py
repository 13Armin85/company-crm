from django import template
from django.conf import settings

register = template.Library()


@register.simple_tag
def crm_brand_logo_url():
    """Use the public application asset even when Celery renders without a request."""
    web_url = settings.WEB_URL or "http://localhost:3000"
    return f"{web_url.rstrip('/')}/branding/amard-logo.png"
