"""accounts — Custom User model"""

from django.contrib.auth.models import AbstractUser
from django.db import models


class CustomUser(AbstractUser):
    """AbstractUser 확장: bio, avatar, 관심 장르"""

    bio = models.TextField(blank=True, default="")
    avatar = models.ImageField(upload_to="avatars/", null=True, blank=True)
    # 관심 장르: books.Genre ManyToMany (string ref로 순환참조 방지)
    favorite_genres = models.ManyToManyField(
        "books.Genre", blank=True, related_name="interested_users"
    )

    class Meta:
        db_table = "auth_custom_user"
        verbose_name = "사용자"
        verbose_name_plural = "사용자 목록"

    def __str__(self):
        return self.username

    @property
    def avatar_url(self):
        if self.avatar:
            return self.avatar.url
        return None
