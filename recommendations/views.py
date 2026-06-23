"""recommendations — Views"""

from django.conf import settings
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.response import Response

from books.models import Book
from books.serializers import BookListSerializer
from .engine import recommend_for_user, score_to_tier, compute_judgment_hash
from .models import RecommendationLog


# ── 개인화 추천 (로그인 필요) ────────────────────────────────────────
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def personalized(request):
    """
    GET /api/recommendations/
    쿼리파라미터:
      top_n   : 반환 건수 (기본 settings.REC_TOP_N, 최대 50)
      page    : 컨텍스트 페이지명 (감사 추적용)
      refresh : "true" 이면 이전 로그 무시하고 재계산
    """
    top_n = min(int(request.query_params.get("top_n", settings.REC_TOP_N)), 50)
    context_page = request.query_params.get("page", "home")

    # 후보 도서 (전체 카탈로그, 평점순)
    candidate_books = Book.objects.prefetch_related("authors", "genres").order_by(
        "-rating_count", "-average_rating"
    )[:500]

    results = recommend_for_user(
        request.user,
        candidate_books,
        top_n=top_n,
        context_page=context_page,
    )

    # 응답 구성 + 로그 적재 (벌크 insert)
    response_items = []
    logs_to_create = []

    for book, score, tier, reason in results:
        feature_snapshot = {
            "score": score,
            "algorithm": settings.REC_ALGORITHM_VERSION,
            "ml_flag": settings.ML_MODEL_ENABLED,
        }
        j_hash = compute_judgment_hash(request.user.id, book.id, feature_snapshot)

        book_data = BookListSerializer(book, context={"request": request}).data
        response_items.append({
            **book_data,
            "rec_score": score,        # float 0.0–1.0
            "rec_tier": tier,          # "high"|"mid"|"low" — 백엔드 단일 판정
            "rec_reason": reason,
        })

        logs_to_create.append(
            RecommendationLog(
                user=request.user,
                book=book,
                score=score,
                tier=tier,
                reason=reason,
                algorithm_version=settings.REC_ALGORITHM_VERSION,
                ml_flag=settings.ML_MODEL_ENABLED,
                judgment_hash=j_hash,
                context_page=context_page,
            )
        )

    # 최근 세션 로그 중복 방지 (같은 책이 이미 high tier로 추천된 경우)
    RecommendationLog.objects.bulk_create(logs_to_create, ignore_conflicts=False)

    return Response({
        "count": len(response_items),
        "algorithm": settings.REC_ALGORITHM_VERSION,
        "ml_flag": settings.ML_MODEL_ENABLED,
        "results": response_items,
    })


# ── 비로그인 인기 도서 추천 (콜드스타트 대체) ────────────────────────
@api_view(["GET"])
@permission_classes([AllowAny])
def popular(request):
    """
    GET /api/recommendations/popular/
    비로그인 사용자용 — 평점 높은 책을 low tier로 반환.
    """
    top_n = min(int(request.query_params.get("top_n", 12)), 30)
    books = Book.objects.prefetch_related("authors", "genres").order_by(
        "-average_rating", "-rating_count"
    )[:top_n]

    results = []
    for book in books:
        raw_score = (book.average_rating / 5.0) * 0.35 if book.average_rating else 0.05
        score = round(min(raw_score, 0.39), 4)
        tier = score_to_tier(score)
        book_data = BookListSerializer(book, context={"request": request}).data
        results.append({
            **book_data,
            "rec_score": score,
            "rec_tier": tier,
            "rec_reason": "많은 독자가 선택한 인기 도서입니다.",
        })

    return Response({"count": len(results), "results": results})


# ── 특정 도서 기준 유사 도서 추천 ────────────────────────────────────
@api_view(["GET"])
@permission_classes([AllowAny])
def similar_books(request, pk):
    """
    GET /api/recommendations/similar/<pk>/
    해당 도서와 TF-IDF 유사도가 높은 도서 반환.
    """
    try:
        source_book = Book.objects.prefetch_related("authors", "genres").get(pk=pk)
    except Book.DoesNotExist:
        return Response({"detail": "도서를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

    top_n = min(int(request.query_params.get("top_n", 8)), 20)

    from recommendations.engine import (
        book_corpus_text, tokenize, compute_idf, tfidf_vector,
        cosine_similarity, load_book_vector
    )
    import json

    # 소스 도서 벡터
    source_precomp = load_book_vector(source_book)

    candidates = Book.objects.exclude(pk=pk).prefetch_related("authors", "genres")[:300]
    cand_list = list(candidates)

    # 소스 벡터가 없으면 실시간 계산
    if not source_precomp:
        all_texts = [book_corpus_text(source_book)] + [book_corpus_text(b) for b in cand_list]
        all_tokens = [tokenize(t) for t in all_texts]
        idf = compute_idf(all_tokens)
        source_vec = tfidf_vector(all_tokens[0], idf)
    else:
        source_vec = source_precomp
        # IDF 필요 없음 (사전계산 벡터 활용)
        idf = {}

    results = []
    for book in cand_list:
        precomp = load_book_vector(book)
        if precomp:
            book_vec = precomp
        elif idf:
            book_vec = tfidf_vector(tokenize(book_corpus_text(book)), idf)
        else:
            continue

        score = round(cosine_similarity(source_vec, book_vec), 4)
        tier = score_to_tier(score)
        book_data = BookListSerializer(book, context={"request": request}).data
        results.append({
            **book_data,
            "rec_score": score,
            "rec_tier": tier,
            "rec_reason": f"'{source_book.title}'와 유사한 도서입니다.",
        })

    results.sort(key=lambda x: x["rec_score"], reverse=True)
    return Response({"count": len(results[:top_n]), "results": results[:top_n]})


# ── 추천 이력 조회 ────────────────────────────────────────────────────
@api_view(["GET"])
@permission_classes([IsAuthenticated])
def recommendation_history(request):
    logs = RecommendationLog.objects.filter(user=request.user).select_related("book")[:50]
    data = [
        {
            "book_id": log.book_id,
            "book_title": log.book.title,
            "score": log.score,
            "tier": log.tier,
            "reason": log.reason,
            "algorithm_version": log.algorithm_version,
            "created_at": log.created_at,
        }
        for log in logs
    ]
    return Response({"count": len(data), "results": data})
