"""accounts — Auth & Profile views"""

from django.db.models import Count
from rest_framework import status
from rest_framework.authtoken.models import Token
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import CustomUser
from .serializers import (
    LoginSerializer,
    UserMiniSerializer,
    UserProfileSerializer,
    UserProfileUpdateSerializer,
    UserRegistrationSerializer,
)


# ── 회원가입 ─────────────────────────────────────────────────────────
@api_view(["POST"])
@permission_classes([AllowAny])
def register(request):
    serializer = UserRegistrationSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.save()
    token, _ = Token.objects.get_or_create(user=user)
    return Response(
        {"token": token.key, "user": UserMiniSerializer(user).data},
        status=status.HTTP_201_CREATED,
    )


# ── 로그인 ───────────────────────────────────────────────────────────
@api_view(["POST"])
@permission_classes([AllowAny])
def login(request):
    serializer = LoginSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.validated_data["user"]
    token, _ = Token.objects.get_or_create(user=user)
    return Response({"token": token.key, "user": UserMiniSerializer(user).data})


# ── 로그아웃 ─────────────────────────────────────────────────────────
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def logout(request):
    request.user.auth_token.delete()
    return Response({"detail": "로그아웃 되었습니다."})


# ── 내 프로필 조회/수정 ──────────────────────────────────────────────
@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
def my_profile(request):
    user = (
        CustomUser.objects.annotate(
            read_count=Count("book_interactions", distinct=True),
            post_count=Count("community_posts", distinct=True),
        )
        .get(pk=request.user.pk)
    )
    if request.method == "GET":
        serializer = UserProfileSerializer(user)
        return Response(serializer.data)

    serializer = UserProfileUpdateSerializer(user, data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    serializer.save()
    return Response(UserProfileSerializer(user).data)


# ── 특정 유저 프로필 (공개) ──────────────────────────────────────────
@api_view(["GET"])
@permission_classes([AllowAny])
def user_profile(request, pk):
    try:
        user = CustomUser.objects.annotate(
            read_count=Count("book_interactions", distinct=True),
            post_count=Count("community_posts", distinct=True),
        ).get(pk=pk)
    except CustomUser.DoesNotExist:
        return Response({"detail": "사용자를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)
    return Response(UserProfileSerializer(user).data)
