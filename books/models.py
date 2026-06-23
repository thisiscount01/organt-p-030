"""books — Book catalog models"""

from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils.text import slugify


class Genre(models.Model):
    name = models.CharField(max_length=50, unique=True)
    slug = models.SlugField(max_length=60, unique=True, blank=True)
    description = models.TextField(blank=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "장르"
        verbose_name_plural = "장르 목록"

    def save(self, *args, **kwargs):
        if not self.slug:
            self.slug = slugify(self.name, allow_unicode=True)
        super().save(*args, **kwargs)

    def __str__(self):
        return self.name


class Author(models.Model):
    name = models.CharField(max_length=200)
    bio = models.TextField(blank=True)
    birth_year = models.PositiveSmallIntegerField(null=True, blank=True)

    class Meta:
        ordering = ["name"]
        verbose_name = "저자"
        verbose_name_plural = "저자 목록"

    def __str__(self):
        return self.name


class Book(models.Model):
    """도서 — TF-IDF 벡터 사전계산 포함"""

    isbn = models.CharField(max_length=20, unique=True, null=True, blank=True)
    title = models.CharField(max_length=500)
    authors = models.ManyToManyField(Author, blank=True, related_name="books")
    genres = models.ManyToManyField(Genre, blank=True, related_name="books")
    description = models.TextField(blank=True)
    cover_url = models.URLField(max_length=800, blank=True)
    published_year = models.PositiveSmallIntegerField(null=True, blank=True)
    pages = models.PositiveIntegerField(null=True, blank=True)
    publisher = models.CharField(max_length=200, blank=True)
    language = models.CharField(max_length=10, default="ko")

    # 평점 집계 (비정규화 — 성능)
    average_rating = models.FloatField(default=0.0)
    rating_count = models.PositiveIntegerField(default=0)

    # TF-IDF 사전계산 벡터 (JSON): {term: tfidf_score, ...}
    # 코퍼스 변경 시 management command로 재계산
    tfidf_vector_json = models.TextField(blank=True, default="{}")
    tfidf_computed_at = models.DateTimeField(null=True, blank=True)

    # 외부 소스 추적 (Day 0 잠금)
    source = models.CharField(
        max_length=30,
        choices=[
            ("open_library", "Open Library"),
            ("kakao", "Kakao Books API"),
            ("naver", "Naver Books API"),
            ("manual", "수동 입력"),
        ],
        default="manual",
    )
    external_id = models.CharField(max_length=200, blank=True)

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-rating_count", "-average_rating"]
        verbose_name = "도서"
        verbose_name_plural = "도서 목록"
        indexes = [
            models.Index(fields=["isbn"]),
            models.Index(fields=["-average_rating"]),
            models.Index(fields=["language"]),
        ]

    def __str__(self):
        return self.title

    def update_rating_stats(self):
        """평점 집계 재계산 — save() 없이 DB update"""
        from django.db.models import Avg, Count
        stats = self.interactions.filter(
            interaction_type="rated", rating__isnull=False
        ).aggregate(avg=Avg("rating"), cnt=Count("id"))
        Book.objects.filter(pk=self.pk).update(
            average_rating=round(stats["avg"] or 0.0, 2),
            rating_count=stats["cnt"] or 0,
        )


class UserBookInteraction(models.Model):
    """유저-도서 상호작용 (읽음/찜/평점)"""

    INTERACTION_CHOICES = [
        ("read", "읽음"),
        ("want_to_read", "읽고 싶어요"),
        ("reading", "읽는 중"),
        ("rated", "평가함"),
        ("liked", "좋아요"),
    ]

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="book_interactions",
    )
    book = models.ForeignKey(
        Book, on_delete=models.CASCADE, related_name="interactions"
    )
    interaction_type = models.CharField(max_length=20, choices=INTERACTION_CHOICES)
    rating = models.FloatField(
        null=True,
        blank=True,
        validators=[MinValueValidator(0.5), MaxValueValidator(5.0)],
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = [("user", "book", "interaction_type")]
        verbose_name = "독서 기록"
        verbose_name_plural = "독서 기록 목록"

    def __str__(self):
        return f"{self.user.username} — {self.book.title} [{self.interaction_type}]"

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        # 평점 추가 시 집계 갱신
        if self.interaction_type == "rated":
            self.book.update_rating_stats()
