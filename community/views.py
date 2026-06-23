"""community — Views (게시글·댓글 CRUD + 좋아요)"""

from django.db.models import Q
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import Category, Comment, Post
from .serializers import (
    CategorySerializer,
    CommentSerializer,
    PostDetailSerializer,
    PostListSerializer,
    PostWriteSerializer,
)


# ── 카테고리 ─────────────────────────────────────────────────────────
@api_view(["GET"])
@permission_classes([AllowAny])
def category_list(request):
    return Response(CategorySerializer(Category.objects.all(), many=True).data)


# ── 게시글 목록 ───────────────────────────────────────────────────────
@api_view(["GET", "POST"])
def post_list(request):
    if request.method == "GET":
        return _get_posts(request)
    permission = IsAuthenticated()
    if not permission.has_permission(request, None):
        return Response({"detail": "로그인이 필요합니다."}, status=status.HTTP_401_UNAUTHORIZED)
    return _create_post(request)


def _get_posts(request):
    qs = Post.objects.select_related("author", "category", "related_book").prefetch_related("likes", "comments")

    # 검색
    q = request.query_params.get("q", "").strip()
    if q:
        qs = qs.filter(Q(title__icontains=q) | Q(content__icontains=q))

    # 카테고리 필터
    cat = request.query_params.get("category", "").strip()
    if cat:
        if cat.isdigit():
            qs = qs.filter(category_id=cat)
        else:
            qs = qs.filter(category__slug=cat)

    # 정렬
    sort = request.query_params.get("sort", "recent")
    if sort == "likes":
        from django.db.models import Count
        qs = qs.annotate(lc=Count("likes")).order_by("-lc", "-created_at")
    elif sort == "views":
        qs = qs.order_by("-views", "-created_at")
    else:
        qs = qs.order_by("-created_at")

    paginator = PageNumberPagination()
    paginator.page_size = int(request.query_params.get("page_size", 20))
    paginator.page_size_query_param = "page_size"
    paginator.max_page_size = 50
    page = paginator.paginate_queryset(qs, request)
    return paginator.get_paginated_response(
        PostListSerializer(page, many=True, context={"request": request}).data
    )


def _create_post(request):
    serializer = PostWriteSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    post = serializer.save(author=request.user)
    return Response(
        PostDetailSerializer(post, context={"request": request}).data,
        status=status.HTTP_201_CREATED,
    )


# ── 게시글 상세 / 수정 / 삭제 ─────────────────────────────────────────
@api_view(["GET", "PUT", "PATCH", "DELETE"])
def post_detail(request, pk):
    try:
        post = Post.objects.select_related("author", "category", "related_book").prefetch_related(
            "likes", "comments__author", "comments__likes"
        ).get(pk=pk)
    except Post.DoesNotExist:
        return Response({"detail": "게시글을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        # 조회수 증가 (비원자적 OK — 정밀 카운트보다 UX 반응성 우선)
        Post.objects.filter(pk=pk).update(views=post.views + 1)
        return Response(PostDetailSerializer(post, context={"request": request}).data)

    # 수정/삭제는 작성자만
    if not request.user.is_authenticated:
        return Response({"detail": "로그인이 필요합니다."}, status=status.HTTP_401_UNAUTHORIZED)
    if post.author_id != request.user.pk and not request.user.is_staff:
        return Response({"detail": "권한이 없습니다."}, status=status.HTTP_403_FORBIDDEN)

    if request.method in ("PUT", "PATCH"):
        serializer = PostWriteSerializer(
            post, data=request.data, partial=(request.method == "PATCH")
        )
        serializer.is_valid(raise_exception=True)
        post = serializer.save()
        return Response(PostDetailSerializer(post, context={"request": request}).data)

    post.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


# ── 게시글 좋아요 토글 ────────────────────────────────────────────────
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def post_like(request, pk):
    try:
        post = Post.objects.get(pk=pk)
    except Post.DoesNotExist:
        return Response({"detail": "게시글을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

    if post.likes.filter(pk=request.user.pk).exists():
        post.likes.remove(request.user)
        liked = False
    else:
        post.likes.add(request.user)
        liked = True

    return Response({"liked": liked, "like_count": post.likes.count()})


# ── 댓글 목록 / 작성 ─────────────────────────────────────────────────
@api_view(["GET", "POST"])
def comment_list(request, post_pk):
    try:
        post = Post.objects.get(pk=post_pk)
    except Post.DoesNotExist:
        return Response({"detail": "게시글을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        comments = post.comments.select_related("author").prefetch_related("likes")
        return Response(CommentSerializer(comments, many=True, context={"request": request}).data)

    if not request.user.is_authenticated:
        return Response({"detail": "로그인이 필요합니다."}, status=status.HTTP_401_UNAUTHORIZED)

    serializer = CommentSerializer(data=request.data, context={"request": request})
    serializer.is_valid(raise_exception=True)
    content = serializer.validated_data.get("content", "").strip()
    if len(content) < 2:
        return Response({"detail": "댓글은 2자 이상 입력해주세요."}, status=status.HTTP_400_BAD_REQUEST)
    comment = Comment.objects.create(post=post, author=request.user, content=content)
    return Response(
        CommentSerializer(comment, context={"request": request}).data,
        status=status.HTTP_201_CREATED,
    )


# ── 댓글 수정 / 삭제 ─────────────────────────────────────────────────
@api_view(["PUT", "PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
def comment_detail(request, post_pk, comment_pk):
    try:
        comment = Comment.objects.select_related("author").get(pk=comment_pk, post_id=post_pk)
    except Comment.DoesNotExist:
        return Response({"detail": "댓글을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

    if comment.author_id != request.user.pk and not request.user.is_staff:
        return Response({"detail": "권한이 없습니다."}, status=status.HTTP_403_FORBIDDEN)

    if request.method in ("PUT", "PATCH"):
        content = request.data.get("content", "").strip()
        if not content:
            return Response({"detail": "내용을 입력해주세요."}, status=status.HTTP_400_BAD_REQUEST)
        comment.content = content
        comment.save()
        return Response(CommentSerializer(comment, context={"request": request}).data)

    comment.delete()
    return Response(status=status.HTTP_204_NO_CONTENT)


# ── 댓글 좋아요 ──────────────────────────────────────────────────────
@api_view(["POST"])
@permission_classes([IsAuthenticated])
def comment_like(request, post_pk, comment_pk):
    try:
        comment = Comment.objects.get(pk=comment_pk, post_id=post_pk)
    except Comment.DoesNotExist:
        return Response({"detail": "댓글을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

    if comment.likes.filter(pk=request.user.pk).exists():
        comment.likes.remove(request.user)
        liked = False
    else:
        comment.likes.add(request.user)
        liked = True

    return Response({"liked": liked, "like_count": comment.likes.count()})
