"""recommendations — Recommendation log model"""

from django.conf import settings
from django.db import models


class RecommendationLog(models.Model):
    """추천 이력 — 알고리즘 감사 추적, Day 0 스키마"""

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="recommendation_logs",
    )
    book = models.ForeignKey(
        "books.Book", on_delete=models.CASCADE, related_name="recommendation_logs"
    )

    # 추천 점수 및 판정 (백엔드 단일 권위)
    score = models.FloatField()                 # TF-IDF 코사인 유사도 0.0–1.0
    tier = models.CharField(
        max_length=10,
        choices=[("high", "높음"), ("mid", "중간"), ("low", "낮음")],
    )
    reason = models.TextField(blank=True)       # 사용자 노출 추천 이유

    # 알고리즘 메타데이터
    algorithm_version = models.CharField(max_length=20, default="tfidf-v1")
    ml_flag = models.BooleanField(default=False)  # True = ML 모델 사용, False = TF-IDF
    judgment_hash = models.CharField(max_length=64, blank=True)  # SHA-256 입력 특성 해시
    context_page = models.CharField(max_length=50, blank=True)   # 추천 발생 페이지

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "추천 이력"
        verbose_name_plural = "추천 이력 목록"
        indexes = [
            models.Index(fields=["user", "-created_at"]),
            models.Index(fields=["book", "tier"]),
        ]

    def __str__(self):
        return f"{self.user.username} ← {self.book.title} [{self.tier}:{self.score:.3f}]"
