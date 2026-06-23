"""books — Admin"""

from django.contrib import admin
from .models import Author, Book, Genre, UserBookInteraction


@admin.register(Genre)
class GenreAdmin(admin.ModelAdmin):
    list_display = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}


@admin.register(Author)
class AuthorAdmin(admin.ModelAdmin):
    list_display = ("name", "birth_year")
    search_fields = ("name",)


@admin.register(Book)
class BookAdmin(admin.ModelAdmin):
    list_display = ("title", "average_rating", "rating_count", "source", "created_at")
    list_filter = ("genres", "source", "language")
    search_fields = ("title", "isbn", "authors__name")
    filter_horizontal = ("authors", "genres")
    readonly_fields = ("average_rating", "rating_count", "tfidf_computed_at", "created_at", "updated_at")


@admin.register(UserBookInteraction)
class UserBookInteractionAdmin(admin.ModelAdmin):
    list_display = ("user", "book", "interaction_type", "rating", "created_at")
    list_filter = ("interaction_type",)
    search_fields = ("user__username", "book__title")
