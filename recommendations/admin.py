"""recommendations — Admin"""

from django.contrib import admin
from .models import RecommendationLog


@admin.register(RecommendationLog)
class RecommendationLogAdmin(admin.ModelAdmin):
    list_display = ("user", "book", "tier", "score", "algorithm_version", "ml_flag", "created_at")
    list_filter = ("tier", "algorithm_version", "ml_flag")
    search_fields = ("user__username", "book__title")
    readonly_fields = ("judgment_hash", "created_at")
