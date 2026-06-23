"""accounts — Admin"""

from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from .models import CustomUser


@admin.register(CustomUser)
class CustomUserAdmin(UserAdmin):
    list_display = ("username", "email", "is_staff", "date_joined")
    search_fields = ("username", "email")
    fieldsets = UserAdmin.fieldsets + (
        ("BookWise 프로필", {"fields": ("bio", "avatar", "favorite_genres")}),
    )
    filter_horizontal = UserAdmin.filter_horizontal + ("favorite_genres",)
