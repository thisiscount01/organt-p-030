"""community — Serializers"""

from rest_framework import serializers
from accounts.serializers import UserMiniSerializer
from books.serializers import BookListSerializer
from .models import Category, Comment, Post


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ["id", "name", "slug", "description"]


class CommentSerializer(serializers.ModelSerializer):
    author = UserMiniSerializer(read_only=True)
    like_count = serializers.SerializerMethodField()
    is_liked = serializers.SerializerMethodField()

    class Meta:
        model = Comment
        fields = ["id", "author", "content", "like_count", "is_liked", "created_at", "updated_at"]
        read_only_fields = ["id", "author", "like_count", "is_liked", "created_at", "updated_at"]

    def get_like_count(self, obj):
        return obj.likes.count()

    def get_is_liked(self, obj):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.likes.filter(pk=request.user.pk).exists()
        return False


class PostListSerializer(serializers.ModelSerializer):
    author = UserMiniSerializer(read_only=True)
    category = CategorySerializer(read_only=True)
    like_count = serializers.IntegerField(source="likes.count", read_only=True)
    comment_count = serializers.IntegerField(source="comments.count", read_only=True)
    related_book_title = serializers.CharField(
        source="related_book.title", read_only=True, allow_null=True
    )

    class Meta:
        model = Post
        fields = [
            "id", "author", "category", "title",
            "like_count", "comment_count", "views",
            "related_book_title", "created_at",
        ]


class PostDetailSerializer(serializers.ModelSerializer):
    author = UserMiniSerializer(read_only=True)
    category = CategorySerializer(read_only=True)
    related_book = BookListSerializer(read_only=True)
    comments = CommentSerializer(many=True, read_only=True)
    like_count = serializers.IntegerField(source="likes.count", read_only=True)
    is_liked = serializers.SerializerMethodField()
    is_owner = serializers.SerializerMethodField()

    class Meta:
        model = Post
        fields = [
            "id", "author", "category", "related_book",
            "title", "content",
            "like_count", "is_liked", "is_owner",
            "comment_count", "views", "comments",
            "created_at", "updated_at",
        ]

    def get_is_liked(self, obj):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.likes.filter(pk=request.user.pk).exists()
        return False

    def get_is_owner(self, obj):
        request = self.context.get("request")
        if request and request.user.is_authenticated:
            return obj.author_id == request.user.pk
        return False


class PostWriteSerializer(serializers.ModelSerializer):
    category_id = serializers.IntegerField(required=False, allow_null=True)
    related_book_id = serializers.IntegerField(required=False, allow_null=True)

    class Meta:
        model = Post
        fields = ["title", "content", "category_id", "related_book_id"]

    def validate_title(self, value):
        if len(value.strip()) < 2:
            raise serializers.ValidationError("제목은 2자 이상 입력해주세요.")
        return value.strip()

    def validate_content(self, value):
        if len(value.strip()) < 5:
            raise serializers.ValidationError("내용은 5자 이상 입력해주세요.")
        return value.strip()
