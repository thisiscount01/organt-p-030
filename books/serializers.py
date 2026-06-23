"""books — Serializers"""

from rest_framework import serializers
from .models import Author, Book, Genre, UserBookInteraction


class GenreSerializer(serializers.ModelSerializer):
    class Meta:
        model = Genre
        fields = ["id", "name", "slug"]


class AuthorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Author
        fields = ["id", "name", "bio", "birth_year"]


class BookListSerializer(serializers.ModelSerializer):
    """목록용 — 핵심 필드만"""
    authors = AuthorSerializer(many=True, read_only=True)
    genres = GenreSerializer(many=True, read_only=True)

    class Meta:
        model = Book
        fields = [
            "id", "title", "authors", "genres", "cover_url",
            "published_year", "average_rating", "rating_count",
            "language",
        ]


class BookDetailSerializer(serializers.ModelSerializer):
    """상세용 — 전체 필드"""
    authors = AuthorSerializer(many=True, read_only=True)
    genres = GenreSerializer(many=True, read_only=True)
    user_interaction = serializers.SerializerMethodField()

    class Meta:
        model = Book
        fields = [
            "id", "isbn", "title", "authors", "genres",
            "description", "cover_url", "published_year",
            "pages", "publisher", "language",
            "average_rating", "rating_count",
            "source", "created_at",
            "user_interaction",
        ]

    def get_user_interaction(self, obj):
        request = self.context.get("request")
        if not request or not request.user.is_authenticated:
            return None
        interactions = UserBookInteraction.objects.filter(
            user=request.user, book=obj
        )
        result = {}
        for i in interactions:
            result[i.interaction_type] = True
            if i.interaction_type == "rated":
                result["rating"] = i.rating
        return result


class UserBookInteractionSerializer(serializers.ModelSerializer):
    class Meta:
        model = UserBookInteraction
        fields = ["id", "interaction_type", "rating", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate(self, data):
        if data.get("interaction_type") == "rated" and data.get("rating") is None:
            raise serializers.ValidationError({"rating": "평점을 입력해주세요 (0.5 ~ 5.0)."})
        if data.get("interaction_type") != "rated":
            data["rating"] = None
        return data
