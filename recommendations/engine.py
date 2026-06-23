"""
recommendations/engine.py

TF-IDF 코사인 유사도 기반 도서 추천 엔진.

계약 (AI 엔지니어·프론트엔드·디자이너 합의 — tokens.css §3에 기록):
  score ≥ 0.6  → tier="high"
  score ≥ 0.4  → tier="mid"
  score  < 0.4  → tier="low"

판정 권위: 백엔드 단일. score_to_tier()만이 tier 문자열을 생성.
프론트는 tier 문자열을 data-tier 속성에 써넣고 색상 선택은 CSS var로만.
"""

import hashlib
import json
import math
import re
from collections import Counter
from typing import Dict, List, Optional, Tuple

from django.conf import settings
from django.utils import timezone


# ── 임계값 — 환경변수로 조정 가능, 기본값 0.6/0.4 ──────────────────
def _thresholds() -> Tuple[float, float]:
    return (
        getattr(settings, "REC_THRESHOLD_HIGH", 0.6),
        getattr(settings, "REC_THRESHOLD_MID", 0.4),
    )


# ── 판정 함수 — 백엔드 단일 권위 ────────────────────────────────────
def score_to_tier(score: float) -> str:
    """
    float score → 'high'|'mid'|'low'
    이 함수 외에서 tier를 결정하는 코드는 일절 작성 금지.
    """
    high, mid = _thresholds()
    if score >= high:
        return "high"
    if score >= mid:
        return "mid"
    return "low"


# ── 텍스트 전처리 ────────────────────────────────────────────────────
def tokenize(text: str) -> List[str]:
    """한국어+영어 혼합 토크나이저 (소문자, 특수문자 제거)"""
    if not text:
        return []
    text = text.lower()
    tokens = re.findall(r"[\w가-힣]+", text)
    # 1~2 글자 영문 불용어 제거 (노이즈 감소)
    tokens = [t for t in tokens if not (t.isascii() and len(t) <= 2)]
    return tokens


def compute_tf(tokens: List[str]) -> Dict[str, float]:
    if not tokens:
        return {}
    count = Counter(tokens)
    total = len(tokens)
    return {term: cnt / total for term, cnt in count.items()}


def compute_idf(corpus: List[List[str]]) -> Dict[str, float]:
    """IDF (smoothed): log((N+1)/(df+1)) + 1"""
    N = len(corpus)
    if N == 0:
        return {}
    df: Counter = Counter()
    for doc_tokens in corpus:
        for term in set(doc_tokens):
            df[term] += 1
    return {term: math.log((N + 1) / (cnt + 1)) + 1 for term, cnt in df.items()}


def tfidf_vector(tokens: List[str], idf: Dict[str, float]) -> Dict[str, float]:
    tf = compute_tf(tokens)
    return {term: tf_val * idf.get(term, 1.0) for term, tf_val in tf.items()}


def cosine_similarity(vec_a: Dict[str, float], vec_b: Dict[str, float]) -> float:
    if not vec_a or not vec_b:
        return 0.0
    common = set(vec_a) & set(vec_b)
    if not common:
        return 0.0
    dot = sum(vec_a[t] * vec_b[t] for t in common)
    norm_a = math.sqrt(sum(v ** 2 for v in vec_a.values()))
    norm_b = math.sqrt(sum(v ** 2 for v in vec_b.values()))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return min(dot / (norm_a * norm_b), 1.0)


# ── 도서 코퍼스 텍스트 생성 ─────────────────────────────────────────
def book_corpus_text(book) -> str:
    """도서 TF-IDF 대상 텍스트 (title + authors + genres + description[:1000])"""
    parts = [book.title]
    parts += [a.name for a in book.authors.all()]
    parts += [g.name for g in book.genres.all()]
    if book.description:
        parts.append(book.description[:1000])
    return " ".join(parts)


# ── 사전계산 벡터 로드 ───────────────────────────────────────────────
def load_book_vector(book) -> Optional[Dict[str, float]]:
    """DB에 저장된 사전계산 TF-IDF 벡터 로드. 없으면 None."""
    raw = book.tfidf_vector_json
    if not raw or raw == "{}":
        return None
    try:
        return json.loads(raw)
    except (json.JSONDecodeError, ValueError):
        return None


# ── 판정 해시 ────────────────────────────────────────────────────────
def compute_judgment_hash(user_id: int, book_id: int, feature_snapshot: dict) -> str:
    """입력 특성 SHA-256 — 감사 추적 및 캐싱용"""
    payload = json.dumps(
        {"user_id": user_id, "book_id": book_id, "features": feature_snapshot},
        sort_keys=True,
    )
    return hashlib.sha256(payload.encode()).hexdigest()


# ── 콜드스타트 처리 ──────────────────────────────────────────────────
def _cold_start_results(candidate_books, top_n: int) -> List[Tuple]:
    """
    독서 기록 0건 — 평점 높은 책을 low tier로 반환.
    score는 고의로 0.39 이하 (low tier 상한) 로 설정.
    """
    results = []
    for book in candidate_books[:top_n]:
        # 평점 기반 점수: (avg_rating/5) * 0.35 → 최대 0.35 (low tier 유지)
        raw_score = (book.average_rating / 5.0) * 0.35 if book.average_rating else 0.1
        score = round(min(raw_score, 0.39), 4)
        tier = score_to_tier(score)  # 항상 'low'
        results.append(
            (book, score, tier, "아직 독서 기록이 없어요. 인기 도서로 시작해보세요.")
        )
    return results


# ── 메인 추천 함수 ───────────────────────────────────────────────────
def recommend_for_user(
    user,
    candidate_books,
    top_n: int = 20,
    context_page: str = "",
) -> List[Tuple]:
    """
    Returns: [(book, score: float, tier: str, reason: str), ...]
    sorted by score descending, length ≤ top_n.

    tier는 score_to_tier()로만 결정 — 프론트 전달 후 재계산 없음.
    """
    from books.models import UserBookInteraction

    interactions = list(
        UserBookInteraction.objects.filter(user=user)
        .select_related("book")
        .prefetch_related("book__authors", "book__genres")
    )

    # 콜드스타트
    if not interactions:
        return _cold_start_results(list(candidate_books), top_n)

    # 유저 프로필 텍스트 구성 (읽음·좋아요·평점 순위 가중)
    weight_map = {"read": 2, "liked": 2, "rated": 3, "reading": 1, "want_to_read": 0}
    profile_texts: List[str] = []
    for interaction in interactions:
        weight = weight_map.get(interaction.interaction_type, 1)
        text = book_corpus_text(interaction.book)
        profile_texts.extend([text] * weight)

    if not profile_texts:
        profile_texts = [book_corpus_text(i.book) for i in interactions[:5]]

    profile_tokenized = [tokenize(t) for t in profile_texts]

    # 후보 도서 토크나이징 (사전계산 벡터 우선 사용)
    candidate_list = list(candidate_books)
    candidate_tokenized: List[Tuple] = []
    for book in candidate_list:
        precomp = load_book_vector(book)
        # 사전계산 벡터가 없는 경우 실시간 토크나이징 표시
        candidate_tokenized.append((book, tokenize(book_corpus_text(book)), precomp))

    # IDF 계산 (사전계산 없는 경우를 위한 실시간 코퍼스)
    all_docs = profile_tokenized + [tokens for _, tokens, _ in candidate_tokenized if tokens]
    idf = compute_idf(all_docs)

    # 유저 프로필 벡터 (읽은 책 TF-IDF 평균)
    profile_vecs = [tfidf_vector(tokens, idf) for tokens in profile_tokenized if tokens]
    if not profile_vecs:
        return _cold_start_results(candidate_list, top_n)

    all_terms = set()
    for v in profile_vecs:
        all_terms.update(v.keys())
    user_vec: Dict[str, float] = {
        term: sum(v.get(term, 0.0) for v in profile_vecs) / len(profile_vecs)
        for term in all_terms
    }

    # 이미 읽은/찜한 도서 ID 집합
    interacted_book_ids = {i.book_id for i in interactions}
    # 유저 관심 장르
    user_genre_names = set(user.favorite_genres.values_list("name", flat=True))

    results: List[Tuple] = []
    for book, tokens, precomp_vec in candidate_tokenized:
        if book.id in interacted_book_ids:
            continue

        # 점수 계산 (사전계산 벡터 있으면 우선 사용)
        if precomp_vec:
            score = round(cosine_similarity(user_vec, precomp_vec), 4)
        else:
            book_vec = tfidf_vector(tokens, idf)
            score = round(cosine_similarity(user_vec, book_vec), 4)

        tier = score_to_tier(score)

        # 추천 이유 생성
        book_genres = {g.name for g in book.genres.all()}
        matching_genres = user_genre_names & book_genres
        if matching_genres:
            reason = f"'{', '.join(sorted(matching_genres)[:2])}' 장르를 좋아하시는 분께 추천합니다."
        elif tier == "high":
            reason = "독서 취향과 높은 연관성이 있는 도서입니다."
        elif tier == "mid":
            reason = "독서 취향과 부분적으로 겹치는 도서입니다."
        else:
            reason = "새로운 분야를 탐험해보세요."

        results.append((book, score, tier, reason))

    results.sort(key=lambda x: x[1], reverse=True)
    return results[:top_n]


# ── TF-IDF 사전계산 (management command에서 호출) ───────────────────
def recompute_all_tfidf_vectors():
    """
    전체 도서 TF-IDF 벡터 일괄 재계산.
    도서 추가/삭제 후 `python manage.py import_books` 말미에 자동 호출.
    """
    from books.models import Book

    books = list(
        Book.objects.prefetch_related("authors", "genres").all()
    )
    if not books:
        return

    # 전체 코퍼스 IDF
    corpus = [tokenize(book_corpus_text(b)) for b in books]
    idf = compute_idf(corpus)

    now = timezone.now()
    for book, tokens in zip(books, corpus):
        vec = tfidf_vector(tokens, idf)
        # 상위 500 term만 저장 (DB 공간 절약)
        top_vec = dict(sorted(vec.items(), key=lambda x: x[1], reverse=True)[:500])
        Book.objects.filter(pk=book.pk).update(
            tfidf_vector_json=json.dumps(top_vec, ensure_ascii=False),
            tfidf_computed_at=now,
        )
