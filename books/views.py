"""books — Views (목록/검색/상세/상호작용/외부 API 프록시)"""

import requests as http_requests
from django.conf import settings
from django.db.models import Q
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from .models import Author, Book, Genre, UserBookInteraction
from .serializers import (
    BookDetailSerializer,
    BookListSerializer,
    GenreSerializer,
    UserBookInteractionSerializer,
)

# ── 장르 목록 ─────────────────────────────────────────────────────────
@api_view(["GET"])
@permission_classes([AllowAny])
def genre_list(request):
    genres = Genre.objects.all()
    return Response(GenreSerializer(genres, many=True).data)


# ── 도서 목록 + 검색 + 장르 필터 ─────────────────────────────────────
@api_view(["GET"])
@permission_classes([AllowAny])
def book_list(request):
    qs = Book.objects.prefetch_related("authors", "genres")

    # 검색 (제목, 저자명)
    q = request.query_params.get("q", "").strip()
    if q:
        qs = qs.filter(
            Q(title__icontains=q) | Q(authors__name__icontains=q)
        ).distinct()

    # 장르 필터 (slug 또는 id)
    genre = request.query_params.get("genre", "").strip()
    if genre:
        if genre.isdigit():
            qs = qs.filter(genres__id=genre)
        else:
            qs = qs.filter(genres__slug=genre)

    # 정렬
    sort = request.query_params.get("sort", "-rating_count")
    allowed_sorts = {
        "rating": "-average_rating",
        "-rating": "average_rating",
        "recent": "-created_at",
        "title": "title",
        "-rating_count": "-rating_count",
    }
    qs = qs.order_by(allowed_sorts.get(sort, "-rating_count"))

    paginator = PageNumberPagination()
    paginator.page_size = int(request.query_params.get("page_size", 20))
    paginator.page_size_query_param = "page_size"
    paginator.max_page_size = 100
    page = paginator.paginate_queryset(qs, request)
    serializer = BookListSerializer(page, many=True, context={"request": request})
    return paginator.get_paginated_response(serializer.data)


# ── 도서 상세 ─────────────────────────────────────────────────────────
@api_view(["GET"])
@permission_classes([AllowAny])
def book_detail(request, pk):
    try:
        book = Book.objects.prefetch_related("authors", "genres").get(pk=pk)
    except Book.DoesNotExist:
        return Response({"detail": "도서를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)
    serializer = BookDetailSerializer(book, context={"request": request})
    return Response(serializer.data)


# ── 유저-도서 상호작용 (읽음/평점/찜 등) ─────────────────────────────
@api_view(["GET", "POST", "DELETE"])
@permission_classes([IsAuthenticated])
def book_interact(request, pk):
    try:
        book = Book.objects.get(pk=pk)
    except Book.DoesNotExist:
        return Response({"detail": "도서를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

    if request.method == "GET":
        interactions = UserBookInteraction.objects.filter(user=request.user, book=book)
        return Response(UserBookInteractionSerializer(interactions, many=True).data)

    if request.method == "POST":
        serializer = UserBookInteractionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        interaction, created = UserBookInteraction.objects.update_or_create(
            user=request.user,
            book=book,
            interaction_type=serializer.validated_data["interaction_type"],
            defaults={"rating": serializer.validated_data.get("rating")},
        )
        return Response(
            UserBookInteractionSerializer(interaction).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )

    # DELETE
    interaction_type = request.data.get("interaction_type") or request.query_params.get("interaction_type")
    if not interaction_type:
        return Response({"detail": "interaction_type이 필요합니다."}, status=status.HTTP_400_BAD_REQUEST)
    deleted, _ = UserBookInteraction.objects.filter(
        user=request.user, book=book, interaction_type=interaction_type
    ).delete()
    if not deleted:
        return Response({"detail": "해당 상호작용을 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)
    return Response(status=status.HTTP_204_NO_CONTENT)


# ── 외부 API 프록시 — F1302 ───────────────────────────────────────────
@api_view(["GET"])
@permission_classes([AllowAny])
def external_book_search(request):
    """
    외부 도서 검색 프록시.
    우선순위: 1) Kakao Books API (키 있을 때)  2) Open Library (무료)
    반환 형식: { results: [{title, authors, isbn, cover_url, description, ...}] }
    """
    query = request.query_params.get("q", "").strip()
    if not query:
        return Response({"detail": "검색어(q)를 입력해주세요."}, status=status.HTTP_400_BAD_REQUEST)

    # 1) Kakao Books API
    if settings.KAKAO_REST_API_KEY:
        return _kakao_search(query)

    # 2) Open Library (무료, 키 불필요)
    return _open_library_search(query)


def _kakao_search(query: str) -> Response:
    """Kakao 책 검색 API (F1302 외부 API 구현)"""
    url = "https://dapi.kakao.com/v3/search/book"
    headers = {"Authorization": f"KakaoAK {settings.KAKAO_REST_API_KEY}"}
    params = {"query": query, "size": 10}
    try:
        resp = http_requests.get(url, headers=headers, params=params, timeout=5)
        resp.raise_for_status()
        raw = resp.json()
        results = [
            {
                "title": item.get("title", ""),
                "authors": item.get("authors", []),
                "isbn": item.get("isbn", "").split(" ")[0],
                "cover_url": item.get("thumbnail", ""),
                "description": item.get("contents", ""),
                "publisher": item.get("publisher", ""),
                "published_year": (item.get("datetime") or "")[:4] or None,
                "source": "kakao",
            }
            for item in raw.get("documents", [])
        ]
        return Response({"results": results, "source": "kakao"})
    except Exception as e:
        # 카카오 실패 시 Open Library로 자동 fallback
        return _open_library_search(query)


def _open_library_search(query: str) -> Response:
    """Open Library Search API (무료, 키 불필요)"""
    url = "https://openlibrary.org/search.json"
    params = {"q": query, "limit": 10, "fields": "key,title,author_name,isbn,cover_i,subject,publisher,first_publish_year,number_of_pages_median"}
    try:
        resp = http_requests.get(url, params=params, timeout=8)
        resp.raise_for_status()
        raw = resp.json()
        results = []
        for item in raw.get("docs", []):
            isbn = None
            raw_isbns = item.get("isbn", [])
            if raw_isbns:
                isbn = raw_isbns[0]
            cover_id = item.get("cover_i")
            cover_url = f"https://covers.openlibrary.org/b/id/{cover_id}-M.jpg" if cover_id else ""
            results.append({
                "title": item.get("title", ""),
                "authors": item.get("author_name", []),
                "isbn": isbn,
                "cover_url": cover_url,
                "description": "",
                "publisher": (item.get("publisher") or [""])[0],
                "published_year": item.get("first_publish_year"),
                "pages": item.get("number_of_pages_median"),
                "source": "open_library",
            })
        return Response({"results": results, "source": "open_library"})
    except Exception as e:
        return Response(
            {"detail": f"외부 도서 검색 실패: {str(e)}", "results": []},
            status=status.HTTP_502_BAD_GATEWAY,
        )
